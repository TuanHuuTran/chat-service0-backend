// chat.controller.ts
// ============================================
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Gửi message (tự động tạo conversation nếu chưa có)
   */
  @Post('messages')
  async sendMessage(
    @Body()
    dto: {
      senderId: string;
      receiverId: string;
      content: string;
      conversationId?: string;
    },
  ) {
    // 1. Save message vào DB
    const result = await this.chatService.sendMessage(dto);

    console.log('data send api', result);

    // 2. Emit real-time cho receiver qua Gateway
    const isReceiverOnline = this.chatGateway.emitToUser(
      dto.receiverId,
      'newMessage',
      {
        message: result.message,
        conversation: result.conversation,
        senderId: dto.senderId,
      },
    );

    console.log(
      `💬 Message sent via API from ${dto.senderId} to ${dto.receiverId}`,
    );
    console.log(
      `${isReceiverOnline ? '✅ Receiver online - Real-time sent' : '⚠️ Receiver offline - Will see on next login'}`,
    );

    // 3. Trả về kết quả + status online
    return {
      ...result,
      receiverOnline: isReceiverOnline,
      deliveryMethod: 'api',
    };
  }

  /**
   * Tạo hoặc lấy conversation
   */
  @Post('conversations')
  async createConversation(@Body() dto: { user1Id: string; user2Id: string }) {
    const conversation = await this.chatService.findOrCreateConversation(
      dto.user1Id,
      dto.user2Id,
    );

    // Format theo FE interface
    return this.chatService['formatConversation'](conversation, dto.user1Id);
  }

  /**
   * Lấy messages trong conversation
   */
  @Get('conversations/:conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const userId = '66bd2174-9e71-4cb6-9240-3caec5680e82';
    if (!userId) {
      throw new Error('userId is required');
    }

    return this.chatService.getMessages(
      conversationId,
      userId,
      limit ? +limit : 50,
      offset ? +offset : 0,
    );
  }

  /**
   * Lấy danh sách conversations của user
   */
  @Get('users/:userId/conversations')
  async getUserConversations(@Param('userId') userId: string) {
    return this.chatService.getUserConversations(userId);
  }

  /**
   * Đánh dấu messages là đã đọc
   */
  @Post('conversations/:conversationId/read')
  async markAsRead(
    @Param('conversationId') conversationId: string,
    @Body('userId') userId: string,
  ) {
    const result = await this.chatService.markMessagesAsRead(
      conversationId,
      userId,
    );

    // Emit real-time cho sender biết messages đã được đọc
    const conversations = await this.chatService.getUserConversations(userId);
    const conversation = conversations.find((c) => c.id === conversationId);

    if (conversation) {
      const senderId = conversation.receiverId; // receiverId trong formatted conversation là người còn lại

      this.chatGateway.emitToUser(senderId, 'messagesRead', {
        conversationId,
        readBy: userId,
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  }

  /**
   * Lấy số lượng unread messages
   */
  @Get('users/:userId/unread-count')
  async getUnreadCount(@Param('userId') userId: string) {
    return this.chatService.getUnreadCount(userId);
  }

  /**
   * Kiểm tra online status của users
   */
  @Post('users/online-status')
  async checkOnlineStatus(@Body() dto: { userIds: string[] }) {
    const onlineStatus = dto.userIds.map((userId) => ({
      userId,
      isOnline: this.chatGateway.isUserOnline(userId),
    }));

    return {
      success: true,
      onlineStatus,
    };
  }

  /**
   * Lấy danh sách users đang online
   */
  @Get('users/online')
  async getOnlineUsers() {
    const users = this.chatGateway.getOnlineUsers();

    return {
      success: true,
      users,
      count: users.length,
    };
  }

  /**
   * ✅ Xóa conversation
   */
  @Delete('conversations/:conversationId')
  async deleteConversation(
    @Param('conversationId') conversationId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new Error('userId is required');
    }

    // 🔹 Lấy thông tin conversation trước khi xóa để xác định người còn lại
    const conversation =
      await this.chatService.getConversationWithUsers(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    const receiverId =
      conversation.user1.id === userId
        ? conversation.user2.id
        : conversation.user1.id;

    // 🔹 Xóa conversation
    const result = await this.chatService.deleteConversation(
      conversationId,
      userId,
    );

    // 🔹 Emit realtime cho người còn lại
    this.chatGateway.emitToUser(receiverId, 'conversationDeleted', {
      conversationId,
      deletedBy: userId,
      timestamp: new Date().toISOString(),
    });

    // 🔹 Emit cho chính người xóa (để UI cập nhật)
    this.chatGateway.emitToUser(userId, 'conversationDeleted', {
      conversationId,
      deletedBy: userId,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Conversation ${conversationId} deleted by ${userId}`);
    return result;
  }

  /**
   * ✅ Xóa nhiều conversations cùng lúc
   */
  @Post('conversations/delete-multiple')
  async deleteMultipleConversations(
    @Body() dto: { conversationIds: string[]; userId: string },
  ) {
    const results = await Promise.all(
      dto.conversationIds.map((id) =>
        this.chatService.deleteConversation(id, dto.userId),
      ),
    );

    return {
      success: true,
      deletedCount: results.length,
      conversationIds: dto.conversationIds,
    };
  }
}
