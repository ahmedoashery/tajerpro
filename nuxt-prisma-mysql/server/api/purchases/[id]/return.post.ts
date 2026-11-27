import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma, num } from '../../../utils/prisma';

const returnSchema = z.object({
  reason: z.string().default('مرتجع مشتريات للمورد'),
  treasuryId: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.string().min(1),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_purchases');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف فاتورة الشراء مطلوب' });
  const body = returnSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: true },
    });
    if (!purchase) throw createError({ statusCode: 404, statusMessage: 'فاتورة الشراء غير موجودة' });

    let returnTotal = 0;
    const retItems: Array<{
      purchaseItemId: string;
      productId: string;
      productName: string;
      quantity: number;
      refundAmount: number;
    }> = [];

    for (const line of body.items) {
      const poItem = purchase.items.find((i) => i.id === line.purchaseItemId);
      if (!poItem) throw createError({ statusCode: 404, statusMessage: 'بند الشراء غير موجود' });
      const rem = Math.max(0, num(poItem.quantity) - num(poItem.returnedQuantity));
      if (line.quantity > rem) {
        throw createError({ statusCode: 409, statusMessage: `الكمية تتجاوز المتاح للإرجاع (${rem})` });
      }
      const refundAmount = Number((line.quantity * num(poItem.unitCost)).toFixed(2));
      returnTotal += refundAmount;

      const updatedProd = await tx.product.update({
        where: { id: poItem.productId },
        data: { stockQty: { decrement: line.quantity } },
      });
      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { returnedQuantity: { increment: line.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: poItem.productId,
          type: 'PURCHASE_RETURN',
          deltaQty: -line.quantity,
          stockAfter: updatedProd.stockQty,
          refId: purchase.purchaseNumber,
          note: `مرتجع للمورد ${purchase.supplierName}`,
          actorId: actor.id,
        },
      });
      retItems.push({
        purchaseItemId: poItem.id,
        productId: poItem.productId,
        productName: poItem.productName,
        quantity: line.quantity,
        refundAmount,
      });
    }

    returnTotal = Number(returnTotal.toFixed(2));
    const debtReduced = Math.min(num(purchase.supplier.balanceOwed), returnTotal);
    const cashRefunded = Number(Math.max(0, returnTotal - debtReduced).toFixed(2));

    if (debtReduced > 0) {
      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: { balanceOwed: { decrement: debtReduced } },
      });
    }

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });
    if (cashRefunded > 0 && treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { increment: cashRefunded } },
      });
    }

    const returnRecord = await tx.purchaseReturn.create({
      data: {
        purchaseId: purchase.id,
        actorName: actor.name,
        reason: body.reason,
        returnTotal,
        debtReduced,
        cashRefunded,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        items: { create: retItems },
      },
      include: { items: true },
    });

    await tx.purchaseOrder.update({
      where: { id: purchase.id },
      data: { returnedTotal: { increment: returnTotal } },
    });

    return { returnRecord };
  });
});
