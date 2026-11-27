import { defineEventHandler } from 'h3';
import { getPrisma, num } from '../../utils/prisma';

async function computeShiftTotals(prisma: ReturnType<typeof getPrisma>, periodStartAt: Date) {
  const [invoices, returns, expenses, collections, payouts, drawings] = await Promise.all([
    prisma.invoice.findMany({
      where: { createdAt: { gt: periodStartAt } },
      include: { allocations: true },
    }),
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

  const cashCollections = collections
    .filter((c) => c.gateway === 'CASH')
    .reduce((s, c) => s + num(c.amount), 0);
  const cashReturns = returns.reduce((s, r) => s + num(r.cashRefunded), 0);
  const cashExpenses = expenses
    .filter((e) => e.paymentSource === 'CASH_DRAWER')
    .reduce((s, e) => s + num(e.amount), 0);
  const cashSupplierPayouts = payouts
    .filter((p) => p.gateway === 'CASH')
    .reduce((s, p) => s + num(p.amount), 0);
  const cashEquityDrawings = drawings.reduce((s, d) => s + num(d.amount), 0);

  return {
    cashSales: Number(cashSales.toFixed(2)),
    cashCollections: Number(cashCollections.toFixed(2)),
    cashReturns: Number(cashReturns.toFixed(2)),
    cashExpenses: Number(cashExpenses.toFixed(2)),
    cashSupplierPayouts: Number(cashSupplierPayouts.toFixed(2)),
    cashEquityDrawings: Number(cashEquityDrawings.toFixed(2)),
    instapayTotal: Number(instapayTotal.toFixed(2)),
    walletTotal: Number(walletTotal.toFixed(2)),
    cardTotal: Number(cardTotal.toFixed(2)),
    creditTotal: Number(creditTotal.toFixed(2)),
    invoiceCount,
    returnedCount,
  };
}

export default defineEventHandler(async () => {
  const prisma = getPrisma();
  const lastClosure = await prisma.shiftClosure.findFirst({ orderBy: { closedAt: 'desc' } });
  const periodStartAt = lastClosure?.closedAt ?? new Date(new Date().setHours(0, 0, 0, 0));

  const totals = await computeShiftTotals(prisma, periodStartAt);
  const recentClosures = await prisma.shiftClosure.findMany({
    orderBy: { closedAt: 'desc' },
    take: 12,
  });

  return {
    periodStartAt: periodStartAt.toISOString(),
    ...totals,
    recentClosures: recentClosures.map((c) => ({
      ...c,
      openingFloat: num(c.openingFloat),
      cashSales: num(c.cashSales),
      cashCollections: num(c.cashCollections),
      cashReturns: num(c.cashReturns),
      cashExpenses: num(c.cashExpenses),
      cashSupplierPayouts: num(c.cashSupplierPayouts),
      cashEquityDrawings: num(c.cashEquityDrawings),
      expectedCash: num(c.expectedCash),
      actualCash: num(c.actualCash),
      variance: num(c.variance),
      instapayTotal: num(c.instapayTotal),
      walletTotal: num(c.walletTotal),
      cardTotal: num(c.cardTotal),
      creditTotal: num(c.creditTotal),
    })),
  };
});
