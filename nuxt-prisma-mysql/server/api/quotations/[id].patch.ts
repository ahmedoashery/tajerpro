import { QuotationStatus } from '@prisma/client';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const patchSchema = z.object({
  status: z.nativeEnum(QuotationStatus),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'pos_sell');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف عرض السعر مطلوب' });
  const body = patchSchema.parse(await readBody(event));
  const prisma = getPrisma();
  const quotation = await prisma.salesQuotation.update({
    where: { id },
    data: { status: body.status },
  });
  return { quotation };
});
