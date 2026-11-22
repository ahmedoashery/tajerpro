import type express from 'express';
import type { PermissionKey, StaffUser, UserRole } from '../../shared/types.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';

export interface RouteAuthContext {
  resolveActor: (req: express.Request) => StaffUser | null;
  hasValidAdminPin: (req: express.Request) => boolean;
  checkActorPerm: (req: express.Request, res: express.Response, perm: PermissionKey) => boolean;
  getActorContext: (req: express.Request) => { id: string; name: string; role: UserRole } | null;
}

/**
 * Centralizes authentication resolution, PIN override verification, and RBAC permission guards
 * across all modular Express route registrars.
 */
export function createRouteAuthContext(storeDb: StoreDatabase): RouteAuthContext {
  const resolveActor = (req: express.Request): StaffUser | null => {
    const authHeader = req.header('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        return storeDb.verifyAuthToken(token);
      }
    }
    return null;
  };

  const hasValidAdminPin = (req: express.Request): boolean => {
    const adminPin = req.header('x-admin-pin');
    if (!adminPin) return false;
    return storeDb.verifyAnyOwnerPin(String(adminPin), req.ip || 'local');
  };

  const checkActorPerm = (
    req: express.Request,
    res: express.Response,
    perm: PermissionKey
  ): boolean => {
    if (req.header('x-admin-pin')) {
      if (hasValidAdminPin(req)) {
        return true;
      }
      res.status(401).json({
        error: 'رمز المالك (PIN) غير صحيح أو تم إيقاف المحاولات مؤقتاً لكثرة الأخطاء.',
      });
      return false;
    }
    const actor = resolveActor(req);
    if (!actor) {
      res.status(401).json({
        error: 'انتهت جلسة العمل أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول برمز PIN.',
      });
      return false;
    }
    if (!storeDb.hasPermission(actor.id, perm)) {
      res.status(403).json({
        error: 'ليست لديك صلاحية تنفيذ هذا الإجراء. يرجى مراجعة مالك المحل أو إدخال رمز PIN المالك.',
      });
      return false;
    }
    return true;
  };

  const getActorContext = (
    req: express.Request
  ): { id: string; name: string; role: UserRole } | null => {
    const actor = resolveActor(req);
    if (actor) {
      return { id: actor.id, name: actor.name, role: actor.role };
    }
    if (hasValidAdminPin(req)) {
      const primaryOwner = storeDb.getStaffUsers().find((u) => u.role === 'owner' && u.active);
      return {
        id: primaryOwner?.id || 'usr-owner',
        name: primaryOwner?.name || 'مالك المحل (PIN)',
        role: 'owner',
      };
    }
    return null;
  };

  return {
    resolveActor,
    hasValidAdminPin,
    checkActorPerm,
    getActorContext,
  };
}
