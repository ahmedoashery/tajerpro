import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import type { PermissionKey, UserRole } from '../../shared/types.ts';
import {
  MYSQL_PRODUCTION_SCHEMA_SQL,
  provisionExternalMysqlSchema,
  testExternalMysqlConnection,
} from '../db/mysqlSchema.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';
import type { RouteAuthContext } from '../security/authContext.ts';
import { SlidingWindowRateLimiter } from '../security/rateLimiter.ts';
import { buildZipBuffer, collectDirectoryZipEntries } from '../utils/zipBuilder.ts';

/**
 * Modular Express routes for Authentication, Health/Bootstrap, Staff RBAC,
 * Cryptographic Licensing, Audit & Integrity, MySQL Provisioning, Backups, and XLSX Imports.
 */
export function registerSecurityAndDataRoutes(
  app: express.Express,
  storeDb: StoreDatabase,
  wsHub: RealtimeHub,
  auth: RouteAuthContext
): void {
  const authRateLimiter = new SlidingWindowRateLimiter(
    60_000,
    25,
    'تم إيقاف محاولات التحقق مؤقتاً لحماية الحساب من التكرار السريع'
  );
  const authGuard = authRateLimiter.middleware();

  // Authentication & Signed Session Endpoints (HMAC-SHA256 + rate-limited)
  app.post('/api/auth/login', authGuard, (req, res) => {
    const { userId, pin } = req.body || {};
    const fwd = req.header('x-forwarded-for');
    const clientIp = (fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'local';
    const result = storeDb.authenticateWithPin(
      String(userId || ''),
      String(pin || ''),
      clientIp
    );
    if (!result.ok) {
      const code = result.lockedRemainingSec ? 429 : 401;
      res.status(code).json({ error: result.error, lockedRemainingSec: result.lockedRemainingSec });
      return;
    }
    res.json({ user: result.user, token: result.token });
  });

  app.post('/api/auth/logout', (req, res) => {
    const actor = auth.resolveActor(req);
    if (actor) {
      storeDb.logAudit({
        actorUserId: actor.id,
        actorName: actor.name,
        action: 'تسجيل خروج من الجلسة',
        category: 'auth',
        target: actor.id,
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/session', (req, res) => {
    const actor = auth.resolveActor(req);
    res.json({ authenticated: Boolean(actor), user: actor });
  });

  // Health & Server Diagnostics (accessible pre-login for Server Config Modal)
  app.get('/api', (_req, res) => {
    res.json({
      ok: true,
      service: 'tajirpro-api',
      health: '/api/health',
      bootstrap: '/api/bootstrap',
    });
  });

  app.get('/api/download/nuxt-project.zip', (_req, res) => {
    const nuxtDir = path.resolve(process.cwd(), 'nuxt-prisma-mysql');
    if (!fs.existsSync(nuxtDir)) {
      res.status(404).json({ error: 'مجلد مشروع Nuxt غير متوفر في هذه البيئة.' });
      return;
    }
    const entries = collectDirectoryZipEntries(nuxtDir, { prefixDir: 'tajirpro-nuxt-prisma-mysql' });
    const zipBuf = buildZipBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="tajirpro-nuxt-prisma-mysql.zip"');
    res.setHeader('Content-Length', String(zipBuf.length));
    res.send(zipBuf);
  });

  app.get('/api/download/full-project.zip', (_req, res) => {
    const rootDir = process.cwd();
    const entries = collectDirectoryZipEntries(rootDir, {
      prefixDir: 'tajirpro-full-project',
      extraIgnoredDirs: new Set(['nuxt-prisma-mysql']),
    });
    const zipBuf = buildZipBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="tajirpro-full-project.zip"');
    res.setHeader('Content-Length', String(zipBuf.length));
    res.send(zipBuf);
  });

  app.get('/api/health', (_req, res) => {
    const settings = storeDb.getSettings();
    res.json({
      ok: true,
      status: 'healthy',
      storeName: settings.storeName,
      dbDriver: settings.dbDriver,
      realtimeWs: wsHub.enabled,
      uptimeSec: Math.floor(process.uptime()),
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/api/server/info', (_req, res) => {
    try {
      res.json(storeDb.getServerRuntimeInfo(wsHub.getClientCount()));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'تعذر قراءة معلومات الخادم' });
    }
  });

  // Bootstrap application state (redacted when requireLoginOnStart is active & unauthenticated)
  app.get('/api/bootstrap', (req, res) => {
    try {
      const actor = auth.resolveActor(req);
      res.json(storeDb.getBootstrapSnapshot(wsHub.getClientCount(), actor));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تحميل بيانات المتجر' });
    }
  });

  // Security, Staff RBAC & Cryptographic Licensing
  app.post('/api/security/verify-pin', authGuard, (req, res) => {
    const { userId, pin } = req.body || {};
    const fwd = req.header('x-forwarded-for');
    const clientIp = (fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'local';
    const result = storeDb.authenticateWithPin(
      String(userId || ''),
      String(pin || ''),
      clientIp
    );
    if (!result.ok) {
      const code = result.lockedRemainingSec ? 429 : 401;
      res.status(code).json({ error: result.error, lockedRemainingSec: result.lockedRemainingSec });
      return;
    }
    res.json({ user: result.user, token: result.token });
  });

  app.post('/api/security/update-pin', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const targetUserId = String(req.body?.userId || '');
      const target = storeDb.getStaffUsers().find((u) => u.id === targetUserId);
      if (!target) {
        res.status(404).json({ error: 'الموظف غير موجود.' });
        return;
      }
      if (target.role === 'owner' && actor?.role !== 'owner') {
        res.status(403).json({ error: 'فقط مالك المحل يمكنه إعادة تعيين الرمز السري لحساب مالك.' });
        return;
      }
      storeDb.updateStaffPin(targetUserId, String(req.body?.newPin || ''));
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إعادة تعيين الرمز السري للموظف (${target.name}) وإبطال الجلسات القديمة`,
        category: 'rbac',
        target: target.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث الرمز السري وتأمين جلسات الحساب' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الرمز' });
    }
  });

  app.post('/api/security/rbac/permissions', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const role = String(req.body?.role) as UserRole;
      if (!['owner', 'manager', 'cashier'].includes(role)) {
        res.status(400).json({ error: 'الدور الوظيفي غير صالح.' });
        return;
      }
      const permissions = (req.body?.permissions || {}) as Partial<Record<PermissionKey, boolean>>;
      if (actor?.role !== 'owner') {
        if (role === 'owner' || permissions.manage_security_rbac !== undefined) {
          res.status(403).json({ error: 'فقط مالك المحل يمكنه تعديل صلاحيات المالك أو منح صلاحية إدارة الأمان.' });
          return;
        }
      }
      const rolePermissions = storeDb.updateRolePermissions(role, permissions);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تعديل مصفوفة صلاحيات دور (${role})`,
        category: 'rbac',
        target: role,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث مصفوفة صلاحيات الأدوار' });
      res.json({ rolePermissions });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الصلاحيات' });
    }
  });

  app.post('/api/security/staff', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const user = storeDb.createStaffUser({
        ...req.body,
        actorUserId: actor?.id,
        actorRole: actor?.role,
      });
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إضافة حساب موظف جديد (${user.name} - ${user.role})`,
        category: 'rbac',
        target: user.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تمت إضافة موظف جديد' });
      res.status(201).json({ user, staff: storeDb.getStaffUsers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إضافة الموظف' });
    }
  });

  app.patch('/api/security/staff/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const customPerms = req.body?.customPermissions as
        | Partial<Record<PermissionKey, boolean | null>>
        | undefined;
      if (actor?.role !== 'owner' && customPerms?.manage_security_rbac !== undefined) {
        res.status(403).json({
          error: 'فقط مالك المحل يمكنه تعديل صلاحية إدارة الأمان لموظف.',
        });
        return;
      }
      const user = storeDb.updateStaffUser(
        req.params.id,
        {
          name: req.body?.name,
          role: req.body?.role,
          active: req.body?.active,
          newPin: req.body?.newPin,
          customPermissions: customPerms,
        },
        { actorUserId: actor?.id, actorRole: actor?.role }
      );
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تحديث بيانات أو صلاحية الموظف (${user.name})`,
        category: 'rbac',
        target: user.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث بيانات الموظف' });
      res.json({ user, staff: storeDb.getStaffUsers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الموظف' });
    }
  });

  app.post('/api/security/staff/:id/permissions', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const customPermissions = (req.body?.customPermissions || {}) as Partial<
        Record<PermissionKey, boolean | null>
      >;
      if (actor?.role !== 'owner' && customPermissions.manage_security_rbac !== undefined) {
        res.status(403).json({ error: 'فقط مالك المحل يمكنه تعديل صلاحية إدارة الأمان لموظف.' });
        return;
      }
      const user = storeDb.updateStaffUser(
        req.params.id,
        { customPermissions },
        { actorUserId: actor?.id, actorRole: actor?.role }
      );
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `تخصيص صلاحيات فردية للموظف (${user.name})`,
        category: 'rbac',
        target: user.id,
        details: JSON.stringify(customPermissions),
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم تحديث الصلاحيات الخاصة للموظف: ${user.name}` });
      res.json({ user, staff: storeDb.getStaffUsers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تحديث الصلاحيات الفردية' });
    }
  });

  app.post('/api/security/staff/:id/revoke-sessions', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const user = storeDb.revokeUserSessions(req.params.id);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `إلغاء كافة الجلسات النشطة للموظف (${user.name})`,
        category: 'security',
        target: user.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: `تم إنهاء جلسات الحساب: ${user.name}` });
      res.json({ user, staff: storeDb.getStaffUsers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إلغاء الجلسات' });
    }
  });

  app.delete('/api/security/staff/:id', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
      const actor = auth.getActorContext(req);
      const target = storeDb.getStaffUsers().find((u) => u.id === req.params.id);
      storeDb.deleteStaffUser(req.params.id, actor?.id, actor?.role);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `حذف حساب الموظف (${target?.name || req.params.id})`,
        category: 'rbac',
        target: req.params.id,
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم حذف حساب موظف' });
      res.json({ ok: true, staff: storeDb.getStaffUsers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف الموظف' });
    }
  });

  app.get('/api/security/audit-logs', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    res.json({ auditLogs: storeDb.getAuditLogs(100) });
  });

  app.get('/api/security/integrity', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    res.json(storeDb.verifyLedgerIntegrity());
  });

  app.post('/api/security/license/activate', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    const result = storeDb.activateLicenseKey(String(req.body?.licenseKey || ''));
    if (!result.ok) {
      res.status(400).json({ error: result.status.reason, status: result.status });
      return;
    }
    const actor = auth.getActorContext(req);
    storeDb.logAudit({
      actorUserId: actor?.id || 'usr-owner',
      actorName: actor?.name || 'صاحب المحل',
      action: 'تفعيل مفتاح ترخيص Ed25519 جديد',
      category: 'security',
      target: result.status.payload?.tier || 'pro',
    });
    wsHub.broadcast({ type: 'state:refresh', reason: 'تم تفعيل ترخيص موثق جديد' });
    res.json({ status: result.status });
  });

  app.post('/api/security/license/issue-demo', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    const tier = req.body?.tier === 'enterprise' ? 'enterprise' : 'pro';
    const durationDays = Number(req.body?.durationDays || 365);
    const maxTerminals = Number(req.body?.maxTerminals || 10);
    const key = storeDb.issueTestSignedLicense({ tier, durationDays, maxTerminals });
    res.json({ licenseKey: key });
  });

  // External MySQL Connection Test, Provisioning & DB Engine Switch
  app.post('/api/database/test-mysql', async (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    const { host, port, user, password, database, ssl, connectionLimit } = req.body || {};
    const result = await testExternalMysqlConnection({
      host: String(host || '127.0.0.1'),
      port: Number(port || 3306),
      user: String(user || 'root'),
      password: String(password || ''),
      database: String(database || 'tajirpro_pos'),
      ssl: Boolean(ssl),
    });
    if (result.ok) {
      storeDb.updateStoreSettings({
        mysqlConfig: {
          host: String(host || '127.0.0.1'),
          port: Number(port || 3306),
          user: String(user || 'root'),
          database: String(database || 'tajirpro_pos'),
          connected: true,
          ssl: Boolean(ssl),
          connectionLimit: Number(connectionLimit || 10),
        },
      });
    }
    res.json(result);
  });

  app.post('/api/database/provision-mysql', async (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    const { host, port, user, password, database, ssl } = req.body || {};
    const result = await provisionExternalMysqlSchema({
      host: String(host || '127.0.0.1'),
      port: Number(port || 3306),
      user: String(user || 'root'),
      password: String(password || ''),
      database: String(database || 'tajirpro_pos'),
      ssl: Boolean(ssl),
    });
    res.json(result);
  });

  app.post('/api/database/config', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    const { dbDriver, mysqlConfig } = req.body || {};
    const nextDriver = dbDriver === 'mysql' ? 'mysql' : 'sqlite';
    const settings = storeDb.updateStoreSettings({
      dbDriver: nextDriver,
      mysqlConfig: mysqlConfig
        ? {
            host: String(mysqlConfig.host || '127.0.0.1'),
            port: Number(mysqlConfig.port || 3306),
            database: String(mysqlConfig.database || 'tajirpro_pos'),
            user: String(mysqlConfig.user || 'root'),
            connected: Boolean(mysqlConfig.connected),
            ssl: Boolean(mysqlConfig.ssl),
            connectionLimit: Number(mysqlConfig.connectionLimit || 10),
          }
        : undefined,
    });
    wsHub.broadcast({ type: 'state:refresh', reason: 'تم تحديث إعدادات قاعدة البيانات ومحرك التشغيل' });
    res.json({
      ok: true,
      settings,
      serverInfo: storeDb.getServerRuntimeInfo(wsHub.getClientCount()),
    });
  });

  app.get('/api/database/mysql-schema', (_req, res) => {
    res.type('text/plain; charset=utf-8').send(MYSQL_PRODUCTION_SCHEMA_SQL);
  });

  app.get('/api/database/export-backup', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
    res.json(storeDb.exportBackupJson());
  });

  app.post('/api/database/restore-json', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
      const actor = auth.getActorContext(req);
      const restoredCounts = storeDb.restoreBackupJson(req.body || {}, actor?.name || 'صاحب المحل');
      wsHub.broadcast({ type: 'state:refresh', reason: 'تمت استعادة البيانات من نسخة احتياطية JSON' });
      res.json({
        ok: true,
        restoredCounts,
        snapshot: storeDb.getBootstrapSnapshot(wsHub.getClientCount(), auth.resolveActor(req)),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استعادة النسخة الاحتياطية' });
    }
  });

  // XLSX Bulk Data Management Endpoints
  app.post('/api/data/import/products', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
      const actor = auth.getActorContext(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const summary = storeDb.importProductsBatch(rows, actor?.name || 'استيراد XLSX');
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `استيراد بيانات البضاعة XLSX (+${summary.inserted} / ~${summary.updated})`,
        category: 'data',
        target: 'products',
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم استيراد وتحديث جدول البضاعة عبر Excel' });
      res.json(summary);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استيراد البضاعة' });
    }
  });

  app.post('/api/data/import/customers', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
      const actor = auth.getActorContext(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const summary = storeDb.importCustomersBatch(rows);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `استيراد بيانات العملاء XLSX (+${summary.inserted} / ~${summary.updated})`,
        category: 'data',
        target: 'customers',
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم استيراد وتحديث العملاء عبر Excel' });
      res.json(summary);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استيراد العملاء' });
    }
  });

  app.post('/api/data/import/suppliers', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
      const actor = auth.getActorContext(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const summary = storeDb.importSuppliersBatch(rows);
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `استيراد بيانات الموردين XLSX (+${summary.inserted} / ~${summary.updated})`,
        category: 'data',
        target: 'suppliers',
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم استيراد وتحديث الموردين عبر Excel' });
      res.json(summary);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استيراد الموردين' });
    }
  });

  app.post('/api/data/import/expenses', (req, res) => {
    try {
      if (!auth.checkActorPerm(req, res, 'manage_data_xlsx')) return;
      const actor = auth.getActorContext(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const summary = storeDb.importExpensesBatch(rows, actor?.name || 'استيراد XLSX');
      storeDb.logAudit({
        actorUserId: actor?.id || 'usr-owner',
        actorName: actor?.name || 'صاحب المحل',
        action: `استيراد بيانات المصروفات XLSX (+${summary.inserted})`,
        category: 'data',
        target: 'expenses',
      });
      wsHub.broadcast({ type: 'state:refresh', reason: 'تم استيراد المصروفات عبر Excel' });
      res.json(summary);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'فشل استيراد المصروفات' });
    }
  });

  app.post('/api/database/reset-demo', (req, res) => {
    if (!auth.checkActorPerm(req, res, 'manage_security_rbac')) return;
    storeDb.resetDemoData();
    wsHub.broadcast({ type: 'state:refresh', reason: 'تمت استعادة البيانات الافتراضية المؤقتة للتجربة' });
    res.json({
      ok: true,
      snapshot: storeDb.getBootstrapSnapshot(wsHub.getClientCount(), auth.resolveActor(req)),
    });
  });
}
