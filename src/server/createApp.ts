import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { StoreDatabase } from './db/storeDatabase.ts';
import { RealtimeHub } from './realtime/wsHub.ts';
import { registerCommerceRoutes } from './routes/commerceRoutes.ts';
import { registerEquityAndReportsRoutes } from './routes/equityAndReportsRoutes.ts';
import { registerFeatureRoutes } from './routes/featureRoutes.ts';
import { registerPartnersAndTreasuryRoutes } from './routes/partnersAndTreasuryRoutes.ts';
import { registerQuotationsRoutes } from './routes/quotationsRoutes.ts';
import { registerScheduledReportsRoutes } from './routes/scheduledReportsRoutes.ts';
import { registerSecurityAndDataRoutes } from './routes/securityAndDataRoutes.ts';
import { createRouteAuthContext } from './security/authContext.ts';
import {
  safeJsonErrorMiddleware,
  securityHeadersMiddleware,
} from './security/requestValidation.ts';
import { ScheduledReportsService } from './services/scheduledReportsService.ts';

export interface StoreAppContext {
  app: express.Express;
  storeDb: StoreDatabase;
  wsHub: RealtimeHub;
  scheduledReportsService: ScheduledReportsService;
}

/**
 * Builds the Express application with all Store API routes, security headers,
 * CORS, and optional WebSocket hub so both long-lived server.ts and serverless
 * adapters (e.g., Vercel api/index.ts) share one exact source of truth.
 */
export function createStoreApp(options?: { httpServer?: HttpServer | null }): StoreAppContext {
  const app = express();
  app.set('trust proxy', 1);
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

  const storeDb = new StoreDatabase();
  const wsHub = new RealtimeHub(options?.httpServer ?? null);
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

  return { app, storeDb, wsHub, scheduledReportsService };
}
