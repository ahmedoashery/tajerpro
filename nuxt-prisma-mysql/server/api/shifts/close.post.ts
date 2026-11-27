import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

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

  const [invoices, returns, expenses, collections, payouts, drawings] = await Promise.all([
    prisma.invoice.findMany({ where: { createdAt: { gt: periodStartAt } }, include: { allocations: true } }),
    prisma.invoiceReturn.findMany({ where: { createdAt: { gt: periodStartAt } } }),
    prisma.storeExpense.findMany({ where: { createdAt: { gt: periodStartAt } } }),
    prisma.paymentTransaction.findMany({
      where: { createdAt: { gt: periodStartAt }, customerId: { not: null }, invoiceId: null },
    }),
    prisma.paymentTransaction.findMany({
      where: { createdAt: { gt: periodStartAt }, referenceCode: { startsWith: 'SUP-' } },
    }),
    prisma.equityDrawing.findMany({
      where: { createdAt: { gt: periodStartAt }, type: { in: ['DRAW', 'SETTLEMENT'] } },
    }),
  ]);

  let cashSales = 0;
  let instapayTotal = 0;
  let walletTotal = 0;
  let cardTotal = 0;
  let creditTotal = 0;
  let invoiceCount = 0;
  let returnedCount = 0;

  for (const inv of invoices) {
    if (inv.status === 'RETURNED') {
      returnedCount += 1;
      continue;
    }
    invoiceCount += 1;
    if (inv.allocations.length > 0) {
      for (const a of inv.allocations) {
        const amt = num(a.amount);
        if (a.method === 'CASH') cashSales += amt;
        else if (a.method === 'INSTAPAY') instapayTotal += amt;
        else if (a.method === 'VODAFONE_CASH') walletTotal += amt;
        else if (a.method === 'CARD') cardTotal += amt;
        else if (a.method === 'CREDIT') creditTotal += amt;
      }
    } else {
      const total = num(inv.grandTotal);
      if (inv.paymentMethod === 'CASH') cashSales += total;
      else if (inv.paymentMethod === 'INSTAPAY') instapayTotal += total;
      else if (inv.paymentMethod === 'VODAFONE_CASH') walletTotal += total;
      else if (inv.paymentMethod === 'CARD') cardTotal += total;
      else if (inv.paymentMethod === 'CREDIT') creditTotal += total;
    }
  }

  const cashCollections = collections.filter((c) => c.gateway === 'CASH').reduce((s, c) => s + num(c.amount), 0);
  const cashReturns = returns.reduce((s, r) => s + num(r.cashRefunded), 0);
  const cashExpenses = expenses.filter((e) => e.paymentSource === 'CASH_DRAWER').reduce((s, e) => s + num(e.amount), 0);
  const cashSupplierPayouts = payouts.filter((p) => p.gateway === 'CASH').reduce((s, p) => s + num(p.amount), 0);
  const cashEquityDrawings = drawings.reduce((s, d) => s + num(d.amount), 0);

  const expectedCash = Number(
    (
      body.openingFloat +
      cashSales +
      cashCollections -
      cashReturns -
      cashExpenses -
      cashSupplierPayouts -
      cashEquityDrawings
    ).toFixed(2)
  );
  const variance = Number((body.actualCash - expectedCash).toFixed(2));

  const closure = await prisma.shiftClosure.create({
    data: {
      cashierId: actor.id,
      cashierName: actor.name,
      periodStartAt,
      openingFloat: body.openingFloat,
      cashSales,
      cashCollections,
      cashReturns,
      cashExpenses,
      cashSupplierPayouts,
      cashEquityDrawings,
      expectedCash,
      actualCash: body.actualCash,
      variance,
      instapayTotal,
      walletTotal,
      cardTotal,
      creditTotal,
      invoiceCount,
      returnedCount,
      notes: body.notes || '',
    },
  });

  return { closure };
});
