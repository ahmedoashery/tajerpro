import { StaffRole } from '@prisma/client';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { hashPin, logSecurityAudit, requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.nativeEnum(StaffRole).optional(),
  active: z.boolean().optional(),
  newPin: z.string().min(4).optional(),
  customPermissions: z.record(z.boolean().nullable()).optional(),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_security_rbac');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الموظف مطلوب' });
  const body = patchSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target) throw createError({ statusCode: 404, statusMessage: 'الموظف غير موجود' });
  if (target.role === StaffRole.OWNER && actor.role !== StaffRole.OWNER) {
    throw createError({ statusCode: 403, statusMessage: 'فقط المالك يمكنه تعديل حساب مالك' });
  }

  let nextCustom = (target.customPermissionsJson as Record<string, boolean> | null) || {};
  if (body.customPermissions) {
    for (const [k, v] of Object.entries(body.customPermissions)) {
      if (k === 'manage_security_rbac' && actor.role !== StaffRole.OWNER) continue;
      if (v === null) delete nextCustom[k];
      else nextCustom[k] = Boolean(v);
    }
  }

  const updated = await prisma.staffUser.update({
    where: { id },
    data: {
      name: body.name?.trim() || target.name,
      role: body.role ?? target.role,
      active: body.active ?? target.active,
      ...(body.newPin
        ? { pinHash: hashPin(body.newPin), tokenVersion: { increment: 1 } }
        : {}),
      ...(body.customPermissions ? { customPermissionsJson: nextCustom } : {}),
    },
    select: { id: true, name: true, role: true, active: true, tokenVersion: true },
  });

  await logSecurityAudit(actor, `تحديث بيانات/صلاحيات الموظف (${updated.name})`, 'rbac', updated.id);
  return { user: updated };
});
