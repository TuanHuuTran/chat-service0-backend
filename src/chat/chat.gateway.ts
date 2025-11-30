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
import { MessageType } from 'src/conversation/entities/message.entity';

interface CallUser {
  userId: string;
  socketId: string;
  name: string;
  avatar?: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>(); // userId -> socketId
  private callUsers = new Map<string, CallUser>(); // userId -> CallUser info
  private activeCalls = new Map<
    string,
    {
      caller: string;
      callee: string;
      hasEnded: boolean; // ✅ NEW: Track nếu call đã được ended
    }
  >();

  constructor(private chatService: ChatService) {}

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    const userName = client.handshake.query.userName as string;
    const userAvatar = client.handshake.query.userAvatar as string;

    if (!userId) {
      console.log('❌ Connection rejected: No userId');
      client.disconnect();
      return;
    }

    this.connectedUsers.set(userId, client.id);

    this.callUsers.set(userId, {
      userId,
      socketId: client.id,
      name: userName || 'Unknown User',
      avatar: userAvatar,
    });

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
      this.callUsers.delete(userId);

      this.endActiveCallsForUser(userId);

      await this.chatService.updateOnlineStatus(userId, false);

      console.log(`🔴 User ${userId} disconnected`);

      client.broadcast.emit('userOffline', {
        userId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ==========================================
  // 💬 CHAT MESSAGES (Existing)
  // ==========================================

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

  //     const usersInfo = await this.chatService.getUsersInfo([
  //       data.receiverId,
  //       data.senderId,
  //     ]);
  //     const receiverInfo = usersInfo.get(data.receiverId);
  //     const senderInfo = usersInfo.get(data.senderId);

  //     const result = await this.chatService.sendMessage({
  //       senderId: data.senderId,
  //       receiverId: data.receiverId,
  //       content: data.content,
  //       conversationId: data.conversationId,
  //       senderInfo: senderInfo,
  //       receiverInfo: receiverInfo,
  //     });

  //     console.log('✅ Message saved:', result);

  //     const messageData = {
  //       id: result.message.id,
  //       content: result.message.content,
  //       timestamp: new Date(result.message.createdAt).toLocaleTimeString(
  //         'vi-VN',
  //         {
  //           hour: '2-digit',
  //           minute: '2-digit',
  //         },
  //       ),
  //       isSent: true,
  //       isDelivered: false,
  //       isRead: false,
  //       senderId: result.message.senderId,
  //       senderName: result?.message?.senderInfo?.name || 'Unknown',
  //       avatar: result?.message?.senderInfo?.avatar || '',
  //       createdAt: result.message.createdAt,
  //     };

  //     console.log('messageData', messageData);
  //     client.emit('messageSent', {
  //       tempId: data.tempId,
  //       message: messageData,
  //       conversationId: result.conversation.id,
  //     });

  //     const receiverSocketId = this.connectedUsers.get(data.receiverId);

  //     if (receiverSocketId) {
  //       await this.chatService.markAsDelivered(result.message.id);

  //       this.server.to(receiverSocketId).emit('newMessage', {
  //         message: {
  //           id: result.message.id,
  //           content: result.message.content,
  //           senderId: data.senderId,
  //           timestamp: messageData.timestamp,
  //           senderName: result?.message?.senderInfo?.name || 'Unknown',
  //           avatar: result?.message?.senderInfo?.avatar || '',
  //         },
  //         conversation: {
  //           id: result.conversation.id,
  //           name: result?.message?.senderInfo?.name || 'Unknown User',
  //           avatar: result?.message?.senderInfo?.avatar || '',
  //           timestamp: messageData.timestamp,
  //           receiverId: data.senderId,
  //         },
  //       });

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
      images?: string[]; // ✅ NEW: Array of image URLs
      messageType?: MessageType; // ✅ NEW: Message type (use enum)
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(
        `📤 Sending message from ${data.senderId} to ${data.receiverId}`,
        {
          hasImages: !!data.images,
          imageCount: data.images?.length || 0,
          messageType: data.messageType,
        },
      );

      const usersInfo = await this.chatService.getUsersInfo([
        data.receiverId,
        data.senderId,
      ]);
      const receiverInfo = usersInfo.get(data.receiverId);
      const senderInfo = usersInfo.get(data.senderId);

      // ✅ Pass images to service
      const result = await this.chatService.sendMessage({
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        conversationId: data.conversationId,
        senderInfo: senderInfo,
        receiverInfo: receiverInfo,
        images: data.images, // ✅ NEW
        messageType: data.messageType, // ✅ Pass enum directly
      });

      console.log('✅ Message saved:', result);

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
        senderName: result?.message?.senderInfo?.name || 'Unknown',
        avatar: result?.message?.senderInfo?.avatar || '',
        createdAt: result.message.createdAt,
        images: result.message.metadata?.images || [], // ✅ NEW
        messageType: result.message.messageType || 'text', // ✅ NEW
      };

      client.emit('messageSent', {
        tempId: data.tempId,
        message: messageData,
        conversationId: result.conversation.id,
      });

      const receiverSocketId = this.connectedUsers.get(data.receiverId);

      if (receiverSocketId) {
        await this.chatService.markAsDelivered(result.message.id);

        this.server.to(receiverSocketId).emit('newMessage', {
          message: {
            id: result.message.id,
            content: result.message.content,
            senderId: data.senderId,
            timestamp: messageData.timestamp,
            senderName: result?.message?.senderInfo?.name || 'Unknown',
            avatar: result?.message?.senderInfo?.avatar || '',
            images: result.message.metadata?.images || [], // ✅ NEW
            messageType: result.message.messageType || 'text', // ✅ NEW
          },
          conversation: {
            id: result.conversation.id,
            name: result?.message?.senderInfo?.name || 'Unknown User',
            avatar: result?.message?.senderInfo?.avatar || '',
            timestamp: messageData.timestamp,
            receiverId: data.senderId,
          },
        });

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

  // ==========================================
  // 📞 VIDEO CALL SIGNALING (Fixed)
  // ==========================================

  @SubscribeMessage('call-user')
  handleCallUser(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      fromUserId: string;
      toUserId: string;
      fromUserInfo: { name: string; avatar?: string };
      offer: RTCSessionDescriptionInit;
    },
  ) {
    const targetUser = this.callUsers.get(data.toUserId);

    if (!targetUser) {
      client.emit('call-failed', {
        reason: 'User is offline or unavailable',
      });
      console.log(`❌ Call failed: User ${data.toUserId} is offline`);
      return { success: false };
    }

    const isInCall = Array.from(this.activeCalls.values()).some(
      (call) =>
        !call.hasEnded && // ✅ Only check active calls
        (call.caller === data.toUserId || call.callee === data.toUserId),
    );

    if (isInCall) {
      client.emit('call-failed', {
        reason: 'User is currently in another call',
      });
      console.log(`❌ Call failed: User ${data.toUserId} is busy`);
      return { success: false };
    }

    const callId = `${data.fromUserId}-${data.toUserId}-${Date.now()}`;

    // ✅ Store call info
    this.activeCalls.set(callId, {
      caller: data.fromUserId,
      callee: data.toUserId,
      hasEnded: false, // ✅ Track ending state
    });

    console.log(
      `📞 Call from ${data.fromUserId} (${data.fromUserInfo.name}) to ${data.toUserId}`,
    );

    this.server.to(targetUser.socketId).emit('incoming-call', {
      callId,
      fromUserId: data.fromUserId,
      fromUserInfo: data.fromUserInfo,
      offer: data.offer,
    });

    return { success: true, callId };
  }

  @SubscribeMessage('accept-call')
  handleAcceptCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      callId: string;
      toUserId: string;
      answer: RTCSessionDescriptionInit;
    },
  ) {
    const targetUser = this.callUsers.get(data.toUserId);

    if (!targetUser) {
      client.emit('call-failed', { reason: 'Caller is no longer available' });
      return { success: false };
    }

    console.log(`✅ Call accepted by ${client.id} for call ${data.callId}`);

    this.server.to(targetUser.socketId).emit('call-accepted', {
      callId: data.callId,
      answer: data.answer,
    });

    return { success: true };
  }

  @SubscribeMessage('reject-call')
  async handleRejectCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      callId: string;
      toUserId: string;
    },
  ) {
    const targetUser = this.callUsers.get(data.toUserId);

    if (targetUser) {
      this.server.to(targetUser.socketId).emit('call-rejected', {
        callId: data.callId,
      });
    }

    const activeCall = this.activeCalls.get(data.callId);
    if (activeCall) {
      try {
        const callerInfo = this.callUsers.get(activeCall.caller);
        const receiverInfo = this.callUsers.get(data.toUserId);

        await this.chatService.saveCallAsMessage({
          callerId: activeCall.caller,
          receiverId: data.toUserId,
          duration: 0,
          callType: 'video',
          callId: data.callId,
          callStatus: 'declined',
          callerInfo: callerInfo
            ? { name: callerInfo.name, avatar: callerInfo.avatar }
            : undefined,
          receiverInfo: receiverInfo
            ? { name: receiverInfo.name, avatar: receiverInfo.avatar }
            : undefined,
        });
      } catch (error) {
        console.error('❌ Error saving rejected call:', error);
      }
    }

    this.activeCalls.delete(data.callId);
    console.log(`❌ Call ${data.callId} rejected`);
    return { success: true };
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      toUserId: string;
      candidate: RTCIceCandidateInit;
    },
  ) {
    const targetUser = this.callUsers.get(data.toUserId);

    if (targetUser) {
      this.server.to(targetUser.socketId).emit('ice-candidate', {
        candidate: data.candidate,
      });
      console.log(`🧊 ICE candidate sent to ${data.toUserId}`);
    }

    return { success: true };
  }

  /**
   * ✅ FIXED: End call handler
   */
  @SubscribeMessage('end-call')
  async handleEndCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      callId: string;
      toUserId: string;
      callerId?: string;
      duration?: number;
      callType?: 'video' | 'voice';
    },
  ) {
    console.log('📞 End call received:', {
      callId: data.callId,
      toUserId: data.toUserId,
      callerId: data.callerId,
      duration: data.duration,
      callType: data.callType,
    });

    // ✅ FIX 1: Lấy thông tin call từ activeCalls
    const activeCall = data.callId ? this.activeCalls.get(data.callId) : null;

    // ✅ FIX 2: Kiểm tra xem call đã được end chưa
    if (activeCall && activeCall.hasEnded) {
      console.log(`⏭️ Call ${data.callId} already ended, skipping...`);
      return { success: true, message: 'Call already ended' };
    }

    // ✅ FIX 3: Đánh dấu call đã ended NGAY LẬP TỨC
    if (activeCall) {
      activeCall.hasEnded = true;
    }

    // ✅ FIX 4: Xác định đúng caller/callee từ activeCalls
    const actualCallerId = activeCall ? activeCall.caller : data.callerId;
    const actualCalleeId = activeCall ? activeCall.callee : data.toUserId;

    console.log('🔍 Resolved call info:', {
      actualCallerId,
      actualCalleeId,
      fromActiveCall: !!activeCall,
    });

    // ✅ Emit call-ended đến peer (KHÔNG phải người gọi end-call)
    const currentUserId = [...this.callUsers.entries()].find(
      ([_, user]) => user.socketId === client.id,
    )?.[0];

    if (currentUserId && actualCallerId && actualCalleeId && data.callId) {
      const peerUserId =
        currentUserId === actualCallerId ? actualCalleeId : actualCallerId;

      // ✅ Kiểm tra peerUserId exists
      if (peerUserId) {
        const peerSocketId = this.connectedUsers.get(peerUserId);

        if (peerSocketId) {
          console.log(`📤 Emitting call-ended to peer: ${peerUserId}`);
          this.server.to(peerSocketId).emit('call-ended', {
            callId: data.callId,
          });
        }
      }
    }

    // ✅ Save message và emit newMessage
    if (
      data.callId &&
      data.duration !== undefined &&
      data.callType &&
      actualCallerId
    ) {
      try {
        const callerInfo = this.callUsers.get(actualCallerId);
        const calleeInfo = this.callUsers.get(actualCalleeId);

        const result = await this.chatService.saveCallAsMessage({
          callerId: actualCallerId, // ✅ Luôn là người gọi đầu tiên
          receiverId: actualCalleeId,
          duration: data.duration,
          callType: data.callType,
          callId: data.callId,
          callStatus: data.duration > 0 ? 'answered' : 'missed',
          callerInfo: callerInfo
            ? {
                name: callerInfo.name,
                avatar: callerInfo.avatar,
              }
            : undefined,
          receiverInfo: calleeInfo
            ? {
                name: calleeInfo.name,
                avatar: calleeInfo.avatar,
              }
            : undefined,
        });

        console.log('✅ Message saved to DB:', {
          messageId: result.message.id,
          senderId: result.message.senderId,
          content: result.message.content,
        });

        const baseMessage = {
          id: result.message.id,
          content: result.message.content,
          timestamp: new Date(result.message.createdAt).toLocaleTimeString(
            'vi-VN',
            { hour: '2-digit', minute: '2-digit' },
          ),
          createdAt: result.message.createdAt,
          messageType: result.message.messageType,
          metadata: result.message.metadata,
        };

        // ✅ Emit to CALLER
        const callerSocketId = this.connectedUsers.get(actualCallerId);
        if (callerSocketId) {
          const callerPayload = {
            message: {
              ...baseMessage,
              senderId: result.message.senderId,
              senderName: callerInfo?.name || 'You',
            },
            conversation: {
              id: result.conversation.id,
              name: calleeInfo?.name || 'Unknown',
              avatar: calleeInfo?.avatar || '',
              receiverId: actualCalleeId,
            },
          };

          console.log('📤 Emit to CALLER:', {
            userId: actualCallerId,
            socketId: callerSocketId,
          });

          this.server.to(callerSocketId).emit('newMessage', callerPayload);
        }

        // ✅ Emit to CALLEE
        const calleeSocketId = this.connectedUsers.get(actualCalleeId);
        if (calleeSocketId) {
          const calleePayload = {
            message: {
              ...baseMessage,
              senderId: result.message.senderId,
              senderName: callerInfo?.name || 'Unknown',
            },
            conversation: {
              id: result.conversation.id,
              name: callerInfo?.name || 'Unknown',
              avatar: callerInfo?.avatar || '',
              receiverId: actualCallerId,
            },
          };

          console.log('📤 Emit to CALLEE:', {
            userId: actualCalleeId,
            socketId: calleeSocketId,
          });

          this.server.to(calleeSocketId).emit('newMessage', calleePayload);
        }

        console.log('✅✅ Call messages emitted successfully');
      } catch (error) {
        console.error('❌ Error in handleEndCall:', error);
      }
    }

    // ✅ Cleanup activeCalls sau delay (để tránh race condition)
    if (data.callId) {
      setTimeout(() => {
        this.activeCalls.delete(data.callId);
        console.log(`🧹 Call ${data.callId} removed from activeCalls`);
      }, 2000);
    }

    return { success: true };
  }

  @SubscribeMessage('cancel-call')
  async handleCancelCall(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      callId: string;
      toUserId: string;
    },
  ) {
    const targetUser = this.callUsers.get(data.toUserId);

    if (targetUser) {
      this.server.to(targetUser.socketId).emit('call-cancelled', {
        callId: data.callId,
      });
    }

    const activeCall = this.activeCalls.get(data.callId);
    const callerId = activeCall?.caller;

    if (callerId) {
      try {
        const callerInfo = this.callUsers.get(callerId);
        const receiverInfo = this.callUsers.get(data.toUserId);

        await this.chatService.saveCallAsMessage({
          callerId,
          receiverId: data.toUserId,
          duration: 0,
          callType: 'video',
          callId: data.callId,
          callStatus: 'cancelled',
          callerInfo: callerInfo
            ? { name: callerInfo.name, avatar: callerInfo.avatar }
            : undefined,
          receiverInfo: receiverInfo
            ? { name: receiverInfo.name, avatar: receiverInfo.avatar }
            : undefined,
        });
      } catch (error) {
        console.error('❌ Error saving cancelled call:', error);
      }
    }

    this.activeCalls.delete(data.callId);
    console.log(`🚫 Call ${data.callId} cancelled`);
    return { success: true };
  }

  // ==========================================
  // 🛠️ HELPER METHODS
  // ==========================================

  private endActiveCallsForUser(userId: string) {
    for (const [callId, call] of this.activeCalls.entries()) {
      if (call.hasEnded) continue; // ✅ Skip already ended calls

      if (call.caller === userId) {
        const calleeSocketId = this.connectedUsers.get(call.callee);
        if (calleeSocketId) {
          this.server.to(calleeSocketId).emit('call-ended', {
            callId,
            reason: 'User disconnected',
          });
        }
        this.activeCalls.delete(callId);
      } else if (call.callee === userId) {
        const callerSocketId = this.connectedUsers.get(call.caller);
        if (callerSocketId) {
          this.server.to(callerSocketId).emit('call-ended', {
            callId,
            reason: 'User disconnected',
          });
        }
        this.activeCalls.delete(callId);
      }
    }
  }

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

  getActiveCalls(): Array<{ callId: string; caller: string; callee: string }> {
    return Array.from(this.activeCalls.entries())
      .filter(([_, call]) => !call.hasEnded) // ✅ Only return active calls
      .map(([callId, call]) => ({
        callId,
        caller: call.caller,
        callee: call.callee,
      }));
  }
}
