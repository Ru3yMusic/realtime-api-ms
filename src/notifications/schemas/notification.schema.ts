import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NotificationEventType } from '../../common/types/avro-events.types';

export type NotificationDocument = Notification & Document;

@Schema({
  collection: 'notifications',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class Notification {
  @Prop({ required: true, index: true })
  user_id: string;

  @Prop({ required: true })
  actor_id: string;

  @Prop({ required: true })
  actor_username: string;

  @Prop({ default: null })
  actor_photo_url: string | null;

  @Prop({ required: true, enum: Object.values(NotificationEventType) })
  type: NotificationEventType;

  @Prop({ required: true })
  target_id: string;

  @Prop({ required: true })
  target_type: string;

  @Prop({ default: false, index: true })
  is_read: boolean;

  @Prop({ default: false })
  is_deleted: boolean;

  created_at: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ created_at: -1 });
