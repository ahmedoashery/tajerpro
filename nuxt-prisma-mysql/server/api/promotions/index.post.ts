import { PromotionRuleType } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const promoSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().default(true),
  ruleType: z.nativeEnum(PromotionRuleType),
  value: z.number().nonnegative(),
  minSubtotal: z.number().nonnegative().default(0),
  minQty: z.number().nonnegative().default(0),
  category: z.string().default(''),
  productId: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_settings');
  const body = promoSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const promotion = await prisma.storePromotion.create({
    data: {
      name: body.name.trim(),
      active: body.active,
      ruleType: body.ruleType,
      value: body.value,
      minSubtotal: body.minSubtotal,
      minQty: body.minQty,
      category: body.category,
      productId: body.productId || null,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
    },
  });

  return { promotion };
});
