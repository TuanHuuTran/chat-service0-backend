import { BadRequestException } from '@nestjs/common';

export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4',
  'video/quicktime',
];

export const multerConfig = {
  limits: { fileSize: 10 * 1024 * 1024 }, // Giới hạn 10MB
  fileFilter: (req, file, done) => {
    if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      return done(null, true);
    }

    return done(
      new BadRequestException(
        'Invalid file type. Allowed types: jpeg, png, gif, pdf, zip, doc, docx, mp4, mov',
      ),
      false,
    );
  },
};
