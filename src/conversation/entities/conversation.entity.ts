import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user1Id: string; // ✅ Chỉ lưu ID

  @Column()
  user2Id: string; // ✅ Chỉ lưu ID

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];

  @Column({ nullable: true })
  lastMessageId: string;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'SET NULL' })
  lastMessage: Message;

  @Column({ default: 0 })
  unreadCount: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
