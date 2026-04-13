import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

@Schema({
  collection: 'chat_messages',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ChatMessage {
  /** UUID from ws-ms — idempotency key */
  @Prop({ required: true, unique: true, index: true })
  message_id: string;

  @Prop({ required: true, index: true })
  station_id: string;

  @Prop({ required: true, index: true })
  user_id: string;

  @Prop({ required: true })
  username: string;

  @Prop({ default: null })
  profile_photo_url: string | null;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [] })
  mentions: string[];

  @Prop({ default: false })
  is_deleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ station_id: 1, createdAt: -1 });
