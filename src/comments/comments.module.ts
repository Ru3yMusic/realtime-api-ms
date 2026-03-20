import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { CommentLike, CommentLikeSchema } from './schemas/comment-like.schema';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { CommentCreatedHandler } from './handlers/comment-created.handler';
import { CommentLikedHandler } from './handlers/comment-liked.handler';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Comment.name,     schema: CommentSchema     },
      { name: CommentLike.name, schema: CommentLikeSchema },
    ]),
    NotificationsModule,
  ],
  providers: [CommentsService, CommentCreatedHandler, CommentLikedHandler],
  controllers: [CommentsController],
  exports: [CommentsService],
})
export class CommentsModule {}
