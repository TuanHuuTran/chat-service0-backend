import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { multerConfig } from 'src/core/config/multer.config';

export interface ResponseUploadFileDto {
  original_name: string;
  file_url: string;
  public_id: string;
  resource_type: string;
}

@Controller('chat/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // ✅ Existing endpoint
  @Post('cloud-multi')
  @UseInterceptors(FilesInterceptor('files', 5, multerConfig))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadFileDto: UploadFileDto,
  ): Promise<ResponseUploadFileDto[]> {
    return await this.handleMultipleUpload(files, uploadFileDto.folder);
  }

  // ✅ NEW: Chat images upload endpoint (max 10 images)
  @Post('chat-images')
  @UseInterceptors(FilesInterceptor('images', 10, multerConfig))
  async uploadChatImages(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<ResponseUploadFileDto[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No images provided');
    }

    return await this.handleMultipleUpload(files, 'chat-images');
  }

  private async handleMultipleUpload(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<ResponseUploadFileDto[]> {
    const uploadResults = await Promise.all(
      files.map(async (file) => {
        const uploaded = await this.uploadService.uploadFileToCloudinary(
          file,
          folder,
        );
        return this.mapCloudinaryResponse(uploaded, file.originalname);
      }),
    );

    return uploadResults;
  }

  private mapCloudinaryResponse(
    uploaded: any,
    originalName: string,
  ): ResponseUploadFileDto {
    return {
      original_name: originalName,
      file_url: uploaded.secure_url,
      public_id: uploaded.public_id,
      resource_type: uploaded.resource_type,
    };
  }
}
