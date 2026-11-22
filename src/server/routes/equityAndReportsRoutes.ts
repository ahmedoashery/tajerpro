import type express from 'express';
import type { PermissionKey, StoreActivityId } from '../../shared/types.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';

export interface RouteAuthHelpers {
  checkActorPerm: (req: express.Request, res: express.Response, perm: PermissionKey) => boolean;
  getActorContext: (req: express.Request) => { id: string; name: string; role: string } | null;
}

/**
 * Modular Express route registrar for Equity Partners, Partner Drawings,
 * Comprehensive P&L/ABC Reports, and Custom Report Builder Presets & Queries.
 */
export function registerEquityAndReportsRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: RouteAuthHelpers
): void {
  app.get('/api/reports', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const periodParam = String(req.query.period || 'daily');
      const period = periodParam === 'monthly' || periodParam === 'yearly' ? periodParam : 'daily';
      const activityParam = String(req.query.activity || 'all');
      const activityFilter = activityParam === 'all' ? 'all' : (activityParam as StoreActivityId);
      const fromDate = req.query.from ? String(req.query.from) : undefined;
      const toDate = req.query.to ? String(req.query.to) : undefined;

      res.json(
        storeDb.getReportsData({
          period,
          activityFilter,
          fromDate,
          toDate,
        })
      );
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إنشاء التقرير' });
    }
  });

  app.get('/api/reports/custom-presets', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      res.json({ presets: storeDb.getCustomReportPresets() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل قوالب التقارير' });
    }
  });

  app.post('/api/reports/custom-presets', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const actor = auth.getActorContext(req);
      const preset = storeDb.saveCustomReportPreset(req.body || {}, actor?.name || 'صاحب المحل');
      wsHub.broadcast({ type: 'state:refresh', reason: `تم حفظ قالب تقرير مخصص: ${preset.name}` });
      res.status(201).json({ preset, presets: storeDb.getCustomReportPresets() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حفظ التقرير المخصص' });
    }
  });

  app.delete('/api/reports/custom-presets/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      storeDb.deleteCustomReportPreset(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف قالب تقرير مخصص' });
      res.json({ ok: true, presets: storeDb.getCustomReportPresets() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف التقرير المخصص' });
    }
  });

  app.post('/api/reports/custom-query', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      const result = storeDb.runCustomReportQuery(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تنفيذ التقرير المخصص' });
    }
  });

  app.get('/api/equity-partners', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'view_reports')) return;
      res.json({
        partners: storeDb.getEquityPartners(),
        drawings: storeDb.getEquityDrawings(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل بيانات الشركاء' });
    }
  });

  app.post('/api/equity-partners', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const partner = storeDb.createEquityPartner(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إضافة شريك (${partner.name}) بنسبة ربح ${partner.profitSharePercent}%`,
        category: 'settings',
        target: partner.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تمت إضافة الشريك: ${partner.name}` });
      res.status(201).json({ partner, partners: storeDb.getEquityPartners() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إضافة الشريك' });
    }
  });

  app.patch('/api/equity-partners/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const partner = storeDb.updateEquityPartner(req.params.id, req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث بيانات وحصة الشريك (${partner.name}) — ${partner.profitSharePercent}%`,
        category: 'settings',
        target: partner.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث بيانات الشريك: ${partner.name}` });
      res.json({ partner, partners: storeDb.getEquityPartners() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث بيانات الشريك' });
    }
  });

  app.delete('/api/equity-partners/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      storeDb.deleteEquityPartner(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف حساب شريك (${req.params.id})`,
        category: 'settings',
        target: req.params.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف الشريك' });
      res.json({ ok: true, partners: storeDb.getEquityPartners() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف الشريك' });
    }
  });

  app.post('/api/equity-partners/:id/drawings', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const drawing = storeDb.recordEquityDrawing({
        partnerId: req.params.id,
        amount: Number(req.body?.amount),
        type: req.body?.type,
        treasuryId: req.body?.treasuryId || null,
        notes: req.body?.notes,
        actorName: actor?.name || 'صاحب المحل',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تسجيل حركة شريك (${drawing.partnerName}) بقيمة ${drawing.amount} ج.م`,
        category: 'data',
        target: drawing.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تسجيل مسحوبات/توزيعات للشريك: ${drawing.partnerName}` });
      res.status(201).json({ drawing, drawings: storeDb.getEquityDrawings() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل حركة الشريك' });
    }
  });
}
