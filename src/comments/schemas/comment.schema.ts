import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CommentDocument = Comment & Document;

@Schema({
  collection: 'song_comments',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Comment {
  /** Client-generated UUID — idempotency key from realtime-ws-ms event */
  @Prop({ required: true, unique: true, index: true })
  comment_event_id: string;

  @Prop({ required: true, index: true })
  song_id: string;

  @Prop({ required: true, index: true })
  station_id: string;

  @Prop({ required: true })
  user_id: string;

  @Prop({ required: true })
  username: string;

  @Prop({ default: null })
  profile_photo_url: string | null;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [] })
  mentions: string[];

  @Prop({ default: 0, index: true })
  likes_count: number;

  /**
   * Station session version at the moment this comment was created.
   * Bumped server-side when the listener count drops to 0 (everyone left
   * the station). The GET endpoint filters by the current version, so
   * comments from previous sessions become invisible to the new audience
   * — soft-delete via versioning instead of hard delete.
   */
  @Prop({ required: true, default: 1, index: true })
  session_version: number;

  created_at: Date;
  updated_at: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ created_at: -1 });
CommentSchema.index({ likes_count: -1 });
CommentSchema.index({ station_id: 1, song_id: 1, session_version: 1, created_at: -1 });
