import type {
  AutoReorderSuggestionItem,
  AutoReorderSupplierGroup,
  Customer,
  Invoice,
  OwnerAnomalyAlert,
  Product,
  ProductBatch,
  ShiftClosure,
  Supplier,
} from '../../shared/types.ts';
import { roundMoney } from '../security/requestValidation.ts';

export interface InsightsSources {
  getInvoices: () => Invoice[];
  getProducts: () => Product[];
  getAllProducts: () => Product[];
  getCustomers: () => Customer[];
  getSuppliers: () => Supplier[];
  getExpiringBatches: (withinDays?: number) => ProductBatch[];
  getLastShiftClosure: () => ShiftClosure | null;
}

/**
 * Computes actionable Owner Anomaly Alerts and Supplier-Grouped Auto-Reorder suggestions.
 */
export class AlertsAndReorderService {
  private readonly sources: InsightsSources;

  constructor(sources: InsightsSources) {
    this.sources = sources;
  }

  public getOwnerAlerts(): OwnerAnomalyAlert[] {
    const alerts: OwnerAnomalyAlert[] = [];
    const todayKey = new Date().toISOString().slice(0, 10);
    const last7dIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const invoices = this.sources.getInvoices();
    const activeInvoices = invoices.filter((i) => i.status === 'completed' || i.status === 'partial_returned');
    const customers = this.sources.getCustomers();
    const products = this.sources.getProducts();

    // 1. Overdue credit invoices (dueDate < today)
    const overdueCreditInvoices = activeInvoices.filter((inv) => {
      if (!inv.dueDate) return false;
      const hasCredit =
        inv.paymentMethod === 'credit' ||
        Boolean(inv.allocations?.some((a) => a.method === 'credit' && a.amount > 0));
      if (!hasCredit) return false;
      const cust = inv.customerId ? customers.find((c) => c.id === inv.customerId) : undefined;
      return inv.dueDate < todayKey && (cust ? cust.balanceDue > 0 : true);
    });
    if (overdueCreditInvoices.length > 0) {
      alerts.push({
        id: 'alert-overdue-credit',
        severity: 'danger',
        category: 'credit',
        title: 'فواتير آجلة متجاوزة تاريخ الاستحقاق',
        message: `يوجد ${overdueCreditInvoices.length} فاتورة آجلة تجاوزت موعد السداد المحدد وتحتاج متابعة تحصيل.`,
        actionTab: 'partners_payments',
        actionLabel: 'تحصيل الذمم',
        metricValue: `${overdueCreditInvoices.length} فاتورة`,
      });
    }

    // 2. Expiring or expired batches within 30 days
    const expiringBatches = this.sources.getExpiringBatches(30);
    if (expiringBatches.length > 0) {
      const alreadyExpired = expiringBatches.filter((b) => b.expiryDate && b.expiryDate < todayKey).length;
      alerts.push({
        id: 'alert-expiring-batches',
        severity: alreadyExpired > 0 ? 'danger' : 'warning',
        category: 'expiry',
        title: alreadyExpired > 0 ? 'تشغيلات منتهية الصلاحية بالمخزن' : 'تشغيلات تقترب من انتهاء الصلاحية',
        message:
          alreadyExpired > 0
            ? `${alreadyExpired} تشغيلة منتهية الصلاحية و${expiringBatches.length - alreadyExpired} تنتهي خلال 30 يوماً.`
            : `${expiringBatches.length} تشغيلة تنتهي صلاحيتها خلال 30 يوماً — يفضل عمل عروض تصريف سريعة.`,
        actionTab: 'inventory',
        actionLabel: 'مراجعة التشغيلات',
        metricValue: `${expiringBatches.length} تشغيلة`,
      });
    }

    // 3. Low or Negative Margin Invoices in last 7 days (< 5%)
    const lowMarginInvoices = activeInvoices.filter(
      (i) => i.createdAt >= last7dIso && i.grandTotal > 0 && i.totalProfit / i.grandTotal < 0.05
    );
    if (lowMarginInvoices.length > 0) {
      const negativeCount = lowMarginInvoices.filter((i) => i.totalProfit < 0).length;
      alerts.push({
        id: 'alert-low-margin',
        severity: negativeCount > 0 ? 'danger' : 'warning',
        category: 'margin',
        title: negativeCount > 0 ? 'فواتير مباعة بخسارة' : 'فواتير بهامش ربح منخفض (< 5%)',
        message: `تم رصد ${lowMarginInvoices.length} فاتورة خلال 7 أيام بهامش ربح أقل من 5% (${negativeCount} بالخسارة).`,
        actionTab: 'invoices',
        actionLabel: 'فحص الفواتير',
        metricValue: `${lowMarginInvoices.length} فاتورة`,
      });
    }

    // 4. High manual discounts (> 15% of subtotal) in last 7 days
    const highDiscountInvoices = activeInvoices.filter(
      (i) => i.createdAt >= last7dIso && i.subtotal > 0 && i.discountTotal / i.subtotal > 0.15
    );
    if (highDiscountInvoices.length > 0) {
      alerts.push({
        id: 'alert-high-discount',
        severity: 'warning',
        category: 'discount',
        title: 'خصومات مرتفعة تتجاوز 15%',
        message: `تم منح خصم أعلى من 15% في ${highDiscountInvoices.length} فاتورة خلال آخر 7 أيام.`,
        actionTab: 'invoices',
        actionLabel: 'مراجعة الخصومات',
        metricValue: `${highDiscountInvoices.length} فاتورة`,
      });
    }

    // 5. Shift Closing Cash Variance > 50 EGP
    const lastClosure = this.sources.getLastShiftClosure();
    if (lastClosure && Math.abs(lastClosure.variance) > 50) {
      alerts.push({
        id: 'alert-shift-variance',
        severity: lastClosure.variance < 0 ? 'danger' : 'warning',
        category: 'shift',
        title: lastClosure.variance < 0 ? 'عجز نقدية في آخر تقفيل وردية' : 'زيادة غير مفسرة في درج النقدية',
        message: `سجلت وردية (${lastClosure.cashierName}) فرق جرد قدره ${lastClosure.variance > 0 ? '+' : ''}${lastClosure.variance.toFixed(2)} ج.م.`,
        actionTab: 'reports',
        actionLabel: 'مراجعة التقارير',
        metricValue: `${lastClosure.variance > 0 ? '+' : ''}${lastClosure.variance.toFixed(0)} ج.م`,
      });
    }

    // 6. Customers approaching credit limit (>= 90%)
    const nearLimitCustomers = customers.filter(
      (c) => Number(c.creditLimit || 0) > 0 && c.balanceDue >= Number(c.creditLimit || 0) * 0.9
    );
    if (nearLimitCustomers.length > 0) {
      alerts.push({
        id: 'alert-credit-limit',
        severity: 'warning',
        category: 'credit',
        title: 'عملاء اقتربوا من الحد الائتماني',
        message: `${nearLimitCustomers.length} عميل تجاوز 90% من الحد الائتماني المسموح.`,
        actionTab: 'partners_payments',
        actionLabel: 'عرض العملاء',
        metricValue: `${nearLimitCustomers.length} عميل`,
      });
    }

    // 7. Out / Low stock items
    const outCount = products.filter((p) => p.stockQty <= 0).length;
    const lowCount = products.filter((p) => p.stockQty > 0 && p.stockQty <= p.minStockAlert).length;
    if (outCount > 0 || lowCount > 0) {
      alerts.push({
        id: 'alert-stock-reorder',
        severity: outCount > 0 ? 'danger' : 'info',
        category: 'stock',
        title: outCount > 0 ? 'أصناف نفد رصيدها من المخزن' : 'أصناف وصلت لحد إعادة الطلب',
        message: `${outCount} صنف نافد و${lowCount} صنف منخفض الرصيد — راجع مقترحات التوريد التلقائية.`,
        actionTab: 'purchases',
        actionLabel: 'أمر شراء مقترح',
        metricValue: `${outCount + lowCount} صنف`,
      });
    }

    return alerts;
  }

