import type Database from 'better-sqlite3';
import type {
  Customer,
  DataImportSummary,
  EquityDrawing,
  EquityPartner,
  ExpenseCategory,
  Invoice,
  PaymentTransaction,
  PriceTier,
  Product,
  ProductBatch,
  ProductPriceHistory,
  PurchaseOrder,
  SavedCustomReportPreset,
  SecurityAuditLog,
  StockMovement,
  StoreActivityId,
  StoreExpense,
  StorePromotion,
  StoreSettings,
  Supplier,
  TreasuryAccount,
} from '../../shared/types.ts';

export interface DataExchangeDeps {
  getSettings: () => StoreSettings;
  updateStoreSettings: (patch: Record<string, unknown>) => StoreSettings;
  getAllProducts: () => Product[];
  createProduct: (input: Record<string, unknown>) => { product: Product; movement: StockMovement };
  updateProductPriceOrInfo: (productId: string, patch: Record<string, unknown>) => unknown;
  getCustomers: () => Customer[];
  addCustomer: (input: {
    name: string;
    phone: string;
    creditLimit?: number;
    defaultPriceTier?: Exclude<PriceTier, 'custom'>;
    defaultDiscountPercent?: number;
    notes?: string;
  }) => Customer;
  updateCustomer: (id: string, patch: Record<string, unknown>) => Customer;
  getSuppliers: () => Supplier[];
  addSupplier: (input: { name: string; phone: string; category: string; notes?: string }) => Supplier;
  updateSupplier: (id: string, patch: Record<string, unknown>) => Supplier;
  getTreasuries: () => TreasuryAccount[];
  createExpense: (input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasuryId?: string | null;
    receiptRef?: string;
    createdAt?: string;
    actorName: string;
    notes?: string;
  }) => StoreExpense;
  getBatches: () => ProductBatch[];
  getPromotions: () => StorePromotion[];
  getPriceHistory: () => ProductPriceHistory[];
  getInvoices: () => Invoice[];
  getPurchaseOrders: () => PurchaseOrder[];
  getExpenses: () => StoreExpense[];
  getTransactions: () => PaymentTransaction[];
  getMovements: (limit?: number) => StockMovement[];
  getEquityPartners: () => EquityPartner[];
  getEquityDrawings: () => EquityDrawing[];
  getCustomReportPresets: () => SavedCustomReportPreset[];
  getAuditLogs: (limit?: number) => SecurityAuditLog[];
  logAudit: (input: {
    actorUserId: string;
    actorName: string;
    action: string;
    category: 'auth' | 'security' | 'settings' | 'data' | 'rbac';
    target?: string;
    details?: string;
  }) => void;
}

function pickVal(r: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k];
  }
  return undefined;
}

function parseTierLabel(val: unknown): Exclude<PriceTier, 'custom'> | undefined {
  if (!val) return undefined;
  const s = String(val).trim().toLowerCase();
  if (s === 'wholesale' || s === 'جملة') return 'wholesale';
  if (s === 'half_wholesale' || s === 'نصف جملة') return 'half_wholesale';
  if (s === 'retail' || s === 'قطاعي') return 'retail';
  return undefined;
}

/**
 * DataExchangeRepository handles JSON Backup/Restore and Excel/CSV Batch Imports.
 */
export class DataExchangeRepository {
  private readonly db: Database.Database;
  private readonly deps: DataExchangeDeps;

  constructor(db: Database.Database, deps: DataExchangeDeps) {
    this.db = db;
    this.deps = deps;
  }

  public exportBackupJson() {
    return {
      exportedAt: new Date().toISOString(),
      settings: this.deps.getSettings(),
      products: this.db.prepare('SELECT * FROM products').all(),
      batches: this.deps.getBatches(),
      promotions: this.deps.getPromotions(),
      priceHistory: this.deps.getPriceHistory(),
      invoices: this.deps.getInvoices(),
      purchases: this.deps.getPurchaseOrders(),
      expenses: this.deps.getExpenses(),
      customers: this.deps.getCustomers(),
      suppliers: this.deps.getSuppliers(),
      transactions: this.deps.getTransactions(),
      movements: this.deps.getMovements(200),
      equityPartners: this.deps.getEquityPartners(),
      equityDrawings: this.deps.getEquityDrawings(),
      customReportPresets: this.deps.getCustomReportPresets(),
      auditLogs: this.deps.getAuditLogs(100),
    };
  }

