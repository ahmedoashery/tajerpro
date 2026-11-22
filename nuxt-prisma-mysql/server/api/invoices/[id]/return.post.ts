import { createError, defineEventHandler, getRouterParam } from 'h3';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'invoice_return');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الفاتورة مطلوب' });

  const prisma = getPrisma();
  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice) throw createError({ statusCode: 404, statusMessage: 'الفاتورة غير موجودة' });
    if (invoice.status === 'RETURNED') {
      throw createError({ statusCode: 409, statusMessage: 'تم رد هذه الفاتورة مسبقاً' });
    }

    for (const item of invoice.items) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'RETURN',
          deltaQty: item.quantity,
          stockAfter: updated.stockQty,
          refId: invoice.invoiceNumber,
          note: `مرتجع فاتورة ${invoice.invoiceNumber}`,
          actorId: actor.id,
        },
      });
    }

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'RETURNED', returnedAt: new Date() },
    });

    return { invoice: updatedInvoice };
  });
});
