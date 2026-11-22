import crypto from 'node:crypto';
import type { H3Event } from 'h3';
import { createError, getHeader } from 'h3';
import { getPrisma } from './prisma';

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

export async function requirePermission(event: H3Event, permissionKey: string) {
  const prisma = getPrisma();
  const actorId = getHeader(event, 'x-actor-user-id') || 'usr-owner';
  const user = await prisma.staffUser.findUnique({ where: { id: actorId } });
  if (!user || !user.active) {
    throw createError({ statusCode: 401, statusMessage: 'حساب الموظف غير نشط' });
  }
  const rolePerm = await prisma.rolePermission.findUnique({ where: { role: user.role } });
  const perms = (rolePerm?.permissionsJson as Record<string, boolean> | null) || {};
  if (!perms[permissionKey]) {
    throw createError({ statusCode: 403, statusMessage: 'ليس لديك صلاحية تنفيذ هذه العملية' });
  }
  return user;
}
