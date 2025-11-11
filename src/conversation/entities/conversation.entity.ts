import { User } from 'src/auth/entities/auth.entity';
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

  @ManyToOne(() => User)
  user1: User;

  @ManyToOne(() => User)
  user2: User;

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

  @CreateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
