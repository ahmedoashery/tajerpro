import { defineEventHandler } from 'h3';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async () => {
  const prisma = getPrisma();
  const lastClosure = await prisma.shiftClosure.findFirst({ orderBy: { closedAt: 'desc' } });
  const periodStartAt = lastClosure?.closedAt ?? new Date(new Date().setHours(0, 0, 0, 0));

  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gt: periodStartAt } },
  });

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
    const total = Number(inv.grandTotal);
    if (inv.paymentMethod === 'CASH') cashSales += total;
    else if (inv.paymentMethod === 'INSTAPAY') instapayTotal += total;
    else if (inv.paymentMethod === 'VODAFONE_CASH') walletTotal += total;
    else if (inv.paymentMethod === 'CARD') cardTotal += total;
    else if (inv.paymentMethod === 'CREDIT') creditTotal += total;
  }

  const recentClosures = await prisma.shiftClosure.findMany({
    orderBy: { closedAt: 'desc' },
    take: 10,
  });

  return {
    periodStartAt: periodStartAt.toISOString(),
    cashSales,
    instapayTotal,
    walletTotal,
    cardTotal,
    creditTotal,
    invoiceCount,
    returnedCount,
    recentClosures,
  };
});
