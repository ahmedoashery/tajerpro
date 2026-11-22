import type {
  CustomReportConfig,
  CustomReportTabularResult,
  Customer,
  EquityDrawing,
  EquityPartner,
  EquityPartnerDistributionRow,
  ExpenseCategory,
  Invoice,
  PaymentMethod,
  PaymentTransaction,
  PeakDayBucket,
  PeakHourBucket,
  PeakTimeAnalytics,
  PeriodComparisonDelta,
  Product,
  ProfitLossReport,
  PurchaseOrder,
  ReportsPayload,
  SlowMovingProductRow,
  StoreActivityId,
  StoreExpense,
  Supplier,
  TreasuryAccount,
} from '../../shared/types.ts';
import { roundMoney } from '../security/requestValidation.ts';

export interface ReportDataSources {
  getInvoices: () => Invoice[];
  getAllProducts: () => Product[];
  getExpenses: () => StoreExpense[];
  getPurchases: () => PurchaseOrder[];
  getTransactions: () => PaymentTransaction[];
  getCustomers: () => Customer[];
  getSuppliers: () => Supplier[];
  getTreasuries: () => TreasuryAccount[];
  getEquityPartners: () => EquityPartner[];
  getEquityDrawings: () => EquityDrawing[];
}

const MONTH_NAMES_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const PAYMENT_AR: Record<PaymentMethod, string> = {
  cash: 'نقدي (كاش)',
  instapay: 'إنستا باي',
  vodafone_cash: 'محفظة كاش',
  card: 'بطاقة / فيزا',
  credit: 'آجل (ذمم)',
  split: 'دفع مقسم',
};

const EXPENSE_CAT_AR: Record<ExpenseCategory, string> = {
  rent: 'إيجار',
  utilities: 'كهرباء ومياه وإنترنت',
  salaries: 'رواتب ومكافآت',
  shipping: 'نقل وشحن',
  maintenance: 'صيانة',
  taxes: 'ضرائب وتراخيص',
  owner_draw: 'مسحوبات مالك',
  misc: 'نثرية',
};

/**
 * ReportService computes all accounting-accurate reports:
 * - Period Sales & Historical Margin
 * - P&L Waterfall (Gross -> Returns -> Net Sales -> Historical COGS -> Gross Profit -> Fees & OpEx -> Net Operating Profit)
 * - Partner Equity Shares & Drawings Settlement with penny-exact rounding reconciliation
 * - Slow-Moving / Dead Stock & ABC Inventory Turnover
 * - Flexible Custom Report Query Engine
 */
export class ReportService {
  private readonly sources: ReportDataSources;

  constructor(sources: ReportDataSources) {
    this.sources = sources;
  }

