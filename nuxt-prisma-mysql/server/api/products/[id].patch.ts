import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  attributeValue: z.string().optional(),
  salePrice: z.number().nonnegative().optional(),
  halfWholesalePrice: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  stockDelta: z.number().optional(),
  minStockAlert: z.number().nonnegative().optional(),
  maxStockTarget: z.number().nonnegative().optional(),
  supplierId: z.string().nullable().optional(),
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

    const nextSale = body.salePrice ?? num(existing.salePrice);
    const nextCost = body.costPrice ?? num(existing.costPrice);
    const nextStock = Math.max(0, num(existing.stockQty) + (body.stockDelta ?? 0));

    if (nextSale !== num(existing.salePrice) || nextCost !== num(existing.costPrice)) {
      await tx.productPriceHistory.create({
        data: {
          productId: existing.id,
          oldSalePrice: existing.salePrice,
          newSalePrice: nextSale,
          oldCostPrice: existing.costPrice,
          newCostPrice: nextCost,
          changedById: actor.id,
          reason: body.note || 'تعديل سعر يدوي',
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
        name: body.name ?? existing.name,
        category: body.category ?? existing.category,
        unit: body.unit ?? existing.unit,
        attributeValue: body.attributeValue ?? existing.attributeValue,
        salePrice: nextSale,
        halfWholesalePrice: body.halfWholesalePrice ?? existing.halfWholesalePrice,
        wholesalePrice: body.wholesalePrice ?? existing.wholesalePrice,
        costPrice: nextCost,
        stockQty: nextStock,
        minStockAlert: body.minStockAlert ?? existing.minStockAlert,
        maxStockTarget: body.maxStockTarget ?? existing.maxStockTarget,
        supplierId: body.supplierId !== undefined ? body.supplierId : existing.supplierId,
      },
    });
  });

  return { product: updated };
});
