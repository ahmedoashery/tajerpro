import { StaffRole } from '@prisma/client';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { logSecurityAudit, requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const rbacSchema = z.object({
  role: z.nativeEnum(StaffRole),
  permissions: z.record(z.boolean()),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_security_rbac');
  const body = rbacSchema.parse(await readBody(event));
  if (actor.role !== StaffRole.OWNER && body.role === StaffRole.OWNER) {
    throw createError({ statusCode: 403, statusMessage: 'فقط المالك يمكنه تعديل صلاحيات دور المالك' });
  }
  const prisma = getPrisma();
  const existing = await prisma.rolePermission.findUnique({ where: { role: body.role } });
  const merged = {
    ...((existing?.permissionsJson as Record<string, boolean> | null) || {}),
    ...body.permissions,
  };
  await prisma.rolePermission.upsert({
    where: { role: body.role },
    update: { permissionsJson: merged },
    create: { role: body.role, permissionsJson: merged },
  });
  await logSecurityAudit(actor, `تعديل صلاحيات دور (${body.role})`, 'rbac', body.role);
  return { role: body.role, permissions: merged };
});
