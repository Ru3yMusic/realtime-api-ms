import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatMessage, ChatMessageDocument } from './schemas/chat-message.schema';

export interface SaveChatMessageData {
  message_id:        string;
  station_id:        string;
  user_id:           string;
  username:          string;
  profile_photo_url: string | null;
  content:           string;
  mentions:          string[];
}

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
  ) {}

  /**
   * Persist from Kafka event — idempotent via unique index on message_id.
   * Uses $setOnInsert so replayed events are no-ops.
   */
  async saveMessage(data: SaveChatMessageData): Promise<ChatMessageDocument> {
    return this.chatMessageModel.findOneAndUpdate(
      { message_id: data.message_id },
      {
        $setOnInsert: {
          message_id:        data.message_id,
          station_id:        data.station_id,
          user_id:           data.user_id,
          username:          data.username,
          profile_photo_url: data.profile_photo_url ?? null,
          content:           data.content,
          mentions:          data.mentions ?? [],
          is_deleted:        false,
        },
      },
      { upsert: true, new: true },
    );
  }

  /**
   * Paginated chat history for a station — newest first, excludes soft-deleted.
   */
  async getMessages(
    stationId: string,
    page: number,
    size: number,
  ): Promise<{ data: ChatMessageDocument[]; total: number }> {
    const filter = { station_id: stationId, is_deleted: false };
    const skip   = page * size;

    const [data, total] = await Promise.all([
      this.chatMessageModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(size),
      this.chatMessageModel.countDocuments(filter),
    ]);

    return { data, total };
  }

  /**
   * Soft delete — only the message owner can delete their message.
   * Throws NotFoundException if not found or not owned by userId.
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const result = await this.chatMessageModel.updateOne(
      { message_id: messageId, user_id: userId, is_deleted: false },
      { $set: { is_deleted: true } },
    );

    if (result.modifiedCount === 0) {
      throw new NotFoundException('Message not found or not yours');
    }
  }
}
