import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const supplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().default(''),
  company: z.string().default(''),
  category: z.string().default('توريد عام'),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_partners');
  const body = supplierSchema.parse(await readBody(event));
  const prisma = getPrisma();
  const supplier = await prisma.supplier.create({ data: body });
  return { supplier };
});
