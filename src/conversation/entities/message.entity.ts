// import {
//   Column,
//   CreateDateColumn,
//   Entity,
//   ManyToOne,
//   PrimaryGeneratedColumn,
// } from 'typeorm';
// import { Conversation } from './conversation.entity';

// // ✅ Enum cho message type
// export enum MessageType {
//   TEXT = 'text',
//   IMAGE = 'image',
//   FILE = 'file',
//   CALL = 'call', // ✅ Thêm type cho cuộc gọi
// }

// // ✅ Enum cho call type
// export enum CallType {
//   VIDEO = 'video',
//   VOICE = 'voice',
// }

// @Entity('messages')
// export class Message {
//   @PrimaryGeneratedColumn('uuid')
//   id: string;

//   @ManyToOne(() => Conversation, (conversation) => conversation.messages)
//   conversation: Conversation;

//   @Column()
//   senderId: string;

//   @Column('text')
//   content: string;

//   // ✅ Thêm messageType
//   @Column({
//     type: 'enum',
//     enum: MessageType,
//     default: MessageType.TEXT,
//   })
//   messageType: MessageType;

//   // ✅ Thêm metadata cho call (JSON)
//   @Column({ type: 'jsonb', nullable: true })
//   metadata: {
//     callId?: string;
//     duration?: number; // seconds
//     callType?: CallType;
//     callStatus?: 'answered' | 'missed' | 'declined' | 'cancelled';
//   };

//   @Column({ default: true })
//   isSent: boolean;

//   @Column({ default: false })
//   isDelivered: boolean;

//   @Column({ default: false })
//   isRead: boolean;

//   @Column({ type: 'timestamp', nullable: true })
//   deliveredAt: Date;

//   @Column({ type: 'timestamp', nullable: true })
//   readAt: Date;

//   @Column({ nullable: true })
//   reaction: string;

//   @CreateDateColumn({ type: 'timestamp' })
//   createdAt: Date;
// }

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  CALL = 'call',
  FILE = 'file',
}

export enum CallType {
  VIDEO = 'video',
  VOICE = 'voice',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column()
  conversationId: string;

  @Column()
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  messageType: MessageType;

  // ✅ NEW: Store metadata including images
  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    images?: string[]; // ✅ Array of image URLs
    callId?: string;
    duration?: number;
    callType?: CallType;
    callStatus?: 'answered' | 'missed' | 'declined' | 'cancelled';
    fileName?: string;
    fileSize?: number;
    fileType?: string;
  };

  @Column({ nullable: true })
  reaction?: string;

  @Column({ default: false })
  isSent: boolean;

  @Column({ default: false })
  isDelivered: boolean;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  deliveredAt?: Date;

  @Column({ nullable: true })
  readAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
