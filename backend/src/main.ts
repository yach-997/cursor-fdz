import { createNestApp } from './bootstrap';

async function bootstrap() {
  const app = await createNestApp();
  const port = process.env.BACKEND_PORT || process.env.PORT || 3000;
  await app.listen(port);
  console.log(`阳光运维系统后端已启动: http://localhost:${port}/api`);
}

bootstrap();
