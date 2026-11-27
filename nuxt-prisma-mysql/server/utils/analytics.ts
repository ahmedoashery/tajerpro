import type { PrismaClient } from '@prisma/client';
import { num } from './prisma';

export interface OwnerAlertItem {
  id: string;
  severity: 'danger' | 'warning' | 'info';
  category: 'margin' | 'discount' | 'shift' | 'credit' | 'expiry' | 'stock';
  title: string;
  message: string;
  metricValue?: string;
}

export async function buildDashboardAndAlerts(prisma: PrismaClient) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [products, invoices30d, expensesMonth, treasuries, customers, suppliers, batches, closures] =
    await Promise.all([
      prisma.product.findMany(),
      prisma.invoice.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        include: { items: true, allocations: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.storeExpense.findMany({
        where: { createdAt: { gte: startOfMonth } },
      }),
      prisma.treasuryAccount.findMany({ where: { active: true } }),
      prisma.customer.findMany(),
      prisma.supplier.findMany(),
      prisma.productBatch.findMany({ where: { qty: { gt: 0 } } }),
      prisma.shiftClosure.findMany({ orderBy: { closedAt: 'desc' }, take: 5 }),
    ]);

  let todayRevenue = 0;
  let todayProfit = 0;
  let todayInvoiceCount = 0;
  let electronicSalesToday = 0;
  let creditSalesToday = 0;

  const productVelocity = new Map<string, number>();
  const topProductsMap = new Map<
    string,
    { productId: string; name: string; qtySold: number; revenue: number; profit: number }
  >();

  for (const inv of invoices30d) {
    const activeFactor = inv.status === 'RETURNED' ? 0 : 1;
    const netGrand = Math.max(0, num(inv.grandTotal) - num(inv.returnedTotal)) * activeFactor;
    const isToday = inv.createdAt >= startOfToday;

    if (isToday && inv.status !== 'RETURNED') {
      todayInvoiceCount += 1;
      todayRevenue += netGrand;
      todayProfit += num(inv.netProfit);
      if (inv.paymentMethod === 'CREDIT') creditSalesToday += netGrand;
      else if (inv.paymentMethod !== 'CASH') electronicSalesToday += netGrand;
    }

    if (inv.status !== 'RETURNED') {
      for (const it of inv.items) {
        const netQty = Math.max(0, num(it.quantity) - num(it.returnedQuantity));
        productVelocity.set(it.productId, (productVelocity.get(it.productId) || 0) + netQty);
        const cur = topProductsMap.get(it.productId) || {
          productId: it.productId,
          name: it.productName,
          qtySold: 0,
          revenue: 0,
          profit: 0,
        };
        cur.qtySold += netQty;
        cur.revenue += num(it.lineTotal);
        cur.profit += num(it.lineProfit);
        topProductsMap.set(it.productId, cur);
      }
    }
  }

  let todayExpenses = 0;
  let monthExpenses = 0;
  for (const ex of expensesMonth) {
    const amt = num(ex.amount);
    monthExpenses += amt;
    if (ex.createdAt >= startOfToday) todayExpenses += amt;
  }

  const cashDrawerBalance = treasuries
    .filter((t) => t.type === 'CASH_DRAWER')
    .reduce((s, t) => s + num(t.currentBalance), 0);
  const totalLiquidity = treasuries.reduce((s, t) => s + num(t.currentBalance), 0);

  let inventoryCapitalCost = 0;
  let inventoryRetailValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const p of products) {
    const qty = num(p.stockQty);
    inventoryCapitalCost += Math.max(0, qty) * num(p.costPrice);
    inventoryRetailValue += Math.max(0, qty) * num(p.salePrice);
    if (qty <= 0) outOfStockCount += 1;
    else if (qty <= num(p.minStockAlert)) lowStockCount += 1;
  }

  const expiringBatches = batches.filter(
    (b) => b.expiryDate && b.expiryDate <= thirtyDaysAhead
  );

  // Owner Anomaly Alerts
  const ownerAlerts: OwnerAlertItem[] = [];
  if (outOfStockCount > 0) {
    ownerAlerts.push({
      id: 'alt-out-stock',
      severity: 'danger',
      category: 'stock',
      title: 'أصناف نفد رصيدها تماماً',
      message: `يوجد ${outOfStockCount} صنف برصيد صفر ويحتاج طلب توريد فوري.`,
      metricValue: `${outOfStockCount} صنف`,
    });
  }
  if (expiringBatches.length > 0) {
    ownerAlerts.push({
      id: 'alt-expiry',
      severity: 'warning',
      category: 'expiry',
      title: 'تشغيلات قاربت على انتهاء الصلاحية',
      message: `${expiringBatches.length} تشغيلة تنتهي خلال 30 يوماً (الأولوية للصرف FEFO).`,
      metricValue: `${expiringBatches.length} تشغيلة`,
    });
  }
  const overLimitCustomers = customers.filter(
    (c) => num(c.creditLimit) > 0 && num(c.balanceDue) > num(c.creditLimit)
  );
  if (overLimitCustomers.length > 0) {
    ownerAlerts.push({
      id: 'alt-credit-limit',
      severity: 'warning',
      category: 'credit',
      title: 'عملاء تجاوزوا الحد الائتماني',
      message: `${overLimitCustomers.length} عميل تجاوز سقف الآجل المسموح به.`,
      metricValue: `${overLimitCustomers.length} عميل`,
    });
  }
  if (closures[0] && Math.abs(num(closures[0].variance)) >= 50) {
    ownerAlerts.push({
      id: 'alt-shift-variance',
      severity: 'warning',
      category: 'shift',
      title: 'فرق نقدية ملحوظ في آخر تقفيل وردية',
      message: `تم تسجيل فرق قدره ${num(closures[0].variance).toFixed(2)} ج.م في وردية ${closures[0].cashierName}.`,
      metricValue: `${num(closures[0].variance).toFixed(2)} ج.م`,
    });
  }

  // Auto-Reorder Suggestions grouped by supplier
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const reorderBySupplier = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      supplierPhone: string;
      totalEstimatedCost: number;
      items: Array<{
        productId: string;
        productName: string;
        unit: string;
        currentStock: number;
        minStockAlert: number;
        maxStockLimit: number;
        velocityPerDay: number;
        suggestedQty: number;
        unitCost: number;
        estimatedCost: number;
      }>;
    }
  >();

  for (const p of products) {
    const qty = num(p.stockQty);
    const minAlert = num(p.minStockAlert);
    const maxTarget = Math.max(num(p.maxStockTarget), minAlert * 2, 10);
    if (qty <= minAlert) {
      const sid = p.supplierId || 'unassigned';
      const sup = p.supplierId ? supplierById.get(p.supplierId) : null;
      const velocity = Number(((productVelocity.get(p.id) || 0) / 30).toFixed(2));
      const suggestedQty = Math.max(1, Math.ceil(maxTarget - Math.max(0, qty)));
      const unitCost = num(p.costPrice);
      const estimatedCost = Number((suggestedQty * unitCost).toFixed(2));

      const grp = reorderBySupplier.get(sid) || {
        supplierId: sid,
        supplierName: sup?.name || 'مورد غير محدد (شراء مفتوح)',
        supplierPhone: sup?.phone || '',
        totalEstimatedCost: 0,
        items: [],
      };
      grp.totalEstimatedCost = Number((grp.totalEstimatedCost + estimatedCost).toFixed(2));
      grp.items.push({
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        currentStock: qty,
        minStockAlert: minAlert,
        maxStockLimit: maxTarget,
        velocityPerDay: velocity,
        suggestedQty,
        unitCost,
        estimatedCost,
      });
      reorderBySupplier.set(sid, grp);
    }
  }

  return {
    dashboard: {
      todayRevenue: Number(todayRevenue.toFixed(2)),
      todayProfit: Number(todayProfit.toFixed(2)),
      todayExpenses: Number(todayExpenses.toFixed(2)),
      todayNetAfterExpenses: Number((todayProfit - todayExpenses).toFixed(2)),
      monthExpenses: Number(monthExpenses.toFixed(2)),
      todayInvoiceCount,
      cashDrawerBalance: Number(cashDrawerBalance.toFixed(2)),
      totalTreasuriesLiquidity: Number(totalLiquidity.toFixed(2)),
      electronicSalesToday: Number(electronicSalesToday.toFixed(2)),
      creditSalesToday: Number(creditSalesToday.toFixed(2)),
      inventoryCapitalCost: Number(inventoryCapitalCost.toFixed(2)),
      inventoryRetailValue: Number(inventoryRetailValue.toFixed(2)),
      lowStockCount,
      outOfStockCount,
      expiringBatchesCount: expiringBatches.length,
      topProducts: Array.from(topProductsMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 6),
    },
    ownerAlerts,
    reorderSuggestions: Array.from(reorderBySupplier.values()),
  };
}

