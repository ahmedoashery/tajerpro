import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const partnerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().default(''),
  roleTitle: z.string().default('شريك'),
  capitalContribution: z.number().min(0).default(0),
  profitSharePercent: z.number().min(0).max(100),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'view_reports');
  const body = partnerSchema.parse(await readBody(event));
  const prisma = getPrisma();
  const partner = await prisma.equityPartner.create({ data: body });
  return { partner };
});
