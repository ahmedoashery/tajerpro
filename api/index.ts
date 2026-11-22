import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStoreApp } from '../src/server/createApp.ts';

let cachedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

function getHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  if (!cachedHandler) {
    const { app } = createStoreApp({ httpServer: null });
    cachedHandler = app;
  }
  return cachedHandler;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  return getHandler()(req, res);
}
