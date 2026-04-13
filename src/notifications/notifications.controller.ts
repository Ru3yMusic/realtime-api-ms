import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUserId } from '../common/decorators/current-user-id.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(
    @CurrentUserId() userId: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
    @Query('type') type?: string,
  ) {
    const { data, total } = await this.service.findByUser(userId, +page, +size, type);
    return { content: data, total, page: +page, size: +size };
  }

  @Get('badges')
  async getBadges(@CurrentUserId() userId: string) {
    return this.service.getBadges(userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(@CurrentUserId() userId: string) {
    await this.service.markAllAsRead(userId);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.service.markAsRead(id, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUserId() userId: string) {
    await this.service.softDelete(id, userId);
  }

  @Delete('badges/friends')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearFriendBadge(@CurrentUserId() userId: string) {
    await this.service.clearFriendBadge(userId);
  }
}
