import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { ChatMessage } from './schemas/chat-message.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSaveData(overrides: Partial<Parameters<ChatService['saveMessage']>[0]> = {}) {
  return {
    message_id:        'msg-uuid-1',
    station_id:        'station-1',
    user_id:           'user-1',
    username:          'alice',
    profile_photo_url: null,
    content:           'Hello station!',
    mentions:          [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatService', () => {
  let service: ChatService;

  const mockDoc = { message_id: 'msg-uuid-1', station_id: 'station-1' };

  const chatMessageModel = {
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    updateOne: jest.fn(),
  };

  // Chainable find mock
  const chainable = {
    sort:  jest.fn().mockReturnThis(),
    skip:  jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([mockDoc]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getModelToken(ChatMessage.name),
          useValue: chatMessageModel,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── saveMessage ───────────────────────────────────────────────────────────

  describe('saveMessage', () => {
    it('upserts via findOneAndUpdate with $setOnInsert', async () => {
      chatMessageModel.findOneAndUpdate.mockResolvedValue(mockDoc);

      const data = makeSaveData();
      const result = await service.saveMessage(data);

      expect(chatMessageModel.findOneAndUpdate).toHaveBeenCalledWith(
        { message_id: 'msg-uuid-1' },
        expect.objectContaining({ $setOnInsert: expect.objectContaining({ message_id: 'msg-uuid-1' }) }),
        { upsert: true, new: true },
      );
      expect(result).toBe(mockDoc);
    });

    it('sets is_deleted: false on insert', async () => {
      chatMessageModel.findOneAndUpdate.mockResolvedValue(mockDoc);

      await service.saveMessage(makeSaveData());

      const [[, update]] = chatMessageModel.findOneAndUpdate.mock.calls;
      expect(update.$setOnInsert.is_deleted).toBe(false);
    });

    it('defaults profile_photo_url to null when not provided', async () => {
      chatMessageModel.findOneAndUpdate.mockResolvedValue(mockDoc);

      await service.saveMessage(makeSaveData({ profile_photo_url: undefined as any }));

      const [[, update]] = chatMessageModel.findOneAndUpdate.mock.calls;
      expect(update.$setOnInsert.profile_photo_url).toBeNull();
    });

    it('is idempotent — same message_id returns existing doc (no duplicate)', async () => {
      // Mongoose findOneAndUpdate with upsert returns the existing doc when it already exists.
      // We simulate calling saveMessage twice with the same message_id.
      chatMessageModel.findOneAndUpdate.mockResolvedValue(mockDoc);

      await service.saveMessage(makeSaveData());
      await service.saveMessage(makeSaveData());

      // Both calls use the same filter — MongoDB deduplicates via unique index
      expect(chatMessageModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      const [[filter1], [filter2]] = chatMessageModel.findOneAndUpdate.mock.calls;
      expect(filter1).toEqual(filter2);
    });
  });

  // ── getMessages ───────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('returns paginated messages sorted by createdAt desc', async () => {
      chatMessageModel.find.mockReturnValue(chainable);
      chatMessageModel.countDocuments.mockResolvedValue(42);

      const result = await service.getMessages('station-1', 0, 20);

      expect(chatMessageModel.find).toHaveBeenCalledWith({ station_id: 'station-1', is_deleted: false });
      expect(chainable.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(chainable.skip).toHaveBeenCalledWith(0);
      expect(chainable.limit).toHaveBeenCalledWith(20);
      expect(result.total).toBe(42);
      expect(result.data).toEqual([mockDoc]);
    });

    it('calculates skip correctly for page > 0', async () => {
      chatMessageModel.find.mockReturnValue(chainable);
      chatMessageModel.countDocuments.mockResolvedValue(100);

      await service.getMessages('station-1', 2, 20);

      expect(chainable.skip).toHaveBeenCalledWith(40); // page=2, size=20
    });

    it('excludes soft-deleted messages from results', async () => {
      chatMessageModel.find.mockReturnValue(chainable);
      chatMessageModel.countDocuments.mockResolvedValue(5);

      await service.getMessages('station-1', 0, 20);

      const [[filter]] = chatMessageModel.find.mock.calls;
      expect(filter.is_deleted).toBe(false);
    });
  });

  // ── deleteMessage ─────────────────────────────────────────────────────────

  describe('deleteMessage', () => {
    it('soft-deletes message when owner requests deletion', async () => {
      chatMessageModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.deleteMessage('msg-uuid-1', 'user-1');

      expect(chatMessageModel.updateOne).toHaveBeenCalledWith(
        { message_id: 'msg-uuid-1', user_id: 'user-1', is_deleted: false },
        { $set: { is_deleted: true } },
      );
    });

    it('throws NotFoundException when message not found', async () => {
      chatMessageModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await expect(service.deleteMessage('no-such-msg', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user does not own the message', async () => {
      // modifiedCount=0 because user_id filter didn't match
      chatMessageModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await expect(service.deleteMessage('msg-uuid-1', 'other-user')).rejects.toThrow(NotFoundException);
    });

    it('does not delete already soft-deleted message', async () => {
      // is_deleted: false filter prevents matching already-deleted docs
      chatMessageModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await expect(service.deleteMessage('msg-uuid-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
