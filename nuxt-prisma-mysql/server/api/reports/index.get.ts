import { defineEventHandler, getQuery } from 'h3';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'view_reports');
  const query = getQuery(event);
  const period = String(query.period || 'daily') as 'daily' | 'monthly' | 'yearly';
  const activityId = query.activityId ? String(query.activityId) : 'all';

  const prisma = getPrisma();
  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'COMPLETED',
      ...(activityId !== 'all' ? { activityId } : {}),
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  const bucketMap = new Map<string, { label: string; sales: number; cost: number; profit: number; count: number }>();
  const productProfitMap = new Map<
    string,
    { productId: string; productName: string; sku: string; qtySold: number; revenue: number; cost: number; profit: number }
  >();

  for (const inv of invoices) {
    const iso = inv.createdAt.toISOString();
    const key = period === 'yearly' ? iso.slice(0, 4) : period === 'monthly' ? iso.slice(0, 7) : iso.slice(0, 10);
    const cur = bucketMap.get(key) || { label: key, sales: 0, cost: 0, profit: 0, count: 0 };
    cur.sales += Number(inv.grandTotal);
    cur.cost += Number(inv.totalCost);
    cur.profit += Number(inv.netProfit);
    cur.count += 1;
    bucketMap.set(key, cur);

    for (const it of inv.items) {
      const p = productProfitMap.get(it.productId) || {
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        qtySold: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      };
      p.qtySold += Number(it.quantity);
      p.revenue += Number(it.lineTotal);
      p.cost += Number(it.unitCostSnapshot) * Number(it.quantity);
      p.profit += Number(it.lineProfit);
      productProfitMap.set(it.productId, p);
    }
  }

  const products = await prisma.product.findMany({
    where: activityId !== 'all' ? { activityId } : undefined,
    orderBy: { stockQty: 'asc' },
  });

  const inventoryHealth = products.map((p) => {
    const qty = Number(p.stockQty);
    const min = Number(p.minStockAlert);
    const max = Number(p.maxStockTarget);
    const status =
      qty <= 0 ? 'out' : qty <= min ? 'low' : qty > max ? 'overstock' : 'available';
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      stockQty: qty,
      minStockAlert: min,
      maxStockTarget: max,
      status,
      stockCostValue: Number((qty * Number(p.costPrice)).toFixed(2)),
    };
  });

  return {
    periodBuckets: Array.from(bucketMap.values()),
    productProfits: Array.from(productProfitMap.values()),
    inventoryHealth,
  };
});
