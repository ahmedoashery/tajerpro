import { defineEventHandler } from 'h3';
import { getPrisma } from '../utils/prisma';

export default defineEventHandler(async () => {
  const prisma = getPrisma();
  const [settings, products, invoices, customers, suppliers, staff, rolePerms, movements, priceHistory, license] =
    await Promise.all([
      prisma.storeSettings.findUnique({ where: { id: 1 } }),
      prisma.product.findMany({ orderBy: { name: 'asc' } }),
      prisma.invoice.findMany({
        include: { items: true, cashier: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 150,
      }),
      prisma.customer.findMany({ orderBy: { name: 'asc' } }),
      prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
      prisma.staffUser.findMany({
        select: { id: true, name: true, role: true, active: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.rolePermission.findMany(),
      prisma.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.productPriceHistory.findMany({ orderBy: { changedAt: 'desc' }, take: 50 }),
      prisma.appLicense.findUnique({ where: { id: 1 } }),
    ]);

  const rolePermissions = Object.fromEntries(
    rolePerms.map((r) => [r.role, r.permissionsJson as Record<string, boolean>])
  );

  const lowStockProducts = products.filter(
    (p) => Number(p.stockQty) > 0 && Number(p.stockQty) <= Number(p.minStockAlert)
  );
  const outOfStockProducts = products.filter((p) => Number(p.stockQty) <= 0);

  return {
    settings,
    products: products.map((p) => ({
      ...p,
      salePrice: Number(p.salePrice),
      costPrice: Number(p.costPrice),
      stockQty: Number(p.stockQty),
      minStockAlert: Number(p.minStockAlert),
      maxStockTarget: Number(p.maxStockTarget),
    })),
    invoices: invoices.map((inv) => ({
      ...inv,
      subtotal: Number(inv.subtotal),
      discountTotal: Number(inv.discountTotal),
      grandTotal: Number(inv.grandTotal),
      totalCost: Number(inv.totalCost),
      netProfit: Number(inv.netProfit),
      items: inv.items.map((it) => ({
        ...it,
        quantity: Number(it.quantity),
        unitPriceSnapshot: Number(it.unitPriceSnapshot),
        unitCostSnapshot: Number(it.unitCostSnapshot),
        discountAmount: Number(it.discountAmount),
        lineTotal: Number(it.lineTotal),
        lineProfit: Number(it.lineProfit),
      })),
    })),
    customers: customers.map((c) => ({ ...c, balanceDue: Number(c.balanceDue) })),
    suppliers: suppliers.map((s) => ({ ...s, balanceOwed: Number(s.balanceOwed) })),
    staff,
    rolePermissions,
    movements: movements.map((m) => ({
      ...m,
      deltaQty: Number(m.deltaQty),
      stockAfter: Number(m.stockAfter),
    })),
    priceHistory: priceHistory.map((h) => ({
      ...h,
      oldSalePrice: Number(h.oldSalePrice),
      newSalePrice: Number(h.newSalePrice),
      oldCostPrice: Number(h.oldCostPrice),
      newCostPrice: Number(h.newCostPrice),
    })),
    lowStockCount: lowStockProducts.length,
    outOfStockCount: outOfStockProducts.length,
    license,
  };
});
