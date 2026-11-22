import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Customer,
  Invoice,
  PartnerItemizedSummaryRow,
  PartnerStatementLineItem,
  PaymentMethod,
  PriceTier,
  PurchaseOrder,
  Supplier,
  TreasuryAccount,
} from '../../shared/types.ts';
import { roundMoney } from '../security/requestValidation.ts';

export interface PartnersRepoDeps {
  getInvoices: () => Invoice[];
  getPurchaseOrders: () => PurchaseOrder[];
  getTreasuries: () => TreasuryAccount[];
}

function normalizeDefaultTier(tier?: string): Exclude<PriceTier, 'custom'> {
  if (tier === 'half_wholesale' || tier === 'wholesale') return tier;
  return 'retail';
}

function clampDiscountPct(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Number(Math.max(0, Math.min(80, n)).toFixed(2));
}

/**
 * PartnersRepository owns Customers (including default tier pricing & discount rules),
 * Suppliers, debt settlements, and return-aware Partner Statements.
 */
export class PartnersRepository {
  private readonly db: Database.Database;
  private readonly deps: PartnersRepoDeps;

  constructor(db: Database.Database, deps: PartnersRepoDeps) {
    this.db = db;
    this.deps = deps;
  }

  public getCustomers(): Customer[] {
    const rows = this.db
      .prepare('SELECT * FROM customers ORDER BY balance_due DESC, name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone),
      balanceDue: Number(r.balance_due),
      creditLimit: Number(r.credit_limit || 0),
      defaultPriceTier: normalizeDefaultTier(
        r.default_price_tier ? String(r.default_price_tier) : 'retail'
      ),
      defaultDiscountPercent: Number(r.default_discount_percent || 0),
      totalPurchases: Number(r.total_purchases),
      loyaltyPoints: Number(r.loyalty_points || 0),
      storeCreditBalance: Number(r.store_credit_balance || 0),
      lastPurchaseAt: r.last_purchase_at ? String(r.last_purchase_at) : null,
      notes: String(r.notes || ''),
    }));
  }

  public addCustomer(input: {
    name: string;
    phone: string;
    creditLimit?: number;
    defaultPriceTier?: Exclude<PriceTier, 'custom'>;
    defaultDiscountPercent?: number;
    notes?: string;
  }): Customer {
    if (!input.name?.trim()) throw new Error('اسم العميل مطلوب.');
    const id = `cust-${crypto.randomBytes(3).toString('hex')}`;
    this.db
      .prepare(
        `INSERT INTO customers (
          id, name, phone, balance_due, credit_limit, default_price_tier, default_discount_percent,
          total_purchases, loyalty_points, store_credit_balance, last_purchase_at, notes
        ) VALUES (?, ?, ?, 0, ?, ?, ?, 0, 0, 0, NULL, ?)`
      )
      .run(
        id,
        input.name.trim(),
        (input.phone || '').trim(),
        Number(input.creditLimit || 0),
        normalizeDefaultTier(input.defaultPriceTier),
        clampDiscountPct(input.defaultDiscountPercent ?? 0),
        (input.notes || '').trim()
      );
    return this.getCustomers().find((c) => c.id === id)!;
  }

  public updateCustomer(
    id: string,
    patch: {
      name?: string;
      phone?: string;
      creditLimit?: number;
      defaultPriceTier?: Exclude<PriceTier, 'custom'>;
      defaultDiscountPercent?: number;
      notes?: string;
      loyaltyPoints?: number;
      storeCreditBalance?: number;
    }
  ): Customer {
    const existing = this.getCustomers().find((c) => c.id === id);
    if (!existing) throw new Error('العميل غير موجود.');
    this.db
      .prepare(
        `UPDATE customers
         SET name = ?, phone = ?, credit_limit = ?, default_price_tier = ?, default_discount_percent = ?,
             loyalty_points = ?, store_credit_balance = ?, notes = ?
         WHERE id = ?`
      )
      .run(
        patch.name?.trim() || existing.name,
        patch.phone !== undefined ? patch.phone.trim() : existing.phone,
        patch.creditLimit !== undefined
          ? Math.max(0, Number(patch.creditLimit))
          : Number(existing.creditLimit || 0),
        patch.defaultPriceTier !== undefined
          ? normalizeDefaultTier(patch.defaultPriceTier)
          : normalizeDefaultTier(existing.defaultPriceTier),
        patch.defaultDiscountPercent !== undefined
          ? clampDiscountPct(patch.defaultDiscountPercent)
          : clampDiscountPct(existing.defaultDiscountPercent ?? 0),
        patch.loyaltyPoints !== undefined
          ? Math.max(0, Number(patch.loyaltyPoints))
          : Number(existing.loyaltyPoints || 0),
        patch.storeCreditBalance !== undefined
          ? Math.max(0, Number(patch.storeCreditBalance))
          : Number(existing.storeCreditBalance || 0),
        patch.notes !== undefined ? patch.notes.trim() : existing.notes || '',
        id
      );
    return this.getCustomers().find((c) => c.id === id)!;
  }

  public deleteCustomer(id: string): void {
    const existing = this.getCustomers().find((c) => c.id === id);
    if (!existing) throw new Error('العميل غير موجود.');
    if (existing.balanceDue > 0) {
      throw new Error('لا يمكن حذف عميل عليه مديونية مستحقة. يرجى تسوية الحساب أولاً.');
    }
    this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }

  public getCustomerStatement(customerId: string) {
    const customer = this.getCustomers().find((c) => c.id === customerId);
    if (!customer) throw new Error('العميل غير موجود.');

    const invoices = this.deps.getInvoices().filter((inv) => inv.customerId === customerId);
    const collectionRows = this.db
      .prepare(
        `SELECT * FROM payment_transactions
         WHERE (partner_id = ? OR invoice_number = ?) AND status = 'settled' AND invoice_id IS NULL
         ORDER BY created_at ASC`
      )
      .all(customerId, `تحصيل آجل - ${customer.name}`) as Array<Record<string, unknown>>;

    const entries: Array<{
      id: string;
      date: string;
      type: 'invoice' | 'payment' | 'return';
      reference: string;
      description: string;
      debit: number;
      credit: number;
      method: string;
      dueDate?: string | null;
      invoiceStatus?: string;
      treasuryBreakdown?: string;
      items?: PartnerStatementLineItem[];
    }> = [];

    const itemAgg = new Map<
      string,
      {
        productId: string;
        productName: string;
        unit: string;
        totalQty: number;
        totalAmount: number;
        invoiceIds: Set<string>;
      }
    >();

    for (const inv of invoices) {
      const mappedItems: PartnerStatementLineItem[] = inv.items.map((it) => {
        const retQty = Number(it.returnedQuantity || 0);
        const activeQty = Number(Math.max(0, it.quantity - retQty).toFixed(3));
        const ratio = it.quantity > 0 ? activeQty / it.quantity : 0;
        const netLineTotal =
          inv.status === 'returned' ? 0 : roundMoney(it.lineTotal * ratio);
        return {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          returnedQuantity: inv.status === 'returned' ? it.quantity : retQty,
          unitPrice: it.unitSalePrice,
          discountAmount: it.discountAmount,
          lineTotal: it.lineTotal,
          netLineTotal,
        };
      });

      const treasuryBreakdown =
        inv.allocations && inv.allocations.length > 0
          ? inv.allocations.map((a) => `${a.treasuryName}: ${a.amount} ج.م`).join(' | ')
          : undefined;

      const origTotal =
        inv.status === 'partial_returned' ||
        (inv.status === 'returned' && Number(inv.returnedTotal || 0) > 0)
          ? roundMoney(inv.grandTotal + Number(inv.returnedTotal || 0))
          : inv.grandTotal;

      const origCreditPortion =
        inv.allocations && inv.allocations.length > 0
          ? inv.allocations.filter((a) => a.method === 'credit').reduce((s, a) => s + a.amount, 0)
          : inv.paymentMethod === 'credit'
            ? origTotal
            : 0;

      const origInstantSettled = roundMoney(Math.max(0, origTotal - origCreditPortion));

      entries.push({
        id: inv.id,
        date: inv.createdAt,
        type: 'invoice',
        reference: inv.invoiceNumber,
        description: `فاتورة مبيعات (${inv.items.length} أصناف)${inv.dueDate ? ` · استحقاق ${inv.dueDate}` : ''}`,
        debit: origTotal,
        credit: origInstantSettled,
        method: inv.paymentMethod,
        dueDate: inv.dueDate || null,
        invoiceStatus: inv.status,
        treasuryBreakdown,
        items: mappedItems,
      });

      if (inv.returns && inv.returns.length > 0) {
        for (const ret of inv.returns) {
          entries.push({
            id: ret.id,
            date: ret.createdAt,
            type: 'return',
            reference: `${inv.invoiceNumber}-RET`,
            description:
              ret.creditDebtReduced > 0
                ? `مرتجع ${inv.invoiceNumber} (خصم من المديونية ${ret.creditDebtReduced} ج.م${ret.storeCreditAdded > 0 ? ` + رصيد دائن ${ret.storeCreditAdded} ج.م` : ''})`
                : ret.storeCreditAdded > 0
                  ? `مرتجع ${inv.invoiceNumber} (إضافة رصيد دائن للعميل ${ret.storeCreditAdded} ج.م)`
                  : `مرتجع ${inv.invoiceNumber} (رد نقدي/بنكي ${ret.returnTotal} ج.م)`,
            debit: 0,
            credit: roundMoney(ret.creditDebtReduced),
            method: ret.creditDebtReduced > 0 ? 'credit' : 'cash',
          });
        }
      } else if (inv.status === 'returned') {
        entries.push({
          id: `${inv.id}-ret`,
          date: inv.createdAt,
          type: 'return',
          reference: `${inv.invoiceNumber}-RET`,
          description: `مرتجع فاتورة كامل (${inv.items.length} أصناف)`,
          debit: 0,
          credit: roundMoney(origCreditPortion),
          method: inv.paymentMethod,
          treasuryBreakdown,
          items: mappedItems,
        });
      }

      if (inv.status === 'completed' || inv.status === 'partial_returned') {
        for (const it of inv.items) {
          const activeQty = Number(Math.max(0, it.quantity - Number(it.returnedQuantity || 0)).toFixed(3));
          if (activeQty <= 0.0001) continue;
          const netRatio = it.quantity > 0 ? activeQty / it.quantity : 0;
          const activeAmt = roundMoney(it.lineTotal * netRatio);
          const cur = itemAgg.get(it.productId) || {
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            totalQty: 0,
            totalAmount: 0,
            invoiceIds: new Set<string>(),
          };
          cur.totalQty = Number((cur.totalQty + activeQty).toFixed(3));
          cur.totalAmount = roundMoney(cur.totalAmount + activeAmt);
          cur.invoiceIds.add(inv.id);
          itemAgg.set(it.productId, cur);
        }
      }
    }

    for (const tx of collectionRows) {
      const tName = String(tx.treasury_name || tx.provider || '');
      entries.push({
        id: String(tx.id),
        date: String(tx.created_at),
        type: 'payment',
        reference: String(tx.reference_code || '') || 'سند قبض',
        description: `تحصيل دفعة (${tName})`,
        debit: 0,
        credit: Number(tx.amount),
        method: String(tx.method),
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));

    const entriesNet = entries.reduce((s, e) => s + e.debit - e.credit, 0);
    const openingDiff = roundMoney(customer.balanceDue - entriesNet);
    if (Math.abs(openingDiff) > 0.05) {
      const baseTs = entries[0]?.date
        ? new Date(entries[0].date).getTime() - 1000
        : Date.now() - 86400 * 1000;
      const openingDate = new Date(baseTs).toISOString();
      entries.unshift({
        id: `opening-${customerId}`,
        date: openingDate,
        type: openingDiff > 0 ? 'invoice' : 'payment',
        reference: 'رصيد سابق',
        description:
          openingDiff > 0
            ? 'رصيد افتتاحي مستحق قبل الفواتير المسجلة بالنظام'
            : 'رصيد دائن / دفعة مقدمة سابقة للعميل',
        debit: openingDiff > 0 ? openingDiff : 0,
        credit: openingDiff < 0 ? Math.abs(openingDiff) : 0,
        method: openingDiff > 0 ? 'credit' : 'cash',
      });
    }

    const itemizedSummary: PartnerItemizedSummaryRow[] = Array.from(itemAgg.values())
      .map((row) => ({
        productId: row.productId,
        productName: row.productName,
        unit: row.unit,
        totalQty: row.totalQty,
        avgUnitPrice: row.totalQty > 0 ? roundMoney(row.totalAmount / row.totalQty) : 0,
        totalAmount: row.totalAmount,
        invoiceCount: row.invoiceIds.size,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      partnerType: 'customer' as const,
      customer,
      entries,
      itemizedSummary,
      totalInvoiced: roundMoney(
        invoices
          .filter((i) => i.status === 'completed' || i.status === 'partial_returned')
          .reduce((s, i) => s + i.grandTotal, 0)
      ),
      totalPaid: roundMoney(entries.reduce((s, e) => s + e.credit, 0)),
      closingBalance: customer.balanceDue,
    };
  }

  public collectCustomerPayment(input: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    referenceCode?: string;
    treasuryId?: string | null;
  }): Customer {
    const customer = this.getCustomers().find((c) => c.id === input.customerId);
    if (!customer) throw new Error('العميل غير موجود.');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > customer.balanceDue) {
      throw new Error('المبلغ غير صالح أو أكبر من الرصيد المستحق.');
    }

    const now = new Date().toISOString();
    const treasuries = this.deps.getTreasuries();
    const treasury = input.treasuryId
      ? treasuries.find((t) => t.id === input.treasuryId)
      : treasuries.find(
          (t) =>
            t.active &&
            t.type ===
              (input.method === 'instapay'
                ? 'instapay'
                : input.method === 'vodafone_cash'
                  ? 'wallet'
                  : 'cash_drawer')
        );
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE customers SET balance_due = ROUND(balance_due - ?, 2) WHERE id = ?')
        .run(amount, input.customerId);

      this.db
        .prepare(
          `INSERT INTO payment_transactions (id, invoice_id, invoice_number, partner_id, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'settled', ?)`
        )
        .run(
          `tx-${crypto.randomBytes(4).toString('hex')}`,
          `تحصيل آجل - ${customer.name}`,
          customer.id,
          treasury?.id || null,
          treasury?.name || '',
          input.method,
          treasury?.name ||
            (input.method === 'instapay'
              ? 'شبكة إنستا باي'
              : input.method === 'vodafone_cash'
                ? 'فودافون كاش'
                : 'تحصيل نقدي بالمحل'),
          amount,
          amount,
          (input.referenceCode || '').trim(),
          now
        );

      if (treasury) {
        this.db
          .prepare(
            'UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?'
          )
          .run(amount, now, treasury.id);
      }
    });
    tx();
    return this.getCustomers().find((c) => c.id === input.customerId)!;
  }

  public getSuppliers(): Supplier[] {
    const rows = this.db
      .prepare('SELECT * FROM suppliers ORDER BY name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone),
      category: String(r.category),
      balanceDue: Number(r.balance_due),
      lastSupplyAt: r.last_supply_at ? String(r.last_supply_at) : null,
      notes: String(r.notes || ''),
    }));
  }

  public addSupplier(input: {
    name: string;
    phone: string;
    category: string;
    notes?: string;
  }): Supplier {
    if (!input.name?.trim()) throw new Error('اسم المورد مطلوب.');
    const id = `sup-${crypto.randomBytes(3).toString('hex')}`;
    this.db
      .prepare(
        'INSERT INTO suppliers (id, name, phone, category, balance_due, last_supply_at, notes) VALUES (?, ?, ?, ?, 0, NULL, ?)'
      )
      .run(
        id,
        input.name.trim(),
        (input.phone || '').trim(),
        (input.category || 'عام').trim(),
        (input.notes || '').trim()
      );
    return this.getSuppliers().find((s) => s.id === id)!;
  }

  public updateSupplier(
    id: string,
    patch: { name?: string; phone?: string; category?: string; notes?: string }
  ): Supplier {
    const existing = this.getSuppliers().find((s) => s.id === id);
    if (!existing) throw new Error('المورد غير موجود.');
    this.db
      .prepare('UPDATE suppliers SET name = ?, phone = ?, category = ?, notes = ? WHERE id = ?')
      .run(
        patch.name?.trim() || existing.name,
        patch.phone !== undefined ? patch.phone.trim() : existing.phone,
        patch.category?.trim() || existing.category,
        patch.notes !== undefined ? patch.notes.trim() : existing.notes || '',
        id
      );
    return this.getSuppliers().find((s) => s.id === id)!;
  }

  public deleteSupplier(id: string): void {
    const existing = this.getSuppliers().find((s) => s.id === id);
    if (!existing) throw new Error('المورد غير موجود.');
    if (existing.balanceDue > 0) {
      throw new Error('لا يمكن حذف مورد له رصيد مستحق. يرجى سداد المديونية أولاً.');
    }
    const usedInPurchases = this.db
      .prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE supplier_id = ?')
      .get(id) as { c: number };
    if (usedInPurchases.c > 0) {
      throw new Error('لا يمكن حذف مورد مرتبط بفواتير توريد سابقة.');
    }
    this.db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  }

  public paySupplierDebt(
    supplierId: string,
    amount: number,
    method: PaymentMethod = 'cash',
    referenceCode = '',
    treasuryId?: string | null
  ): Supplier {
    const supplier = this.getSuppliers().find((s) => s.id === supplierId);
    if (!supplier) throw new Error('المورد غير موجود.');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > supplier.balanceDue) {
      throw new Error('المبلغ غير صالح أو أكبر من الرصيد المستحق.');
    }
    const now = new Date().toISOString();
    const treasuries = this.deps.getTreasuries();
    const targetType =
      method === 'instapay' ? 'instapay' : method === 'vodafone_cash' ? 'wallet' : 'cash_drawer';
    const treasury =
      (treasuryId ? treasuries.find((t) => t.id === treasuryId) : undefined) ||
      treasuries.find((t) => t.active && t.type === targetType && t.isDefault) ||
      treasuries.find((t) => t.active && t.type === targetType);

    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE suppliers SET balance_due = ROUND(balance_due - ?, 2) WHERE id = ?')
        .run(amt, supplierId);

      this.db
        .prepare(
          `INSERT INTO payment_transactions (id, invoice_id, invoice_number, partner_id, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'settled', ?)`
        )
        .run(
          `tx-${crypto.randomBytes(4).toString('hex')}`,
          `سداد مورد - ${supplier.name}`,
          supplier.id,
          treasury?.id || null,
          treasury?.name || '',
          method,
          treasury?.name ||
            (method === 'instapay'
              ? 'تحويل إنستا باي للمورد'
              : method === 'vodafone_cash'
                ? 'محفظة إلكترونية للمورد'
                : 'صرف نقدي من الخزينة'),
          amt,
          amt,
          referenceCode.trim(),
          now
        );

      if (treasury) {
        this.db
          .prepare(
            'UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?'
          )
          .run(amt, now, treasury.id);
      }
    });
    tx();
    return this.getSuppliers().find((s) => s.id === supplierId)!;
  }

  public getSupplierStatement(supplierId: string) {
    const supplier = this.getSuppliers().find((s) => s.id === supplierId);
    if (!supplier) throw new Error('المورد غير موجود.');

    const purchases = this.deps.getPurchaseOrders().filter((p) => p.supplierId === supplierId);
    const paymentRows = this.db
      .prepare(
        `SELECT * FROM payment_transactions
         WHERE partner_id = ? OR invoice_number = ?
         ORDER BY created_at ASC`
      )
      .all(supplierId, `سداد مورد - ${supplier.name}`) as Array<Record<string, unknown>>;

    const entries: Array<{
      id: string;
      date: string;
      type: 'purchase' | 'payment' | 'return';
      reference: string;
      description: string;
      credit: number;
      debit: number;
      method: string;
      treasuryBreakdown?: string;
      items?: PartnerStatementLineItem[];
    }> = [];

    const itemAgg = new Map<
      string,
      {
        productId: string;
        productName: string;
        unit: string;
        totalQty: number;
        totalAmount: number;
        poIds: Set<string>;
      }
    >();

    for (const po of purchases) {
      const mappedItems: PartnerStatementLineItem[] = po.items.map((it) => {
        const retQty = Number(it.returnedQuantity || 0);
        const activeQty = Number(Math.max(0, it.quantity - retQty).toFixed(3));
        const netLineTotal = roundMoney(activeQty * it.unitCost);
        return {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          returnedQuantity: retQty,
          unitPrice: it.unitCost,
          discountAmount: 0,
          lineTotal: it.lineTotal,
          netLineTotal,
        };
      });

      const returnedOnPoCash = roundMoney(
        (po.returns || []).reduce((s, r) => s + Number(r.cashRefunded || 0), 0)
      );
      const origPaid = roundMoney(po.paidAmount + returnedOnPoCash);

      entries.push({
        id: po.id,
        date: po.createdAt,
        type: 'purchase',
        reference: po.purchaseNumber,
        description: `فاتورة توريد (${po.items.length} أصناف) — ${po.supplierInvoiceRef || 'بدون مرجع'}`,
        credit: po.grandTotal,
        debit: origPaid,
        method: po.paymentSource,
        treasuryBreakdown:
          origPaid > 0 && po.treasuryName ? `${po.treasuryName}: ${origPaid} ج.م` : undefined,
        items: mappedItems,
      });

      for (const ret of po.returns || []) {
        entries.push({
          id: ret.id,
          date: ret.createdAt,
          type: 'return',
          reference: `${po.purchaseNumber}-RET`,
          description:
            ret.debtReduced > 0
              ? `مرتجع توريد ${po.purchaseNumber} (تخفيض مديونية ${ret.debtReduced} ج.م${ret.cashRefunded > 0 ? ` + استرداد نقدي ${ret.cashRefunded} ج.م` : ''})`
              : `مرتجع توريد ${po.purchaseNumber} (استرداد نقدي/بنكي ${ret.cashRefunded} ج.م)`,
          credit: 0,
          debit: roundMoney(ret.debtReduced),
          method: ret.debtReduced > 0 ? 'credit' : 'cash',
        });
      }

      for (const it of mappedItems) {
        const activeQty = Number(Math.max(0, it.quantity - Number(it.returnedQuantity || 0)).toFixed(3));
        if (activeQty <= 0.0001) continue;
        const activeAmt = it.netLineTotal ?? roundMoney(activeQty * it.unitPrice);
        const cur = itemAgg.get(it.productId) || {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          totalQty: 0,
          totalAmount: 0,
          poIds: new Set<string>(),
        };
        cur.totalQty = Number((cur.totalQty + activeQty).toFixed(3));
        cur.totalAmount = roundMoney(cur.totalAmount + activeAmt);
        cur.poIds.add(po.id);
        itemAgg.set(it.productId, cur);
      }
    }

    for (const tx of paymentRows) {
      const invNum = String(tx.invoice_number || '');
      if (invNum.startsWith('PUR-')) continue;
      const tName = String(tx.treasury_name || tx.provider || '');
      entries.push({
        id: String(tx.id),
        date: String(tx.created_at),
        type: 'payment',
        reference: String(tx.reference_code || '') || 'سند صرف',
        description: `سداد دفعة للمورد (${tName})`,
        credit: 0,
        debit: Number(tx.amount),
        method: String(tx.method),
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));

    const entriesNet = entries.reduce((s, e) => s + e.credit - e.debit, 0);
    const openingDiff = roundMoney(supplier.balanceDue - entriesNet);
    if (Math.abs(openingDiff) > 0.05) {
      const baseTs = entries[0]?.date
        ? new Date(entries[0].date).getTime() - 1000
        : Date.now() - 86400 * 1000;
      const openingDate = new Date(baseTs).toISOString();
      entries.unshift({
        id: `opening-${supplierId}`,
        date: openingDate,
        type: openingDiff > 0 ? 'purchase' : 'payment',
        reference: 'رصيد سابق',
        description:
          openingDiff > 0
            ? 'رصيد افتتاحي مستحق للمورد قبل الفواتير المسجلة'
            : 'دفعة مقدمة / رصيد دائن لدى المورد',
        credit: openingDiff > 0 ? openingDiff : 0,
        debit: openingDiff < 0 ? Math.abs(openingDiff) : 0,
        method: openingDiff > 0 ? 'credit' : 'cash',
      });
    }

    const itemizedSummary: PartnerItemizedSummaryRow[] = Array.from(itemAgg.values())
      .map((row) => ({
        productId: row.productId,
        productName: row.productName,
        unit: row.unit,
        totalQty: row.totalQty,
        avgUnitPrice: row.totalQty > 0 ? roundMoney(row.totalAmount / row.totalQty) : 0,
        totalAmount: row.totalAmount,
        invoiceCount: row.poIds.size,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    return {
      partnerType: 'supplier' as const,
      supplier,
      entries,
      itemizedSummary,
      totalSupplied: roundMoney(
        purchases.reduce((s, p) => s + Math.max(0, p.grandTotal - Number(p.returnedTotal || 0)), 0)
      ),
      totalPaid: roundMoney(entries.reduce((s, e) => s + e.debit, 0)),
      closingBalance: supplier.balanceDue,
    };
  }
}
