import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'edit_prices_stock');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف التشغيلة مطلوب' });
  const prisma = getPrisma();
  await prisma.productBatch.delete({ where: { id } });
  return { ok: true };
});
