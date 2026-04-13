import { AVRO_TOPICS, JSON_TOPICS, TOPICS } from './avro-events.types';

describe('avro-events.types — topic lists', () => {
  // ── Task 2.1 critical guard ───────────────────────────────────────────────

  it('AVRO_TOPICS does NOT include realtime.notification.push', () => {
    expect(AVRO_TOPICS).not.toContain(TOPICS.NOTIFICATION_PUSH);
    expect(AVRO_TOPICS).not.toContain('realtime.notification.push');
  });

  it('AVRO_TOPICS only contains comment and chat topics consumed by api-ms', () => {
    expect(AVRO_TOPICS).toEqual([
      'realtime.comment.created',
      'realtime.comment.liked',
      'realtime.chat.message',
    ]);
  });

  it('JSON_TOPICS contains the friend topics from Spring social-service', () => {
    expect(JSON_TOPICS).toContain('user.friend.request');
    expect(JSON_TOPICS).toContain('user.friend.accepted');
  });
});
