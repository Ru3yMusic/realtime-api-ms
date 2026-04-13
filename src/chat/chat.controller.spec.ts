import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDoc(overrides: object = {}) {
  return {
    message_id:        'msg-uuid-1',
    station_id:        'station-1',
    user_id:           'user-1',
    username:          'alice',
    profile_photo_url: null,
    content:           'Hello!',
    mentions:          [],
    is_deleted:        false,
    createdAt:         new Date(),
    updatedAt:         new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: jest.Mocked<Pick<ChatService, 'getMessages' | 'deleteMessage'>>;

  beforeEach(async () => {
    chatService = {
      getMessages:   jest.fn(),
      deleteMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── GET /chat/:stationId ──────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns paginated chat history for a station', async () => {
      const docs = [makeMockDoc(), makeMockDoc({ message_id: 'msg-uuid-2' })];
      chatService.getMessages.mockResolvedValue({ data: docs as any, total: 2 });

      const result = await controller.getHistory('station-1', '0', '20');

      expect(chatService.getMessages).toHaveBeenCalledWith('station-1', 0, 20);
      expect(result).toEqual({ content: docs, total: 2, page: 0, size: 20 });
    });

    it('uses default page=0 and size=20 when not provided', async () => {
      chatService.getMessages.mockResolvedValue({ data: [] as any, total: 0 });

      await controller.getHistory('station-1');

      expect(chatService.getMessages).toHaveBeenCalledWith('station-1', 0, 20);
    });

    it('passes correct page/size from query params', async () => {
      chatService.getMessages.mockResolvedValue({ data: [] as any, total: 50 });

      const result = await controller.getHistory('station-1', '2', '10');

      expect(chatService.getMessages).toHaveBeenCalledWith('station-1', 2, 10);
      expect(result.page).toBe(2);
      expect(result.size).toBe(10);
    });

    it('returns empty content array when no messages', async () => {
      chatService.getMessages.mockResolvedValue({ data: [] as any, total: 0 });

      const result = await controller.getHistory('station-xyz', '0', '20');

      expect(result).toEqual({ content: [], total: 0, page: 0, size: 20 });
    });
  });

  // ── DELETE /chat/:messageId ───────────────────────────────────────────────

  describe('delete', () => {
    it('calls deleteMessage with messageId and userId', async () => {
      chatService.deleteMessage.mockResolvedValue(undefined);

      await controller.delete('msg-uuid-1', 'user-1');

      expect(chatService.deleteMessage).toHaveBeenCalledWith('msg-uuid-1', 'user-1');
    });

    it('propagates NotFoundException from service', async () => {
      chatService.deleteMessage.mockRejectedValue(new NotFoundException('Message not found or not yours'));

      await expect(controller.delete('no-such-msg', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('returns void (204 No Content) on success', async () => {
      chatService.deleteMessage.mockResolvedValue(undefined);

      const result = await controller.delete('msg-uuid-1', 'user-1');

      expect(result).toBeUndefined();
    });
  });
});
