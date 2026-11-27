import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'edit_prices_stock');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الصنف مطلوب' });

  const prisma = getPrisma();
  const used = await prisma.invoiceItem.count({ where: { productId: id } });
  if (used > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'لا يمكن حذف صنف مرتبط بفواتير مبيعات سابقة حفاظاً على السجل التاريخي.',
    });
  }

  await prisma.product.delete({ where: { id } });
  return { ok: true };
});
