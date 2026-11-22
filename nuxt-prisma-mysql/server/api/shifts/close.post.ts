import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const closeSchema = z.object({
  openingFloat: z.number().nonnegative(),
  actualCash: z.number().nonnegative(),
  notes: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'pos_sell');
  const body = closeSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const lastClosure = await prisma.shiftClosure.findFirst({ orderBy: { closedAt: 'desc' } });
  const periodStartAt = lastClosure?.closedAt ?? new Date(new Date().setHours(0, 0, 0, 0));
  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gt: periodStartAt }, status: 'COMPLETED' },
  });

  let cashSales = 0;
  let instapayTotal = 0;
  let walletTotal = 0;
  let cardTotal = 0;
  let creditTotal = 0;

  for (const inv of invoices) {
    const total = Number(inv.grandTotal);
    if (inv.paymentMethod === 'CASH') cashSales += total;
    else if (inv.paymentMethod === 'INSTAPAY') instapayTotal += total;
    else if (inv.paymentMethod === 'VODAFONE_CASH') walletTotal += total;
    else if (inv.paymentMethod === 'CARD') cardTotal += total;
    else if (inv.paymentMethod === 'CREDIT') creditTotal += total;
  }

  const expectedCash = Number((body.openingFloat + cashSales).toFixed(2));
  const variance = Number((body.actualCash - expectedCash).toFixed(2));

  const closure = await prisma.shiftClosure.create({
    data: {
      cashierId: actor.id,
      cashierName: actor.name,
      periodStartAt,
      openingFloat: body.openingFloat,
      expectedCash,
      actualCash: body.actualCash,
      variance,
      cashSales,
      instapayTotal,
      walletTotal,
      cardTotal,
      creditTotal,
      notes: body.notes || '',
    },
  });

  return { closure };
});