  public buildReportsPayload(params: {
    period: 'daily' | 'monthly' | 'yearly';
    activityFilter: StoreActivityId | 'all';
    fromDate?: string;
    toDate?: string;
  }): ReportsPayload {
    const allInvoices = this.sources.getInvoices();
    const from = params.fromDate ? `${params.fromDate}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
    const to = params.toDate ? `${params.toDate}T23:59:59.999Z` : '2999-12-31T23:59:59.999Z';

    const inRange = allInvoices.filter((inv) => {
      const matchActivity = params.activityFilter === 'all' || inv.activityId === params.activityFilter;
      const matchDate = inv.createdAt >= from && inv.createdAt <= to;
      return matchActivity && matchDate;
    });

    const completed = inRange.filter((inv) => inv.status === 'completed' || inv.status === 'partial_returned');
    const returnedInvoices = inRange.filter((inv) => inv.status === 'returned');
    const returnedCount = inRange.filter((inv) => inv.status === 'returned' || inv.status === 'partial_returned').length;

    const revenue = roundMoney(completed.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
    const cost = roundMoney(completed.reduce((s, i) => s + Number(i.totalCostAtSale || 0), 0));
    const profit = roundMoney(completed.reduce((s, i) => s + Number(i.totalProfit || 0), 0));
    const marginPercent = revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : 0;

    // 1) Period Time Series
    const bucketMap = new Map<
      string,
      { bucket: string; label: string; revenue: number; cost: number; profit: number; invoiceCount: number }
    >();

    for (const inv of completed) {
      const dt = new Date(inv.createdAt);
      let bucket = '';
      let label = '';
      if (params.period === 'daily') {
        bucket = inv.createdAt.slice(0, 10);
        label = dt.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });
      } else if (params.period === 'monthly') {
        bucket = inv.createdAt.slice(0, 7);
        label = `${MONTH_NAMES_AR[dt.getMonth()]} ${dt.getFullYear()}`;
      } else {
        bucket = String(dt.getFullYear());
        label = `سنة ${dt.getFullYear()}`;
      }

      const cur = bucketMap.get(bucket) || { bucket, label, revenue: 0, cost: 0, profit: 0, invoiceCount: 0 };
      cur.revenue = roundMoney(cur.revenue + inv.grandTotal);
      cur.cost = roundMoney(cur.cost + inv.totalCostAtSale);
      cur.profit = roundMoney(cur.profit + inv.totalProfit);
      cur.invoiceCount += 1;
      bucketMap.set(bucket, cur);
    }

    const periodSeries = Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

    // 2) Per-Product Historical Profit (reconciled with invoice-level discounts & partial returns)
    const allProducts = this.sources.getAllProducts();
    const productById = new Map(allProducts.map((p) => [p.id, p]));
    const prodAgg = new Map<
      string,
      {
        productId: string;
        productName: string;
        activityId: StoreActivityId;
        qtySold: number;
        revenue: number;
        historicalCost: number;
        historicalProfit: number;
        priceSignatures: Set<string>;
      }
    >();

    for (const inv of completed) {
      const activeItems = inv.items
        .map((item) => {
          const activeQty = Number(Math.max(0, item.quantity - Number(item.returnedQuantity || 0)).toFixed(3));
          const activeGrossLine =
            item.quantity > 0 ? roundMoney(item.lineTotal * (activeQty / item.quantity)) : 0;
          return { item, activeQty, activeGrossLine };
        })
        .filter((x) => x.activeQty > 0.0001);

      const grossActiveSum = activeItems.reduce((s, x) => s + x.activeGrossLine, 0);
      let allocatedRevSum = 0;
      let allocatedCostSum = 0;

      activeItems.forEach((entry, idx) => {
        const { item, activeQty, activeGrossLine } = entry;
        const isLast = idx === activeItems.length - 1;
        const itemRev = isLast
          ? roundMoney(inv.grandTotal - allocatedRevSum)
          : grossActiveSum > 0
            ? roundMoney(inv.grandTotal * (activeGrossLine / grossActiveSum))
            : 0;
        const itemCost = isLast
          ? roundMoney(inv.totalCostAtSale - allocatedCostSum)
          : roundMoney(item.unitCostAtSale * activeQty);
        allocatedRevSum = roundMoney(allocatedRevSum + itemRev);
        allocatedCostSum = roundMoney(allocatedCostSum + itemCost);
        const itemProfit = roundMoney(itemRev - itemCost);

        const cur = prodAgg.get(item.productId) || {
          productId: item.productId,
          productName: item.productName,
          activityId: item.activityId,
          qtySold: 0,
          revenue: 0,
          historicalCost: 0,
          historicalProfit: 0,
          priceSignatures: new Set<string>(),
        };
        cur.qtySold = Number((cur.qtySold + activeQty).toFixed(3));
        cur.revenue = roundMoney(cur.revenue + itemRev);
        cur.historicalCost = roundMoney(cur.historicalCost + itemCost);
        cur.historicalProfit = roundMoney(cur.historicalProfit + itemProfit);
        cur.priceSignatures.add(`${item.unitCostAtSale}-${item.unitSalePrice}`);
        prodAgg.set(item.productId, cur);
      });
    }

    const productProfitRows = Array.from(prodAgg.values())
      .map((row) => {
        const liveProd = productById.get(row.productId);
        return {
          productId: row.productId,
          productName: row.productName,
          activityId: row.activityId,
          qtySold: row.qtySold,
          revenue: row.revenue,
          historicalCost: row.historicalCost,
          historicalProfit: row.historicalProfit,
          marginPercent: row.revenue > 0 ? Number(((row.historicalProfit / row.revenue) * 100).toFixed(1)) : 0,
          priceBatchCount: row.priceSignatures.size,
          latestSalePrice: liveProd?.currentSalePrice ?? 0,
          latestCostPrice: liveProd?.currentCostPrice ?? 0,
        };
      })
      .sort((a, b) => b.historicalProfit - a.historicalProfit);

    // 3) Inventory Health
    const filteredProds =
      params.activityFilter === 'all'
        ? allProducts
        : allProducts.filter((p) => p.activityId === params.activityFilter);

    const counts = { available: 0, low: 0, overstock: 0, out: 0 };
    const invRows = filteredProds.map((p) => {
      let status: 'available' | 'low' | 'overstock' | 'out' = 'available';
      if (p.stockQty <= 0) {
        status = 'out';
        counts.out += 1;
      } else if (p.stockQty <= p.minStockAlert) {
        status = 'low';
        counts.low += 1;
      } else if (p.stockQty > p.maxStockLimit) {
        status = 'overstock';
        counts.overstock += 1;
      } else {
        status = 'available';
        counts.available += 1;
      }
      return {
        product: p,
        status,
        stockValueAtCost: roundMoney(p.stockQty * p.currentCostPrice),
        stockValueAtSale: roundMoney(p.stockQty * p.currentSalePrice),
      };
    });

    // 4) Expenses, Fees, Purchases & Accurate P&L Waterfall
    const returnsTotal = roundMoney(
      inRange.reduce((s, i) => {
        if (i.status === 'returned') {
          const retAmt = Number(i.returnedTotal || 0) > 0 ? Number(i.returnedTotal) : Number(i.grandTotal || 0);
          return s + retAmt;
        }
        if (i.status === 'partial_returned') {
          return s + Number(i.returnedTotal || 0);
        }
        return s;
      }, 0)
    );
    const grossSalesBeforeReturns = roundMoney(revenue + returnsTotal);
    const totalDiscountGiven = roundMoney(completed.reduce((s, i) => s + Number(i.discountTotal || 0), 0));
    const avgInvoiceValue = completed.length > 0 ? roundMoney(revenue / completed.length) : 0;

    const allExpenses = this.sources.getExpenses();
    const periodExpenses = allExpenses.filter((ex) => {
      const day = ex.createdAt.slice(0, 10);
      if (params.fromDate && day < params.fromDate) return false;
      if (params.toDate && day > params.toDate) return false;
      return true;
    });

    const ownerDrawingsInExpenses = roundMoney(
      periodExpenses.filter((e) => e.category === 'owner_draw').reduce((s, e) => s + Number(e.amount || 0), 0)
    );
    const operatingOnlyExpenses = roundMoney(
      periodExpenses.filter((e) => e.category !== 'owner_draw').reduce((s, e) => s + Number(e.amount || 0), 0)
    );
    const totalAllExpenses = roundMoney(operatingOnlyExpenses + ownerDrawingsInExpenses);

    // Gateway / Card processing fees in range
    const completedIds = new Set(completed.map((i) => i.id));
    const periodTransactions = this.sources.getTransactions().filter((tx) => {
      if (tx.status === 'refunded') return false;
      const day = tx.createdAt.slice(0, 10);
      if (params.fromDate && day < params.fromDate) return false;
      if (params.toDate && day > params.toDate) return false;
      if (params.activityFilter !== 'all' && tx.invoiceId && !completedIds.has(tx.invoiceId)) return false;
      return true;
    });
    const cardFeesTotal = roundMoney(periodTransactions.reduce((s, tx) => s + Number(tx.feeAmount || 0), 0));

    // Net Operating Profit excludes owner drawings (which are equity distributions, not operating loss),
    // while executiveSummary also exposes totalAllExpenses for backward consistency.
    const netOperatingProfit = roundMoney(profit - operatingOnlyExpenses - cardFeesTotal);
    const netOperatingMarginPercent =
      revenue > 0 ? Number(((netOperatingProfit / revenue) * 100).toFixed(1)) : 0;

    const netIncomeAfterExpenses = roundMoney(profit - totalAllExpenses - cardFeesTotal);
    const netMarginPercent = revenue > 0 ? Number(((netIncomeAfterExpenses / revenue) * 100).toFixed(1)) : 0;

    const expCatMap = new Map<ExpenseCategory, { total: number; count: number }>();
    for (const ex of periodExpenses) {
      const cur = expCatMap.get(ex.category) || { total: 0, count: 0 };
      cur.total = roundMoney(cur.total + Number(ex.amount || 0));
      cur.count += 1;
      expCatMap.set(ex.category, cur);
    }
    const expensesByCategory = Array.from(expCatMap.entries())
      .map(([category, v]) => ({
        category,
        total: v.total,
        count: v.count,
        percent: totalAllExpenses > 0 ? Number(((v.total / totalAllExpenses) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const periodPurchases = this.sources.getPurchases().filter((po) => {
      if (params.activityFilter !== 'all' && po.activityId !== params.activityFilter) return false;
      const day = po.createdAt.slice(0, 10);
      if (params.fromDate && day < params.fromDate) return false;
      if (params.toDate && day > params.toDate) return false;
      return true;
    });
    const purchasesTotalInPeriod = roundMoney(periodPurchases.reduce((s, p) => s + Number(p.grandTotal || 0), 0));
    const cashCollectedInPeriod = roundMoney(
      completed.reduce((s, inv) => {
        const origTotal = Number(inv.grandTotal || 0) + Number(inv.returnedTotal || 0);
        const scale = origTotal > 0 ? Number(inv.grandTotal || 0) / origTotal : 1;
        if (inv.allocations && inv.allocations.length > 0) {
          return (
            s +
            inv.allocations
              .filter((a) => a.method !== 'credit')
              .reduce((alSum, a) => alSum + Number(a.amount || 0) * scale, 0)
          );
        }
        return inv.paymentMethod === 'credit' ? s : s + Number(inv.grandTotal || 0);
      }, 0)
    );

    const profitLoss: ProfitLossReport = {
      grossSalesBeforeReturns,
      returnsTotal,
      discountsTotal: totalDiscountGiven,
      netSalesRevenue: revenue,
      historicalCogs: cost,
      grossProfit: profit,
      grossMarginPercent: marginPercent,
      cardFeesTotal,
      operatingExpensesTotal: operatingOnlyExpenses,
      ownerDrawingsInExpenses,
      netOperatingProfit,
      netOperatingMarginPercent,
      expensesByCategory,
      purchasesTotalInPeriod,
      cashCollectedInPeriod,
    };

    // 5) Payment Method, Activity, Cashier, Top Customers
    const payMap = new Map<PaymentMethod, { total: number; count: number }>();
    for (const inv of completed) {
      const origTotal = Number(inv.grandTotal || 0) + Number(inv.returnedTotal || 0);
      const scale = origTotal > 0 ? Number(inv.grandTotal || 0) / origTotal : 1;
      if (inv.allocations && inv.allocations.length > 0) {
        const seenMethods = new Set<PaymentMethod>();
        for (const al of inv.allocations) {
          const cur = payMap.get(al.method) || { total: 0, count: 0 };
          cur.total = roundMoney(cur.total + Number(al.amount || 0) * scale);
          if (!seenMethods.has(al.method)) {
            cur.count += 1;
            seenMethods.add(al.method);
          }
          payMap.set(al.method, cur);
        }
      } else {
        const cur = payMap.get(inv.paymentMethod) || { total: 0, count: 0 };
        cur.total = roundMoney(cur.total + inv.grandTotal);
        cur.count += 1;
        payMap.set(inv.paymentMethod, cur);
      }
    }
    const paySum = Array.from(payMap.values()).reduce((s, v) => s + v.total, 0);
    const byPaymentMethod = Array.from(payMap.entries())
      .map(([method, v]) => ({
        method,
        total: v.total,
        count: v.count,
        percent: paySum > 0 ? Number(((v.total / paySum) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const actMap = new Map<StoreActivityId, { revenue: number; cost: number; profit: number; invoiceCount: number }>();
    for (const inv of completed) {
      const cur = actMap.get(inv.activityId) || { revenue: 0, cost: 0, profit: 0, invoiceCount: 0 };
      cur.revenue = roundMoney(cur.revenue + inv.grandTotal);
      cur.cost = roundMoney(cur.cost + inv.totalCostAtSale);
      cur.profit = roundMoney(cur.profit + inv.totalProfit);
      cur.invoiceCount += 1;
      actMap.set(inv.activityId, cur);
    }
    const byActivity = Array.from(actMap.entries())
      .map(([activityId, v]) => ({
        activityId,
        ...v,
        percent: revenue > 0 ? Number(((v.revenue / revenue) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const cashierMap = new Map<string, { revenue: number; profit: number; invoiceCount: number }>();
    for (const inv of completed) {
      const cname = inv.cashierName || 'غير محدد';
      const cur = cashierMap.get(cname) || { revenue: 0, profit: 0, invoiceCount: 0 };
      cur.revenue = roundMoney(cur.revenue + inv.grandTotal);
      cur.profit = roundMoney(cur.profit + inv.totalProfit);
      cur.invoiceCount += 1;
      cashierMap.set(cname, cur);
    }
    const byCashier = Array.from(cashierMap.entries())
      .map(([cashierName, v]) => ({
        cashierName,
        revenue: v.revenue,
        profit: v.profit,
        invoiceCount: v.invoiceCount,
        avgBasket: v.invoiceCount > 0 ? roundMoney(v.revenue / v.invoiceCount) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const custSpendMap = new Map<string, { customerName: string; totalSpent: number; invoiceCount: number }>();
    for (const inv of completed) {
      if (!inv.customerId) continue;
      const cur = custSpendMap.get(inv.customerId) || {
        customerName: inv.customerName,
        totalSpent: 0,
        invoiceCount: 0,
      };
      cur.totalSpent = roundMoney(cur.totalSpent + inv.grandTotal);
      cur.invoiceCount += 1;
      custSpendMap.set(inv.customerId, cur);
    }
    const topCustomers = Array.from(custSpendMap.entries())
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 6);

    const allCustomers = this.sources.getCustomers();
    const allSuppliers = this.sources.getSuppliers();
    const allTreasuries = this.sources.getTreasuries();
    const inventoryCostValue = roundMoney(invRows.reduce((s, r) => s + Math.max(0, r.stockValueAtCost), 0));
    const inventoryRetailValue = roundMoney(invRows.reduce((s, r) => s + Math.max(0, r.stockValueAtSale), 0));

    // 6) Slow-Moving / Dead Stock & ABC Inventory Turnover
    const slowMovingReport = this.buildSlowMovingReport(allInvoices, filteredProds);

    // 7) Partner Equity Profit Distribution & Drawings Reconciliation
    const equityDistribution = this.buildEquityDistribution(
      allInvoices,
      allExpenses,
      netOperatingProfit,
      params.fromDate,
      params.toDate
    );

    // 8) Period-over-Period Comparison vs equal preceding period
    const periodComparison = this.buildPeriodComparison(
      allInvoices,
      allExpenses,
      params.activityFilter,
      params.fromDate,
      params.toDate
    );

    return {
      period: params.period,
      activityFilter: params.activityFilter,
      fromDate: params.fromDate || '',
      toDate: params.toDate || '',
      totals: {
        revenue,
        cost,
        profit,
        marginPercent,
        invoiceCount: completed.length,
        returnedCount,
      },
      periodSeries,
      productProfitRows,
      inventoryReport: {
        counts,
        rows: invRows,
      },
      profitLoss,
      periodComparison,
      slowMovingReport,
      equityDistribution,
      executiveSummary: {
        grossSalesBeforeReturns,
        returnsTotal,
        avgInvoiceValue,
        totalDiscountGiven,
        operatingExpensesTotal: totalAllExpenses,
        netIncomeAfterExpenses,
        netMarginPercent,
        expensesByCategory,
        byPaymentMethod,
        byActivity,
        byCashier,
        topCustomers,
        businessHealth: {
          customerReceivables: roundMoney(allCustomers.reduce((s, c) => s + Number(c.balanceDue || 0), 0)),
          supplierPayables: roundMoney(allSuppliers.reduce((s, sp) => s + Number(sp.balanceDue || 0), 0)),
          treasuriesTotal: roundMoney(allTreasuries.reduce((s, t) => s + Number(t.currentBalance || 0), 0)),
          inventoryCostValue,
          inventoryRetailValue,
          lowStockCount: counts.low,
          outOfStockCount: counts.out,
          overLimitCustomersCount: allCustomers.filter(
            (c) => Number(c.creditLimit || 0) > 0 && Number(c.balanceDue || 0) >= Number(c.creditLimit || 0) * 0.85
          ).length,
          suppliersWithDebtCount: allSuppliers.filter((sp) => Number(sp.balanceDue || 0) > 0).length,
        },
      },
      peakTimeAnalytics: this.buildPeakTimeAnalytics(completed),
    };
  }

  private buildPeakTimeAnalytics(completed: Invoice[]): PeakTimeAnalytics {
    const DAY_NAMES_AR = [
      'الأحد',
      'الإثنين',
      'الثلاثاء',
      'الأربعاء',
      'الخميس',
      'الجمعة',
      'السبت',
    ];
    const hourBuckets: PeakHourBucket[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2, '0')}:00`,
      invoiceCount: 0,
      revenue: 0,
    }));
    const dayBuckets: PeakDayBucket[] = DAY_NAMES_AR.map((dayNameAr, dayIndex) => ({
      dayIndex,
      dayNameAr,
      invoiceCount: 0,
      revenue: 0,
    }));

    for (const inv of completed) {
      const dt = new Date(inv.createdAt);
      if (Number.isNaN(dt.getTime())) continue;
      const hr = dt.getHours();
      const day = dt.getDay();
      if (hourBuckets[hr]) {
        hourBuckets[hr].invoiceCount += 1;
        hourBuckets[hr].revenue = roundMoney(hourBuckets[hr].revenue + Number(inv.grandTotal || 0));
      }
      if (dayBuckets[day]) {
        dayBuckets[day].invoiceCount += 1;
        dayBuckets[day].revenue = roundMoney(dayBuckets[day].revenue + Number(inv.grandTotal || 0));
      }
    }

    const bestHour = [...hourBuckets].sort((a, b) => b.revenue - a.revenue || b.invoiceCount - a.invoiceCount)[0];
    const bestDay = [...dayBuckets].sort((a, b) => b.revenue - a.revenue || b.invoiceCount - a.invoiceCount)[0];

    return {
      byHour: hourBuckets,
      byDayOfWeek: dayBuckets,
      peakHourLabel:
        bestHour && bestHour.invoiceCount > 0 ? `${bestHour.label} (${bestHour.invoiceCount} فاتورة)` : '—',
      peakDayLabel:
        bestDay && bestDay.invoiceCount > 0 ? `${bestDay.dayNameAr} (${bestDay.invoiceCount} فاتورة)` : '—',
    };
  }

  private buildSlowMovingReport(
    allInvoices: Invoice[],
    filteredProds: Product[]
  ): NonNullable<ReportsPayload['slowMovingReport']> {
    const nowMs = Date.now();
    const ninetyDaysAgoIso = new Date(nowMs - 90 * 24 * 3600 * 1000).toISOString();

    const lastSoldMap = new Map<string, string>();
    const sold90dQtyMap = new Map<string, number>();
    const sold90dRevMap = new Map<string, number>();

    for (const inv of allInvoices) {
      if (inv.status !== 'completed' && inv.status !== 'partial_returned') continue;
      for (const item of inv.items) {
        const netQty = Number(Math.max(0, item.quantity - Number(item.returnedQuantity || 0)).toFixed(3));
        if (netQty <= 0.0001) continue;
        const netRatio = item.quantity > 0 ? netQty / item.quantity : 0;
        const prevLast = lastSoldMap.get(item.productId);
        if (!prevLast || inv.createdAt > prevLast) {
          lastSoldMap.set(item.productId, inv.createdAt);
        }
        if (inv.createdAt >= ninetyDaysAgoIso) {
          sold90dQtyMap.set(item.productId, Number(((sold90dQtyMap.get(item.productId) || 0) + netQty).toFixed(3)));
          sold90dRevMap.set(item.productId, roundMoney((sold90dRevMap.get(item.productId) || 0) + item.lineTotal * netRatio));
        }
      }
    }

    // ABC Classification based on 90-day revenue contribution
    const total90dRevenue = Array.from(sold90dRevMap.values()).reduce((s, v) => s + v, 0);
    const sortedForAbc = [...filteredProds].sort(
      (a, b) => (sold90dRevMap.get(b.id) || 0) - (sold90dRevMap.get(a.id) || 0)
    );
    const abcMap = new Map<string, 'A' | 'B' | 'C'>();
    let cumShare = 0;
    for (const p of sortedForAbc) {
      const rev = sold90dRevMap.get(p.id) || 0;
      if (rev <= 0 || total90dRevenue <= 0) {
        abcMap.set(p.id, 'C');
        continue;
      }
      cumShare += rev / total90dRevenue;
      if (cumShare <= 0.8) abcMap.set(p.id, 'A');
      else if (cumShare <= 0.95) abcMap.set(p.id, 'B');
      else abcMap.set(p.id, 'C');
    }

    let deadStockCount = 0;
    let slowStockCount = 0;
    let tiedUpCapital = 0;

    const rows: SlowMovingProductRow[] = filteredProds
      .map((p) => {
        const lastSoldAt = lastSoldMap.get(p.id) || null;
        const daysSinceLastSale = lastSoldAt
          ? Math.max(0, Math.floor((nowMs - new Date(lastSoldAt).getTime()) / (24 * 3600 * 1000)))
          : null;
        const qtySoldLast90d = sold90dQtyMap.get(p.id) || 0;
        const revenueLast90d = sold90dRevMap.get(p.id) || 0;
        const stockCostValue = roundMoney(Math.max(0, p.stockQty) * p.currentCostPrice);
        const stockRetailValue = roundMoney(Math.max(0, p.stockQty) * p.currentSalePrice);
        const turnoverRate =
          p.stockQty > 0 ? Number((qtySoldLast90d / Math.max(1, p.stockQty)).toFixed(2)) : qtySoldLast90d > 0 ? 99 : 0;

        let healthTag: SlowMovingProductRow['healthTag'] = 'normal';
        if (p.stockQty > 0 && (daysSinceLastSale === null || daysSinceLastSale >= 45 || qtySoldLast90d === 0)) {
          healthTag = 'dead';
          deadStockCount += 1;
          tiedUpCapital = roundMoney(tiedUpCapital + stockCostValue);
        } else if (p.stockQty > 0 && ((daysSinceLastSale !== null && daysSinceLastSale >= 21) || turnoverRate < 0.3)) {
          healthTag = 'slow';
          slowStockCount += 1;
          tiedUpCapital = roundMoney(tiedUpCapital + stockCostValue);
        } else if (turnoverRate >= 1.2 || abcMap.get(p.id) === 'A') {
          healthTag = 'fast';
        }

        return {
          productId: p.id,
          productName: p.name,
          category: p.category,
          activityId: p.activityId,
          unit: p.unit,
          stockQty: p.stockQty,
          stockCostValue,
          stockRetailValue,
          qtySoldLast90d,
          revenueLast90d,
          lastSoldAt,
          daysSinceLastSale,
          turnoverRate,
          abcClass: abcMap.get(p.id) || 'C',
          healthTag,
        };
      })
      .sort((a, b) => {
        const rank = { dead: 0, slow: 1, normal: 2, fast: 3 };
        if (rank[a.healthTag] !== rank[b.healthTag]) return rank[a.healthTag] - rank[b.healthTag];
        return b.stockCostValue - a.stockCostValue;
      });

    return {
      deadStockCount,
      slowStockCount,
      tiedUpCapital,
      rows,
    };
  }

  private buildEquityDistribution(
    allInvoices: Invoice[],
    allExpenses: StoreExpense[],
    netOperatingProfitInPeriod: number,
    fromDate?: string,
    toDate?: string
  ): NonNullable<ReportsPayload['equityDistribution']> {
    const partners = this.sources.getEquityPartners();
    const drawings = this.sources.getEquityDrawings();
    const periodDrawingsList = drawings.filter((d) => {
      const day = d.createdAt.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });

    // Calculate all-time net operating profit across store for accurate net payable balance
    const allTimeGrossProfit = allInvoices
      .filter((i) => i.status === 'completed' || i.status === 'partial_returned')
      .reduce((s, i) => s + Number(i.totalProfit || 0), 0);
    const allTimeOpEx = allExpenses
      .filter((e) => e.category !== 'owner_draw')
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const allTimeFees = this.sources
      .getTransactions()
      .filter((t) => t.status !== 'refunded')
      .reduce((s, t) => s + Number(t.feeAmount || 0), 0);
    const allTimeNetProfit = roundMoney(allTimeGrossProfit - allTimeOpEx - allTimeFees);

    const activePartners = partners.filter((p) => p.active);
    const totalSharePercentConfigured = roundMoney(
      activePartners.reduce((s, p) => s + p.profitSharePercent, 0)
    );

    const periodTargetPool = roundMoney((netOperatingProfitInPeriod * totalSharePercentConfigured) / 100);
    const allTimeTargetPool = roundMoney((allTimeNetProfit * totalSharePercentConfigured) / 100);

    let allocatedPeriod = 0;
    let allocatedAllTime = 0;
    const lastActiveIdx = partners.reduce(
      (last, p, idx) => (p.active && p.profitSharePercent > 0 ? idx : last),
      -1
    );

    const rows: EquityPartnerDistributionRow[] = partners.map((partner, idx) => {
      let periodProfitShare = 0;
      let allTimeProfitShareEstimate = 0;
      if (partner.active && partner.profitSharePercent > 0) {
        if (idx === lastActiveIdx) {
          // Penny-exact reconciliation on final active partner
          periodProfitShare = roundMoney(periodTargetPool - allocatedPeriod);
          allTimeProfitShareEstimate = roundMoney(allTimeTargetPool - allocatedAllTime);
        } else {
          periodProfitShare = roundMoney((netOperatingProfitInPeriod * partner.profitSharePercent) / 100);
          allTimeProfitShareEstimate = roundMoney((allTimeNetProfit * partner.profitSharePercent) / 100);
          allocatedPeriod = roundMoney(allocatedPeriod + periodProfitShare);
          allocatedAllTime = roundMoney(allocatedAllTime + allTimeProfitShareEstimate);
        }
      }

      const periodDrawings = roundMoney(
        periodDrawingsList
          .filter((d) => d.partnerId === partner.id && d.type !== 'capital_add')
          .reduce((s, d) => s + Number(d.amount || 0), 0)
      );
      const allTimeDrawings = roundMoney(
        drawings
          .filter((d) => d.partnerId === partner.id && d.type !== 'capital_add')
          .reduce((s, d) => s + Number(d.amount || 0), 0)
      );
      const netPayableBalance = roundMoney(allTimeProfitShareEstimate - allTimeDrawings);

      return {
        partner,
        periodProfitShare,
        periodDrawings,
        allTimeProfitShareEstimate,
        allTimeDrawings,
        netPayableBalance,
      };
    });

    return {
      totalSharePercentConfigured,
      netDistributableProfit: netOperatingProfitInPeriod,
      rows,
      drawingsInPeriod: periodDrawingsList,
    };
  }

  public runCustomReportQuery(config: CustomReportConfig): CustomReportTabularResult {
    const from = config.dateFrom ? `${config.dateFrom}T00:00:00.000Z` : '';
    const to = config.dateTo ? `${config.dateTo}T23:59:59.999Z` : '';
    const actFilter = config.activityFilter && config.activityFilter !== 'all' ? config.activityFilter : null;

    type ColSpec = { key: string; label: string; numeric?: boolean; get: (row: Record<string, unknown>) => string | number };

    const catalog: Record<CustomReportConfig['source'], { title: string; cols: ColSpec[]; fetch: () => Array<Record<string, unknown>> }> = {
      sales_invoices: {
        title: 'تقرير الفواتير والمبيعات المخصص',
        cols: [
          { key: 'invoiceNumber', label: 'رقم الفاتورة', get: (r) => String(r.invoiceNumber) },
          { key: 'createdAt', label: 'التاريخ', get: (r) => String(r.createdAt).slice(0, 16).replace('T', ' ') },
          { key: 'customerName', label: 'العميل', get: (r) => String(r.customerName) },
          { key: 'cashierName', label: 'الكاشير', get: (r) => String(r.cashierName) },
          { key: 'paymentMethod', label: 'طريقة الدفع', get: (r) => PAYMENT_AR[r.paymentMethod as PaymentMethod] || String(r.paymentMethod) },
          { key: 'subtotal', label: 'قبل الخصم', numeric: true, get: (r) => Number(r.subtotal || 0) },
          { key: 'discountTotal', label: 'الخصم', numeric: true, get: (r) => Number(r.discountTotal || 0) },
          { key: 'grandTotal', label: 'الصافي', numeric: true, get: (r) => Number(r.grandTotal || 0) },
          { key: 'totalCostAtSale', label: 'التكلفة التاريخية', numeric: true, get: (r) => Number(r.totalCostAtSale || 0) },
          { key: 'totalProfit', label: 'الربح', numeric: true, get: (r) => Number(r.totalProfit || 0) },
          {
            key: 'status',
            label: 'الحالة',
            get: (r) => (r.status === 'returned' ? 'مرتجع' : r.status === 'partial_returned' ? 'مرتجع جزئي' : 'مكتملة'),
          },
        ],
        fetch: () =>
          this.sources
            .getInvoices()
            .filter((i) => (!actFilter || i.activityId === actFilter) && (!from || i.createdAt >= from) && (!to || i.createdAt <= to))
            .map((i) => ({ ...i })),
      },
      product_profits: {
        title: 'تقرير أرباح الأصناف المخصص',
        cols: [
          { key: 'productName', label: 'الصنف', get: (r) => String(r.productName) },
          { key: 'activityId', label: 'النشاط', get: (r) => String(r.activityId) },
          { key: 'qtySold', label: 'الكمية المباعة', numeric: true, get: (r) => Number(r.qtySold || 0) },
          { key: 'revenue', label: 'إجمالي المبيعات', numeric: true, get: (r) => Number(r.revenue || 0) },
          { key: 'historicalCost', label: 'التكلفة التاريخية', numeric: true, get: (r) => Number(r.historicalCost || 0) },
          { key: 'historicalProfit', label: 'صافي الربح', numeric: true, get: (r) => Number(r.historicalProfit || 0) },
          { key: 'marginPercent', label: 'الهامش %', numeric: true, get: (r) => Number(r.marginPercent || 0) },
        ],
        fetch: () =>
          this.buildReportsPayload({
            period: 'daily',
            activityFilter: actFilter || 'all',
            fromDate: config.dateFrom,
            toDate: config.dateTo,
          }).productProfitRows.map((p) => ({ ...p })),
      },
      inventory_stock: {
        title: 'تقرير المخزون والتسعير المخصص',
        cols: [
          { key: 'name', label: 'اسم الصنف', get: (r) => String(r.name) },
          { key: 'barcode', label: 'الباركود', get: (r) => String(r.barcode) },
          { key: 'category', label: 'التصنيف', get: (r) => String(r.category) },
          { key: 'unit', label: 'الوحدة', get: (r) => String(r.unit) },
          { key: 'stockQty', label: 'الكمية', numeric: true, get: (r) => Number(r.stockQty || 0) },
          { key: 'currentCostPrice', label: 'التكلفة', numeric: true, get: (r) => Number(r.currentCostPrice || 0) },
          { key: 'currentSalePrice', label: 'سعر القطاعي', numeric: true, get: (r) => Number(r.currentSalePrice || 0) },
          { key: 'halfWholesalePrice', label: 'سعر نصف جملة', numeric: true, get: (r) => Number(r.halfWholesalePrice || 0) },
          { key: 'wholesalePrice', label: 'سعر الجملة', numeric: true, get: (r) => Number(r.wholesalePrice || 0) },
          { key: 'stockValueCost', label: 'قيمة المخزون بالتكلفة', numeric: true, get: (r) => Number(r.stockValueCost || 0) },
        ],
        fetch: () =>
          this.sources
            .getAllProducts()
            .filter((p) => !actFilter || p.activityId === actFilter)
            .map((p) => ({ ...p, stockValueCost: roundMoney(Math.max(0, p.stockQty) * p.currentCostPrice) })),
      },
      expenses: {
        title: 'تقرير المصروفات التشغيلية المخصص',
        cols: [
          { key: 'createdAt', label: 'التاريخ', get: (r) => String(r.createdAt).slice(0, 16).replace('T', ' ') },
          { key: 'title', label: 'البند / البيان', get: (r) => String(r.title) },
          { key: 'category', label: 'التصنيف', get: (r) => EXPENSE_CAT_AR[r.category as ExpenseCategory] || String(r.category) },
          { key: 'treasuryName', label: 'الخزينة', get: (r) => String(r.treasuryName || '—') },
          { key: 'actorName', label: 'المسؤول', get: (r) => String(r.actorName) },
          { key: 'amount', label: 'المبلغ (ج.م)', numeric: true, get: (r) => Number(r.amount || 0) },
        ],
        fetch: () =>
          this.sources
            .getExpenses()
            .filter((e) => (!from || e.createdAt >= from) && (!to || e.createdAt <= to))
            .map((e) => ({ ...e })),
      },
      customers_ar: {
        title: 'تقرير حسابات العملاء والذمم',
        cols: [
          { key: 'name', label: 'اسم العميل', get: (r) => String(r.name) },
          { key: 'phone', label: 'الهاتف', get: (r) => String(r.phone) },
          { key: 'balanceDue', label: 'الرصيد المستحق', numeric: true, get: (r) => Number(r.balanceDue || 0) },
          { key: 'totalPurchases', label: 'إجمالي المسحوبات', numeric: true, get: (r) => Number(r.totalPurchases || 0) },
          { key: 'creditLimit', label: 'الحد الائتماني', numeric: true, get: (r) => Number(r.creditLimit || 0) },
        ],
        fetch: () => this.sources.getCustomers().map((c) => ({ ...c })),
      },
      suppliers_ap: {
        title: 'تقرير حسابات الموردين والمستحقات',
        cols: [
          { key: 'name', label: 'المورد', get: (r) => String(r.name) },
          { key: 'phone', label: 'الهاتف', get: (r) => String(r.phone) },
          { key: 'category', label: 'التخصص', get: (r) => String(r.category) },
          { key: 'balanceDue', label: 'المستحق للمورد', numeric: true, get: (r) => Number(r.balanceDue || 0) },
        ],
        fetch: () => this.sources.getSuppliers().map((s) => ({ ...s })),
      },
      purchases: {
        title: 'تقرير فواتير المشتريات والتوريد',
        cols: [
          { key: 'purchaseNumber', label: 'رقم التوريد', get: (r) => String(r.purchaseNumber) },
          { key: 'createdAt', label: 'التاريخ', get: (r) => String(r.createdAt).slice(0, 16).replace('T', ' ') },
          { key: 'supplierName', label: 'المورد', get: (r) => String(r.supplierName) },
          { key: 'grandTotal', label: 'إجمالي الفاتورة', numeric: true, get: (r) => Number(r.grandTotal || 0) },
          { key: 'paidAmount', label: 'المدفوع', numeric: true, get: (r) => Number(r.paidAmount || 0) },
          { key: 'remainingDebt', label: 'المتبقي آجل', numeric: true, get: (r) => Number(r.remainingDebt || 0) },
        ],
        fetch: () =>
          this.sources
            .getPurchases()
            .filter((p) => (!actFilter || p.activityId === actFilter) && (!from || p.createdAt >= from) && (!to || p.createdAt <= to))
            .map((p) => ({ ...p })),
      },
      equity_partners: {
        title: 'تقرير حصص الشركاء وتوزيع الأرباح',
        cols: [
          { key: 'name', label: 'اسم الشريك', get: (r) => String(r.name) },
          { key: 'roleTitle', label: 'الصفة', get: (r) => String(r.roleTitle) },
          { key: 'capitalContribution', label: 'رأس المال المساهم', numeric: true, get: (r) => Number(r.capitalContribution || 0) },
          { key: 'profitSharePercent', label: 'نسبة الربح %', numeric: true, get: (r) => Number(r.profitSharePercent || 0) },
          { key: 'periodProfitShare', label: 'حصة أرباح الفترة', numeric: true, get: (r) => Number(r.periodProfitShare || 0) },
          { key: 'allTimeDrawings', label: 'المسحوبات', numeric: true, get: (r) => Number(r.allTimeDrawings || 0) },
          { key: 'netPayableBalance', label: 'صافي المستحق للشريك', numeric: true, get: (r) => Number(r.netPayableBalance || 0) },
        ],
        fetch: () => {
          const payload = this.buildReportsPayload({
            period: 'daily',
            activityFilter: actFilter || 'all',
            fromDate: config.dateFrom,
            toDate: config.dateTo,
          });
          return (payload.equityDistribution?.rows || []).map((row) => ({
            ...row.partner,
            periodProfitShare: row.periodProfitShare,
            allTimeDrawings: row.allTimeDrawings,
            netPayableBalance: row.netPayableBalance,
          }));
        },
      },
    };

    const spec = catalog[config.source] || catalog.sales_invoices;
    const selectedCols =
      config.columns.length > 0
        ? spec.cols.filter((c) => config.columns.includes(c.key))
        : spec.cols.slice(0, 6);
    const finalCols = selectedCols.length > 0 ? selectedCols : spec.cols.slice(0, 5);

    let records = spec.fetch();

    // Apply rule filters
    if (config.filters && config.filters.length > 0) {
      records = records.filter((rec) =>
        config.filters!.every((rule) => {
          if (!rule.value.trim()) return true;
          const raw = rec[rule.field];
          const strVal = String(raw ?? '').toLowerCase();
          const target = rule.value.trim().toLowerCase();
          const numVal = Number(raw);
          const numTarget = Number(rule.value);
          switch (rule.operator) {
            case 'contains':
              return strVal.includes(target);
            case 'eq':
              return strVal === target || (Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal === numTarget);
            case 'gt':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal > numTarget;
            case 'gte':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal >= numTarget;
            case 'lt':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal < numTarget;
            case 'lte':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal <= numTarget;
            default:
              return true;
          }
        })
      );
    }

    // Apply sort
    const sortKey = config.sortBy || finalCols[0]?.key;
    if (sortKey) {
      const dir = config.sortDir === 'asc' ? 1 : -1;
      records.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? ''), 'ar') * dir;
      });
    }

    const headers = finalCols.map((c) => c.label);
    const rows = records.map((rec) => finalCols.map((c) => c.get(rec)));

    const totalsRow = finalCols.map((c, idx) => {
      if (idx === 0) return `الإجمالي (${records.length})`;
      if (!c.numeric || c.key === 'marginPercent' || c.key === 'profitSharePercent') return '';
      return roundMoney(records.reduce((s, rec) => s + Number(rec[c.key] || 0), 0));
    });

    return {
      title: config.name.trim() || spec.title,
      subtitle: `${records.length} سجل · ${config.dateFrom || 'كل الفترات'} ← ${config.dateTo || 'الآن'}`,
      headers,
      rows,
      totalsRow,
    };
  }

  private buildPeriodComparison(
    allInvoices: Invoice[],
    allExpenses: StoreExpense[],
    activityFilter: StoreActivityId | 'all',
    fromDate?: string,
    toDate?: string
  ): PeriodComparisonDelta {
    const todayStr = new Date().toISOString().slice(0, 10);
    const curEnd = toDate || todayStr;
    const curStart =
      fromDate || new Date(new Date(`${curEnd}T00:00:00.000Z`).getTime() - 29 * 86400 * 1000).toISOString().slice(0, 10);

    const startMs = new Date(`${curStart}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${curEnd}T00:00:00.000Z`).getTime();
    const spanDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

    const prevEndMs = startMs - 86400000;
    const prevStartMs = prevEndMs - (spanDays - 1) * 86400000;
    const prevFrom = new Date(prevStartMs).toISOString().slice(0, 10);
    const prevTo = new Date(prevEndMs).toISOString().slice(0, 10);

    const filterInvs = (f: string, t: string) =>
      allInvoices.filter((inv) => {
        if (inv.status !== 'completed' && inv.status !== 'partial_returned') return false;
        if (activityFilter !== 'all' && inv.activityId !== activityFilter) return false;
        const day = inv.createdAt.slice(0, 10);
        return day >= f && day <= t;
      });
    const filterExps = (f: string, t: string) =>
      allExpenses.filter((e) => {
        if (e.category === 'owner_draw') return false;
        const day = e.createdAt.slice(0, 10);
        return day >= f && day <= t;
      });

    const curInvs = filterInvs(curStart, curEnd);
    const prevInvs = filterInvs(prevFrom, prevTo);
    const curExps = filterExps(curStart, curEnd);
    const prevExps = filterExps(prevFrom, prevTo);

    const curRev = roundMoney(curInvs.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
    const curProf = roundMoney(curInvs.reduce((s, i) => s + Number(i.totalProfit || 0), 0));
    const curExp = roundMoney(curExps.reduce((s, e) => s + Number(e.amount || 0), 0));
    const curCnt = curInvs.length;

    const prevRev = roundMoney(prevInvs.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
    const prevProf = roundMoney(prevInvs.reduce((s, i) => s + Number(i.totalProfit || 0), 0));
    const prevExp = roundMoney(prevExps.reduce((s, e) => s + Number(e.amount || 0), 0));
    const prevCnt = prevInvs.length;

    const pct = (cur: number, prev: number): number | null => {
      if (Math.abs(prev) < 0.01) {
        return Math.abs(cur) < 0.01 ? null : 100;
      }
      return Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
    };

    return {
      previousRevenue: prevRev,
      revenueDeltaPercent: pct(curRev, prevRev),
      previousProfit: prevProf,
      profitDeltaPercent: pct(curProf, prevProf),
      previousExpenses: prevExp,
      expensesDeltaPercent: pct(curExp, prevExp),
      previousInvoiceCount: prevCnt,
      invoiceCountDeltaPercent: pct(curCnt, prevCnt),
    };
  }
}
