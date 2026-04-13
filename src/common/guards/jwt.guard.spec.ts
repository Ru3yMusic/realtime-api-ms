import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtGuard } from './jwt.guard';

// Mock jsonwebtoken BEFORE the module is imported so jest intercepts it
jest.mock('jsonwebtoken');
import * as jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----';

/** Builds a mock NestJS ExecutionContext from a plain request object */
function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JwtGuard', () => {
  let guard: JwtGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtGuard,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(MOCK_PUBLIC_KEY) },
        },
      ],
    }).compile();

    guard = module.get<JwtGuard>(JwtGuard);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Valid token ────────────────────────────────────────────────────────────

  it('returns true and sets request.userId when token is valid', () => {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'user-123' });

    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer valid.jwt.token' },
    };
    const ctx = makeContext(req);

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req['userId']).toBe('user-123');
  });

  // ── Missing / malformed header ─────────────────────────────────────────────

  it('throws 401 when Authorization header is absent', () => {
    const ctx = makeContext({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when Authorization header is not a Bearer token', () => {
    const ctx = makeContext({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  // ── Invalid token ──────────────────────────────────────────────────────────

  it('throws 401 when token has an invalid signature', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const ctx = makeContext({ headers: { authorization: 'Bearer bad.jwt.token' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when token is expired', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      const err: Error & { name?: string } = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      throw err;
    });

    const ctx = makeContext({ headers: { authorization: 'Bearer expired.jwt.token' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when token payload is missing the sub claim', () => {
    (jwt.verify as jest.Mock).mockReturnValue({ role: 'USER' }); // no sub

    const ctx = makeContext({ headers: { authorization: 'Bearer no-sub.jwt.token' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  // ── Health endpoint note ───────────────────────────────────────────────────
  // The /health endpoint is registered as a raw Express route in main.ts via
  // app.getHttpAdapter().get('/health', ...) and therefore NEVER reaches the
  // NestJS guard layer. No test needed here — it is excluded by design.
});
