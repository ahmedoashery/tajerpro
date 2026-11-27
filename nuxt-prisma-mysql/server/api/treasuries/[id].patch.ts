import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  accountNumber: z.string().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  notes: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_payments');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الخزينة مطلوب' });
  const body = patchSchema.parse(await readBody(event));
  const prisma = getPrisma();
  if (body.isDefault) {
    await prisma.treasuryAccount.updateMany({ data: { isDefault: false } });
  }
  const treasury = await prisma.treasuryAccount.update({ where: { id }, data: body });
  return { treasury };
});