  public importProductsBatch(
    rows: Array<Record<string, unknown>>,
    actorName = 'استيراد Excel'
  ): DataImportSummary {
    const settings = this.deps.getSettings();
    const summary: DataImportSummary = {
      entity: 'products',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const existingAll = this.deps.getAllProducts();
    const byBarcode = new Map(existingAll.map((p) => [p.barcode.trim(), p]));
    const bySku = new Map(existingAll.map((p) => [p.sku.trim().toLowerCase(), p]));
    const byId = new Map(existingAll.map((p) => [p.id, p]));

    const tx = this.db.transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const name = String(pickVal(row, ['name', 'الاسم', 'اسم الصنف']) || '').trim();
          if (!name) {
            summary.skipped += 1;
            return;
          }
          const barcode = String(pickVal(row, ['barcode', 'الباركود']) || '').trim();
          const sku = String(pickVal(row, ['sku', 'الكود', 'رمز الصنف']) || '').trim();
          const idVal = String(pickVal(row, ['id']) || '').trim();
          const category = String(pickVal(row, ['category', 'القسم', 'الفئة']) || 'عام').trim();
          const unit = String(pickVal(row, ['unit', 'الوحدة']) || 'قطعة').trim();
          const attributeValue = String(
            pickVal(row, ['attributeValue', 'المقاس / الصفة', 'المواصفات']) || ''
          ).trim();
          const costPrice = Number(
            pickVal(row, ['currentCostPrice', 'costPrice', 'سعر التكلفة', 'التكلفة']) ?? 0
          );
          const salePrice = Number(
            pickVal(row, ['currentSalePrice', 'salePrice', 'سعر البيع', 'السعر', 'سعر القطاعي']) ??
              0
          );
          const halfRaw = pickVal(row, ['halfWholesalePrice', 'سعر نصف الجملة', 'نصف جملة']);
          const wholeRaw = pickVal(row, ['wholesalePrice', 'سعر الجملة', 'جملة']);
          const halfWholesalePrice = halfRaw !== undefined ? Number(halfRaw) : undefined;
          const wholesalePrice = wholeRaw !== undefined ? Number(wholeRaw) : undefined;
          const stockQty = Number(pickVal(row, ['stockQty', 'الكمية', 'الرصيد']) ?? 0);
          const minAlert = Number(pickVal(row, ['minStockAlert', 'حد الطلب', 'الحد الأدنى']) ?? 5);
          const maxLimit = Number(pickVal(row, ['maxStockLimit', 'الحد الأقصى']) ?? 60);
          const activityId = String(
            pickVal(row, ['activityId', 'النشاط']) || settings.activityId
          ) as StoreActivityId;

          if (
            !Number.isFinite(salePrice) ||
            salePrice < 0 ||
            !Number.isFinite(costPrice) ||
            costPrice < 0
          ) {
            summary.errors.push(`صف ${idx + 2}: سعر غير صالح للصنف "${name}"`);
            summary.skipped += 1;
            return;
          }

          const matched =
            (idVal ? byId.get(idVal) : undefined) ||
            (barcode ? byBarcode.get(barcode) : undefined) ||
            (sku ? bySku.get(sku.toLowerCase()) : undefined);

          if (matched) {
            this.deps.updateProductPriceOrInfo(matched.id, {
              name,
              category,
              unit,
              attributeValue,
              barcode: barcode || matched.barcode,
              currentCostPrice: costPrice > 0 ? costPrice : matched.currentCostPrice,
              currentSalePrice: salePrice > 0 ? salePrice : matched.currentSalePrice,
              halfWholesalePrice:
                halfWholesalePrice !== undefined &&
                Number.isFinite(halfWholesalePrice) &&
                halfWholesalePrice > 0
                  ? halfWholesalePrice
                  : matched.halfWholesalePrice,
              wholesalePrice:
                wholesalePrice !== undefined &&
                Number.isFinite(wholesalePrice) &&
                wholesalePrice > 0
                  ? wholesalePrice
                  : matched.wholesalePrice,
              minStockAlert: minAlert,
              maxStockLimit: maxLimit,
              reason: 'تحديث جماعي عبر ملف Excel (.xlsx)',
              actorName,
            });
            const delta = Number((stockQty - matched.stockQty).toFixed(3));
            if (Math.abs(delta) >= 0.001) {
              this.db
                .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
                .run(stockQty, new Date().toISOString(), matched.id);
            }
            summary.updated += 1;
          } else {
            const created = this.deps.createProduct({
              name,
              sku: sku || undefined,
              barcode: barcode || undefined,
              category,
              unit,
              attributeValue,
              currentCostPrice: costPrice,
              currentSalePrice: salePrice,
              halfWholesalePrice:
                halfWholesalePrice !== undefined &&
                Number.isFinite(halfWholesalePrice) &&
                halfWholesalePrice > 0
                  ? halfWholesalePrice
                  : undefined,
              wholesalePrice:
                wholesalePrice !== undefined &&
                Number.isFinite(wholesalePrice) &&
                wholesalePrice > 0
                  ? wholesalePrice
                  : undefined,
              stockQty: Math.max(0, stockQty),
              minStockAlert: minAlert,
              maxStockLimit: maxLimit,
              actorName,
              terminalName: 'استيراد XLSX',
            });
            if (activityId !== settings.activityId) {
              this.db
                .prepare('UPDATE products SET activity_id = ? WHERE id = ?')
                .run(activityId, created.product.id);
            }
            byBarcode.set(created.product.barcode, created.product);
            bySku.set(created.product.sku.toLowerCase(), created.product);
            summary.inserted += 1;
          }
        } catch (err) {
          summary.errors.push(
            `صف ${idx + 2}: ${err instanceof Error ? err.message : 'خطأ غير متوقع'}`
          );
          summary.skipped += 1;
        }
      });
    });
    tx();
    return summary;
  }

  public importCustomersBatch(rows: Array<Record<string, unknown>>): DataImportSummary {
    const summary: DataImportSummary = {
      entity: 'customers',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const existing = this.deps.getCustomers();
    const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [c.phone.trim(), c]));
    const byName = new Map(existing.map((c) => [c.name.trim(), c]));

    const tx = this.db.transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const name = String(pickVal(row, ['name', 'الاسم', 'اسم العميل']) || '').trim();
          if (!name) {
            summary.skipped += 1;
            return;
          }
          const phone = String(
            pickVal(row, ['phone', 'الهاتف', 'رقم الهاتف', 'الموبايل']) || ''
          ).trim();
          const creditLimit = Number(pickVal(row, ['creditLimit', 'الحد الائتماني']) ?? 0);
          const defaultPriceTier = parseTierLabel(
            pickVal(row, ['defaultPriceTier', 'شريحة التسعير', 'السعر الافتراضي'])
          );
          const defaultDiscountRaw = pickVal(row, ['defaultDiscountPercent', 'نسبة الخصم الافتراضية', 'الخصم %']);
          const defaultDiscountPercent =
            defaultDiscountRaw !== undefined ? Number(defaultDiscountRaw) : undefined;
          const notes = String(pickVal(row, ['notes', 'ملاحظات']) || '').trim();
          const matched = (phone ? byPhone.get(phone) : undefined) || byName.get(name);
          if (matched) {
            this.deps.updateCustomer(matched.id, {
              name,
              phone: phone || matched.phone,
              creditLimit,
              defaultPriceTier,
              defaultDiscountPercent,
              notes,
            });
            summary.updated += 1;
          } else {
            const created = this.deps.addCustomer({
              name,
              phone,
              creditLimit,
              defaultPriceTier,
              defaultDiscountPercent,
              notes,
            });
            if (phone) byPhone.set(phone, created);
            byName.set(name, created);
            summary.inserted += 1;
          }
        } catch (err) {
          summary.errors.push(`صف ${idx + 2}: ${err instanceof Error ? err.message : 'خطأ'}`);
          summary.skipped += 1;
        }
      });
    });
    tx();
    return summary;
  }

  public importSuppliersBatch(rows: Array<Record<string, unknown>>): DataImportSummary {
    const summary: DataImportSummary = {
      entity: 'suppliers',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const existing = this.deps.getSuppliers();
    const byPhone = new Map(existing.filter((s) => s.phone).map((s) => [s.phone.trim(), s]));
    const byName = new Map(existing.map((s) => [s.name.trim(), s]));

    const tx = this.db.transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const name = String(pickVal(row, ['name', 'الاسم', 'اسم المورد']) || '').trim();
          if (!name) {
            summary.skipped += 1;
            return;
          }
          const phone = String(pickVal(row, ['phone', 'الهاتف', 'رقم الهاتف']) || '').trim();
          const category = String(
            pickVal(row, ['category', 'النشاط / التخصص', 'القسم']) || 'توريد عام'
          ).trim();
          const notes = String(pickVal(row, ['notes', 'ملاحظات']) || '').trim();
          const matched = (phone ? byPhone.get(phone) : undefined) || byName.get(name);
          if (matched) {
            this.deps.updateSupplier(matched.id, {
              name,
              phone: phone || matched.phone,
              category,
              notes,
            });
            summary.updated += 1;
          } else {
            const created = this.deps.addSupplier({ name, phone, category, notes });
            if (phone) byPhone.set(phone, created);
            byName.set(name, created);
            summary.inserted += 1;
          }
        } catch (err) {
          summary.errors.push(`صف ${idx + 2}: ${err instanceof Error ? err.message : 'خطأ'}`);
          summary.skipped += 1;
        }
      });
    });
    tx();
    return summary;
  }

  public importExpensesBatch(
    rows: Array<Record<string, unknown>>,
    actorName = 'استيراد Excel'
  ): DataImportSummary {
    const summary: DataImportSummary = {
      entity: 'expenses',
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    const tx = this.db.transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const title = String(pickVal(row, ['title', 'البيان', 'بند المصروف']) || '').trim();
          const amount = Number(pickVal(row, ['amount', 'المبلغ']) ?? 0);
          if (!title || !Number.isFinite(amount) || amount <= 0) {
            summary.skipped += 1;
            return;
          }
          const category = String(
            pickVal(row, ['category', 'الفئة', 'التصنيف']) || 'misc'
          ) as ExpenseCategory;
          const paymentSource = String(
            pickVal(row, ['paymentSource', 'جهة الصرف']) || 'cash_drawer'
          ) as 'cash_drawer' | 'bank_instapay' | 'wallet';
          const receiptRef = String(
            pickVal(row, ['receiptRef', 'رقم الإيصال', 'المرجع']) || ''
          ).trim();
          const createdAtRaw = pickVal(row, ['createdAt', 'التاريخ', 'تاريخ المصروف']);
          const createdAt = createdAtRaw ? String(createdAtRaw) : undefined;
          const treasuryNameRaw = String(pickVal(row, ['treasuryName', 'الخزينة']) || '').trim();
          const matchedTreasury = treasuryNameRaw
            ? this.deps.getTreasuries().find((t) => t.name === treasuryNameRaw)
            : undefined;
          const notes = String(pickVal(row, ['notes', 'ملاحظات']) || '').trim();
          this.deps.createExpense({
            title,
            category,
            amount,
            paymentSource,
            treasuryId: matchedTreasury?.id || null,
            receiptRef,
            createdAt,
            actorName,
            notes,
          });
          summary.inserted += 1;
        } catch (err) {
          summary.errors.push(`صف ${idx + 2}: ${err instanceof Error ? err.message : 'خطأ'}`);
          summary.skipped += 1;
        }
      });
    });
    tx();
    return summary;
  }

  public restoreBackupJson(
    backup: Record<string, unknown>,
    actorName = 'صاحب المحل'
  ): Record<string, number> {
    if (!backup || typeof backup !== 'object') {
      throw new Error('ملف النسخة الاحتياطية غير صالح.');
    }
    const counts = { products: 0, customers: 0, suppliers: 0, expenses: 0 };
    if (backup.settings && typeof backup.settings === 'object') {
      const s = backup.settings as Record<string, unknown>;
      this.deps.updateStoreSettings({
        storeName: typeof s.storeName === 'string' ? s.storeName : undefined,
        phone: typeof s.phone === 'string' ? s.phone : undefined,
        address: typeof s.address === 'string' ? s.address : undefined,
        taxNumber: typeof s.taxNumber === 'string' ? s.taxNumber : undefined,
        receiptFooter: typeof s.receiptFooter === 'string' ? s.receiptFooter : undefined,
        vatPercent: s.vatPercent !== undefined ? Number(s.vatPercent) : undefined,
        allowNegativeStock:
          s.allowNegativeStock !== undefined ? Boolean(s.allowNegativeStock) : undefined,
        autoPrintAfterSale:
          s.autoPrintAfterSale !== undefined ? Boolean(s.autoPrintAfterSale) : undefined,
      });
    }
    if (Array.isArray(backup.suppliers)) {
      const res = this.importSuppliersBatch(backup.suppliers as Array<Record<string, unknown>>);
      counts.suppliers = res.inserted + res.updated;
    }
    if (Array.isArray(backup.customers)) {
      const res = this.importCustomersBatch(backup.customers as Array<Record<string, unknown>>);
      counts.customers = res.inserted + res.updated;
    }
    if (Array.isArray(backup.products)) {
      const mapped = (backup.products as Array<Record<string, unknown>>).map((p) => ({
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        category: p.category,
        unit: p.unit,
        attributeValue: p.attribute_value ?? p.attributeValue,
        activityId: p.activity_id ?? p.activityId,
        currentCostPrice: p.current_cost_price ?? p.currentCostPrice,
        currentSalePrice: p.current_sale_price ?? p.currentSalePrice,
        stockQty: p.stock_qty ?? p.stockQty,
        minStockAlert: p.min_stock_alert ?? p.minStockAlert,
        maxStockLimit: p.max_stock_limit ?? p.maxStockLimit,
      }));
      const res = this.importProductsBatch(mapped, actorName);
      counts.products = res.inserted + res.updated;
    }
    this.deps.logAudit({
      actorUserId: 'usr-owner',
      actorName,
      action: 'استعادة بيانات من نسخة احتياطية JSON',
      category: 'data',
      target: 'database',
      details: JSON.stringify(counts),
    });
    return counts;
  }
}
