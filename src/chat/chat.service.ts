// chat.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Conversation } from 'src/conversation/entities/conversation.entity';
import { DataSource, Repository } from 'typeorm';
import { Message } from 'src/conversation/entities/message.entity';
import { UserChatStatus } from 'src/conversation/entities/user-chat-status.entity';
import { toVietnamTime } from 'src/utils/helper';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepo: Repository<Message>,
    @InjectRepository(UserChatStatus)
    private userChatStatusRepo: Repository<UserChatStatus>,
    private dataSource: DataSource,
  ) {}

  async getAllConversations() {
    return await this.conversationRepo.find();
  }

  async getAllUserChatStatus() {
    return await this.userChatStatusRepo.find();
  }

  /**
   * ✅ Update online status
   */
  async updateOnlineStatus(userId: string, isOnline: boolean) {
    // await this.ensureUserChatStatus(userId);

    const updateData: Partial<UserChatStatus> = {
      isOnline,
      lastSeen: new Date(),
    };

    if (isOnline) {
      updateData.lastConnectedAt = new Date();
    }

    await this.userChatStatusRepo.update({ userId }, updateData);
  }

  /**
   * ✅ Get UserChatStatus (với cache)
   */
  // async getUserChatStatus(userId: string): Promise<UserChatStatus> {
  //   return this.ensureUserChatStatus(userId);
  // }

  async getUserChat(userId: string) {
    return await this.userChatStatusRepo.findOne({
      where: { userId },
    });
  }

  async getAllMessages() {
    return await this.messageRepo.find();
  }
  /**
   * ✅ Validate UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  async findOrCreateConversation(
    user1Id: string,
    user2Id: string,
    user1Info?: { name: string; avatar?: string },
    user2Info?: { name: string; avatar?: string },
  ): Promise<Conversation> {
    // Validate
    if (!this.isValidUUID(user1Id) || !this.isValidUUID(user2Id)) {
      throw new BadRequestException('Invalid user ID format');
    }

    // ✅ Chỉ update name/avatar cho UserChatStatus (không động đến lastSeen)
    await Promise.all([
      this.updateUserInfo(user1Id, user1Info),
      this.updateUserInfo(user2Id, user2Info),
    ]);

    // ✅ Tìm hoặc tạo conversation
    let conversation = await this.conversationRepo.findOne({
      where: [
        { user1Id, user2Id },
        { user1Id: user2Id, user2Id: user1Id },
      ],
      relations: ['lastMessage'],
    });

    if (!conversation) {
      conversation = this.conversationRepo.create({
        user1Id,
        user2Id,
        unreadCount: 0,
        createdAt: new Date(),
      });
      await this.conversationRepo.save(conversation);
    }

    return conversation;
  }

  // ✅ Method riêng để update ONLY name/avatar
  async updateUserInfo(
    userId: string,
    userInfo?: { name: string; avatar?: string },
  ): Promise<void> {
    if (!userInfo) return;

    const data: any = { userId };

    if (userInfo.name) {
      data.name = userInfo.name;
    }
    if (userInfo.avatar !== undefined) {
      data.avatar = userInfo.avatar ?? '';
    }

    await this.userChatStatusRepo
      .createQueryBuilder()
      .insert()
      .into(UserChatStatus)
      .values({
        userId,
        name: userInfo.name ?? '',
        avatar: userInfo.avatar ?? '',
        isOnline: false,
      })
      .orUpdate(['name', 'avatar'], ['userId']) // ✅ CHỈ update name/avatar
      .execute();

    console.log(`✅ Updated user info for ${userId}`);
  }
  /**
   * ✅ Send message (không cần User entity)
   */
  async sendMessage(data: {
    senderId: string;
    receiverId: string;
    content: string;
    conversationId?: string;
    senderInfo?: { name: string; avatar?: string };
    receiverInfo?: { name: string; avatar?: string };
  }) {
    // Validate
    if (
      !this.isValidUUID(data.senderId) ||
      !this.isValidUUID(data.receiverId)
    ) {
      throw new BadRequestException('Invalid user ID format');
    }

    // Ensure UserChatStatus exists
    // await Promise.all([
    //   this.ensureUserChatStatus(data.senderId),
    //   this.ensureUserChatStatus(data.receiverId),
    // ]);

    // Tìm hoặc tạo conversation
    let conversation: Conversation;

    if (data.conversationId) {
      const found = await this.conversationRepo.findOne({
        where: { id: data.conversationId },
        relations: ['lastMessage'],
      });

      if (!found) {
        throw new NotFoundException('Conversation not found');
      }

      conversation = found;
    } else {
      const existing = await this.conversationRepo.findOne({
        where: [
          { user1Id: data.senderId, user2Id: data.receiverId },
          { user1Id: data.receiverId, user2Id: data.senderId },
        ],
        relations: ['lastMessage'],
      });

      if (existing) {
        conversation = existing;
      } else {
        conversation = this.conversationRepo.create({
          user1Id: data.senderId,
          user2Id: data.receiverId,
          unreadCount: 0,
        });
        await this.conversationRepo.save(conversation);
      }
    }

    // Tạo message
    const message = this.messageRepo.create({
      conversation,
      senderId: data.senderId,
      content: data.content,
      isSent: true,
      isDelivered: false,
      isRead: false,
      createdAt: new Date(),
    });
    await this.messageRepo.save(message);

    // Update conversation lastMessage
    await this.conversationRepo.update(conversation.id, {
      lastMessage: message,
      lastMessageId: message.id,
      updatedAt: new Date(),
    });

    // Load lại conversation
    const updatedConversation = await this.conversationRepo.findOne({
      where: { id: conversation.id },
      relations: ['lastMessage'],
    });

    // ✅ Null check before using
    if (!updatedConversation) {
      throw new NotFoundException('Failed to load updated conversation');
    }

    // Format response với user info từ FE (nếu có)
    const formattedConversation = await this.formatConversation(
      updatedConversation,
      data.senderId,
      data.receiverInfo,
    );

    return {
      message: {
        ...message,
        senderInfo: data.senderInfo, // ✅ Trả về user info từ FE
      },
      conversation: formattedConversation,
    };
  }

  private async formatConversation(
    conversation: Conversation,
    currentUserId: string,
    providedOtherUserInfo?: { name: string; avatar?: string },
  ) {
    const otherUserId =
      conversation.user1Id === currentUserId
        ? conversation.user2Id
        : conversation.user1Id;

    // Get chat status (đã có name và avatar trong đây)
    const chatStatus = await this.getUserChat(otherUserId);

    // ✅ Ưu tiên: providedInfo > chatStatus > default
    const userName =
      providedOtherUserInfo?.name || chatStatus?.name || 'Unknown User';

    const userAvatar =
      providedOtherUserInfo?.avatar || chatStatus?.avatar || '';

    return {
      id: conversation.id,
      name: userName,
      avatar: userAvatar,
      lastMessage: conversation.lastMessage?.content || '',
      timestamp: conversation.lastMessage?.createdAt
        ? toVietnamTime(conversation.lastMessage.createdAt.toISOString())
        : toVietnamTime(conversation.updatedAt.toISOString()),
      unread: conversation.unreadCount > 0,
      isOnline: chatStatus?.isOnline || false,
      lastSeen: chatStatus?.lastSeen?.toISOString() || null,
      messageCount: conversation.unreadCount,
      receiverId: otherUserId,
    };
  }

  /**
   * ✅ Get messages (không cần User entity)
   */
  // async getMessages(
  //   conversationId: string,
  //   currentUserId: string,
  //   limit = 50,
  //   offset = 0,
  //   providedUsersInfo?: Map<string, { name: string; avatar?: string }>,
  // ) {
  //   const conversation = await this.conversationRepo.findOne({
  //     where: { id: conversationId },
  //   });

  //   if (!conversation) {
  //     throw new NotFoundException('Conversation not found');
  //   }

  //   const messages = await this.messageRepo.find({
  //     where: { conversation: { id: conversationId } },
  //     order: { createdAt: 'DESC' },
  //     take: limit,
  //     skip: offset,
  //   });

  //   const total = await this.messageRepo.count({
  //     where: { conversation: { id: conversationId } },
  //   });

  //   // Format messages
  //   const formattedMessages = messages.reverse().map((msg) => {
  //     const senderInfo = providedUsersInfo?.get(msg.senderId);

  //     return {
  //       id: msg.id,
  //       text: msg.content,
  //       sender:
  //         msg.senderId === currentUserId
  //           ? ('user' as const)
  //           : ('friend' as const),
  //       timestamp: toVietnamTime(msg.createdAt.toISOString()),
  //       senderName: senderInfo?.name || 'Unknown',
  //       avatar: senderInfo?.avatar,
  //       reaction: msg.reaction,
  //       isSent: msg.isSent,
  //       isDelivered: msg.isDelivered,
  //       isRead: msg.isRead,
  //       deliveredAt: msg.deliveredAt?.toISOString(),
  //       readAt: msg.readAt?.toISOString(),
  //     };
  //   });

  //   return {
  //     conversation: await this.formatConversation(conversation, currentUserId),
  //     messages: formattedMessages,
  //     total,
  //   };
  // }

  async getMessages(
    conversationId: string,
    currentUserId: string,
    limit = 50,
    offset = 0,
    providedUsersInfo?: Map<string, { name: string; avatar?: string }>,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // ✅ Validate currentUserId thuộc conversation
    if (
      conversation.user1Id !== currentUserId &&
      conversation.user2Id !== currentUserId
    ) {
      throw new ForbiddenException('User not part of this conversation');
    }

    const messages = await this.messageRepo.find({
      where: { conversation: { id: conversationId } },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const total = await this.messageRepo.count({
      where: { conversation: { id: conversationId } },
    });

    // Format messages
    const formattedMessages = messages.reverse().map((msg) => {
      const senderInfo = providedUsersInfo?.get(msg.senderId);

      // ✅ Normalize UUIDs trước khi so sánh
      const normalizedSenderId = msg.senderId.trim().toLowerCase();
      const normalizedCurrentUserId = currentUserId.trim().toLowerCase();
      const isCurrentUser = normalizedSenderId === normalizedCurrentUserId;

      return {
        id: msg.id,
        text: msg.content,
        sender: isCurrentUser ? ('user' as const) : ('friend' as const),
        timestamp: toVietnamTime(msg.createdAt.toISOString()),
        senderName: senderInfo?.name || 'Unknown',
        avatar: senderInfo?.avatar,
        reaction: msg.reaction,
        isSent: msg.isSent,
        isDelivered: msg.isDelivered,
        isRead: msg.isRead,
        deliveredAt: msg.deliveredAt?.toISOString(),
        readAt: msg.readAt?.toISOString(),
      };
    });

    return {
      conversation: await this.formatConversation(conversation, currentUserId),
      messages: formattedMessages,
      total,
    };
  }

  /**
   * ✅ Get user conversations (không cần User entity)
   */
  async getUserConversations(
    userId: string,
    providedUsersInfo?: Map<string, { name: string; avatar?: string }>,
  ) {
    const conversations = await this.conversationRepo
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
      .where(
        'conversation.user1Id = :userId OR conversation.user2Id = :userId',
        {
          userId,
        },
      )
      .orderBy('conversation.updatedAt', 'DESC')
      .getMany();

    return Promise.all(
      conversations.map((conv) => {
        const otherUserId =
          conv.user1Id === userId ? conv.user2Id : conv.user1Id;
        const otherUserInfo = providedUsersInfo?.get(otherUserId);

        return this.formatConversation(conv, userId, otherUserInfo);
      }),
    );
  }

  /**
   * ✅ Mark as delivered
   */
  async markAsDelivered(messageId: string) {
    await this.messageRepo.update(messageId, {
      isDelivered: true,
      deliveredAt: new Date(),
    });
    return { success: true };
  }

  /**
   * ✅ Mark messages as read
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ success: boolean; markedCount: number }> {
    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin('message.conversation', 'conversation')
      .where('conversation.id = :conversationId', { conversationId })
      .andWhere('message.senderId != :userId', { userId })
      .andWhere('message.isRead = :isRead', { isRead: false })
      .getMany();

    const messageIds = messages.map((m) => m.id);
    const markedCount = messageIds.length;

    if (messageIds.length > 0) {
      await this.messageRepo.update(messageIds, {
        isRead: true,
        readAt: new Date(),
      });
    }

    await this.conversationRepo.update(
      { id: conversationId },
      { unreadCount: 0 },
    );

    return { success: true, markedCount };
  }

  /**
   * ✅ Get unread count
   */
  async getUnreadCount(userId: string) {
    const conversations = await this.conversationRepo
      .createQueryBuilder('conversation')
      .where(
        'conversation.user1Id = :userId OR conversation.user2Id = :userId',
        {
          userId,
        },
      )
      .getMany();

    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length === 0) {
      return { total: 0, byConversation: [] };
    }

    const unreadMessages = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin('message.conversation', 'conversation')
      .select('conversation.id', 'conversationId')
      .addSelect('COUNT(*)', 'count')
      .where('conversation.id IN (:...conversationIds)', { conversationIds })
      .andWhere('message.senderId != :userId', { userId })
      .andWhere('message.isRead = :isRead', { isRead: false })
      .groupBy('conversation.id')
      .getRawMany();

    const total = unreadMessages.reduce(
      (sum, item) => sum + parseInt(item.count),
      0,
    );

    return {
      total,
      byConversation: unreadMessages,
    };
  }

  /**
   * ✅ Get conversation với userIds
   */
  async getConversationWithUsers(conversationId: string) {
    return this.conversationRepo.findOne({
      where: { id: conversationId },
    });
  }

  /**
   * ✅ Delete conversation
   */
  async deleteConversation(conversationId: string, userId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const conversation = await queryRunner.manager.findOne(Conversation, {
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // Kiểm tra quyền
      if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
        throw new ForbiddenException(
          'Not authorized to delete this conversation',
        );
      }

      // Đếm messages
      const messageCount = await queryRunner.manager.count(Message, {
        where: { conversation: { id: conversationId } },
      });

      // Xóa messages
      await queryRunner.manager.delete(Message, {
        conversation: { id: conversationId },
      });

      // Xóa conversation
      await queryRunner.manager.delete(Conversation, { id: conversationId });

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Conversation deleted successfully',
        deletedConversationId: conversationId,
        deletedMessages: messageCount,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
