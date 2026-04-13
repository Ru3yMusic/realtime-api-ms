import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Parameter decorator that extracts the authenticated user's ID from the
 * request object. The ID is set by JwtGuard after verifying the Bearer token.
 *
 * Usage:
 *   async myEndpoint(@CurrentUserId() userId: string) { ... }
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request & { userId: string }>();
    return request.userId;
  },
);
