import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: 400,
  }));

  app.useGlobalInterceptors(new LoggingInterceptor());

  app.setGlobalPrefix('api');

  // Настраиваем статические файлы с абсолютным путем
  const uploadsPath = join(process.cwd(), 'uploads');
  console.log('Static files path:', uploadsPath); // Для отладки
  app.useStaticAssets(uploadsPath, {
    prefix: '/api/uploads',
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
