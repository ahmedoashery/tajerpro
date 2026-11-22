import type express from 'express';
import type { PermissionKey, StaffUser } from '../../shared/types.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import { SlidingWindowRateLimiter } from '../security/rateLimiter.ts';

export interface FeatureRouteAuthHelpers {
  checkActorPerm: (req: express.Request, res: express.Response, perm: PermissionKey) => boolean;
  getActorContext: (req: express.Request) => { id: string; name: string; role: string } | null;
  hasValidAdminPin: (req: express.Request) => boolean;
  resolveActor: (req: express.Request) => StaffUser | null;
}

/**
 * Registers endpoints for Partial Returns & Exchanges, FEFO Product Batches,
 * Store Promotions, Owner Anomaly Alerts, and Supplier-Grouped Auto-Reorder suggestions.
 */
export function registerFeatureRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: FeatureRouteAuthHelpers
): void {
  const overrideRateLimiter = new SlidingWindowRateLimiter(
    60_000,
    15,
    'تم تجاوز عدد محاولات التحقق من رمز الاعتماد المسموح به'
  );

  const requireAuthenticated = (req: express.Request, res: express.Response): boolean => {
    const actor = auth.resolveActor(req);
    if (actor || auth.hasValidAdminPin(req)) return true;
    res.status(401).json({ error: 'يرجى تسجيل الدخول للوصول إلى هذه البيانات.' });
    return false;
  };

  // Partial invoice return & optional linked exchange invoice
  app.post('/api/invoices/:id/partial-return', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'invoice_return')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.partialReturnOrExchange({
        invoiceId: req.params.id,
        items: Array.isArray(req.body?.items) ? req.body.items : [],
        refundStrategy: req.body?.refundStrategy || 'cash',
        treasuryId: req.body?.treasuryId ?? null,
        reason: req.body?.reason ? String(req.body.reason) : '',
        actorName: actor?.name || 'صاحب المحل',
        terminalName: String(req.body?.terminalName || 'إدارة الفواتير'),
        exchangeItems: Array.isArray(req.body?.exchangeItems) ? req.body.exchangeItems : undefined,
        exchangeDifferenceMethod: req.body?.exchangeDifferenceMethod,
        exchangeDifferenceTreasuryId: req.body?.exchangeDifferenceTreasuryId ?? null,
      });

      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `مرتجع جزئي${result.exchangeInvoice ? ' واستبدال' : ''} للفاتورة (${result.invoice.invoiceNumber}) بقيمة ${result.returnRecord.returnTotal} ج.م`,
        category: 'data',
        target: result.invoice.id,
      });

      for (let i = 0; i < result.updatedProducts.length; i++) {
        if (result.movements[i]) {
          wsHub.broadcast({
            type: 'stock:updated',
            product: result.updatedProducts[i],
            movement: result.movements[i],
          });
        }
      }

      const dashboard = storeDb.getDashboardSummary();
      wsHub.broadcast({
        type: 'invoice:returned',
        invoice: result.invoice,
        dashboard,
      });
      if (result.exchangeInvoice) {
        wsHub.broadcast({
          type: 'invoice:created',
          invoice: result.exchangeInvoice,
          dashboard,
        });
      }

      res.json({ ...result, dashboard });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تنفيذ المرتجع الجزئي أو الاستبدال' });
    }
  });

  // FEFO Product Batches & Expiry Tracking
  app.get('/api/batches', (req, res) => {
    try {
      if (!requireAuthenticated(req, res)) return;
      const productId = req.query.productId ? String(req.query.productId) : undefined;
      res.json({ batches: storeDb.getBatches(productId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل بيانات التشغيلات' });
    }
  });

  app.post('/api/batches', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const batch = storeDb.createBatch(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إضافة تشغيلة (${batch.batchCode}) للصنف (${batch.productName}) بكمية ${batch.qty}`,
        category: 'data',
        target: batch.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تسجيل تشغيلة جديدة: ${batch.batchCode}` });
      res.status(201).json({ batch, batches: storeDb.getBatches() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل التشغيلة' });
    }
  });

  app.delete('/api/batches/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      storeDb.deleteBatch(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف سجل تشغيلة من المخزون' });
      res.json({ ok: true, batches: storeDb.getBatches() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف التشغيلة' });
    }
  });

  // Store Promotions & Bundle Discounts
  app.get('/api/promotions', (req, res) => {
    try {
      if (!requireAuthenticated(req, res)) return;
      res.json({ promotions: storeDb.getPromotions() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل العروض الترويجية' });
    }
  });

  app.post('/api/promotions', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const promotion = storeDb.createPromotion(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إنشاء عرض ترويجي (${promotion.name})`,
        category: 'settings',
        target: promotion.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تمت إضافة عرض ترويجي: ${promotion.name}` });
      res.status(201).json({ promotion, promotions: storeDb.getPromotions() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إنشاء العرض الترويجي' });
    }
  });

  app.patch('/api/promotions/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const promotion = storeDb.updatePromotion(req.params.id, req.body || {});
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث العرض الترويجي: ${promotion.name}` });
      res.json({ promotion, promotions: storeDb.getPromotions() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث العرض الترويجي' });
    }
  });

  app.delete('/api/promotions/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      storeDb.deletePromotion(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف عرض ترويجي' });
      res.json({ ok: true, promotions: storeDb.getPromotions() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف العرض الترويجي' });
    }
  });

  // Owner Anomaly Alerts & Supplier-Grouped Auto-Reorder Suggestions
  app.get('/api/insights/alerts', (req, res) => {
    try {
      if (!requireAuthenticated(req, res)) return;
      res.json({ alerts: storeDb.getOwnerAlerts() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل تنبيهات المالك' });
    }
  });

  app.get('/api/purchases/reorder-suggestions', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_purchases')) return;
      res.json({ groups: storeDb.getAutoReorderSuggestions() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حساب مقترحات إعادة الطلب' });
    }
  });

  // Purchase Return to Supplier
  app.post('/api/purchases/:id/return', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_purchases')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.createPurchaseReturn({
        purchaseId: req.params.id,
        items: Array.isArray(req.body?.items) ? req.body.items : [],
        treasuryId: req.body?.treasuryId ?? null,
        reason: req.body?.reason ? String(req.body.reason) : '',
        actorName: actor?.name || 'المسؤول',
        terminalName: String(req.body?.terminalName || 'إدارة المشتريات'),
      });

      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `مرتجع مشتريات للمورد (${result.purchase.purchaseNumber}) بقيمة ${result.returnRecord.returnTotal} ج.م`,
        category: 'data',
        target: result.purchase.id,
      });

      for (let i = 0; i < result.updatedProducts.length; i++) {
        if (result.movements[i]) {
          wsHub.broadcast({
            type: 'stock:updated',
            product: result.updatedProducts[i],
            movement: result.movements[i],
          });
        }
      }

      wsHub.broadcast({
        type: 'state:refresh',
        reason: `مرتجع مشتريات للمورد: ${result.purchase.purchaseNumber}`,
      });

      res.status(201).json({
        ...result,
        suppliers: storeDb.getSuppliers(),
        treasuries: storeDb.getTreasuries(),
        dashboard: storeDb.getDashboardSummary(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل مرتجع المشتريات' });
    }
  });

  // Recurring Expenses CRUD & Atomic Execute
  app.get('/api/expenses/recurring', (req, res) => {
    try {
      if (!requireAuthenticated(req, res)) return;
      res.json({ recurringExpenses: storeDb.getRecurringExpenses() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل المصروفات الدورية' });
    }
  });

  app.post('/api/expenses/recurring', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const recurring = storeDb.createRecurringExpense(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إضافة مصروف دوري (${recurring.title}) بمبلغ ${recurring.amount} ج.م`,
        category: 'data',
        target: recurring.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم جدولة مصروف دوري: ${recurring.title}` });
      res.status(201).json({ recurring, recurringExpenses: storeDb.getRecurringExpenses() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إضافة المصروف الدوري' });
    }
  });

  app.patch('/api/expenses/recurring/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const recurring = storeDb.updateRecurringExpense(req.params.id, req.body || {});
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث المصروف الدوري: ${recurring.title}` });
      res.json({ recurring, recurringExpenses: storeDb.getRecurringExpenses() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث المصروف الدوري' });
    }
  });

  app.delete('/api/expenses/recurring/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      storeDb.deleteRecurringExpense(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف بند مصروف دوري' });
      res.json({ ok: true, recurringExpenses: storeDb.getRecurringExpenses() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف المصروف الدوري' });
    }
  });

  app.post('/api/expenses/recurring/:id/execute', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.executeRecurringExpense(
        req.params.id,
        actor?.name || 'صاحب المحل',
        req.body?.amount !== undefined ? Number(req.body.amount) : undefined,
        req.body?.treasuryId !== undefined ? req.body.treasuryId : undefined
      );
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `صرف مصروف دوري مجدول (${result.expense.title}) بقيمة ${result.expense.amount} ج.م`,
        category: 'data',
        target: result.expense.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم صرف مصروف دوري: ${result.expense.title}` });
      res.status(201).json({
        ...result,
        recurringExpenses: storeDb.getRecurringExpenses(),
        expenses: storeDb.getExpenses(),
        treasuries: storeDb.getTreasuries(),
        dashboard: storeDb.getDashboardSummary(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تنفيذ المصروف الدوري' });
    }
  });

  // POS Manager/Owner PIN Override Verification (does not log out cashier)
  app.post('/api/auth/verify-override-pin', overrideRateLimiter.middleware(), (req, res) => {
    try {
      if (!requireAuthenticated(req, res)) return;
      const rateKey = req.ip || 'pos';
      const result = storeDb.verifyOverridePin(String(req.body?.pin || ''), rateKey);
      if (!result.authorized) {
        res.status(403).json({ authorized: false, error: result.reason || 'رمز الاعتماد غير صحيح' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ authorized: false, error: err instanceof Error ? err.message : 'تعذر التحقق من الاعتماد' });
    }
  });
}
