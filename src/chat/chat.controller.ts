import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  NotFoundException,
  Delete,
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
   * ✅ Send message với user info từ FE
   */
  @Post('messages')
  async sendMessage(
    @Body()
    dto: {
      senderId: string;
      receiverId: string;
      content: string;
      conversationId?: string;
      senderInfo?: { name: string; avatar?: string };
      receiverInfo?: { name: string; avatar?: string };
    },
  ) {
    const result = await this.chatService.sendMessage(dto);

    const isReceiverOnline = this.chatGateway.emitToUser(
      dto.receiverId,
      'newMessage',
      {
        message: result.message,
        conversation: result.conversation,
        senderId: dto.senderId,
      },
    );

    return {
      ...result,
      receiverOnline: isReceiverOnline,
    };
  }

  /**
   * ✅ Create conversation với user info từ FE
   */
  @Post('conversations')
  async createConversation(
    @Body()
    dto: {
      user1Id: string;
      user2Id: string;
      user1Info?: { name: string; avatar?: string };
      user2Info?: { name: string; avatar?: string };
    },
  ) {
    const conversation = await this.chatService.findOrCreateConversation(
      dto.user1Id,
      dto.user2Id,
      dto.user1Info,
      dto.user2Info,
    );

    return this.chatService['formatConversation'](
      conversation,
      dto.user1Id,
      dto.user2Info,
    );
  }

  @Get('conversations')
  async getConversation() {
    return await this.chatService.getAllConversations();
  }

  @Get('messages')
  async getAllMessages() {
    return await this.chatService.getAllMessages();
  }

  /**
   * ✅ Get messages với user info từ FE
   */
  @Get('conversations/:conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    if (!userId) {
      throw new Error('userId is required');
    }
    console.log('userId', userId);

    return this.chatService.getMessages(
      conversationId,
      userId,
      limit ? +limit : 50,
      offset ? +offset : 0,
    );
  }

  /**
   * ✅ Get user conversations
   */
  // @Get('users/:userId/conversations')
  // async getUserConversations(@Param('userId') userId: string) {
  //   console.log('userId', userId);

  //   return this.chatService.getUserConversations(userId);
  // }

  @Get('users/:userId/conversations')
  async getUserConversations(@Param('userId') userId: string) {
    // ✅ Lấy danh sách conversations trước
    const conversations = await this.chatService.getConversationsRaw(userId);

    // ✅ Collect tất cả userIds cần fetch
    const userIds = new Set<string>();
    conversations.forEach((conv) => {
      const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
      userIds.add(otherUserId);
    });

    // ✅ Fetch user info từ UserChatStatus
    const usersInfo = await this.chatService.getUsersInfo(Array.from(userIds));

    // ✅ Format với userInfo
    return this.chatService.formatConversations(
      conversations,
      userId,
      usersInfo,
    );
  }

  /**
   * ✅ Mark as read
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

    const conversations = await this.chatService.getUserConversations(userId);
    const conversation = conversations.find((c) => c.id === conversationId);

    if (conversation) {
      this.chatGateway.emitToUser(conversation.receiverId, 'messagesRead', {
        conversationId,
        readBy: userId,
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  }

  /**
   * ✅ Get unread count
   */
  @Get('users/:userId/unread-count')
  async getUnreadCount(@Param('userId') userId: string) {
    return this.chatService.getUnreadCount(userId);
  }

  /**
   * ✅ Check online status
   */
  @Post('users/online-status')
  async checkOnlineStatus(@Body() dto: { userIds: string[] }) {
    const onlineStatus = dto.userIds.map((userId) => ({
      userId,
      isOnline: this.chatGateway.isUserOnline(userId),
    }));

    return { success: true, onlineStatus };
  }

  /**
   * ✅ Get online users
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
   * ✅ Delete conversation
   */
  @Delete('conversations/:conversationId')
  async deleteConversation(
    @Param('conversationId') conversationId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new Error('userId is required');
    }

    // Get conversation
    const conversation =
      await this.chatService.getConversationWithUsers(conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Xác định người còn lại
    const receiverId =
      conversation.user1Id === userId
        ? conversation.user2Id
        : conversation.user1Id;

    // Delete conversation
    const result = await this.chatService.deleteConversation(
      conversationId,
      userId,
    );

    // Emit realtime
    this.chatGateway.emitToUser(receiverId, 'conversationDeleted', {
      conversationId,
      deletedBy: userId,
      timestamp: new Date().toISOString(),
    });

    this.chatGateway.emitToUser(userId, 'conversationDeleted', {
      conversationId,
      deletedBy: userId,
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Conversation ${conversationId} deleted by ${userId}`);
    return result;
  }

  /**
   * ✅ Delete multiple conversations
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
