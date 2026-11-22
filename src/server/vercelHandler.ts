import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStoreApp, type StoreAppContext } from './createApp.ts';

let cachedContext: StoreAppContext | null = null;
let lastSchedulerTickAt = 0;

function getAppContext(): StoreAppContext {
  if (!cachedContext) {
    cachedContext = createStoreApp({ httpServer: null });
  }
  return cachedContext;
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

  // Normalize direct /api/handler invocation (from /api rewrite) to /api
  if (parsed.pathname === '/api/handler') {
    const qs = parsed.searchParams.toString();
    req.url = `/api${qs ? `?${qs}` : ''}`;
    return;
  }

  // Ensure /api/... keeps its /api prefix even if invoked via catch-all or stripped prefix
  if (!parsed.pathname.startsWith('/api')) {
    const qs = parsed.searchParams.toString();
    const clean = parsed.pathname.replace(/^\/+/, '');
    req.url = clean ? `/api/${clean}${qs ? `?${qs}` : ''}` : `/api${qs ? `?${qs}` : ''}`;
  }
}

export default function vercelHandler(req: IncomingMessage, res: ServerResponse): void {
  try {
    normalizeVercelApiUrl(req);
    const ctx = getAppContext();

    // Opportunistically evaluate scheduled reports once per minute on bootstrap requests in Vercel
    const now = Date.now();
    if (req.url?.startsWith('/api/bootstrap') && now - lastSchedulerTickAt >= 60_000) {
      lastSchedulerTickAt = now;
      void ctx.scheduledReportsService.tick().catch(() => {
        // Non-fatal background evaluation
      });
    }

    ctx.app(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر تشغيل خادم المتجر';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `تعذر تشغيل خادم البيانات: ${message}` }));
  }
}
