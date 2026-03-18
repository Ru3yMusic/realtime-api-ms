import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(
    @Headers('x-user-id') userId: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const { data, total } = await this.service.findByUser(userId, +page, +size);
    return { content: data, total, page: +page, size: +size };
  }

  @Get('badges')
  async getBadges(@Headers('x-user-id') userId: string) {
    return this.service.getBadges(userId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(@Headers('x-user-id') userId: string) {
    await this.service.markAllAsRead(userId);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Headers('x-user-id') userId: string) {
    return this.service.markAsRead(id, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Headers('x-user-id') userId: string) {
    await this.service.softDelete(id, userId);
  }

  @Delete('badges/friends')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearFriendBadge(@Headers('x-user-id') userId: string) {
    await this.service.clearFriendBadge(userId);
  }
}
