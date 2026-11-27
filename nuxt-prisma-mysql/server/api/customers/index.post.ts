import { PriceTier } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().default(''),
  creditLimit: z.number().min(0).default(0),
  defaultPriceTier: z.nativeEnum(PriceTier).default(PriceTier.RETAIL),
  defaultDiscountPercent: z.number().min(0).max(100).default(0),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_partners');
  const body = customerSchema.parse(await readBody(event));
  const prisma = getPrisma();
  const customer = await prisma.customer.create({ data: body });
  return { customer };
});
