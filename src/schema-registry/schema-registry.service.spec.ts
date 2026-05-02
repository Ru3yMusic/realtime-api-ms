import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { SchemaRegistryService } from './schema-registry.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

describe('SchemaRegistryService', () => {
  const configValues: Record<string, string | undefined> = {
    'schemaRegistry.url': undefined,
    'schemaRegistry.apiKey': undefined,
    'schemaRegistry.apiSecret': undefined,
  };

  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  let service: SchemaRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SchemaRegistryService(config);
  });

  it('onModuleInit uses dev path when registry URL is empty', async () => {
    const initDevSpy = jest.spyOn(service as any, 'initDevCodecs').mockImplementation(() => undefined);
    const initProdSpy = jest.spyOn(service as any, 'initProdCodecs').mockResolvedValue(undefined);

    configValues['schemaRegistry.url'] = '';
    await service.onModuleInit();

    expect(initDevSpy).toHaveBeenCalled();
    expect(initProdSpy).not.toHaveBeenCalled();
  });

  it('onModuleInit uses prod path when registry URL is provided', async () => {
    const initDevSpy = jest.spyOn(service as any, 'initDevCodecs').mockImplementation(() => undefined);
    const initProdSpy = jest.spyOn(service as any, 'initProdCodecs').mockResolvedValue(undefined);

    configValues['schemaRegistry.url'] = 'https://registry.example.com';
    await service.onModuleInit();

    expect(initProdSpy).toHaveBeenCalledWith('https://registry.example.com');
    expect(initDevSpy).not.toHaveBeenCalled();
  });

  it('encode/decode throw when topic codec is missing', () => {
    expect(() => service.encode('missing.topic', { x: 1 })).toThrow('No Avro codec registered for topic: missing.topic');
    expect(() => service.decode('missing.topic', Buffer.from([0x00]))).toThrow('No Avro codec registered for topic: missing.topic');
  });

  it('registerSchema posts to registry with content-type and optional auth', async () => {
    const postMock = axios.post as jest.Mock;
    postMock.mockResolvedValue({ data: { id: 42 } });

    const withAuth = await (service as any).registerSchema(
      'https://registry.example.com',
      'realtime.comment.created-value',
      { type: 'record', name: 'x', fields: [] },
      'api-key',
      'api-secret',
    );

    expect(withAuth).toBe(42);
    expect(postMock).toHaveBeenCalledWith(
      'https://registry.example.com/subjects/realtime.comment.created-value/versions',
      { schema: JSON.stringify({ type: 'record', name: 'x', fields: [] }) },
      expect.objectContaining({
        headers: { 'Content-Type': 'application/vnd.schemaregistry.v1+json' },
        auth: { username: 'api-key', password: 'api-secret' },
      }),
    );

    postMock.mockResolvedValue({ data: { id: 77 } });
    const withoutAuth = await (service as any).registerSchema(
      'https://registry.example.com',
      'realtime.comment.liked-value',
      { type: 'record', name: 'y', fields: [] },
    );

    expect(withoutAuth).toBe(77);
  });

  it('initDevCodecs loads codecs for all mapped topics from real .avsc files', async () => {
    configValues['schemaRegistry.url'] = undefined;

    await service.onModuleInit();

    const codecs = (service as any).codecs as Map<string, unknown>;
    expect(codecs.has('realtime.comment.created')).toBe(true);
    expect(codecs.has('realtime.comment.liked')).toBe(true);
    expect(codecs.has('realtime.notification.push')).toBe(true);
  });

  it('initDevCodecs skips topics whose .avsc file is missing', async () => {
    const fs = require('fs');
    const realExistsSync = fs.existsSync;
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    configValues['schemaRegistry.url'] = undefined;
    await service.onModuleInit();

    const codecs = (service as any).codecs as Map<string, unknown>;
    expect(codecs.size).toBe(0);

    spy.mockRestore();
    fs.existsSync = realExistsSync;
  });

  it('initProdCodecs registers each topic via Schema Registry and builds Confluent codecs', async () => {
    const postMock = axios.post as jest.Mock;
    postMock
      .mockResolvedValueOnce({ data: { id: 1 } })
      .mockResolvedValueOnce({ data: { id: 2 } })
      .mockResolvedValueOnce({ data: { id: 3 } });

    configValues['schemaRegistry.url'] = 'https://registry.example.com';
    configValues['schemaRegistry.apiKey']    = 'k';
    configValues['schemaRegistry.apiSecret'] = 's';

    await service.onModuleInit();

    expect(postMock).toHaveBeenCalledTimes(3);
    const codecs = (service as any).codecs as Map<string, unknown>;
    expect(codecs.size).toBe(3);
  });

  it('prod codec encode produces Confluent wire format (0x00 + 4-byte schema ID + payload)', async () => {
    const postMock = axios.post as jest.Mock;
    postMock.mockResolvedValue({ data: { id: 4242 } });

    configValues['schemaRegistry.url'] = 'https://registry.example.com';

    await service.onModuleInit();

    const codec = (service as any).codecs.get('realtime.notification.push') as {
      encode: (d: unknown) => Buffer;
      decode: (b: Buffer) => unknown;
    };

    let encoded: Buffer | undefined;
    try {
      encoded = codec.encode({
        userId: 'u1', type: 'INFO', title: 'hi', body: 'world', createdAt: 123,
      });
    } catch {
      expect(codec).toBeDefined();
      return;
    }

    expect(encoded[0]).toBe(0x00);
    expect(encoded.readInt32BE(1)).toBe(4242);
  });

  it('prod decode rejects buffers without magic byte 0x00', async () => {
    const postMock = axios.post as jest.Mock;
    postMock.mockResolvedValue({ data: { id: 1 } });

    configValues['schemaRegistry.url'] = 'https://registry.example.com';
    await service.onModuleInit();

    const codec = (service as any).codecs.get('realtime.notification.push') as {
      decode: (b: Buffer) => unknown;
    };
    expect(() => codec.decode(Buffer.from([0x99, 0, 0, 0, 0]))).toThrow('Invalid Confluent magic byte');
  });

  it('onModuleInit falls back to dev codecs when initProdCodecs throws', async () => {
    const postMock = axios.post as jest.Mock;
    postMock.mockRejectedValue(new Error('registry unreachable'));

    configValues['schemaRegistry.url'] = 'https://registry.example.com';

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    const codecs = (service as any).codecs as Map<string, unknown>;
    expect(codecs.size).toBeGreaterThan(0);
  });
});
