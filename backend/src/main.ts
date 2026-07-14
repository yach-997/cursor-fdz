import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局路由前缀
  app.setGlobalPrefix('api');

  // 开启 CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // 全局校验管道：自动转换类型 + 校验 DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.BACKEND_PORT || process.env.PORT || 3000;
  await app.listen(port);
  console.log(`智能设备巡检系统后端已启动: http://localhost:${port}/api`);
}

bootstrap();
