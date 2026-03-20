# realtime-api-ms

Persistence and notification microservice for RUBY MUSIC real-time features. Consumes Kafka events, writes to MongoDB, manages Redis badge counters, and produces push notifications back to `realtime-ws-ms`.

**Port:** `3002` | **Framework:** NestJS 10 | **DB:** MongoDB 7

---

## Responsibilities

- Consume Avro events (`realtime.comment.created`, `realtime.comment.liked`) from `realtime-ws-ms`
- Consume JSON events (`user.friend.request`, `user.friend.accepted`) from `social-service`
- Persist comments and comment likes in MongoDB (idempotent via `comment_event_id`)
- Persist notifications in MongoDB for offline delivery
- Maintain Redis badge counters (`badge:notifications:{userId}`, `badge:friends:{userId}`)
- Produce `realtime.notification.push` (Avro) to trigger WebSocket delivery in `realtime-ws-ms`
- Expose REST endpoints for notification listing, badge management, and comment queries

---

## Architecture

```
realtime-ws-ms ──▶ realtime.comment.created (Avro) ──▶ CommentCreatedHandler
                                                           ├── MongoDB: song_comments (upsert)
                                                           ├── MongoDB: notifications (MENTION)
                                                           ├── Redis: badge:notifications (incr)
                                                           └── Kafka: notification.push

realtime-ws-ms ──▶ realtime.comment.liked (Avro) ──▶ CommentLikedHandler
                                                           ├── MongoDB: comment_likes (upsert)
                                                           ├── MongoDB: song_comments ($inc likes)
                                                           ├── MongoDB: notifications (COMMENT_REACTION)
                                                           ├── Redis: badge:notifications (incr)
                                                           └── Kafka: notification.push

social-service ──▶ user.friend.request  (JSON) ──▶ FriendRequestHandler
                                                           ├── MongoDB: notifications (FRIEND_REQUEST)
                                                           ├── Redis: badge:friends (incr)
                                                           └── Kafka: notification.push

social-service ──▶ user.friend.accepted (JSON) ──▶ FriendAcceptedHandler
                                                           ├── MongoDB: notifications (FRIEND_ACCEPTED)
                                                           ├── Redis: badge:notifications (incr)
                                                           └── Kafka: notification.push

realtime-api-ms ──▶ realtime.notification.push (Avro) ──▶ realtime-ws-ms ──▶ WebSocket client
```

---

## Kafka Topics

### Consumed

| Topic | Group | Format | Handler |
|---|---|---|---|
| `realtime.comment.created` | `realtime-api-ms-avro` | Avro | `CommentCreatedHandler` |
| `realtime.comment.liked` | `realtime-api-ms-avro` | Avro | `CommentLikedHandler` |
| `realtime.notification.push` | `realtime-api-ms-avro` | Avro | _(consumed by ws-ms, not api-ms)_ |
| `user.friend.request` | `realtime-api-ms-json` | JSON | `FriendRequestHandler` |
| `user.friend.accepted` | `realtime-api-ms-json` | JSON | `FriendAcceptedHandler` |

Two separate consumer groups:
- `realtime-api-ms-avro` — Avro topics (decoded via `SchemaRegistryService`)
- `realtime-api-ms-json` — JSON topics from Spring Boot services (plain `JSON.parse`)

### Produced

| Topic | Format | Trigger |
|---|---|---|
| `realtime.notification.push` | Avro | Every handler that creates a notification |

---

## Event Processing Details

### `CommentCreatedHandler`
- Uses **`mergeMap` (concurrency: 10)** — comments are independent and can be processed in parallel
- Idempotent: MongoDB upsert uses `comment_event_id` unique index (`$setOnInsert`)
- Detects `@mentions` from the event payload (array of user UUIDs)
- For each mentioned user (excluding self): persists MENTION notification + increments badge + publishes push

### `CommentLikedHandler`
- Uses **`concatMap` (sequential)** — prevents `$inc` race conditions on `likes_count`
- Detects unlike via `liker_username` prefix `"UNLIKE:"` → calls `decrementLikes` instead
- Skips notification for self-likes (`liker_id === comment_author_id`)
- Persists COMMENT_REACTION notification + increments badge + publishes push

### `FriendRequestHandler`
- Persists FRIEND_REQUEST notification → increments `badge:friends` (not notification badge)
- Publishes push so the addressee sees real-time request alert

### `FriendAcceptedHandler`
- Notifies the **original requester** (not the accepter) about the accepted friendship
- Increments `badge:notifications` (shows in general notification count)

---

## REST Endpoints

All routes prefixed with `/api` (e.g. `GET /api/notifications`).

### Notifications

| Method | Path | Headers | Query | Description |
|---|---|---|---|---|
| `GET` | `/api/notifications` | `X-User-Id` | `page`, `size` | List paginated notifications (excludes soft-deleted) |
| `GET` | `/api/notifications/badges` | `X-User-Id` | — | Get `{ notifications, friends }` badge counts from Redis |
| `PATCH` | `/api/notifications/read-all` | `X-User-Id` | — | Mark all as read + clear notification badge |
| `PATCH` | `/api/notifications/:id/read` | `X-User-Id` | — | Mark one notification as read |
| `DELETE` | `/api/notifications/:id` | `X-User-Id` | — | Soft-delete a notification |
| `DELETE` | `/api/notifications/badges/friends` | `X-User-Id` | — | Clear friend badge counter |

