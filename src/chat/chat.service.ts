// chat.service.ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Conversation } from 'src/conversation/entities/conversation.entity';
import { User } from 'src/auth/entities/auth.entity';
import { DataSource, Repository } from 'typeorm';
import { Message } from 'src/conversation/entities/message.entity';
import { toVietnamTime } from 'src/utils/helper';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepo: Repository<Message>,
    @InjectRepository(User)
    private userRepo: Repository<User>,

    private dataSource: DataSource,
  ) {}

  /**
   * Tìm hoặc tạo conversation giữa 2 users
   */
  async findOrCreateConversation(user1Id: string, user2Id: string) {
    // Tìm conversation hiện có (check cả 2 chiều)
    let conversation = await this.conversationRepo.findOne({
      where: [
        { user1: { id: user1Id }, user2: { id: user2Id } },
        { user1: { id: user2Id }, user2: { id: user1Id } },
      ],
      relations: ['user1', 'user2', 'lastMessage', 'lastMessage.sender'],
    });

    // Nếu chưa có thì tạo mới
    if (!conversation) {
      const user1 = await this.userRepo.findOne({ where: { id: user1Id } });
      const user2 = await this.userRepo.findOne({ where: { id: user2Id } });

      if (!user1 || !user2) {
        throw new NotFoundException('User not found');
      }

      conversation = this.conversationRepo.create({
        user1,
        user2,
        unreadCount: 0,
      });
      await this.conversationRepo.save(conversation);
    }

    return conversation;
  }

  /**
   * Lấy tất cả messages trong conversation
   */
  async getMessages(
    conversationId: string,
    currentUserId: string,
    limit = 50,
    offset = 0,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['user1', 'user2', 'messages', 'lastMessage.sender'],
    });

    console.log('conversation', conversation);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.messageRepo.find({
      where: { conversation: { id: conversationId } },
      relations: ['sender'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    console.log('messages', messages);

    const total = await this.messageRepo.count({
      where: { conversation: { id: conversationId } },
    });

    // Format messages theo interface FE
    const formattedMessages = messages
      .reverse()
      .map((msg) => this.formatMessage(msg, currentUserId));

    return {
      conversation: this.formatConversation(conversation, currentUserId),
      messages: formattedMessages,
      total,
    };
  }

  /**
   * Lấy danh sách conversations của user (sorted by updatedAt)
   */
  async getUserConversations(userId: string) {
    const conversations = await this.conversationRepo
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.user1', 'user1')
      .leftJoinAndSelect('conversation.user2', 'user2')
      .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
      .leftJoinAndSelect('lastMessage.sender', 'sender')
      .where('user1.id = :userId OR user2.id = :userId', { userId })
      .orderBy('conversation.updatedAt', 'DESC')
      .getMany();

    return conversations.map((conv) => this.formatConversation(conv, userId));
  }

  /**
   * Helper: Format conversation theo interface FE
   */
  private formatConversation(
    conversation: Conversation,
    currentUserId: string,
  ) {
    // Xác định người nhận (người còn lại trong conversation)
    const otherUser =
      conversation.user1.id === currentUserId
        ? conversation.user2
        : conversation.user1;

    return {
      id: conversation.id,
      name: otherUser.name,
      avatar: otherUser.avatar || '',
      lastMessage: conversation.lastMessage?.content || '',
      timestamp:
        toVietnamTime(conversation.lastMessage?.createdAt.toISOString()) ||
        toVietnamTime(conversation.updatedAt.toISOString()),
      unread: conversation.unreadCount > 0,
      isOnline: otherUser.isOnline,
      lastSeen: otherUser.lastSeen?.toISOString(),
      messageCount: conversation.unreadCount,
      receiverId: otherUser.id, // Thêm receiverId để dễ emit socket
    };
  }

  /**
   * Helper: Format message theo interface FE
   */
  private formatMessage(message: Message, currentUserId: string) {
    return {
      id: message.id,
      text: message.content,
      sender:
        message.sender.id === currentUserId ? 'user' : ('friend' as const),
      timestamp: toVietnamTime(message.createdAt.toISOString()),
      senderName: message.sender.name,
      avatar: message.sender.avatar || undefined,
      reaction: message.reaction || undefined,
    };
  }

  /**
   * Helper: Lấy conversation đã format
   */
  private async getConversationFormatted(
    conversationId: string,
    currentUserId: string,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['user1', 'user2', 'lastMessage', 'lastMessage.sender'],
    });

    console.log(
      'conversationconversationconversationconversationconversation',
      conversation,
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.formatConversation(conversation, currentUserId);
  }

  /**
   * ✅ NEW: Mark message as delivered
   */
  async markAsDelivered(messageId: string) {
    console.log(`✅✅ Marking message ${messageId} as delivered`);

    await this.messageRepo.update(messageId, {
      isDelivered: true,
      deliveredAt: new Date(),
    });

    return { success: true };
  }

  /**
   * ✅ Mark messages as read with count
   */
  async markMessagesAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ success: boolean; markedCount: number }> {
    console.log(`👀 Marking messages as read:`, {
      conversationId,
      userId,
    });

    const messages = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin('message.conversation', 'conversation')
      .leftJoin('message.sender', 'sender')
      .where('conversation.id = :conversationId', { conversationId })
      .andWhere('sender.id != :userId', { userId })
      .andWhere('message.isRead = :isRead', { isRead: false })
      .getMany();

    const messageIds = messages.map((m) => m.id);
    const markedCount = messageIds.length;

    if (messageIds.length > 0) {
      await this.messageRepo.update(messageIds, {
        isRead: true,
        readAt: new Date(),
      });
      console.log(`✅ Marked ${markedCount} messages as read`);
    }

    await this.conversationRepo.update(
      { id: conversationId },
      { unreadCount: 0 },
    );

    return { success: true, markedCount };
  }

  /**
   * ✅ UPDATED: Get messages with status information
   */
  async getMessagesConversation(conversationId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['messages', 'messages.sender'],
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Transform messages to include status
    const messages = conversation.messages.map((msg) => {
      const isSender = msg.sender.id === msg.sender.id; // You need to pass current userId here

      return {
        id: msg.id,
        text: msg.content,
        sender: isSender ? 'user' : 'friend',
        timestamp: new Date(msg.createdAt).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        }),
        senderName: msg.sender.name,
        avatar: msg.sender.avatar,
        reaction: msg.reaction,
        // ✅ Status information
        isSent: msg.isSent,
        isDelivered: msg.isDelivered,
        isRead: msg.isRead,
        deliveredAt: msg.deliveredAt?.toISOString(),
        readAt: msg.readAt?.toISOString(),
      };
    });

    return {
      conversation: {
        id: conversation.id,
        name: 'Conversation',
      },
      messages,
    };
  }

  /**
   * ✅ UPDATED: Create message with isSent = true
   */
  // async sendMessage(data: {
  //   senderId: string;
  //   receiverId: string;
  //   content: string;
  //   conversationId?: string;
  // }) {
  //   let conversation: Conversation | null = null;

  //   if (data.conversationId) {
  //     conversation = await this.conversationRepo.findOne({
  //       where: { id: data.conversationId },
  //       relations: ['user1', 'user2'],
  //     });

  //     if (!conversation) {
  //       throw new Error('Conversation not found');
  //     }
  //   } else {
  //     // Tìm hoặc tạo conversation
  //     conversation = await this.conversationRepo
  //       .createQueryBuilder('conversation')
  //       .leftJoinAndSelect('conversation.user1', 'user1')
  //       .leftJoinAndSelect('conversation.user2', 'user2')
  //       .where(
  //         '(user1.id = :senderId AND user2.id = :receiverId) OR (user1.id = :receiverId AND user2.id = :senderId)',
  //         {
  //           senderId: data.senderId,
  //           receiverId: data.receiverId,
  //         },
  //       )
  //       .getOne();

  //     if (!conversation) {
  //       const user1 = await this.userRepo.findOne({
  //         where: { id: data.senderId },
  //       });
  //       const user2 = await this.userRepo.findOne({
  //         where: { id: data.receiverId },
  //       });

  //       if (!user1 || !user2) {
  //         throw new Error('Users not found');
  //       }

  //       conversation = this.conversationRepo.create({
  //         user1,
  //         user2,
  //       });

  //       await this.conversationRepo.save(conversation);
  //     }
  //   }

  //   // Tạo message với isSent = true
  //   const sender = await this.userRepo.findOne({
  //     where: { id: data.senderId },
  //   });

  //   if (!sender) {
  //     throw new Error('Sender not found');
  //   }

  //   const message = this.messageRepo.create({
  //     conversation,
  //     sender,
  //     content: data.content,
  //     isSent: true, // ✅ Đánh dấu đã gửi thành công
  //     isDelivered: false, // Sẽ update sau nếu receiver online
  //     isRead: false,
  //     createdAt: new Date(),
  //   });

  //   await this.messageRepo.save(message);

  //   // ✅ Update conversation với lastMessage relation và lastMessageId
  //   await this.conversationRepo.update(conversation.id, {
  //     lastMessage: message,
  //     lastMessageId: message.id,
  //     updatedAt: new Date(),
  //   });

  //   // Load sender info
  //   const savedMessage = await this.messageRepo.findOne({
  //     where: { id: message.id },
  //     relations: ['sender'],
  //   });

  //   if (!savedMessage) {
  //     throw new Error('Failed to save message');
  //   }

  //   return {
  //     message: savedMessage,
  //     conversation: {
  //       id: conversation.id,
  //       lastMessage: data.content,
  //       lastMessageId: message.id,
  //       updatedAt: new Date(),
  //     },
  //   };
  // }

  async sendMessage(data: {
    senderId: string;
    receiverId: string;
    content: string;
    conversationId?: string;
  }) {
    let conversation: Conversation | null = null;

    // ✅ Tìm hoặc tạo conversation
    if (data.conversationId) {
      conversation = await this.conversationRepo.findOne({
        where: { id: data.conversationId },
        relations: ['user1', 'user2', 'lastMessage'],
      });
      if (!conversation) throw new Error('Conversation not found');
    } else {
      conversation = await this.conversationRepo
        .createQueryBuilder('conversation')
        .leftJoinAndSelect('conversation.user1', 'user1')
        .leftJoinAndSelect('conversation.user2', 'user2')
        .leftJoinAndSelect('conversation.lastMessage', 'lastMessage')
        .where(
          '(user1.id = :senderId AND user2.id = :receiverId) OR (user1.id = :receiverId AND user2.id = :senderId)',
          { senderId: data.senderId, receiverId: data.receiverId },
        )
        .getOne();

      if (!conversation) {
        const user1 = await this.userRepo.findOne({
          where: { id: data.senderId },
        });
        const user2 = await this.userRepo.findOne({
          where: { id: data.receiverId },
        });
        if (!user1 || !user2) throw new Error('Users not found');

        conversation = this.conversationRepo.create({ user1, user2 });
        await this.conversationRepo.save(conversation);
      }
    }

    // ✅ Tạo message
    const sender = await this.userRepo.findOne({
      where: { id: data.senderId },
    });
    if (!sender) throw new Error('Sender not found');

    const message = this.messageRepo.create({
      conversation,
      sender,
      content: data.content,
      isSent: true,
      isDelivered: false,
      isRead: false,
      createdAt: new Date(),
    });

    await this.messageRepo.save(message);

    // ✅ Cập nhật conversation.lastMessage
    await this.conversationRepo.update(conversation.id, {
      lastMessage: message,
      lastMessageId: message.id,
      updatedAt: new Date(),
    });

    // ✅ Load lại conversation đầy đủ quan hệ để format chính xác
    const updatedConversation = await this.conversationRepo.findOne({
      where: { id: conversation.id },
      relations: ['user1', 'user2', 'lastMessage'],
    });

    if (!updatedConversation) throw new Error('Failed to reload conversation');

    // ✅ Load sender info đầy đủ
    const savedMessage = await this.messageRepo.findOne({
      where: { id: message.id },
      relations: ['sender'],
    });
    if (!savedMessage) throw new Error('Failed to save message');

    // ✅ Trả về dữ liệu chuẩn hóa
    return {
      message: savedMessage,
      conversation: this.formatConversation(updatedConversation, data.senderId),
    };
  }

  /**
   * ✅ Helper: Get unread count with delivered status
   */
  async getUnreadCount(userId: string) {
    const conversations = await this.conversationRepo
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.user1', 'user1')
      .leftJoinAndSelect('conversation.user2', 'user2')
      .where('user1.id = :userId OR user2.id = :userId', { userId })
      .getMany();

    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length === 0) {
      return { total: 0, byConversation: [] };
    }

    const unreadMessages = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin('message.conversation', 'conversation')
      .leftJoin('message.sender', 'sender')
      .select('conversation.id', 'conversationId')
      .addSelect('COUNT(*)', 'count')
      .where('conversation.id IN (:...conversationIds)', { conversationIds })
      .andWhere('sender.id != :userId', { userId })
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
   * ✅ Delete conversation
   */
  // ✅ Lấy conversation có 2 user (phục vụ controller emit)
  // ✅ Lấy conversation có 2 user (phục vụ controller emit)
  async getConversationWithUsers(conversationId: string) {
    return this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['user1', 'user2'],
    });
  }

  // ✅ Xóa conversation + messages
  async deleteConversation(conversationId: string, userId: string) {
    console.log(`🗑️ Deleting conversation:`, { conversationId, userId });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 🔹 Lấy conversation trong transaction
      const conversation = await queryRunner.manager.findOne(Conversation, {
        where: { id: conversationId },
        relations: ['user1', 'user2'],
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // 🔹 Kiểm tra quyền xóa
      if (
        conversation.user1.id !== userId &&
        conversation.user2.id !== userId
      ) {
        throw new ForbiddenException(
          'You are not authorized to delete this conversation',
        );
      }

      // 🔹 Đếm messages trước khi xóa
      const messageCount = await queryRunner.manager.count(Message, {
        where: { conversation: { id: conversationId } },
      });

      // 🔹 Xóa messages trước
      await queryRunner.manager.delete(Message, {
        conversation: { id: conversationId },
      });
      console.log(`✅ Deleted ${messageCount} messages from ${conversationId}`);

      // 🔹 Xóa conversation
      await queryRunner.manager.delete(Conversation, { id: conversationId });
      console.log(`✅ Deleted conversation ${conversationId}`);

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Conversation deleted successfully',
        deletedConversationId: conversationId,
        deletedMessages: messageCount,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('❌ Error deleting conversation:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * ✅ Soft delete conversation (optional - nếu muốn giữ lại dữ liệu)
   */
  async softDeleteConversation(conversationId: string, userId: string) {
    console.log(`🗑️ Soft deleting conversation:`, {
      conversationId,
      userId,
    });

    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['user1', 'user2'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.user1.id !== userId && conversation.user2.id !== userId) {
      throw new Error('You are not authorized to delete this conversation');
    }

    // Thêm field deletedBy vào conversation entity nếu muốn soft delete
    await this.conversationRepo.update(conversationId, {
      // deletedBy: userId,
      // deletedAt: new Date(),
      // isDeleted: true,
    });

    return {
      success: true,
      message: 'Conversation archived successfully',
      conversationId,
    };
  }
}
