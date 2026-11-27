import crypto from 'node:crypto';
import type { H3Event } from 'h3';
import { createError, getHeader } from 'h3';
import { getPrisma } from './prisma';

export interface AuthTokenPayload {
  uid: string;
  role: string;
  tv: number;
  iat: number;
  exp: number;
}

const PIN_ATTEMPTS = new Map<string, number[]>();
const PIN_WINDOW_MS = 60_000;
const PIN_MAX_ATTEMPTS = 10;

function getSessionSecret(): string {
  try {
    const cfg = useRuntimeConfig();
    if (cfg?.sessionSecret) return String(cfg.sessionSecret);
  } catch {
    // ignore outside nitro context
  }
  return (
    process.env.NUXT_SESSION_SECRET ||
    process.env.SESSION_AUTH_SECRET ||
    'TAJIRPRO-NUXT-SESSION-HMAC-SECRET'
  );
}

export function getLicenseSecret(): string {
  try {
    const cfg = useRuntimeConfig();
    if (cfg?.licenseSecret) return String(cfg.licenseSecret);
  } catch {
    // ignore
  }
  return process.env.NUXT_LICENSE_SECRET || 'TAJIRPRO-PRODUCTION-HMAC-KEY';
}

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`tajirpro_pin::${pin}`).digest('hex');
}

export function hashInvoiceRecord(
  prevHash: string,
  invoiceNumber: string,
  grandTotal: number,
  status: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}|${invoiceNumber}|${grandTotal.toFixed(2)}|${status.toLowerCase()}`)
    .digest('hex');
}

export function issueAuthToken(user: { id: string; role: string; tokenVersion?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    uid: user.id,
    role: user.role,
    tv: user.tokenVersion ?? 1,
    iat: now,
    exp: now + 60 * 60 * 24 * 7, // 7 days
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function checkPinRateLimit(clientKey: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const list = (PIN_ATTEMPTS.get(clientKey) || []).filter((t) => now - t < PIN_WINDOW_MS);
  PIN_ATTEMPTS.set(clientKey, list);
  if (list.length >= PIN_MAX_ATTEMPTS) {
    const oldest = list[0] ?? now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((PIN_WINDOW_MS - (now - oldest)) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordPinFailure(clientKey: string): void {
  const now = Date.now();
  const list = (PIN_ATTEMPTS.get(clientKey) || []).filter((t) => now - t < PIN_WINDOW_MS);
  list.push(now);
  PIN_ATTEMPTS.set(clientKey, list);
}

export function clearPinFailures(clientKey: string): void {
  PIN_ATTEMPTS.delete(clientKey);
}

export function getEffectivePermissions(
  rolePermsJson: Record<string, boolean> | null | undefined,
  customPermsJson: Record<string, boolean> | null | undefined
): Record<string, boolean> {
  return {
    ...(rolePermsJson || {}),
    ...(customPermsJson || {}),
  };
}

export async function resolveActor(event: H3Event) {
  const prisma = getPrisma();
  const authHeader = getHeader(event, 'authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (bearer) {
    const verified = verifyAuthToken(bearer);
    if (!verified) return null;
    const user = await prisma.staffUser.findUnique({ where: { id: verified.uid } });
    if (!user || !user.active || user.tokenVersion !== verified.tv) return null;
    return user;
  }

  const adminPin = (getHeader(event, 'x-admin-pin') || '').trim();
  if (adminPin) {
    const pinHash = hashPin(adminPin);
    const owner = await prisma.staffUser.findFirst({
      where: { pinHash, active: true, role: 'OWNER' },
    });
    if (owner) return owner;
  }

  const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } }).catch(() => null);
  if (settings?.requireLoginOnStart) {
    return null;
  }

  const actorId = getHeader(event, 'x-actor-user-id') || 'usr-owner';
  const user = await prisma.staffUser.findUnique({ where: { id: actorId } });
  if (!user || !user.active) return null;
  return user;
}

export async function requirePermission(event: H3Event, permissionKey: string) {
  const prisma = getPrisma();
  const user = await resolveActor(event);
  if (!user || !user.active) {
    throw createError({
      statusCode: 401,
      statusMessage: 'يرجى تسجيل الدخول برمز PIN للمتابعة',
    });
  }
  const rolePerm = await prisma.rolePermission.findUnique({ where: { role: user.role } });
  const perms = getEffectivePermissions(
    rolePerm?.permissionsJson as Record<string, boolean> | null,
    user.customPermissionsJson as Record<string, boolean> | null
  );
  if (!perms[permissionKey]) {
    throw createError({
      statusCode: 403,
      statusMessage: 'ليس لديك صلاحية تنفيذ هذه العملية',
    });
  }
  return user;
}

export async function logSecurityAudit(
  actor: { id: string; name: string },
  action: string,
  category: 'auth' | 'security' | 'settings' | 'data' | 'rbac',
  target: string,
  details = ''
) {
  try {
    const prisma = getPrisma();
    await prisma.securityAuditLog.create({
      data: {
        actorUserId: actor.id,
        actorName: actor.name,
        action: action.slice(0, 250),
        category,
        target: target.slice(0, 120),
        details: details.slice(0, 490),
      },
    });
  } catch {
    // non-fatal audit logging
  }
}
