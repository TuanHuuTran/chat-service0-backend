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

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(private chatService: ChatService) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;

    if (!userId) {
      console.log('❌ Connection rejected: No userId');
      client.disconnect();
      return;
    }

    this.connectedUsers.set(userId, client.id);

    // ✅ Update UserChatStatus
    await this.chatService.updateOnlineStatus(userId, true);

    console.log(`✅ User ${userId} connected (socketId: ${client.id})`);

    client.emit('connected', {
      message: 'Connected successfully',
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

      // ✅ Update UserChatStatus
      await this.chatService.updateOnlineStatus(userId, false);

      console.log(`🔴 User ${userId} disconnected`);

      client.broadcast.emit('userOffline', {
        userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * ✅ Send message với user info từ FE
   */
  // @SubscribeMessage('sendMessage')
  // async handleSendMessage(
  //   @MessageBody()
  //   data: {
  //     senderId: string;
  //     receiverId: string;
  //     content: string;
  //     conversationId?: string;
  //     tempId: string;
  //     senderInfo?: { name: string; avatar?: string };
  //     receiverInfo?: { name: string; avatar?: string };
  //   },
  //   @ConnectedSocket() client: Socket,
  // ) {
  //   try {
  //     console.log(
  //       `📤 Sending message from ${data.senderId} to ${data.receiverId}`,
  //     );

  //     // Save message
  //     const result = await this.chatService.sendMessage({
  //       senderId: data.senderId,
  //       receiverId: data.receiverId,
  //       content: data.content,
  //       conversationId: data.conversationId,
  //       senderInfo: data.senderInfo,
  //       receiverInfo: data.receiverInfo,
  //     });

  //     console.log('data messages send', result);
  //     const messageData = {
  //       id: result.message.id,
  //       text: result.message.content,
  //       timestamp: new Date(result.message.createdAt).toLocaleTimeString(
  //         'en-US',
  //         {
  //           hour: 'numeric',
  //           minute: '2-digit',
  //         },
  //       ),
  //       isSent: true,
  //       isDelivered: false,
  //       isRead: false,
  //     };

  //     // Emit success to sender
  //     client.emit('messageSent', {
  //       tempId: data.tempId,
  //       message: messageData,
  //       conversationId: result.conversation.id,
  //     });

  //     // Check if receiver is online
  //     const receiverSocketId = this.connectedUsers.get(data.receiverId);

  //     if (receiverSocketId) {
  //       // Mark as delivered
  //       await this.chatService.markAsDelivered(result.message.id);

  //       // Send to receiver
  //       this.server.to(receiverSocketId).emit('newMessage', {
  //         message: {
  //           id: result.message.id,
  //           text: result.message.content,
  //           sender: data.senderId,
  //           timestamp: messageData.timestamp,
  //           senderName: data.senderInfo?.name || 'Unknown',
  //           avatar: data.senderInfo?.avatar,
  //         },
  //         conversation: {
  //           id: result.conversation.id,
  //           avatar: data.senderInfo?.avatar,
  //         },
  //       });

  //       // Notify sender that message was delivered
  //       client.emit('messageDelivered', {
  //         messageId: result.message.id,
  //         conversationId: result.conversation.id,
  //         deliveredAt: new Date().toISOString(),
  //       });

  //       console.log(`✅✅ Message delivered to ${data.receiverId}`);
  //     } else {
  //       console.log(`⚠️ Receiver ${data.receiverId} is offline`);
  //     }

  //     return { success: true };
  //   } catch (error) {
  //     console.error('❌ Error sending message:', error);
  //     client.emit('messageError', {
  //       tempId: data.tempId,
  //       error: error.message,
  //     });
  //     return { success: false, error: error.message };
  //   }
  // }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody()
    data: {
      senderId: string;
      receiverId: string;
      content: string;
      conversationId?: string;
      tempId: string;
      senderInfo?: { name: string; avatar?: string };
      receiverInfo?: { name: string; avatar?: string };
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(
        `📤 Sending message from ${data.senderId} to ${data.receiverId}`,
      );

      // Save message
      const result = await this.chatService.sendMessage({
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        conversationId: data.conversationId,
        senderInfo: data.senderInfo,
        receiverInfo: data.receiverInfo,
      });

      console.log('✅ Message saved:', result.message.id);

      const messageData = {
        id: result.message.id,
        content: result.message.content,
        timestamp: new Date(result.message.createdAt).toLocaleTimeString(
          'vi-VN',
          {
            hour: '2-digit',
            minute: '2-digit',
          },
        ),
        isSent: true,
        isDelivered: false,
        isRead: false,
        senderId: result.message.senderId,
        senderName: data.senderInfo?.name || 'Unknown',
        avatar: data.senderInfo?.avatar || '',
      };

      // ✅ 1. Emit success to SENDER
      client.emit('messageSent', {
        tempId: data.tempId,
        message: messageData,
        conversationId: result.conversation.id,
      });

      // ✅ 2. Check if receiver is online
      const receiverSocketId = this.connectedUsers.get(data.receiverId);

      if (receiverSocketId) {
        // Mark as delivered
        await this.chatService.markAsDelivered(result.message.id);

        // ✅ 3. Send to RECEIVER with CORRECT structure
        this.server.to(receiverSocketId).emit('newMessage', {
          message: {
            id: result.message.id,
            content: result.message.content,
            senderId: data.senderId,
            timestamp: messageData.timestamp,
            senderName: data.senderInfo?.name || 'Unknown',
            avatar: data.senderInfo?.avatar || '',
          },
          conversation: {
            id: result.conversation.id,
            name: data.senderInfo?.name || 'Unknown User', // ✅ Thêm name
            avatar: data.senderInfo?.avatar || '', // ✅ Avatar của người gửi
            timestamp: messageData.timestamp, // ✅ Thêm timestamp
            receiverId: data.senderId, // ✅ Với người nhận, senderId = receiverId
          },
        });

        // ✅ 4. Notify sender that message was delivered
        client.emit('messageDelivered', {
          messageId: result.message.id,
          conversationId: result.conversation.id,
          deliveredAt: new Date().toISOString(),
        });

        console.log(`✅✅ Message delivered to ${data.receiverId}`);
      } else {
        console.log(`⚠️ Receiver ${data.receiverId} is offline`);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Error sending message:', error);
      client.emit('messageError', {
        tempId: data.tempId,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ Mark as seen
   */
  @SubscribeMessage('markAsSeen')
  async handleMarkAsSeen(
    @MessageBody()
    data: {
      conversationId: string;
      userId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.chatService.markMessagesAsRead(
        data.conversationId,
        data.userId,
      );

      // Get conversation to find sender
      const conversations = await this.chatService.getUserConversations(
        data.userId,
      );
      const conversation = conversations.find(
        (c) => c.id === data.conversationId,
      );

      if (conversation) {
        const senderId = conversation.receiverId;
        const senderSocketId = this.connectedUsers.get(senderId);

        if (senderSocketId) {
          this.server.to(senderSocketId).emit('messagesSeen', {
            conversationId: data.conversationId,
            seenBy: data.userId,
            timestamp: new Date().toISOString(),
          });
        }
      }

      client.emit('markAsSeenSuccess', {
        conversationId: data.conversationId,
        markedCount: result.markedCount,
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Error marking as seen:', error);
      client.emit('markAsSeenError', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ Typing indicator
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
   * Helper methods
   */
  emitToUser(userId: string, event: string, data: any): boolean {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  getOnlineUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}
