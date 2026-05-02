import { NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';

function makeChainable(resolved: unknown) {
  const chain = {
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(resolved),
  };
  return chain;
}

describe('CommentsService', () => {
  let commentModel: any;
  let likeModel: any;
  let service: CommentsService;

  beforeEach(() => {
    commentModel = {
      findOneAndUpdate: jest.fn(),
      updateOne:        jest.fn(),
      find:             jest.fn(),
      countDocuments:   jest.fn(),
      findOne:          jest.fn(),
      deleteOne:        jest.fn(),
    };
    likeModel = {
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    service = new CommentsService(commentModel, likeModel);
  });

  // ── persistFromEvent ───────────────────────────────────────────────────

  it('persistFromEvent upserts via findOneAndUpdate using comment_event_id', async () => {
    const event = {
      comment_id: 'c-1',
      song_id:    'song-1',
      station_id: 's-1',
      user_id:    'u-1',
      username:   'alice',
      profile_photo_url: 'http://p.png',
      content:    'hi',
      mentions:   ['u-2'],
      timestamp:  1700000000000,
      session_version: 5,
    };
    commentModel.findOneAndUpdate.mockResolvedValue({ _id: 'm1' });

    const result = await service.persistFromEvent(event as any);

    expect(commentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { comment_event_id: 'c-1' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          comment_event_id: 'c-1',
          song_id:          'song-1',
          station_id:       's-1',
          user_id:          'u-1',
          username:         'alice',
          profile_photo_url: 'http://p.png',
          content:          'hi',
          mentions:         ['u-2'],
          likes_count:      0,
          session_version:  5,
        }),
      }),
      { upsert: true, new: true },
    );
    expect(result).toEqual({ _id: 'm1' });
  });

  it('persistFromEvent defaults profile_photo_url to null and mentions to []', async () => {
    commentModel.findOneAndUpdate.mockResolvedValue({});

    await service.persistFromEvent({
      comment_id: 'c-2', song_id: 's', station_id: 's', user_id: 'u',
      username: 'a', content: 'h', timestamp: 0,
    } as any);

    const setOnInsert = commentModel.findOneAndUpdate.mock.calls[0][1].$setOnInsert;
    expect(setOnInsert.profile_photo_url).toBeNull();
    expect(setOnInsert.mentions).toEqual([]);
    expect(setOnInsert.session_version).toBe(1);
  });

  // ── incrementLikes ─────────────────────────────────────────────────────

  it('incrementLikes increments comment counter only when the like is new (upsertedCount > 0)', async () => {
    likeModel.updateOne.mockResolvedValue({ upsertedCount: 1 });

    await service.incrementLikes('c-1', 'u-1');

    expect(likeModel.updateOne).toHaveBeenCalledWith(
      { comment_event_id: 'c-1', user_id: 'u-1' },
      { $setOnInsert: { comment_event_id: 'c-1', user_id: 'u-1' } },
      { upsert: true },
    );
    expect(commentModel.updateOne).toHaveBeenCalledWith(
      { comment_event_id: 'c-1' },
      { $inc: { likes_count: 1 } },
    );
  });

  it('incrementLikes is a no-op on duplicate like (upsertedCount === 0)', async () => {
    likeModel.updateOne.mockResolvedValue({ upsertedCount: 0 });

    await service.incrementLikes('c-1', 'u-1');

    expect(commentModel.updateOne).not.toHaveBeenCalled();
  });

  // ── decrementLikes ─────────────────────────────────────────────────────

  it('decrementLikes decrements comment counter only when a like was deleted', async () => {
    likeModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await service.decrementLikes('c-1', 'u-1');

    expect(likeModel.deleteOne).toHaveBeenCalledWith({
      comment_event_id: 'c-1', user_id: 'u-1',
    });
    expect(commentModel.updateOne).toHaveBeenCalledWith(
      { comment_event_id: 'c-1' },
      { $inc: { likes_count: -1 } },
    );
  });

  it('decrementLikes is a no-op when the like did not exist', async () => {
    likeModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

    await service.decrementLikes('c-1', 'u-1');

    expect(commentModel.updateOne).not.toHaveBeenCalled();
  });

  // ── findBySong ─────────────────────────────────────────────────────────

  it('findBySong filters by song+station with default sort/page/size', async () => {
    const data = [{ _id: 1 }];
    commentModel.find.mockReturnValue(makeChainable(data));
    commentModel.countDocuments.mockResolvedValue(7);

    const result = await service.findBySong({ songId: 'song-1', stationId: 's-1' });

    expect(commentModel.find).toHaveBeenCalledWith({
      song_id: 'song-1', station_id: 's-1',
    });
    expect(result).toEqual({ data, total: 7 });
  });

  it('findBySong sorts by likes_count desc when sort=popular', async () => {
    const chain = makeChainable([]);
    commentModel.find.mockReturnValue(chain);
    commentModel.countDocuments.mockResolvedValue(0);

    await service.findBySong({ songId: 'x', stationId: 's', sort: 'popular' });

    expect(chain.sort).toHaveBeenCalledWith({ likes_count: -1 });
  });

  it('findBySong includes session_version filter when currentVersion is provided', async () => {
    commentModel.find.mockReturnValue(makeChainable([]));
    commentModel.countDocuments.mockResolvedValue(0);

    await service.findBySong({
      songId: 'x', stationId: 's', currentVersion: 3,
    });

    expect(commentModel.find).toHaveBeenCalledWith(expect.objectContaining({
      session_version: 3,
    }));
  });

  it('findBySong applies pagination skip = page * size', async () => {
    const chain = makeChainable([]);
    commentModel.find.mockReturnValue(chain);
    commentModel.countDocuments.mockResolvedValue(0);

    await service.findBySong({ songId: 'x', stationId: 's', page: 2, size: 10 });

    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  // ── findByEventId ──────────────────────────────────────────────────────

  it('findByEventId delegates to commentModel.findOne', async () => {
    commentModel.findOne.mockResolvedValue({ _id: 'm1' });

    await expect(service.findByEventId('c-1')).resolves.toEqual({ _id: 'm1' });
    expect(commentModel.findOne).toHaveBeenCalledWith({ comment_event_id: 'c-1' });
  });

  // ── deleteByEventId ────────────────────────────────────────────────────

  it('deleteByEventId throws NotFoundException when no document was deleted', async () => {
    commentModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(service.deleteByEventId('c-1', 'u-1')).rejects.toThrow(NotFoundException);
  });

  it('deleteByEventId resolves silently when document was deleted', async () => {
    commentModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await expect(service.deleteByEventId('c-1', 'u-1')).resolves.toBeUndefined();
    expect(commentModel.deleteOne).toHaveBeenCalledWith({
      comment_event_id: 'c-1', user_id: 'u-1',
    });
  });
});