export async function buildReportsPayload(
  prisma: PrismaClient,
  opts: { period: 'daily' | 'monthly' | 'yearly'; activityId: string; fromDate?: string; toDate?: string }
) {
  const from = opts.fromDate ? new Date(opts.fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = opts.toDate ? new Date(`${opts.toDate.slice(0, 10)}T23:59:59.999Z`) : new Date();

  const [invoices, expenses, purchases, products, partners, drawings, allocations] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(opts.activityId !== 'all' ? { activityId: opts.activityId } : {}),
      },
      include: { items: true, allocations: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.storeExpense.findMany({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.purchaseOrder.findMany({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.product.findMany({
      where: opts.activityId !== 'all' ? { activityId: opts.activityId } : undefined,
      orderBy: { stockQty: 'asc' },
    }),
    prisma.equityPartner.findMany({ where: { active: true } }),
    prisma.equityDrawing.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: 'desc' } }),
    prisma.invoicePaymentAllocation.findMany({
      where: { invoice: { createdAt: { gte: from, lte: to } } },
    }),
  ]);

  let grossSalesBeforeReturns = 0;
  let returnsTotal = 0;
  let discountsTotal = 0;
  let netSalesRevenue = 0;
  let historicalCogs = 0;
  let grossProfit = 0;
  let returnedCount = 0;

  const bucketMap = new Map<string, { bucket: string; label: string; revenue: number; cost: number; profit: number; invoiceCount: number }>();
  const productProfitMap = new Map<
    string,
    { productId: string; productName: string; sku: string; qtySold: number; revenue: number; historicalCost: number; historicalProfit: number; marginPercent: number }
  >();

  for (const inv of invoices) {
    const subtotal = num(inv.subtotal);
    const disc = num(inv.discountTotal) + num(inv.promotionDiscount);
    const ret = inv.status === 'RETURNED' ? num(inv.grandTotal) : num(inv.returnedTotal);
    const netGrand = inv.status === 'RETURNED' ? 0 : Math.max(0, num(inv.grandTotal) - num(inv.returnedTotal));
    const cost = inv.status === 'RETURNED' ? 0 : num(inv.totalCost);
    const profit = inv.status === 'RETURNED' ? 0 : num(inv.netProfit);

    grossSalesBeforeReturns += subtotal;
    discountsTotal += disc;
    returnsTotal += ret;
    if (inv.status === 'RETURNED') returnedCount += 1;

    netSalesRevenue += netGrand;
    historicalCogs += cost;
    grossProfit += profit;

    const iso = inv.createdAt.toISOString();
    const key = opts.period === 'yearly' ? iso.slice(0, 4) : opts.period === 'monthly' ? iso.slice(0, 7) : iso.slice(0, 10);
    const cur = bucketMap.get(key) || { bucket: key, label: key, revenue: 0, cost: 0, profit: 0, invoiceCount: 0 };
    cur.revenue += netGrand;
    cur.cost += cost;
    cur.profit += profit;
    cur.invoiceCount += 1;
    bucketMap.set(key, cur);

    if (inv.status !== 'RETURNED') {
      for (const it of inv.items) {
        const netQty = Math.max(0, num(it.quantity) - num(it.returnedQuantity));
        const itCost = num(it.unitCostSnapshot) * netQty;
        const p = productProfitMap.get(it.productId) || {
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          qtySold: 0,
          revenue: 0,
          historicalCost: 0,
          historicalProfit: 0,
          marginPercent: 0,
        };
        p.qtySold += netQty;
        p.revenue += num(it.lineTotal);
        p.historicalCost += itCost;
        p.historicalProfit += num(it.lineProfit);
        p.marginPercent = p.revenue > 0 ? Number(((p.historicalProfit / p.revenue) * 100).toFixed(1)) : 0;
        productProfitMap.set(it.productId, p);
      }
    }
  }

  let operatingExpensesTotal = 0;
  let ownerDrawingsInExpenses = 0;
  const expByCat = new Map<string, { category: string; total: number; count: number }>();
  for (const ex of expenses) {
    const amt = num(ex.amount);
    if (ex.category === 'OWNER_DRAW') {
      ownerDrawingsInExpenses += amt;
    } else {
      operatingExpensesTotal += amt;
    }
    const cur = expByCat.get(ex.category) || { category: ex.category, total: 0, count: 0 };
    cur.total += amt;
    cur.count += 1;
    expByCat.set(ex.category, cur);
  }

  const cardFeesTotal = allocations.reduce((s, a) => s + num(a.feeAmount), 0);
  const netOperatingProfit = Number((grossProfit - operatingExpensesTotal - cardFeesTotal).toFixed(2));
  const grossMarginPercent = netSalesRevenue > 0 ? Number(((grossProfit / netSalesRevenue) * 100).toFixed(1)) : 0;
  const netOperatingMarginPercent =
    netSalesRevenue > 0 ? Number(((netOperatingProfit / netSalesRevenue) * 100).toFixed(1)) : 0;
  const purchasesTotalInPeriod = purchases.reduce((s, p) => s + num(p.grandTotal), 0);

  // Slow-moving & ABC Analysis
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recentItems = await prisma.invoiceItem.findMany({
    where: { invoice: { createdAt: { gte: ninetyDaysAgo }, status: { not: 'RETURNED' } } },
    select: { productId: true, quantity: true, returnedQuantity: true, lineTotal: true, invoice: { select: { createdAt: true } } },
  });
  const sold90Map = new Map<string, { qty: number; rev: number; lastAt: Date | null }>();
  for (const ri of recentItems) {
    const cur = sold90Map.get(ri.productId) || { qty: 0, rev: 0, lastAt: null };
    cur.qty += Math.max(0, num(ri.quantity) - num(ri.returnedQuantity));
    cur.rev += num(ri.lineTotal);
    if (!cur.lastAt || ri.invoice.createdAt > cur.lastAt) cur.lastAt = ri.invoice.createdAt;
    sold90Map.set(ri.productId, cur);
  }

  const totalRev90 = Array.from(sold90Map.values()).reduce((s, x) => s + x.rev, 0);
  let cumulativeRev = 0;
  const slowMovingRows = products
    .map((p) => {
      const s90 = sold90Map.get(p.id) || { qty: 0, rev: 0, lastAt: null };
      const qty = num(p.stockQty);
      const stockCostValue = Number((Math.max(0, qty) * num(p.costPrice)).toFixed(2));
      const daysSince = s90.lastAt ? Math.floor((Date.now() - s90.lastAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const healthTag = s90.qty === 0 ? 'dead' : s90.qty <= 3 ? 'slow' : s90.qty >= 15 ? 'fast' : 'normal';
      return {
        productId: p.id,
        productName: p.name,
        category: p.category,
        unit: p.unit,
        stockQty: qty,
        stockCostValue,
        qtySoldLast90d: s90.qty,
        revenueLast90d: Number(s90.rev.toFixed(2)),
        daysSinceLastSale: daysSince,
        healthTag,
        abcClass: 'C' as 'A' | 'B' | 'C',
      };
    })
    .sort((a, b) => b.revenueLast90d - a.revenueLast90d)
    .map((row) => {
      cumulativeRev += row.revenueLast90d;
      const share = totalRev90 > 0 ? cumulativeRev / totalRev90 : 1;
      return {
        ...row,
        abcClass: (row.revenueLast90d <= 0 ? 'C' : share <= 0.7 ? 'A' : share <= 0.9 ? 'B' : 'C') as 'A' | 'B' | 'C',
      };
    });

  // Equity Distribution
  const equityRows = partners.map((partner) => {
    const share = num(partner.profitSharePercent);
    const periodShare = Number(((netOperatingProfit * share) / 100).toFixed(2));
    const periodDrawn = drawings
      .filter((d) => d.partnerId === partner.id && d.type !== 'CAPITAL_ADD')
      .reduce((s, d) => s + num(d.amount), 0);
    return {
      partner: {
        ...partner,
        capitalContribution: num(partner.capitalContribution),
        profitSharePercent: share,
      },
      periodProfitShare: periodShare,
      periodDrawings: Number(periodDrawn.toFixed(2)),
      netPayableBalance: Number((periodShare - periodDrawn).toFixed(2)),
    };
  });

  const inventoryCounts = { available: 0, low: 0, overstock: 0, out: 0 };
  const inventoryRows = products.map((p) => {
    const qty = num(p.stockQty);
    const min = num(p.minStockAlert);
    const max = num(p.maxStockTarget);
    const status = qty <= 0 ? 'out' : qty <= min ? 'low' : qty > max ? 'overstock' : 'available';
    inventoryCounts[status] += 1;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      stockQty: qty,
      minStockAlert: min,
      maxStockTarget: max,
      status,
      stockCostValue: Number((Math.max(0, qty) * num(p.costPrice)).toFixed(2)),
      stockRetailValue: Number((Math.max(0, qty) * num(p.salePrice)).toFixed(2)),
    };
  });

  return {
    totals: {
      revenue: Number(netSalesRevenue.toFixed(2)),
      cost: Number(historicalCogs.toFixed(2)),
      profit: Number(grossProfit.toFixed(2)),
      marginPercent: grossMarginPercent,
      invoiceCount: invoices.length,
      returnedCount,
    },
    profitLoss: {
      grossSalesBeforeReturns: Number(grossSalesBeforeReturns.toFixed(2)),
      returnsTotal: Number(returnsTotal.toFixed(2)),
      discountsTotal: Number(discountsTotal.toFixed(2)),
      netSalesRevenue: Number(netSalesRevenue.toFixed(2)),
      historicalCogs: Number(historicalCogs.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossMarginPercent,
      cardFeesTotal: Number(cardFeesTotal.toFixed(2)),
      operatingExpensesTotal: Number(operatingExpensesTotal.toFixed(2)),
      ownerDrawingsInExpenses: Number(ownerDrawingsInExpenses.toFixed(2)),
      netOperatingProfit,
      netOperatingMarginPercent,
      expensesByCategory: Array.from(expByCat.values()).map((e) => ({
        ...e,
        percent:
          operatingExpensesTotal + ownerDrawingsInExpenses > 0
            ? Number(((e.total / (operatingExpensesTotal + ownerDrawingsInExpenses)) * 100).toFixed(1))
            : 0,
      })),
      purchasesTotalInPeriod: Number(purchasesTotalInPeriod.toFixed(2)),
    },
    periodSeries: Array.from(bucketMap.values()),
    productProfitRows: Array.from(productProfitMap.values()).sort((a, b) => b.historicalProfit - a.historicalProfit),
    inventoryReport: { counts: inventoryCounts, rows: inventoryRows },
    slowMovingReport: {
      deadStockCount: slowMovingRows.filter((r) => r.healthTag === 'dead').length,
      slowStockCount: slowMovingRows.filter((r) => r.healthTag === 'slow').length,
      tiedUpCapital: Number(
        slowMovingRows
          .filter((r) => r.healthTag === 'dead' || r.healthTag === 'slow')
          .reduce((s, r) => s + r.stockCostValue, 0)
          .toFixed(2)
      ),
      rows: slowMovingRows,
    },
    equityDistribution: {
      totalSharePercentConfigured: partners.reduce((s, p) => s + num(p.profitSharePercent), 0),
      netDistributableProfit: netOperatingProfit,
      rows: equityRows,
      drawingsInPeriod: drawings.map((d) => ({ ...d, amount: num(d.amount) })),
    },
  };
}
