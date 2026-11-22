import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const updateSchema = z.object({
  salePrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  stockDelta: z.number().optional(),
  minStockAlert: z.number().nonnegative().optional(),
  maxStockTarget: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'edit_prices_stock');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الصنف مطلوب' });

  const body = updateSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'الصنف غير موجود' });

    const nextSale = body.salePrice ?? Number(existing.salePrice);
    const nextCost = body.costPrice ?? Number(existing.costPrice);
    const nextStock = Math.max(0, Number(existing.stockQty) + (body.stockDelta ?? 0));

    if (nextSale !== Number(existing.salePrice) || nextCost !== Number(existing.costPrice)) {
      await tx.productPriceHistory.create({
        data: {
          productId: existing.id,
          oldSalePrice: existing.salePrice,
          newSalePrice: nextSale,
          oldCostPrice: existing.costPrice,
          newCostPrice: nextCost,
          changedById: actor.id,
        },
      });
    }

    if (body.stockDelta && body.stockDelta !== 0) {
      await tx.stockMovement.create({
        data: {
          productId: existing.id,
          type: body.stockDelta > 0 ? 'RESTOCK' : 'ADJUSTMENT',
          deltaQty: body.stockDelta,
          stockAfter: nextStock,
          note: body.note || 'تعديل مخزون يدوي',
          actorId: actor.id,
        },
      });
    }

    return await tx.product.update({
      where: { id },
      data: {
        salePrice: nextSale,
        costPrice: nextCost,
        stockQty: nextStock,
        minStockAlert: body.minStockAlert ?? existing.minStockAlert,
        maxStockTarget: body.maxStockTarget ?? existing.maxStockTarget,
      },
    });
  });

  return { product: updated };
});
