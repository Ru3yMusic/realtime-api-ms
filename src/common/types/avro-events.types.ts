/**
 * @generated — TypeScript interfaces derived from Avro schemas in avro/schemas/.
 * Keep in sync with realtime-ws-ms/src/common/types/avro-events.types.ts
 */

export const TOPICS = {
  COMMENT_CREATED:    'realtime.comment.created',
  COMMENT_LIKED:      'realtime.comment.liked',
  NOTIFICATION_PUSH:  'realtime.notification.push',
  CHAT_MESSAGE:       'realtime.chat.message',
  // JSON topics from Spring Boot social-service
  FRIEND_REQUEST:     'user.friend.request',
  FRIEND_ACCEPTED:    'user.friend.accepted',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const AVRO_TOPICS: string[] = [
  'realtime.comment.created',
  'realtime.comment.liked',
  'realtime.chat.message',
];

export const JSON_TOPICS: string[] = [
  'user.friend.request',
  'user.friend.accepted',
];

export interface CommentCreatedEvent {
  comment_id:        string;
  song_id:           string;
  station_id:        string;
  user_id:           string;
  username:          string;
  profile_photo_url: string | null;
  content:           string;
  mentions:          string[];
  timestamp:         number;
}

export interface CommentLikedEvent {
  comment_id:        string;
  comment_author_id: string;
  liker_id:          string;
  liker_username:    string;
  liker_photo_url:   string | null;
  song_id:           string;
  station_id:        string;
  timestamp:         number;
  /** Explicit discriminator: 'like' | 'unlike'. Replaces the UNLIKE: prefix hack. */
  action:            'like' | 'unlike';
}

export interface NotificationPushEvent {
  notification_id: string;
  recipient_id:    string;
  actor_id:        string;
  actor_username:  string;
  actor_photo_url: string | null;
  type:            NotificationEventType;
  target_id:       string;
  target_type:     string;
  timestamp:       number;
}

export enum NotificationEventType {
  COMMENT_REACTION = 'COMMENT_REACTION',
  MENTION          = 'MENTION',
  FRIEND_REQUEST   = 'FRIEND_REQUEST',
  FRIEND_ACCEPTED  = 'FRIEND_ACCEPTED',
}

export interface ChatMessageEvent {
  message_id:        string;
  station_id:        string;
  user_id:           string;
  username:          string;
  profile_photo_url: string | null;
  content:           string;
  mentions:          string[];
  timestamp:         string;
}

export interface FriendRequestEvent {
  requesterId:       string;
  addresseeId:       string;
  friendshipId:      string;
  requesterUsername: string;
  requesterPhotoUrl: string | null;
}

export interface FriendAcceptedEvent {
  requesterId:       string;
  addresseeId:       string;
  friendshipId:      string;
  addresseeUsername: string;
  addresseePhotoUrl: string | null;
}
