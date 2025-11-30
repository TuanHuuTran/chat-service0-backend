// dto/response-upload-file.dto.ts
import { Expose } from 'class-transformer';
import { IsString } from 'class-validator';

export class UploadFileDto {
  @IsString()
  original_name: string;

  @IsString()
  file_url: string;

  @IsString()
  public_id: string;

  @IsString()
  resource_type: string;
}

export class ResponseUploadFileDto {
  @Expose()
  original_name: string;

  @Expose()
  file_url: string;

  @Expose()
  public_id: string;

  @Expose()
  resource_type: string;
}
