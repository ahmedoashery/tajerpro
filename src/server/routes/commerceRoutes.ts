import type express from 'express';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import type { RouteAuthContext } from '../security/authContext.ts';

/**
 * Modular Express routes for Store Settings, Products/Inventory/Stocktake,
 * POS Invoices & Returns, Shifts (X/Z), Purchases, and Operating Expenses.
 */
export function registerCommerceRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: RouteAuthContext
): void {
  // Update store profile, policies, print templates, or switch commercial activity
  app.post('/api/settings', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const updated = storeDb.updateStoreSettings(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: 'تحديث إعدادات المتجر أو نماذج الطباعة',
        category: 'settings',
        target: updated.activityId,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث إعدادات المتجر أو النشاط التجاري' });
      res.json({
        settings: updated,
        snapshot: storeDb.getBootstrapSnapshot(wsHub.getClientCount(), auth.resolveActor(req)),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل حفظ الإعدادات' });
    }
  });

  // Create new product
  app.post('/api/products', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.createProduct({
        ...req.body,
        actorName: actor?.name || 'صاحب المحل',
      });
      wsHub.broadcast({
        type: 'stock:updated',
        product: result.product,
        movement: result.movement,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إضافة الصنف' });
    }
  });

  // Bulk adjust product prices (% or fixed EGP)
  app.post('/api/products/bulk-price', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.bulkAdjustPrices({
        ...req.body,
        actorName: actor?.name || 'صاحب المحل',
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث أسعار ${result.updatedCount} صنف جماعياً` });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل التعديل الجماعي للأسعار' });
    }
  });

  // Update product price or info (preserves historical invoice profit snapshots)
  app.patch('/api/products/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.updateProductPriceOrInfo(req.params.id, {
        ...req.body,
        actorName: actor?.name || 'صاحب المحل',
      });
      if (result.historyEntry) {
        wsHub.broadcast({
          type: 'price:changed',
          product: result.product,
          historyEntry: result.historyEntry,
        });
      } else {
        wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث بيانات الصنف' });
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الصنف' });
    }
  });

  app.delete('/api/products/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      storeDb.deleteProduct(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف صنف من قاعدة البضاعة' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف الصنف' });
    }
  });

  // Restock or adjust stock quantity with real-time broadcast
  app.post('/api/products/:id/stock', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const deltaQty = Number(req.body.deltaQty);
      if (!Number.isFinite(deltaQty) || deltaQty === 0) {
        res.status(400).json({ error: 'قيمة تعديل الكمية غير صالحة.' });
        return;
      }
      const newCostPrice =
        req.body.newCostPrice !== undefined && req.body.newCostPrice !== ''
          ? Number(req.body.newCostPrice)
          : undefined;
      if (newCostPrice !== undefined && (!Number.isFinite(newCostPrice) || newCostPrice < 0)) {
        res.status(400).json({ error: 'سعر التكلفة الجديد غير صالح.' });
        return;
      }
      const result = storeDb.adjustStock({
        productId: req.params.id,
        deltaQty,
        reason: String(req.body.reason || 'تعديل مخزون'),
        actorName: actor?.name || 'صاحب المحل',
        terminalName: String(req.body.terminalName || 'لوحة المخزون'),
        newCostPrice,
      });
      wsHub.broadcast({
        type: 'stock:updated',
        product: result.product,
        movement: result.movement,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تعديل المخزون' });
    }
  });

  // Atomic POS / Table Invoice Checkout (with optional quotation conversion)
  app.post('/api/invoices', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.createSaleInvoice({
        ...req.body,
        cashierName: actor?.name || 'الكاشير',
      });
      for (let i = 0; i < result.updatedProducts.length; i++) {
        wsHub.broadcast({
          type: 'stock:updated',
          product: result.updatedProducts[i],
          movement: result.movements[i],
        });
      }
      const dashboard = storeDb.getDashboardSummary();
      wsHub.broadcast({
        type: 'invoice:created',
        invoice: result.invoice,
        dashboard,
      });
      if (req.body?.quotationId) {
        wsHub.broadcast({
          type: 'state:refresh',
          reason: `تم تحويل عرض السعر إلى الفاتورة ${result.invoice.invoiceNumber}`,
        });
      }
      res.status(201).json({ ...result, dashboard });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إتمام الفاتورة' });
    }
  });

  // Return invoice & restore stock immediately
  app.post('/api/invoices/:id/return', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'invoice_return')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.returnInvoice(
        req.params.id,
        actor?.name || 'صاحب المحل',
        String(req.body?.terminalName || 'إدارة الفواتير')
      );
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `مرتجع فاتورة مبيعات (${result.invoice.invoiceNumber}) بقيمة ${result.invoice.grandTotal} ج.م`,
        category: 'data',
        target: result.invoice.id,
      });
      for (let i = 0; i < result.updatedProducts.length; i++) {
        wsHub.broadcast({
          type: 'stock:updated',
          product: result.updatedProducts[i],
          movement: result.movements[i],
        });
      }
      const dashboard = storeDb.getDashboardSummary();
      wsHub.broadcast({
        type: 'invoice:returned',
        invoice: result.invoice,
        dashboard,
      });
      res.json({ ...result, dashboard });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر عمل مرتجع للفاتورة' });
    }
  });

  // Shift Closing / Cash Drawer Reconciliation (X/Z Report)
  app.get('/api/shifts/summary', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      res.json(storeDb.getShiftSummary());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل ملخص الوردية' });
    }
  });

  app.post('/api/shifts/close', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
      const actor = auth.getActorContext(req);
      const openingFloat = Number(req.body?.openingFloat || 0);
      const actualCash = Number(req.body?.actualCash || 0);
      if (!Number.isFinite(openingFloat) || !Number.isFinite(actualCash) || openingFloat < 0 || actualCash < 0) {
        res.status(400).json({ error: 'قيم عهدة الوردية أو الجرد الفعلي غير صالحة.' });
        return;
      }
      const closure = storeDb.closeShift({
        cashierId: actor?.id || 'usr-owner',
        cashierName: actor?.name || 'صاحب المحل',
        openingFloat,
        actualCash,
        notes: req.body?.notes ? String(req.body.notes) : '',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تقفيل وردية (Z-Report) — متوقع: ${closure.expectedCash} / فعلي: ${closure.actualCash} / فرق: ${closure.variance}`,
        category: 'data',
        target: closure.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم اعتماد وتقفيل الوردية وجرد الدرج' });
      res.status(201).json({ closure, summary: storeDb.getShiftSummary() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تقفيل الوردية' });
    }
  });

  // Purchase Orders (Supplier Supply Invoices) & Atomic Inventory Restock
  app.post('/api/purchases', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_purchases')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.createPurchaseOrder({
        ...req.body,
        actorName: actor?.name || 'المسؤول',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `اعتماد فاتورة مشتريات (${result.purchase.purchaseNumber}) من ${result.purchase.supplierName} بإجمالي ${result.purchase.grandTotal} ج.م`,
        category: 'data',
        target: result.purchase.id,
      });
      for (let i = 0; i < result.updatedProducts.length; i++) {
        wsHub.broadcast({
          type: 'stock:updated',
          product: result.updatedProducts[i],
          movement: result.movements[i],
        });
      }
      wsHub.broadcast({
        type: 'state:refresh',
        reason: `تم اعتماد فاتورة مشتريات ${result.purchase.purchaseNumber} وتوريد المخزون`,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حفظ فاتورة المشتريات' });
    }
  });

  // Physical Inventory Stocktake Reconciliation
  app.post('/api/inventory/stocktake', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'edit_prices_stock')) return;
      const actor = auth.getActorContext(req);
      const result = storeDb.applyStocktake({
        ...req.body,
        actorName: actor?.name || 'المسؤول',
      });
      for (let i = 0; i < result.updatedProducts.length; i++) {
        wsHub.broadcast({
          type: 'stock:updated',
          product: result.updatedProducts[i],
          movement: result.movements[i],
        });
      }
      wsHub.broadcast({ type: 'state:refresh', reason: 'تمت مطابقة الجرد الفعلي للمخزون' });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تطبيق الجرد الفعلي' });
    }
  });

  // Store Operating Expenses & Safe Ledger
  app.get('/api/expenses', (req, res) => {
    try {
      if (req.header('x-admin-pin')) {
        if (!auth.hasValidAdminPin(req)) {
          res.status(401).json({ error: 'رمز المالك (PIN) غير صحيح.' });
          return;
        }
      } else {
        const actor = auth.resolveActor(req);
        if (!actor) {
          res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض المصروفات.' });
          return;
        }
        if (!storeDb.hasPermission(actor.id, 'manage_expenses') && !storeDb.hasPermission(actor.id, 'view_reports')) {
          res.status(403).json({ error: 'ليست لديك صلاحية الاطلاع على سجل المصروفات.' });
          return;
        }
      }
      res.json({ expenses: storeDb.getExpenses() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحميل سجل المصروفات' });
    }
  });

  app.post('/api/expenses', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const expense = storeDb.createExpense({
        ...req.body,
        actorName: actor?.name || 'صاحب المحل',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تسجيل مصروف (${expense.title}) بقيمة ${expense.amount} ج.م${expense.treasuryName ? ` من ${expense.treasuryName}` : ''}`,
        category: 'data',
        target: expense.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تسجيل مصروف: ${expense.title}` });
      res.status(201).json({ expense });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل المصروف' });
    }
  });

  app.patch('/api/expenses/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const expense = storeDb.updateExpense(req.params.id, req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تعديل مصروف (${expense.title}) — القيمة المحدثة: ${expense.amount} ج.م`,
        category: 'data',
        target: expense.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تعديل بند المصروف: ${expense.title}` });
      res.json({ expense });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تعديل المصروف' });
    }
  });

  app.delete('/api/expenses/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_expenses')) return;
      const actor = auth.getActorContext(req);
      const targetExp = storeDb.getExpenseById(req.params.id);
      storeDb.deleteExpense(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف بند مصروف (${targetExp?.title || req.params.id}) وإعادة ${targetExp?.amount || 0} ج.م للخزينة`,
        category: 'data',
        target: req.params.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف بند مصروف من السجل' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف المصروف' });
    }
  });
}
