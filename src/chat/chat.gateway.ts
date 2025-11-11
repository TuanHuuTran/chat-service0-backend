// chat.gateway.ts
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/auth/entities/auth.entity';
import { Repository } from 'typeorm';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private chatService: ChatService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;

    if (!userId) {
      console.log('❌ Connection rejected: No userId');
      client.disconnect();
      return;
    }

    this.connectedUsers.set(userId, client.id);

    await this.userRepo.update(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    console.log(`✅ User ${userId} connected (socketId: ${client.id})`);
    console.log('🟢 Online users:', Array.from(this.connectedUsers.keys()));

    client.emit('connected', {
      message: 'Kết nối socket thành công!',
      socketId: client.id,
      userId,
      onlineUsers: Array.from(this.connectedUsers.keys()),
    });

    client.broadcast.emit('userOnline', {
      userId,
      timestamp: new Date().toISOString(),
    });
  }

  async handleDisconnect(client: Socket) {
    const userId = [...this.connectedUsers.entries()].find(
      ([_, socketId]) => socketId === client.id,
    )?.[0];

    if (userId) {
      this.connectedUsers.delete(userId);

      const lastSeen = new Date();
      await this.userRepo.update(userId, {
        isOnline: false,
        lastSeen,
      });

      console.log(`🔴 User ${userId} disconnected`);

      client.broadcast.emit('userOffline', {
        userId,
        lastSeen: lastSeen.toISOString(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * ✅ UPDATED: Gửi message với message status tracking
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    data: {
      senderId: string;
      receiverId: string;
      content: string;
      conversationId?: string;
      tempId: string; // ✅ Client-generated temp ID
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(`📤 Sending message:`, {
        from: data.senderId,
        to: data.receiverId,
        tempId: data.tempId,
      });

      // 1. Lưu message vào DB với trạng thái isSent = true
      const result = await this.chatService.sendMessage({
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        conversationId: data.conversationId,
      });

      const messageData = {
        id: result.message.id,
        text: result.message.content,
        timestamp: new Date(result.message.createdAt).toLocaleTimeString(
          'en-US',
          {
            hour: 'numeric',
            minute: '2-digit',
          },
        ),
        isSent: true,
        isDelivered: false,
        isRead: false,
      };

      // 2. ✅ Emit "messageSent" cho sender (A) - message đã lưu thành công
      client.emit('messageSent', {
        tempId: data.tempId,
        message: messageData,
        conversationId: result.conversation.id,
      });
      console.log(`✅ Message saved (ID: ${result.message.id})`);

      // 3. Kiểm tra receiver (B) có online không
      const receiverSocketId = this.connectedUsers.get(data.receiverId);

      if (receiverSocketId) {
        // ✅ B đang online → Mark as delivered
        await this.chatService.markAsDelivered(result.message.id);

        // Gửi message cho B
        this.server.to(receiverSocketId).emit('newMessage', {
          message: {
            id: result.message.id,
            text: result.message.content,
            sender: data.senderId,
            timestamp: messageData.timestamp,
            senderName: result.message.sender?.name,
            avatar: result.message.sender?.avatar,
          },
          conversation: {
            id: result.conversation.id,
            avatar: result.message.sender?.avatar,
          },
        });
        console.log(`✅ Sent to receiver ${data.receiverId}`);

        // ✅ Notify sender (A) rằng message đã delivered
        client.emit('messageDelivered', {
          messageId: result.message.id,
          conversationId: result.conversation.id,
          deliveredAt: new Date().toISOString(),
        });
        console.log(`✅✅ Message delivered (ID: ${result.message.id})`);
      } else {
        console.log(
          `⚠️ Receiver ${data.receiverId} is offline - message not delivered`,
        );
      }

      return {
        success: true,
        message: result.message,
        conversation: result.conversation,
      };
    } catch (error) {
      console.error('❌ Error sending message:', error);

      // ✅ Emit error cho sender
      client.emit('messageError', {
        tempId: data.tempId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ✅ NEW: Mark messages as seen (đã xem)
   */
  @SubscribeMessage('markAsSeen')
  async handleMarkAsSeen(
    @MessageBody()
    data: {
      conversationId: string;
      userId: string; // User đang xem (B)
      messageIds?: string[]; // Optional: specific messages
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(`👀 Marking as seen:`, {
        conversationId: data.conversationId,
        userId: data.userId,
      });

      // 1. Update DB - mark messages as read
      const result = await this.chatService.markMessagesAsRead(
        data.conversationId,
        data.userId,
      );

      // 2. Lấy conversation để tìm sender
      const conversations = await this.chatService.getUserConversations(
        data.userId,
      );
      const conversation = conversations.find(
        (c) => c.id === data.conversationId,
      );

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // 3. Tìm sender (người gửi messages)
      const senderId = conversation.receiverId; // receiverId trong formatted conversation

      // 4. ✅ Notify sender (A) rằng messages đã được seen
      const senderSocketId = this.connectedUsers.get(senderId);
      if (senderSocketId) {
        this.server.to(senderSocketId).emit('messagesSeen', {
          conversationId: data.conversationId,
          seenBy: data.userId,
          timestamp: new Date().toISOString(),
        });
        console.log(`👀 Notified ${senderId} that messages were seen`);
      }

      // 5. Confirm cho người xem
      client.emit('markAsSeenSuccess', {
        conversationId: data.conversationId,
        markedCount: result.markedCount,
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Error marking as seen:', error);
      client.emit('markAsSeenError', {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ DEPRECATED: Renamed to markAsSeen for clarity
   * Kept for backward compatibility
   */
  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody()
    data: {
      conversationId: string;
      userId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    console.log('⚠️ markAsRead is deprecated, use markAsSeen instead');
    return this.handleMarkAsSeen(data, client);
  }

  /**
   * Typing indicator
   */
  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody()
    data: {
      conversationId: string;
      senderId: string;
      receiverId: string;
      isTyping: boolean;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const receiverSocketId = this.connectedUsers.get(data.receiverId);

    if (receiverSocketId) {
      this.server.to(receiverSocketId).emit('userTyping', {
        conversationId: data.conversationId,
        userId: data.senderId,
        isTyping: data.isTyping,
      });
    }

    return { success: true };
  }

  /**
   * Check if users are online
   */
  @SubscribeMessage('checkOnline')
  async handleCheckOnline(
    @MessageBody() data: { userIds: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    const onlineStatus = data.userIds.map((userId) => ({
      userId,
      isOnline: this.connectedUsers.has(userId),
    }));

    client.emit('onlineStatus', onlineStatus);

    return { success: true, onlineStatus };
  }

  /**
   * Get list of online users
   */
  @SubscribeMessage('getOnlineUsers')
  async handleGetOnlineUsers(@ConnectedSocket() client: Socket) {
    const onlineUsers = Array.from(this.connectedUsers.keys());

    client.emit('onlineUsersList', {
      users: onlineUsers,
      count: onlineUsers.length,
    });

    return { success: true, users: onlineUsers };
  }

  /**
   * Helper: Emit event to specific user
   */
  emitToUser(userId: string, event: string, data: any) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  /**
   * Helper: Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Helper: Get all online users
   */
  getOnlineUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}
