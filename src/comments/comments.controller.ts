import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommentsService } from './comments.service';

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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') commentEventId: string, @Headers('x-user-id') userId: string) {
    await this.service.deleteByEventId(commentEventId, userId);
  }
}
