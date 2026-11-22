import type { IncomingMessage, ServerResponse } from 'node:http';
import vercelHandler from '../src/server/vercelHandler.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  vercelHandler(req, res);
}
