import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// ✅ RECOMMENDED: Tách bảng UserChatStatus
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

  @UpdateDateColumn()
  updatedAt: Date;
}
