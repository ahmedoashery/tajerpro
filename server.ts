import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createStoreApp } from './src/server/createApp.ts';

async function startServer() {
  const placeholderApp = express();
  const httpServer = http.createServer(placeholderApp);
  const { app, scheduledReportsService } = createStoreApp({ httpServer });

  // Forward HTTP requests from httpServer to the configured Express app
  httpServer.removeAllListeners('request');
  httpServer.on('request', app);

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server: httpServer,
          path: '/__vite_ws',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000;
  const schedulerWarmup = setTimeout(() => {
    void scheduledReportsService.tick();
  }, 8000);
  const schedulerInterval = setInterval(() => {
    void scheduledReportsService.tick();
  }, 60_000);

  httpServer.on('close', () => {
    clearTimeout(schedulerWarmup);
    clearInterval(schedulerInterval);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TajirPro POS & Store Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