### Comments (read + delete)

| Method | Path | Headers | Query | Description |
|---|---|---|---|---|
| `GET` | `/api/comments` | — | `songId`, `stationId`, `sort` (`recent`\|`popular`), `page`, `size` | Paginated comments for a song/station |
| `DELETE` | `/api/comments/:id` | `X-User-Id` | — | Soft-delete own comment by `comment_event_id` |

---

## MongoDB Collections

### `song_comments`
```
comment_event_id  String   unique index — client UUID (idempotency key)
song_id           String   index
station_id        String   index
user_id           String
username          String   denormalized (copied at write time)
profile_photo_url String | null
content           String
mentions          String[]
likes_count       Number   default 0, index
created_at        Date     index (desc)
updated_at        Date
```

### `comment_likes`
```
comment_event_id  String   compound unique index with user_id
user_id           String
created_at        Date
```

### `notifications`
```
user_id           String   index
actor_id          String
actor_username    String   denormalized
actor_photo_url   String | null
type              Enum     COMMENT_REACTION | MENTION | FRIEND_REQUEST | FRIEND_ACCEPTED
target_id         String
target_type       String   "COMMENT" | "USER"
is_read           Boolean  index, default false
is_deleted        Boolean  default false
created_at        Date     index (desc)
```

---

## Avro Schemas (`avro/schemas/`)

| File | Event | Direction |
|---|---|---|
| `realtime.comment.created.avsc` | `CommentCreatedEvent` | Consumed |
| `realtime.comment.liked.avsc` | `CommentLikedEvent` | Consumed |
| `realtime.notification.push.avsc` | `NotificationPushEvent` | Produced |

### Schema Registry modes
- **Dev** (`SCHEMA_REGISTRY_URL` unset): local `.avsc` files, raw Avro binary
- **Prod** (`SCHEMA_REGISTRY_URL` set): Confluent wire format — `0x00` + 4-byte schema ID + Avro payload

---

## Redis Keys

| Key pattern | Type | TTL | Managed by |
|---|---|---|---|
| `badge:notifications:{userId}` | String (integer counter) | none | `RedisService` |
| `badge:friends:{userId}` | String (integer counter) | none | `RedisService` |

Badges are incremented on notification creation and cleared on read-all / explicit clear. Presence keys (`presence:*`, `station:*:listeners`) are owned exclusively by `realtime-ws-ms`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | HTTP port |
| `MONGODB_URI` | `mongodb://localhost:27017/realtime_db` | MongoDB connection string |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH password |
| `KAFKA_BROKER` | `localhost:9092` | Kafka broker address |
| `KAFKA_GROUP_ID_AVRO` | `realtime-api-ms-avro` | Consumer group for Avro topics |
| `KAFKA_GROUP_ID_JSON` | `realtime-api-ms-json` | Consumer group for JSON topics |
| `SCHEMA_REGISTRY_URL` | _(empty)_ | Confluent Schema Registry URL — empty = dev mode |

In Docker all values are injected via `docker-compose.yml` from the root `.env`. The `.env.example` file is for local non-Docker development only.

---

## Build & Run

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm start
```

### Run with Docker (from repo root)
```bash
docker compose up realtime-api-ms
```

---

## Module Structure

```
src/
├── main.ts                          ← Bootstrap; /health endpoint; global prefix /api
├── app.module.ts
├── config/
│   └── configuration.ts             ← Typed config from process.env
├── kafka/
│   ├── kafka.consumer.ts            ← Two consumer groups: Avro + JSON
│   ├── kafka.producer.ts            ← publishNotificationPush (Avro)
│   └── kafka-streams.service.ts     ← RxJS Subject per topic — decouples consumers from handlers
├── schema-registry/
│   └── schema-registry.service.ts   ← Avro encode/decode (dev + Confluent prod)
├── redis/
│   └── redis.service.ts             ← Badge counter ops (incr, get, clear)
├── comments/
│   ├── comments.service.ts          ← persistFromEvent, incrementLikes, findBySong, deleteByEventId
│   ├── comments.controller.ts       ← REST: GET /comments, DELETE /comments/:id
│   ├── schemas/                     ← Mongoose: Comment, CommentLike
│   └── handlers/
│       ├── comment-created.handler.ts  ← mergeMap(10): persist + mention notifications
│       └── comment-liked.handler.ts    ← concatMap: likes/unlikes + reaction notifications
├── notifications/
│   ├── notifications.service.ts     ← create, findByUser, markAsRead, badges
│   ├── notifications.controller.ts  ← REST: GET/PATCH/DELETE /notifications, badges
│   ├── schemas/                     ← Mongoose: Notification
│   └── handlers/
│       ├── friend-request.handler.ts   ← FRIEND_REQUEST → MongoDB + friend badge + push
│       └── friend-accepted.handler.ts  ← FRIEND_ACCEPTED → MongoDB + notification badge + push
├── exception/
│   └── global-exception.filter.ts   ← Catches all unhandled exceptions
└── common/types/
    └── avro-events.types.ts         ← TypeScript interfaces for Kafka payloads (Avro + JSON)
```
