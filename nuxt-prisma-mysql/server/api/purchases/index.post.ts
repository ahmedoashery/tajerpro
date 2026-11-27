import { PurchasePaymentSource } from '@prisma/client';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

const purchaseSchema = z.object({
  supplierId: z.string().min(1),
  activityId: z.string().min(1),
  supplierInvoiceRef: z.string().default(''),
  paymentSource: z.nativeEnum(PurchasePaymentSource),
  paidAmount: z.number().min(0),
  treasuryId: z.string().nullable().optional(),
  notes: z.string().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        unitCost: z.number().nonnegative(),
        newSalePrice: z.number().nonnegative().nullable().optional(),
        batchCode: z.string().default(''),
        expiryDate: z.string().nullable().optional(),
      })
    )
    .min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_purchases');
  const body = purchaseSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId } });
    if (!supplier) throw createError({ statusCode: 404, statusMessage: 'المورد غير موجود' });

    let grandTotal = 0;
    const poItems: Array<{
      productId: string;
      productName: string;
      unit: string;
      quantity: number;
      unitCost: number;
      newSalePrice: number | null;
      batchCode: string;
      expiryDate: Date | null;
      lineTotal: number;
    }> = [];

    for (const item of body.items) {
      const prod = await tx.product.findUnique({ where: { id: item.productId } });
      if (!prod) throw createError({ statusCode: 404, statusMessage: 'أحد الأصناف غير موجود' });
      const lineTotal = Number((item.quantity * item.unitCost).toFixed(2));
      grandTotal += lineTotal;
      poItems.push({
        productId: prod.id,
        productName: prod.name,
        unit: prod.unit,
        quantity: item.quantity,
        unitCost: item.unitCost,
        newSalePrice: item.newSalePrice ?? null,
        batchCode: item.batchCode.trim(),
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        lineTotal,
      });
    }

    grandTotal = Number(grandTotal.toFixed(2));
    const paidAmount =
      body.paymentSource === PurchasePaymentSource.CREDIT
        ? Math.min(grandTotal, body.paidAmount)
        : Math.min(grandTotal, body.paidAmount || grandTotal);
    const remainingDebt = Number(Math.max(0, grandTotal - paidAmount).toFixed(2));

    const treasury = body.treasuryId
      ? await tx.treasuryAccount.findUnique({ where: { id: body.treasuryId } })
      : await tx.treasuryAccount.findFirst({ where: { active: true }, orderBy: [{ isDefault: 'desc' }] });

    if (paidAmount > 0 && treasury) {
      await tx.treasuryAccount.update({
        where: { id: treasury.id },
        data: { currentBalance: { decrement: paidAmount } },
      });
    }

    if (remainingDebt > 0) {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { balanceOwed: { increment: remainingDebt }, lastSupplyAt: new Date() },
      });
    } else {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { lastSupplyAt: new Date() },
      });
    }

    const count = await tx.purchaseOrder.count();
    const purchaseNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const purchase = await tx.purchaseOrder.create({
      data: {
        purchaseNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        activityId: body.activityId,
        actorName: actor.name,
        supplierInvoiceRef: body.supplierInvoiceRef,
        grandTotal,
        paidAmount,
        remainingDebt,
        paymentSource: body.paymentSource,
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || '',
        notes: body.notes,
        items: { create: poItems },
      },
      include: { items: true },
    });

    for (const line of poItems) {
      const prod = await tx.product.findUnique({ where: { id: line.productId } });
      if (!prod) continue;
      const oldQty = Math.max(0, num(prod.stockQty));
      const nextQty = Number((oldQty + line.quantity).toFixed(2));
      const weightedCost =
        nextQty > 0
          ? Number(((oldQty * num(prod.costPrice) + line.quantity * line.unitCost) / nextQty).toFixed(2))
          : line.unitCost;
      const nextSale = line.newSalePrice !== null ? line.newSalePrice : num(prod.salePrice);

      if (weightedCost !== num(prod.costPrice) || nextSale !== num(prod.salePrice)) {
        await tx.productPriceHistory.create({
          data: {
            productId: prod.id,
            oldSalePrice: prod.salePrice,
            newSalePrice: nextSale,
            oldCostPrice: prod.costPrice,
            newCostPrice: weightedCost,
            changedById: actor.id,
            reason: `توريد فاتورة شراء ${purchaseNumber}`,
          },
        });
      }

      await tx.product.update({
        where: { id: prod.id },
        data: {
          stockQty: nextQty,
          costPrice: weightedCost,
          salePrice: nextSale,
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: prod.id,
          type: 'PURCHASE',
          deltaQty: line.quantity,
          stockAfter: nextQty,
          refId: purchaseNumber,
          note: `شراء وتوريد من ${supplier.name}`,
          actorId: actor.id,
        },
      });

      if (line.batchCode || line.expiryDate) {
        await tx.productBatch.create({
          data: {
            productId: prod.id,
            productName: prod.name,
            batchCode: line.batchCode || `PO-${purchaseNumber}`,
            expiryDate: line.expiryDate,
            qty: line.quantity,
            costPrice: line.unitCost,
            supplierId: supplier.id,
            purchaseId: purchase.id,
          },
        });
      }
    }

    return { purchase };
  });
});
