import 'reflect-metadata';
import type { Request, Response } from 'express';
import { createNestApp } from './src/bootstrap';

type ExpressServer = (req: Request, res: Response) => unknown;

let serverPromise: Promise<ExpressServer> | undefined;

async function getServer() {
  if (!serverPromise) {
    serverPromise = (async () => {
      const app = await createNestApp();
      await app.init();
      return app.getHttpAdapter().getInstance() as ExpressServer;
    })();
  }
  return serverPromise;
}

export const config = { maxDuration: 300 };

export default async function handler(req: Request, res: Response) {
  const server = await getServer();
  return server(req, res);
}
