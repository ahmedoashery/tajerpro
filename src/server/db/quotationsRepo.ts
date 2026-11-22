import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { resolveTierUnitPrice } from '../../shared/pricingUtils.ts';
import type {
  PriceTier,
  Product,
  QuotationItem,
  QuotationStatus,
  SalesQuotation,
  StoreActivityId,
} from '../../shared/types.ts';
import { isValidYmdDate, roundMoney, sanitizeText } from '../security/requestValidation.ts';

interface DbQuotationRow {
  id: string;
  quotation_number: string;
  activity_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  status: string;
  items_json: string;
  subtotal: number;
  discount_total: number;
  grand_total: number;
  valid_until: string;
  notes: string;
  created_by: string;
  converted_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationsRepoDeps {
  getProductById: (id: string) => Product | null;
  getCustomerById: (id: string) => { id: string; name: string; phone: string } | null;
  getActivityId: () => StoreActivityId;
}

function safeParseItems(raw: string): QuotationItem[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QuotationItem[]) : [];
  } catch {
    return [];
  }
}

function defaultValidUntil(days = 7): string {
  const target = new Date(Date.now() + Math.max(1, Math.min(90, days)) * 86400_000);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayLocalYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export class QuotationsRepository {
  private readonly db: Database.Database;
  private readonly deps: QuotationsRepoDeps;

  constructor(db: Database.Database, deps: QuotationsRepoDeps) {
    this.db = db;
    this.deps = deps;
  }

  private nextQuotationNumber(): string {
    const year = new Date().getFullYear();
    const prefix = `QT-${year}-`;
    const rows = this.db
      .prepare('SELECT quotation_number FROM sales_quotations WHERE quotation_number LIKE ?')
      .all(`${prefix}%`) as Array<{ quotation_number: string }>;

    let maxSeq = 1000;
    for (const r of rows) {
      const parsed = Number.parseInt(String(r.quotation_number || '').slice(prefix.length), 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed;
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  }

  private mapRow(row: DbQuotationRow): SalesQuotation {
    const today = todayLocalYmd();
    let status: QuotationStatus =
      row.status === 'converted' || row.status === 'cancelled' || row.status === 'expired'
        ? row.status
        : 'active';
    if (status === 'active' && row.valid_until && row.valid_until < today) {
      status = 'expired';
    }
    return {
      id: row.id,
      quotationNumber: row.quotation_number,
      activityId: (row.activity_id || 'grocery') as StoreActivityId,
      customerId: row.customer_id || null,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || '',
      status,
      items: safeParseItems(row.items_json),
      subtotal: roundMoney(Number(row.subtotal || 0)),
      discountTotal: roundMoney(Number(row.discount_total || 0)),
      grandTotal: roundMoney(Number(row.grand_total || 0)),
      validUntil: row.valid_until,
      notes: row.notes || '',
      createdBy: row.created_by || '',
      convertedInvoiceId: row.converted_invoice_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listQuotations(limit = 100): SalesQuotation[] {
    const safeLimit = Math.max(1, Math.min(300, Math.round(limit)));
    const rows = this.db
      .prepare('SELECT * FROM sales_quotations ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as DbQuotationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getQuotationById(id: string): SalesQuotation | null {
    const row = this.db
      .prepare('SELECT * FROM sales_quotations WHERE id = ?')
      .get(id) as DbQuotationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public createQuotation(input: {
    items: Array<{
      productId: string;
      quantity: number;
      priceTier?: PriceTier;
      unitSalePrice?: number;
      discountAmount?: number;
    }>;
    customerId?: string | null;
    customerName?: string;
    customerPhone?: string;
    invoiceDiscount?: number;
    validUntil?: string;
    validDays?: number;
    notes?: string;
    createdBy?: string;
  }): SalesQuotation {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error('عرض السعر يجب أن يحتوي على صنف واحد على الأقل.');
    }

    const resolvedItems: QuotationItem[] = [];
    let subtotal = 0;

    for (const rawItem of input.items) {
      const product = this.deps.getProductById(String(rawItem.productId || ''));
      if (!product) {
        throw new Error('أحد الأصناف المختارة غير موجود في قاعدة البيانات.');
      }
      const qty = Number(rawItem.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`كمية غير صالحة للصنف (${product.name}).`);
      }

      const tier: PriceTier =
        rawItem.priceTier === 'half_wholesale' ||
        rawItem.priceTier === 'wholesale' ||
        rawItem.priceTier === 'custom'
          ? rawItem.priceTier
          : 'retail';

      const defaultUnitPrice = resolveTierUnitPrice(
        product,
        tier === 'custom' ? 'retail' : tier
      );
      const unitSalePrice =
        rawItem.unitSalePrice !== undefined &&
        Number.isFinite(Number(rawItem.unitSalePrice)) &&
        Number(rawItem.unitSalePrice) >= 0
          ? roundMoney(Number(rawItem.unitSalePrice))
          : defaultUnitPrice;

      const grossLine = roundMoney(unitSalePrice * qty);
      const rawDiscount = Number(rawItem.discountAmount || 0);
      const discountAmount = roundMoney(
        Math.min(grossLine, Math.max(0, Number.isFinite(rawDiscount) ? rawDiscount : 0))
      );
      const lineTotal = roundMoney(Math.max(0, grossLine - discountAmount));
      subtotal = roundMoney(subtotal + lineTotal);

      resolvedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        priceTier: tier,
        quantity: Number(qty.toFixed(3)),
        unitSalePrice,
        discountAmount,
        lineTotal,
      });
    }

    const reqInvoiceDiscount = Number(input.invoiceDiscount || 0);
    const discountTotal = roundMoney(
      Math.min(subtotal, Math.max(0, Number.isFinite(reqInvoiceDiscount) ? reqInvoiceDiscount : 0))
    );
    const grandTotal = roundMoney(Math.max(0, subtotal - discountTotal));

    const cust = input.customerId ? this.deps.getCustomerById(input.customerId) : null;
    const customerName = sanitizeText(cust?.name || input.customerName || 'عميل عرض سعر', 140);
    const customerPhone = sanitizeText(cust?.phone || input.customerPhone || '', 40);
    const validUntil =
      input.validUntil && isValidYmdDate(input.validUntil)
        ? input.validUntil.trim()
        : defaultValidUntil(Number(input.validDays || 7));

    const id = `qt-${crypto.randomBytes(4).toString('hex')}`;
    const quotationNumber = this.nextQuotationNumber();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sales_quotations (
          id, quotation_number, activity_id, customer_id, customer_name, customer_phone,
          status, items_json, subtotal, discount_total, grand_total, valid_until, notes,
          created_by, converted_invoice_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        quotationNumber,
        this.deps.getActivityId(),
        cust?.id || null,
        customerName,
        customerPhone,
        JSON.stringify(resolvedItems),
        subtotal,
        discountTotal,
        grandTotal,
        validUntil,
        sanitizeText(input.notes, 400),
        sanitizeText(input.createdBy || 'الكاشير', 100),
        now,
        now
      );

    return this.getQuotationById(id)!;
  }

  public updateStatus(id: string, status: 'active' | 'cancelled'): SalesQuotation {
    const existing = this.getQuotationById(id);
    if (!existing) throw new Error('عرض السعر غير موجود.');
    if (existing.status === 'converted') {
      throw new Error('لا يمكن تعديل عرض سعر تم تحويله بالفعل إلى فاتورة بيع.');
    }
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE sales_quotations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    return this.getQuotationById(id)!;
  }

  public markConverted(id: string, invoiceId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sales_quotations
         SET status = 'converted', converted_invoice_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(invoiceId, now, id);
  }

  public deleteQuotation(id: string): void {
    const info = this.db.prepare('DELETE FROM sales_quotations WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new Error('عرض السعر غير موجود.');
    }
  }
}
