import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from 'src/auth/entities/auth.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages)
  conversation: Conversation;

  @ManyToOne(() => User)
  senderId: string; // ✅ Chỉ lưu ID

  @Column('text')
  content: string;

  // ✅ Trạng thái tin nhắn
  @Column({ default: true })
  isSent: boolean; // Đã gửi lên server thành công

  @Column({ default: false })
  isDelivered: boolean; // Người nhận đã nhận được (online)

  // ✅ Timestamp cho từng trạng thái
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date; // Thời gian delivered

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date; // Thời gian read

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  reaction: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
