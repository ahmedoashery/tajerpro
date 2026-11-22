import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const createProductSchema = z.object({
  activityId: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  salePrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative(),
  stockQty: z.number().nonnegative(),
  minStockAlert: z.number().nonnegative().default(5),
  maxStockTarget: z.number().nonnegative().default(50),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'edit_prices_stock');
  const body = createProductSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: body });
    await tx.stockMovement.create({
      data: {
        productId: created.id,
        type: 'RESTOCK',
        deltaQty: body.stockQty,
        stockAfter: body.stockQty,
        refId: 'INIT',
        note: 'رصيد افتتاحي للصنف الجديد',
        actorId: actor.id,
      },
    });
    return created;
  });

  return { product };
});
