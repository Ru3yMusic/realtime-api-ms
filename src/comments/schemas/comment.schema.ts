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

  created_at: Date;
  updated_at: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ created_at: -1 });
CommentSchema.index({ likes_count: -1 });
