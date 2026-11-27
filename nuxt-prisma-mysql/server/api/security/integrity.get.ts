import { defineEventHandler } from 'h3';
import { hashInvoiceRecord, requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_security_rbac');
  const prisma = getPrisma();
  const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'asc' } });
  const brokenInvoiceIds: string[] = [];
  let expectedPrev = 'GENESIS_00000000';

  for (const inv of invoices) {
    const recomputed = hashInvoiceRecord(
      inv.prevHash,
      inv.invoiceNumber,
      num(inv.grandTotal),
      'completed'
    );
    if (inv.prevHash !== expectedPrev || inv.recordHash !== recomputed) {
      brokenInvoiceIds.push(inv.invoiceNumber);
    }
    expectedPrev = inv.recordHash;
  }

  return {
    checkedAt: new Date().toISOString(),
    totalInvoicesChecked: invoices.length,
    validInvoices: invoices.length - brokenInvoiceIds.length,
    brokenInvoiceIds,
    chainIntact: brokenInvoiceIds.length === 0,
  };
});
