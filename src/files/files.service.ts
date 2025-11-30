import { Injectable, BadRequestException } from '@nestjs/common';
import { UploadApiResponse } from 'cloudinary';
import { CloudinaryProvider } from 'src/provider/cloudinary/cloudinary.config';
import * as streamifier from 'streamifier';

@Injectable()
export class UploadService {
  constructor(private readonly cloudinaryProvider: CloudinaryProvider) {}

  private get cloudinary() {
    return this.cloudinaryProvider.getCloudinary();
  }

  // ✅ Validate image file
  private validateImageFile(file: Express.Multer.File): void {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.',
      );
    }

    if (file.size > maxSize) {
      throw new BadRequestException('File size must be less than 5MB.');
    }
  }

  async uploadFileToCloudinary(
    file: Express.Multer.File,
    folder: string,
  ): Promise<UploadApiResponse> {
    // ✅ Validate if it's an image
    if (file.mimetype.startsWith('image/')) {
      this.validateImageFile(file);
    }

    return new Promise((resolve, reject) => {
      const uploadStream = this.cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          // ✅ Optimize images
          transformation: file.mimetype.startsWith('image/')
            ? [
                { width: 1200, height: 1200, crop: 'limit' },
                { quality: 'auto:good' },
                { fetch_format: 'auto' },
              ]
            : undefined,
        },
        (error, result) => {
          if (error) return reject(error);
          if (result) return resolve(result);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  // ✅ Upload multiple images for chat
  async uploadChatImages(
    files: Express.Multer.File[],
  ): Promise<UploadApiResponse[]> {
    const uploadPromises = files.map((file) =>
      this.uploadFileToCloudinary(file, 'chat-images'),
    );

    return Promise.all(uploadPromises);
  }
}
