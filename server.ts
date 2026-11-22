import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { StoreDatabase } from './src/server/db/storeDatabase.ts';
import { RealtimeHub } from './src/server/realtime/wsHub.ts';
import { registerCommerceRoutes } from './src/server/routes/commerceRoutes.ts';
import { registerEquityAndReportsRoutes } from './src/server/routes/equityAndReportsRoutes.ts';
import { registerFeatureRoutes } from './src/server/routes/featureRoutes.ts';
import { registerPartnersAndTreasuryRoutes } from './src/server/routes/partnersAndTreasuryRoutes.ts';
import { registerQuotationsRoutes } from './src/server/routes/quotationsRoutes.ts';
import { registerScheduledReportsRoutes } from './src/server/routes/scheduledReportsRoutes.ts';
import { registerSecurityAndDataRoutes } from './src/server/routes/securityAndDataRoutes.ts';
import { createRouteAuthContext } from './src/server/security/authContext.ts';
import {
  safeJsonErrorMiddleware,
  securityHeadersMiddleware,
} from './src/server/security/requestValidation.ts';
import { ScheduledReportsService } from './src/server/services/scheduledReportsService.ts';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(securityHeadersMiddleware);

  // Support connecting from external / LAN desktop or PWA clients configured via Server Config Modal
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-actor-user-id, x-admin-pin');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const httpServer = http.createServer(app);
  const storeDb = new StoreDatabase();
  const wsHub = new RealtimeHub(httpServer);
  const scheduledReportsService = new ScheduledReportsService(storeDb, wsHub);
  const auth = createRouteAuthContext(storeDb);

  // Register modular domain route groups
  registerSecurityAndDataRoutes(app, storeDb, wsHub, auth);
  registerCommerceRoutes(app, storeDb, wsHub, auth);
  registerPartnersAndTreasuryRoutes(app, storeDb, wsHub, auth);
  registerQuotationsRoutes(app, storeDb, wsHub, auth);
  registerEquityAndReportsRoutes(app, storeDb, wsHub, auth);
  registerScheduledReportsRoutes(app, storeDb, scheduledReportsService, wsHub, auth);
  registerFeatureRoutes(app, storeDb, wsHub, auth);

  // Safe JSON error fallback for /api routes (hides stack traces in responses)
  app.use(safeJsonErrorMiddleware);

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
