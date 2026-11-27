import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'invoice_return');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الفاتورة مطلوب' });
  const body = (await readBody(event).catch(() => ({}))) as { reason?: string };

  const prisma = getPrisma();
  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true, allocations: true },
    });
    if (!invoice) throw createError({ statusCode: 404, statusMessage: 'الفاتورة غير موجودة' });
    if (invoice.status === 'RETURNED') {
      throw createError({ statusCode: 409, statusMessage: 'تم رد هذه الفاتورة بالكامل مسبقاً' });
    }

    let totalReturnVal = 0;
    const returnItemsPayload: Array<{
      invoiceItemId: string;
      productId: string;
      productName: string;
      quantity: number;
      refundAmount: number;
      costRecovered: number;
    }> = [];

    for (const item of invoice.items) {
      const remQty = Math.max(0, num(item.quantity) - num(item.returnedQuantity));
      if (remQty <= 0) continue;
      const unitNet = num(item.lineTotal) / Math.max(1, num(item.quantity));
      const refundAmount = Number((unitNet * remQty).toFixed(2));
      const costRecovered = Number((num(item.unitCostSnapshot) * remQty).toFixed(2));
      totalReturnVal += refundAmount;

      const updatedProd = await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: remQty } },
      });
      await tx.invoiceItem.update({
        where: { id: item.id },
        data: { returnedQuantity: item.quantity },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'RETURN',
          deltaQty: remQty,
          stockAfter: updatedProd.stockQty,
          refId: invoice.invoiceNumber,
          note: `مرتجع كامل للفاتورة ${invoice.invoiceNumber}`,
          actorId: actor.id,
        },
      });
      returnItemsPayload.push({
        invoiceItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: remQty,
        refundAmount,
        costRecovered,
      });
    }

    let creditReduced = 0;
    let cashRefunded = 0;
    if (invoice.paymentMethod === 'CREDIT' && invoice.customerId) {
      const cus = await tx.customer.findUnique({ where: { id: invoice.customerId } });
      if (cus) {
        creditReduced = Math.min(num(cus.balanceDue), totalReturnVal);
        await tx.customer.update({
          where: { id: cus.id },
          data: { balanceDue: { decrement: creditReduced } },
        });
      }
      cashRefunded = Math.max(0, Number((totalReturnVal - creditReduced).toFixed(2)));
    } else {
      cashRefunded = Number(totalReturnVal.toFixed(2));
    }

    const defaultTreasury = await tx.treasuryAccount.findFirst({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }],
    });
    if (cashRefunded > 0 && defaultTreasury) {
      await tx.treasuryAccount.update({
        where: { id: defaultTreasury.id },
        data: { currentBalance: { decrement: cashRefunded } },
      });
    }

    await tx.invoiceReturn.create({
      data: {
        invoiceId: invoice.id,
        actorName: actor.name,
        reason: body?.reason || 'مرتجع كامل للفاتورة',
        returnTotal: Number(totalReturnVal.toFixed(2)),
        cashRefunded,
        creditDebtReduced: creditReduced,
        treasuryId: defaultTreasury?.id || null,
        treasuryName: defaultTreasury?.name || 'الخزينة الرئيسية',
        items: { create: returnItemsPayload },
      },
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'RETURNED',
        returnedTotal: num(invoice.grandTotal),
        returnedAt: new Date(),
      },
    });

    return { invoice: updatedInvoice };
  });
});
