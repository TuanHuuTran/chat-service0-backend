import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('user_chat_status')
export class UserChatStatus {
  @PrimaryColumn()
  userId: string; // Reference đến user-profile-service

  @Column({ default: false })
  isOnline: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastSeen: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastConnectedAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
