import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

describe('CommentsController', () => {
  let controller: CommentsController;
  let service: jest.Mocked<Pick<CommentsService, 'findBySong' | 'findByEventId' | 'deleteByEventId'>>;

  beforeEach(async () => {
    service = {
      findBySong: jest.fn(),
      findByEventId: jest.fn(),
      deleteByEventId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [{ provide: CommentsService, useValue: service }],
    }).compile();

    controller = module.get<CommentsController>(CommentsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns paginated comments with defaults', async () => {
    service.findBySong.mockResolvedValue({ data: [] as any, total: 0 });

    const result = await controller.list('song-1', 'station-1');

    expect(service.findBySong).toHaveBeenCalledWith({
      songId: 'song-1',
      stationId: 'station-1',
      sort: 'recent',
      page: 0,
      size: 20,
    });
    expect(result).toEqual({ content: [], total: 0, page: 0, size: 20 });
  });

  it('maps a found comment for GET by id', async () => {
    service.findByEventId.mockResolvedValue({
      user_id: 'user-1',
      username: 'alice',
      profile_photo_url: null,
      content: 'hola',
      station_id: 'station-9',
    } as any);

    const result = await controller.getById('comment-evt-1');

    expect(service.findByEventId).toHaveBeenCalledWith('comment-evt-1');
    expect(result).toEqual({
      user_id: 'user-1',
      username: 'alice',
      profile_photo_url: null,
      content: 'hola',
      station_id: 'station-9',
    });
  });

  it('throws NotFoundException when comment does not exist', async () => {
    service.findByEventId.mockResolvedValue(null);

    await expect(controller.getById('missing-comment')).rejects.toThrow(NotFoundException);
  });

  it('delegates deletion to service with comment id and user id', async () => {
    service.deleteByEventId.mockResolvedValue(undefined);

    await controller.delete('comment-evt-1', 'user-9');

    expect(service.deleteByEventId).toHaveBeenCalledWith('comment-evt-1', 'user-9');
  });
});
