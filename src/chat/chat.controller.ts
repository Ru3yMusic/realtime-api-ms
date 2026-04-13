import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';

@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  /** GET /chat/:stationId?page=0&size=20 — paginated chat history */
  @Get(':stationId')
  async getHistory(
    @Param('stationId') stationId: string,
    @Query('page')      page = '0',
    @Query('size')      size = '20',
  ) {
    const { data, total } = await this.service.getMessages(stationId, +page, +size);
    return { content: data, total, page: +page, size: +size };
  }

  /** DELETE /chat/:messageId — soft delete (ownership enforced by service) */
  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('messageId') messageId: string,
    @CurrentUserId()    userId: string,
  ) {
    await this.service.deleteMessage(messageId, userId);
  }
}
