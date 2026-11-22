import type express from 'express';
import type { PermissionKey } from '../../shared/types.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import {
  isEmailTransportConfigured,
  type ScheduledReportsService,
} from '../services/scheduledReportsService.ts';

export interface ScheduledReportsRouteAuth {
  checkActorPerm: (req: express.Request, res: express.Response, perm: PermissionKey) => boolean;
  getActorContext: (req: express.Request) => { id: string; name: string; role: string } | null;
}

export function registerScheduledReportsRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  scheduler: ScheduledReportsService,
  wsHub: RealtimeHub,
  auth: ScheduledReportsRouteAuth
): void {
  app.get('/api/scheduled-reports', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      res.json({
        schedules: storeDb.listScheduledReports(),
        digests: storeDb.listReportDigests(50),
        emailTransportConfigured: isEmailTransportConfigured(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تحميل التقارير المجدولة',
      });
    }
  });

  app.post('/api/scheduled-reports', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const schedule = storeDb.createScheduledReport(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إنشاء جدولة تقرير تلقائي (${schedule.name})`,
        category: 'settings',
        target: schedule.id,
      });
      wsHub.broadcast({
        type: 'state:refresh',
        reason: `تمت إضافة جدولة تقرير: ${schedule.name}`,
      });
      res.status(201).json({
        schedule,
        schedules: storeDb.listScheduledReports(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر إنشاء جدولة التقرير',
      });
    }
  });

  app.patch('/api/scheduled-reports/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const schedule = storeDb.updateScheduledReport(req.params.id, req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث جدولة التقرير (${schedule.name})`,
        category: 'settings',
        target: schedule.id,
      });
      wsHub.broadcast({
        type: 'state:refresh',
        reason: `تم تحديث جدولة التقرير: ${schedule.name}`,
      });
      res.json({
        schedule,
        schedules: storeDb.listScheduledReports(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تحديث جدولة التقرير',
      });
    }
  });

  app.delete('/api/scheduled-reports/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      storeDb.deleteScheduledReport(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف جدولة تقرير (${req.params.id})`,
        category: 'settings',
        target: req.params.id,
      });
      wsHub.broadcast({
        type: 'state:refresh',
        reason: 'تم حذف جدولة تقرير',
      });
      res.json({
        ok: true,
        schedules: storeDb.listScheduledReports(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر حذف جدولة التقرير',
      });
    }
  });

  app.post('/api/scheduled-reports/:id/run-now', async (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const actor = auth.getActorContext(req);
      const digest = await scheduler.dispatchSchedule(req.params.id, { manual: true });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تشغيل وإرسال فوري للتقرير المجدول (${digest.scheduleName})`,
        category: 'data',
        target: digest.id,
      });
      res.status(201).json({
        digest,
        schedules: storeDb.listScheduledReports(),
        digests: storeDb.listReportDigests(50),
        emailTransportConfigured: isEmailTransportConfigured(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تشغيل التقرير المجدول',
      });
    }
  });

  app.post('/api/scheduled-reports/digests/:id/read', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const actor = auth.getActorContext(req);
      const userId = actor?.id || 'usr-owner';
      const digest = storeDb.markReportDigestRead(req.params.id, userId);
      res.json({ digest, digests: storeDb.listReportDigests(50) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تحديث حالة قراءة التقرير',
      });
    }
  });

  app.post('/api/scheduled-reports/digests/read-all', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const actor = auth.getActorContext(req);
      const userId = actor?.id || 'usr-owner';
      storeDb.markAllReportDigestsRead(userId);
      res.json({ ok: true, digests: storeDb.listReportDigests(50) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر تحديث حالة القراءة',
      });
    }
  });

  app.get('/api/cron/scheduled-reports', async (req, res) => {
    try {
      const cronSecret = process.env.CRON_SECRET?.trim();
      if (cronSecret) {
        const authHeader = req.header('authorization') || '';
        if (authHeader !== `Bearer ${cronSecret}`) {
          res.status(401).json({ error: 'Unauthorized cron trigger' });
          return;
        }
      }
      const dispatched = await scheduler.tick();
      res.json({
        ok: true,
        dispatchedCount: dispatched.length,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'تعذر تشغيل المهام المجدولة',
      });
    }
  });
}
