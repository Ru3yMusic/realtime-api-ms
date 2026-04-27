import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { CommentLike, CommentLikeDocument } from './schemas/comment-like.schema';
import { CommentCreatedEvent } from '../common/types/avro-events.types';

export interface CommentsQuery {
  songId:         string;
  stationId:      string;
  sort?:          'popular' | 'recent';
  page?:          number;
  size?:          number;
  /**
   * Current station session version. When provided, only comments saved
   * under that version are returned — older comments (from a previous
   * audience that already left) stay hidden. Omit to return all (legacy).
   */
  currentVersion?: number;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)     private commentModel: Model<CommentDocument>,
    @InjectModel(CommentLike.name) private likeModel: Model<CommentLikeDocument>,
  ) {}

  /**
   * Upsert from Kafka event — idempotent via comment_event_id unique index.
   * Uses $setOnInsert so replayed events are no-ops.
   */
  async persistFromEvent(event: CommentCreatedEvent): Promise<CommentDocument> {
    return this.commentModel.findOneAndUpdate(
      { comment_event_id: event.comment_id },
      {
        $setOnInsert: {
          comment_event_id: event.comment_id,
          song_id:          event.song_id,
          station_id:       event.station_id,
          user_id:          event.user_id,
          username:         event.username,
          profile_photo_url: event.profile_photo_url ?? null,
          content:          event.content,
          mentions:         event.mentions ?? [],
          likes_count:      0,
          session_version:  event.session_version ?? 1,
        },
      },
      { upsert: true, new: true },
    );
  }

  async incrementLikes(commentEventId: string, userId: string): Promise<void> {
    // Upsert like record — idempotent
    const result = await this.likeModel.updateOne(
      { comment_event_id: commentEventId, user_id: userId },
      { $setOnInsert: { comment_event_id: commentEventId, user_id: userId } },
      { upsert: true },
    );
    // Only increment if this is a new like (not a duplicate)
    if (result.upsertedCount > 0) {
      await this.commentModel.updateOne(
        { comment_event_id: commentEventId },
        { $inc: { likes_count: 1 } },
      );
    }
  }

  async decrementLikes(commentEventId: string, userId: string): Promise<void> {
    const result = await this.likeModel.deleteOne({
      comment_event_id: commentEventId,
      user_id: userId,
    });
    if (result.deletedCount > 0) {
      await this.commentModel.updateOne(
        { comment_event_id: commentEventId },
        { $inc: { likes_count: -1 } },
      );
    }
  }

  async findBySong(query: CommentsQuery): Promise<{ data: CommentDocument[]; total: number }> {
    const filter: Record<string, unknown> = { song_id: query.songId, station_id: query.stationId };
    if (typeof query.currentVersion === 'number') {
      filter.session_version = query.currentVersion;
    }
    const sort   = query.sort === 'popular' ? { likes_count: -1 } : { created_at: -1 };
    const skip   = (query.page ?? 0) * (query.size ?? 20);
    const limit  = query.size ?? 20;

    const [data, total] = await Promise.all([
      this.commentModel.find(filter).sort(sort as any).skip(skip).limit(limit),
      this.commentModel.countDocuments(filter),
    ]);
    return { data, total };
  }

  async findByEventId(commentEventId: string): Promise<CommentDocument | null> {
    return this.commentModel.findOne({ comment_event_id: commentEventId });
  }

  async deleteByEventId(commentEventId: string, userId: string): Promise<void> {
    const result = await this.commentModel.deleteOne({
      comment_event_id: commentEventId,
      user_id: userId,
    });
    if (result.deletedCount === 0) throw new NotFoundException('Comment not found or not yours');
  }
}
