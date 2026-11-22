import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStoreApp } from './createApp.ts';

let cachedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

function getHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  if (!cachedHandler) {
    const { app } = createStoreApp({ httpServer: null });
    cachedHandler = app;
  }
  return cachedHandler;
}

function normalizeVercelApiUrl(req: IncomingMessage): void {
  const rawUrl = req.url || '/api/health';
  const parsed = new URL(rawUrl, 'http://localhost');
  const vpath = parsed.searchParams.get('__vpath');
  if (vpath !== null) {
    parsed.searchParams.delete('__vpath');
    const cleanPath = vpath.replace(/^\/+/, '');
    const qs = parsed.searchParams.toString();
    req.url = cleanPath ? `/api/${cleanPath}${qs ? `?${qs}` : ''}` : `/api${qs ? `?${qs}` : ''}`;
    return;
  }

  // Also ensure /api/... keeps its /api prefix even if invoked via catch-all or stripped prefix
  if (!parsed.pathname.startsWith('/api')) {
    const qs = parsed.searchParams.toString();
    const clean = parsed.pathname.replace(/^\/+/, '');
    req.url = clean ? `/api/${clean}${qs ? `?${qs}` : ''}` : `/api${qs ? `?${qs}` : ''}`;
  }
}

export default function vercelHandler(req: IncomingMessage, res: ServerResponse): void {
  try {
    normalizeVercelApiUrl(req);
    getHandler()(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر تشغيل خادم المتجر';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `تعذر تشغيل خادم البيانات: ${message}` }));
  }
}
