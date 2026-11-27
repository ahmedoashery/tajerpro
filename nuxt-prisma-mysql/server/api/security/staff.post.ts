import { StaffRole } from '@prisma/client';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { hashPin, logSecurityAudit, requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const staffSchema = z.object({
  name: z.string().min(1),
  role: z.nativeEnum(StaffRole),
  pin: z.string().min(4),
  active: z.boolean().default(true),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_security_rbac');
  const body = staffSchema.parse(await readBody(event));
  if (body.role === StaffRole.OWNER && actor.role !== StaffRole.OWNER) {
    throw createError({ statusCode: 403, statusMessage: 'فقط مالك المحل يمكنه إنشاء حساب مالك' });
  }
  const prisma = getPrisma();
  const user = await prisma.staffUser.create({
    data: {
      name: body.name.trim(),
      role: body.role,
      pinHash: hashPin(body.pin),
      active: body.active,
    },
    select: { id: true, name: true, role: true, active: true, tokenVersion: true, createdAt: true },
  });
  await logSecurityAudit(actor, `إضافة موظف جديد (${user.name})`, 'rbac', user.id);
  return { user };
});