  public getAutoReorderSuggestions(): AutoReorderSupplierGroup[] {
    const products = this.sources.getProducts();
    const suppliers = this.sources.getSuppliers();
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    // 30-day sales velocity per product
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const sold30dMap = new Map<string, number>();
    for (const inv of this.sources.getInvoices()) {
      if (inv.status === 'returned' || inv.createdAt < thirtyDaysAgoIso) continue;
      for (const item of inv.items) {
        const netQty = Math.max(0, item.quantity - (item.returnedQuantity || 0));
        if (netQty <= 0) continue;
        sold30dMap.set(item.productId, Number(((sold30dMap.get(item.productId) || 0) + netQty).toFixed(3)));
      }
    }

    const groups = new Map<string, AutoReorderSupplierGroup>();

    for (const p of products) {
      const sold30d = sold30dMap.get(p.id) || 0;
      const velocityPerDay = Number((sold30d / 30).toFixed(2));
      const daysRemaining =
        velocityPerDay > 0 && p.stockQty > 0 ? Math.floor(p.stockQty / velocityPerDay) : p.stockQty <= 0 ? 0 : null;

      const needsReorder = p.stockQty <= p.minStockAlert || (daysRemaining !== null && daysRemaining <= 7);
      if (!needsReorder) continue;

      const targetLevel = Math.max(p.minStockAlert * 2, p.maxStockLimit, Math.ceil(velocityPerDay * 14));
      const suggestedQty = Math.max(1, Math.ceil(targetLevel - Math.max(0, p.stockQty)));
      const unitCost = Number(p.currentCostPrice || 0);
      const estimatedCost = roundMoney(suggestedQty * unitCost);

      const sup = (p.supplierId ? supplierById.get(p.supplierId) : undefined) || suppliers[0];
      const supId = sup?.id || 'unassigned';
      const group = groups.get(supId) || {
        supplierId: supId,
        supplierName: sup?.name || 'مورد غير محدد',
        supplierPhone: sup?.phone || '',
        totalEstimatedCost: 0,
        items: [],
      };

      const itemRow: AutoReorderSuggestionItem = {
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        currentStock: p.stockQty,
        minStockAlert: p.minStockAlert,
        maxStockLimit: p.maxStockLimit,
        velocityPerDay,
        daysRemaining,
        suggestedQty,
        unitCost,
        estimatedCost,
      };
      group.items.push(itemRow);
      group.totalEstimatedCost = roundMoney(group.totalEstimatedCost + estimatedCost);
      groups.set(supId, group);
    }

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => a.currentStock - b.currentStock),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }
}
