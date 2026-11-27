import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'pos_sell');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف عرض السعر مطلوب' });
  const prisma = getPrisma();
  await prisma.salesQuotation.delete({ where: { id } });
  return { ok: true };
});
