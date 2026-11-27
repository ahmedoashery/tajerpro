import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const patchSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).optional(),
  value: z.number().nonnegative().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_settings');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف العرض مطلوب' });
  const body = patchSchema.parse(await readBody(event));
  const prisma = getPrisma();
  const promotion = await prisma.storePromotion.update({ where: { id }, data: body });
  return { promotion };
});
