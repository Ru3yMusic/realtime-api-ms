describe('configuration', () => {
  const originalEnv = { ...process.env };

  const loadConfiguration = async () => {
    jest.resetModules();
    const mod = await import('./configuration');
    return mod.default;
  };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns defaults when env vars are not provided', async () => {
    delete process.env.PORT;
    delete process.env.REDIS_PORT;
    delete process.env.KAFKA_CONSUMER_GROUP_SUFFIX;
    delete process.env.KAFKA_GROUP_ID_AVRO;
    delete process.env.KAFKA_GROUP_ID_JSON;

    const configuration = await loadConfiguration();
    const config = configuration();

    expect(config.port).toBe(3002);
    expect(config.redis.port).toBe(6379);
    expect(config.kafka.groupIdAvro).toBe('realtime-api-ms-avro');
    expect(config.kafka.groupIdJson).toBe('realtime-api-ms-json');
  });

  it('appends the consumer group suffix when configured', async () => {
    process.env.KAFKA_CONSUMER_GROUP_SUFFIX = 'staging';
    process.env.KAFKA_GROUP_ID_AVRO = 'custom-avro';
    process.env.KAFKA_GROUP_ID_JSON = 'custom-json';
    process.env.PORT = '4000';
    process.env.REDIS_PORT = '6380';

    const configuration = await loadConfiguration();
    const config = configuration();

    expect(config.port).toBe(4000);
    expect(config.redis.port).toBe(6380);
    expect(config.kafka.groupIdAvro).toBe('custom-avro-staging');
    expect(config.kafka.groupIdJson).toBe('custom-json-staging');
  });
});
