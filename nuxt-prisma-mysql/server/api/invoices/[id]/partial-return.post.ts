import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

const partialSchema = z.object({
  reason: z.string().default('مرتجع جزئي'),
  refundMode: z.enum(['cash', 'store_credit']).default('cash'),
  treasuryId: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        invoiceItemId: z.string().min(1),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'invoice_return');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الفاتورة مطلوب' });
  const body = partialSchema.parse(await readBody(event));

  const prisma = getPrisma();
  return await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice) throw createError({ statusCode: 404, statusMessage: 'الفاتورة غير موجودة' });
    if (invoice.status === 'RETURNED') {
      throw createError({ statusCode: 409, statusMessage: 'تم رد الفاتورة بالكامل مسبقاً' });
    }

    let returnTotal = 0;
    let costRecoveredTotal = 0;
    const retItems: Array<{
      invoiceItemId: string;
      productId: string;
      productName: string;
      quantity: number;
      refundAmount: number;
      costRecovered: number;
    }> = [];

    for (const reqLine of body.items) {
      const invItem = invoice.items.find((i) => i.id === reqLine.invoiceItemId);
      if (!invItem) throw createError({ statusCode: 404, statusMessage: 'بند الفاتورة غير موجود' });
      const maxReturnable = Math.max(0, num(invItem.quantity) - num(invItem.returnedQuantity));
      if (reqLine.quantity > maxReturnable) {
        throw createError({
          statusCode: 409,
          statusMessage: `الكمية المطلوب إرجاعها (${reqLine.quantity}) تتجاوز المتبقي (${maxReturnable}) للصنف ${invItem.productName}`,
        });
      }

      const unitNetPrice = num(invItem.lineTotal) / Math.max(1, num(invItem.quantity));
      const refundAmount = Number((unitNetPrice * reqLine.quantity).toFixed(2));
      const costRecovered = Number((num(invItem.unitCostSnapshot) * reqLine.quantity).toFixed(2));
      returnTotal += refundAmount;
      costRecoveredTotal += costRecovered;

      const updatedProd = await tx.product.update({
        where: { id: invItem.productId },
        data: { stockQty: { increment: reqLine.quantity } },
      });
      await tx.invoiceItem.update({
        where: { id: invItem.id },
        data: { returnedQuantity: { increment: reqLine.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: invItem.productId,
          type: 'RETURN',
          deltaQty: reqLine.quantity,
          stockAfter: updatedProd.stockQty,
          refId: invoice.invoiceNumber,
          note: `مرتجع جزئي فاتورة ${invoice.invoiceNumber}`,
          actorId: actor.id,
        },
      });

      retItems.push({
        invoiceItemId: invItem.id,
        productId: invItem.productId,
        productName: invItem.productName,
        quantity: reqLine.quantity,
        refundAmount,
        costRecovered,
      });
    }

    returnTotal = Number(returnTotal.toFixed(2));
    let storeCreditAdded = 0;
    let cashRefunded = 0;
    let creditReduced = 0;

    if (body.refundMode === 'store_credit' && invoice.customerId) {
      storeCreditAdded = returnTotal;
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { storeCreditBalance: { increment: storeCreditAdded } },
      });
    } else if (invoice.paymentMethod === 'CREDIT' && invoice.customerId) {
      const cus = await tx.customer.findUnique({ where: { id: invoice.customerId } });
      creditReduced = cus ? Math.min(num(cus.balanceDue), returnTotal) : 0;
      if (cus && creditReduced > 0) {
        await tx.customer.update({
          where: { id: cus.id },
          data: { balanceDue: { decrement: creditReduced } },
        });
      }
      cashRefunded = Number(Math.max(0, returnTotal - creditReduced).toFixed(2));
    } else {
      cashRefunded = returnTotal;
    }

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });
    if (cashRefunded > 0 && treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { decrement: cashRefunded } },
      });
    }

    const returnRecord = await tx.invoiceReturn.create({
      data: {
        invoiceId: invoice.id,
        actorName: actor.name,
        reason: body.reason,
        returnTotal,
        cashRefunded,
        creditDebtReduced: creditReduced,
        storeCreditAdded,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        items: { create: retItems },
      },
      include: { items: true },
    });

    const refreshedItems = await tx.invoiceItem.findMany({ where: { invoiceId: invoice.id } });
    const allReturned = refreshedItems.every((i) => num(i.returnedQuantity) >= num(i.quantity));
    const nextReturnedTotal = Number((num(invoice.returnedTotal) + returnTotal).toFixed(2));
    const nextNetProfit = Number((num(invoice.netProfit) - (returnTotal - costRecoveredTotal)).toFixed(2));

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: allReturned ? 'RETURNED' : 'PARTIAL_RETURNED',
        returnedTotal: nextReturnedTotal,
        netProfit: nextNetProfit,
        returnedAt: allReturned ? new Date() : invoice.returnedAt,
      },
    });

    return { invoice: updatedInvoice, returnRecord };
  });
});
