import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUserId } from './current-user-id.decorator';

describe('CurrentUserId decorator', () => {
  it('extracts userId from the request object', () => {
    class TestController {
      endpoint(@CurrentUserId() _userId: string) {
        return null;
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'endpoint');
    const key = Object.keys(metadata)[0];
    const factory = metadata[key].factory as (data: unknown, ctx: ExecutionContext) => string;

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ userId: 'user-123' }),
      }),
    } as any;

    const userId = factory(undefined, ctx);
    expect(userId).toBe('user-123');
  });
});
