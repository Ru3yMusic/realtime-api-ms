import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CommentLikeDocument = CommentLike & Document;

@Schema({
  collection: 'comment_likes',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class CommentLike {
  @Prop({ required: true, index: true })
  comment_event_id: string;  // references comment.comment_event_id

  @Prop({ required: true })
  user_id: string;

  created_at: Date;
}

export const CommentLikeSchema = SchemaFactory.createForClass(CommentLike);
CommentLikeSchema.index({ comment_event_id: 1, user_id: 1 }, { unique: true });
