import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  const allowedOrigins = (
    process.env.CORS_ORIGINS ||
    'https://cursor-fdz-pc.vercel.app,https://cursor-fdz-h5.vercel.app,http://localhost:5173,http://localhost:5175'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('该来源不在 CORS 白名单中'), false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: false,
    }),
  );
  return app;
}

export async function createNestApp() {
  const app = await NestFactory.create(AppModule);
  return configureApp(app);
}
