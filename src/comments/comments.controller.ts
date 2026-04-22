import {
  Controller,
  Get,
  Delete,
  NotFoundException,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';

@Controller('comments')
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get()
  async list(
    @Query('songId')    songId: string,
    @Query('stationId') stationId: string,
    @Query('sort')      sort: 'popular' | 'recent' = 'recent',
    @Query('page')      page = '0',
    @Query('size')      size = '20',
  ) {
    const { data, total } = await this.service.findBySong({ songId, stationId, sort, page: +page, size: +size });
    return { content: data, total, page: +page, size: +size };
  }

  /**
   * Lookup a single comment by its client-generated idempotency key
   * (comment_event_id). Consumed by:
   *   - admin "Gestión de reportes": resolve the comment's author.
   *   - user notifications "Ir" button on MENTION items: resolve the station
   *     to navigate to (notifications only persist target_id = commentId).
   */
  @Get(':id')
  async getById(@Param('id') commentEventId: string) {
    const doc = await this.service.findByEventId(commentEventId);
    if (!doc) throw new NotFoundException('Comment not found');
    return {
      user_id:           doc.user_id,
      username:          doc.username,
      profile_photo_url: doc.profile_photo_url,
      content:           doc.content,
      station_id:        doc.station_id,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') commentEventId: string, @CurrentUserId() userId: string) {
    await this.service.deleteByEventId(commentEventId, userId);
  }
}
