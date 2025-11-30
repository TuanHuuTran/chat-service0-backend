import { Module } from '@nestjs/common';
import { UploadService } from './files.service';
import { UploadController } from './files.controller';
import { CloudinaryModule } from 'src/provider/cloudinary/cloudinary.module';

@Module({
  imports: [CloudinaryModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
