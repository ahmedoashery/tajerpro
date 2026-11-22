import type express from 'express';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import type { RouteAuthContext } from '../security/authContext.ts';

/**
 * REST endpoints for Sales Quotations & Proforma Invoices (عروض الأسعار).
 * Creating or cancelling a quotation never alters stock, customer debt, or treasuries
 * until converted into an actual sale invoice.
 */
export function registerQuotationsRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: RouteAuthContext
): void {
  app.get('/api/quotations', (req, res) => {
    try {
      const actor = auth.resolveActor(req);
      if (!actor && !auth.hasValidAdminPin(req)) {
        res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض عروض الأسعار.' });
        return;
      }
      if (
        actor &&
        !storeDb.hasPermission(actor.id, 'pos_sell') &&
        !storeDb.hasPermission(actor.id, 'view_reports')
      ) {
        res.status(403).json({ error: 'ليست لديك صلاحية عرض عروض الأسعار.' });
        return;
      }
      res.json({ quotations: storeDb.listQuotations(120) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل عروض الأسعار' });
    }
  });

  app.post('/api/quotations', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      const actor = auth.getActorContext(req);
      const quotation = storeDb.createQuotation({
        ...req.body,
        createdBy: actor?.name || 'الكاشير',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إصدار عرض سعر (${quotation.quotationNumber}) للعميل ${quotation.customerName} بقيمة ${quotation.grandTotal} ج.م`,
        category: 'data',
        target: quotation.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم إصدار عرض سعر جديد ${quotation.quotationNumber}` });
      res.status(201).json({ quotation, quotations: storeDb.listQuotations(120) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حفظ عرض السعر' });
    }
  });

  app.patch('/api/quotations/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      const actor = auth.getActorContext(req);
      const nextStatus = req.body?.status === 'cancelled' ? 'cancelled' : 'active';
      const quotation = storeDb.updateQuotationStatus(req.params.id, nextStatus);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث حالة عرض السعر (${quotation.quotationNumber}) إلى ${nextStatus === 'cancelled' ? 'ملغي' : 'ساري'}`,
        category: 'data',
        target: quotation.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث حالة عرض السعر ${quotation.quotationNumber}` });
      res.json({ quotation, quotations: storeDb.listQuotations(120) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث عرض السعر' });
    }
  });

  app.delete('/api/quotations/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      const actor = auth.getActorContext(req);
      storeDb.deleteQuotation(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف عرض السعر (${req.params.id})`,
        category: 'data',
        target: req.params.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف عرض سعر' });
      res.json({ ok: true, quotations: storeDb.listQuotations(120) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف عرض السعر' });
    }
  });
}
