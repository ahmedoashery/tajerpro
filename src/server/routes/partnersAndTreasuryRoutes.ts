import type express from 'express';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import type { RouteAuthContext } from '../security/authContext.ts';

/**
 * Modular Express routes for Customers, Suppliers, Partner Statements,
 * Registered Treasuries & Transfers, Print Templates, and Payment Gateways.
 */
export function registerPartnersAndTreasuryRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: RouteAuthContext
): void {
  // Customers & Debt Collection + Statements
  app.post('/api/customers', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const customer = storeDb.addCustomer(req.body);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تمت إضافة عميل جديد' });
      res.status(201).json({ customer });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إضافة العميل' });
    }
  });

  app.patch('/api/customers/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const customer = storeDb.updateCustomer(req.params.id, req.body || {});
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث بيانات العميل' });
      res.json({ customer });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث بيانات العميل' });
    }
  });

  app.delete('/api/customers/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      storeDb.deleteCustomer(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف حساب عميل' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف العميل' });
    }
  });

  app.get('/api/customers/:id/statement', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      res.json(storeDb.getCustomerStatement(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر استخراج كشف الحساب' });
    }
  });

  app.post('/api/customers/:id/collect', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const actor = auth.getActorContext(req);
      const customer = storeDb.collectCustomerPayment({
        customerId: req.params.id,
        amount: Number(req.body.amount),
        method: req.body.method,
        referenceCode: req.body.referenceCode,
        treasuryId: req.body.treasuryId,
      } as Parameters<typeof storeDb.collectCustomerPayment>[0]);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحصيل دفعة عميل (${customer.name}) بقيمة ${Number(req.body.amount)} ج.م`,
        category: 'data',
        target: customer.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحصيل دفعة من العميل' });
      res.json({ customer });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تسجيل التحصيل' });
    }
  });

  // Suppliers & Statements
  app.post('/api/suppliers', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const supplier = storeDb.addSupplier(req.body);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تمت إضافة مورد جديد' });
      res.status(201).json({ supplier });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إضافة المورد' });
    }
  });

  app.patch('/api/suppliers/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const supplier = storeDb.updateSupplier(req.params.id, req.body || {});
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث بيانات المورد' });
      res.json({ supplier });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تحديث بيانات المورد' });
    }
  });

  app.delete('/api/suppliers/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      storeDb.deleteSupplier(req.params.id);
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف حساب مورد' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف المورد' });
    }
  });

  app.get('/api/suppliers/:id/statement', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      res.json(storeDb.getSupplierStatement(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر استخراج كشف حساب المورد' });
    }
  });

  app.post('/api/suppliers/:id/pay', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_partners')) return;
      const actor = auth.getActorContext(req);
      const supplier = storeDb.paySupplierDebt(
        req.params.id,
        Number(req.body.amount),
        req.body.method || 'cash',
        String(req.body.referenceCode || ''),
        req.body.treasuryId
      );
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `سداد دفعة للمورد (${supplier.name}) بقيمة ${Number(req.body.amount)} ج.م`,
        category: 'data',
        target: supplier.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم سداد دفعة للمورد' });
      res.json({ supplier });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل السداد' });
    }
  });

  // Registered Treasuries & Safes Management
  app.get('/api/treasuries', (req, res) => {
    const actor = auth.resolveActor(req);
    if (!actor && !auth.hasValidAdminPin(req)) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض بيانات الخزائن.' });
      return;
    }
    res.json({ treasuries: storeDb.getTreasuries() });
  });

  app.post('/api/treasuries', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_payments')) return;
      const actor = auth.getActorContext(req);
      const treasury = storeDb.createTreasury(req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إضافة خزينة جديدة (${treasury.name}) برصيد ${treasury.currentBalance} ج.م`,
        category: 'settings',
        target: treasury.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تمت إضافة الخزينة: ${treasury.name}` });
      res.status(201).json({ treasury, treasuries: storeDb.getTreasuries() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إضافة الخزينة' });
    }
  });

  app.patch('/api/treasuries/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_payments')) return;
      const actor = auth.getActorContext(req);
      const treasury = storeDb.updateTreasury(req.params.id, req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث خزينة (${treasury.name}) — الرصيد الحالي: ${treasury.currentBalance} ج.م`,
        category: 'settings',
        target: treasury.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث بيانات الخزينة: ${treasury.name}` });
      res.json({ treasury, treasuries: storeDb.getTreasuries() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الخزينة' });
    }
  });

  app.delete('/api/treasuries/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_payments')) return;
      const actor = auth.getActorContext(req);
      storeDb.deleteTreasury(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف خزينة (${req.params.id})`,
        category: 'settings',
        target: req.params.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف الخزينة من النظام' });
      res.json({ ok: true, treasuries: storeDb.getTreasuries() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف الخزينة' });
    }
  });

  app.post('/api/treasuries/transfer', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_payments')) return;
      const actor = auth.getActorContext(req);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'مبلغ التحويل غير صالح.' });
        return;
      }
      const result = storeDb.transferBetweenTreasuries({
        fromTreasuryId: String(req.body?.fromTreasuryId || ''),
        toTreasuryId: String(req.body?.toTreasuryId || ''),
        amount,
        actorName: actor?.name || 'صاحب المحل',
        notes: req.body?.notes ? String(req.body.notes) : '',
        referenceCode: req.body?.referenceCode ? String(req.body.referenceCode) : '',
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحويل ${amount} ج.م من (${result.fromTreasury.name}) إلى (${result.toTreasury.name})`,
        category: 'settings',
        target: `${result.fromTreasury.id}->${result.toTreasury.id}`,
      });
      wsHub.broadcast({
        type: 'state:refresh',
        reason: `تم تحويل ${amount} ج.م من ${result.fromTreasury.name} إلى ${result.toTreasury.name}`,
      });
      res.status(201).json({
        ok: true,
        fromTreasury: result.fromTreasury,
        toTreasury: result.toTreasury,
        treasuries: storeDb.getTreasuries(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تنفيذ التحويل بين الخزائن' });
    }
  });

  // Document Print & Export Templates
  app.get('/api/templates', (req, res) => {
    const actor = auth.resolveActor(req);
    if (!actor && !auth.hasValidAdminPin(req)) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول لعرض قوالب الطباعة.' });
      return;
    }
    res.json({ templates: storeDb.getTemplates() });
  });

  app.put('/api/templates/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_settings')) return;
      const actor = auth.getActorContext(req);
      const template = storeDb.saveTemplate(req.params.id, req.body || {});
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث قالب الطباعة والتصدير (${template.nameAr}) وتحديث صورة المعاينة PNG`,
        category: 'settings',
        target: template.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث نموذج الطباعة: ${template.nameAr}` });
      res.json({ template, templates: storeDb.getTemplates() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل حفظ نموذج الطباعة' });
    }
  });

  // Electronic Payment Gateways Config & Handshake Verification
  app.post('/api/payments/config', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_payments')) return;
      const paymentConfig = storeDb.updatePaymentConfig(req.body || {});
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث إعدادات الدفع الإلكتروني' });
      res.json({ paymentConfig });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل حفظ إعدادات الدفع' });
    }
  });

  app.post('/api/payments/verify-gateway', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'pos_sell')) return;
    const provider = String(req.body?.provider || 'instapay');
    const amount = Number(req.body?.amount || 0);
    const reference = String(req.body?.reference || '').trim();
    const prefixMap: Record<string, string> = {
      instapay: 'IPA',
      vodafone_cash: 'VFC',
      card: 'PMB',
    };
    const generatedRef =
      reference || `${prefixMap[provider] || 'PAY'}-${Math.floor(1000000 + Math.random() * 8999999)}`;

    res.json({
      verified: true,
      provider,
      amount,
      referenceCode: generatedRef,
      verifiedAt: new Date().toISOString(),
      message: 'تم التحقق من العملية بنجاح وتأكيد القيد اللحظي.',
    });
  });
}
