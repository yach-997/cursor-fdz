import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** 允许本仓库 Vercel Preview 域名（含分支别名与部署临时域名） */
function isAllowedVercelPreviewOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    // 例：cursor-fdz-pc-git-xxx-wndm.vercel.app / cursor-fdz-h5-xxxx-wndm.vercel.app
    return /^cursor-fdz.*-wndm\.vercel\.app$/i.test(hostname);
  } catch {
    return false;
  }
}

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
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        isAllowedVercelPreviewOrigin(origin)
      ) {
        callback(null, true);
        return;
      }
      // 不授予跨域头即可由浏览器拦截；不要抛错，否则普通探测会被误报为 500。
      callback(null, false);
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
