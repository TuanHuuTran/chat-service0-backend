import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { AuthModule } from './auth/auth.module';
import { UploadModule } from './files/files.module';

@Module({
  imports: [
    // Load env
    ConfigModule.forRoot({ isGlobal: true }),

    // PostgreSQL connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('POSTGRES_HOST'),
        port: configService.get<number>('POSTGRES_PORT'),
        username: configService.get<string>('POSTGRES_USER'),
        password: configService.get<string>('POSTGRES_PASSWORD'),
        database: configService.get<string>('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: true, // ⚠️ chỉ dùng trong dev
      }),
    }),

    ConversationModule,
    ChatModule,
    AuthModule,
    UploadModule,
  ],
})
export class AppModule {}
