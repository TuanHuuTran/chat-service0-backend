// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';

// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);

//   // QUAN TRỌNG: Phải enable CORS TRƯỚC khi listen
//   app.enableCors({
//     origin: '*', // ← Đổi từ '*' thành true
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
//     allowedHeaders: [
//       'Content-Type',
//       'Authorization',
//       'Accept',
//       'X-Requested-With',
//     ],
//     exposedHeaders: ['Content-Range', 'X-Content-Range'],
//     maxAge: 3600,
//   });
//   const port = process.env.PORT ?? 8000;
//   await app.listen(port);

//   console.log(`🚀 Server is running on: http://localhost:${port}`);
// }

// bootstrap();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 8000;
  await app.listen(port);

  console.log(`🚀 Server is running on: http://localhost:${port}`);
}

bootstrap();
