import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { verifyJwt, normalisePem } from '../utils/jwt.util';

/**
 * Global HTTP guard that validates Bearer JWT tokens (RS256).
 *
 * On success:  sets `request.userId` from the verified token's `sub` claim.
 * On failure:  throws UnauthorizedException (401).
 *
 * The /health endpoint bypasses this guard because it is registered as a raw
 * Express route (app.getHttpAdapter().get('/health', ...)) in main.ts and
 * therefore never passes through the NestJS guard layer.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request    = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token     = authHeader.slice(7);
    const rawKey    = this.configService.get<string>('jwtPublicKey') ?? '';
    const publicKey = normalisePem(rawKey);

    try {
      const payload = verifyJwt(token, publicKey);

      if (!payload.sub) {
        throw new UnauthorizedException('Token missing sub claim');
      }

      // Attach userId to the request so controllers can read it via @CurrentUserId()
      (request as Request & { userId: string }).userId = payload.sub;
      return true;
    } catch (err) {
      // Re-throw NestJS exceptions as-is; wrap jwt errors in 401
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException((err as Error).message);
    }
  }
}
