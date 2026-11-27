import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

const batchSchema = z.object({
  productId: z.string().min(1),
  batchCode: z.string().min(1),
  expiryDate: z.string().nullable().optional(),
  qty: z.number().positive(),
  costPrice: z.number().nonnegative().optional(),
  supplierId: z.string().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'edit_prices_stock');
  const body = batchSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: body.productId } });
    if (!product) throw createError({ statusCode: 404, statusMessage: 'الصنف غير موجود' });

    const batch = await tx.productBatch.create({
      data: {
        productId: product.id,
        productName: product.name,
        batchCode: body.batchCode.trim(),
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        qty: body.qty,
        costPrice: body.costPrice ?? num(product.costPrice),
        supplierId: body.supplierId || null,
      },
    });

    const afterQty = num(product.stockQty) + body.qty;
    await tx.product.update({
      where: { id: product.id },
      data: { stockQty: afterQty },
    });
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        type: 'RESTOCK',
        deltaQty: body.qty,
        stockAfter: afterQty,
        refId: batch.batchCode,
        note: `إضافة تشغيلة ${batch.batchCode}`,
        actorId: actor.id,
      },
    });

    return { batch };
  });
});
