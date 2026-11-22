import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  PaymentMethod,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseReturnItem,
  PurchaseReturnRecord,
  StockMovement,
  StoreActivityId,
  StoreSettings,
  Supplier,
  TreasuryAccount,
  TreasuryType,
} from '../../shared/types.ts';
import { roundMoney, sanitizeText } from '../security/requestValidation.ts';
import type { BatchAndPromotionRepository } from './batchAndPromotionRepo.ts';

export interface PurchasesRepoDeps {
  getSettings: () => StoreSettings;
  getProductById: (id: string) => Product | null;
  getSuppliers: () => Supplier[];
  getTreasuries: () => TreasuryAccount[];
  getMovementById: (id: string) => StockMovement | null;
  nextYearlySequenceNumber: (table: string, col: string, prefix: string) => string;
  batchRepo: BatchAndPromotionRepository;
}

/**
 * PurchasesAndStocktakeRepository owns Purchase Orders, atomic Purchase Returns to Suppliers,
 * and physical inventory stocktake reconciliation.
 */
export class PurchasesAndStocktakeRepository {
  private readonly db: Database.Database;
  private readonly deps: PurchasesRepoDeps;

  constructor(db: Database.Database, deps: PurchasesRepoDeps) {
    this.db = db;
    this.deps = deps;
  }

  private mapPurchaseItemRow(it: Record<string, unknown>): PurchaseOrderItem {
    return {
      id: String(it.id),
      purchaseId: String(it.purchase_id),
      productId: String(it.product_id),
      productName: String(it.product_name),
      unit: String(it.unit),
      quantity: Number(it.quantity),
      returnedQuantity: Number(it.returned_quantity || 0),
      unitCost: Number(it.unit_cost),
      newSalePrice:
        it.new_sale_price !== null && it.new_sale_price !== undefined
          ? Number(it.new_sale_price)
          : undefined,
      batchCode: it.batch_code ? String(it.batch_code) : undefined,
      expiryDate: it.expiry_date ? String(it.expiry_date) : null,
      lineTotal: Number(it.line_total),
    };
  }

  private mapPurchaseReturnsByOrder(): Map<string, PurchaseReturnRecord[]> {
    const retRows = this.db
      .prepare('SELECT * FROM purchase_returns ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    const itemRows = this.db
      .prepare('SELECT * FROM purchase_return_items')
      .all() as Array<Record<string, unknown>>;

    const itemsByReturn = new Map<string, PurchaseReturnItem[]>();
    for (const r of itemRows) {
      const rid = String(r.return_id);
      const arr = itemsByReturn.get(rid) || [];
      arr.push({
        id: String(r.id),
        returnId: rid,
        purchaseItemId: String(r.purchase_item_id),
        productId: String(r.product_id),
        productName: String(r.product_name),
        quantity: Number(r.quantity),
        refundAmount: Number(r.refund_amount),
      });
      itemsByReturn.set(rid, arr);
    }

    const byPurchase = new Map<string, PurchaseReturnRecord[]>();
    for (const r of retRows) {
      const pid = String(r.purchase_id);
      const rid = String(r.id);
      const arr = byPurchase.get(pid) || [];
      arr.push({
        id: rid,
        purchaseId: pid,
        createdAt: String(r.created_at),
        actorName: String(r.actor_name),
        reason: String(r.reason || ''),
        returnTotal: Number(r.return_total || 0),
        debtReduced: Number(r.debt_reduced || 0),
        cashRefunded: Number(r.cash_refunded || 0),
        treasuryId: r.treasury_id ? String(r.treasury_id) : null,
        treasuryName: String(r.treasury_name || ''),
        items: itemsByReturn.get(rid) || [],
      });
      byPurchase.set(pid, arr);
    }
    return byPurchase;
  }

  private mapPurchaseOrderRow(
    r: Record<string, unknown>,
    items: PurchaseOrderItem[],
    returns: PurchaseReturnRecord[] = []
  ): PurchaseOrder {
    return {
      id: String(r.id),
      purchaseNumber: String(r.purchase_number),
      supplierId: String(r.supplier_id),
      supplierName: String(r.supplier_name),
      activityId: String(r.activity_id) as StoreActivityId,
      createdAt: String(r.created_at),
      actorName: String(r.actor_name),
      supplierInvoiceRef: String(r.supplier_invoice_ref || ''),
      grandTotal: Number(r.grand_total),
      returnedTotal: Number(r.returned_total || 0),
      paidAmount: Number(r.paid_amount),
      remainingDebt: Number(r.remaining_debt),
      paymentSource: String(r.payment_source) as 'cash' | 'bank_transfer' | 'credit',
      treasuryId: r.treasury_id ? String(r.treasury_id) : null,
      treasuryName: String(r.treasury_name || ''),
      notes: String(r.notes || ''),
      items,
      returns,
    };
  }

  public getPurchaseOrders(): PurchaseOrder[] {
    const rows = this.db
      .prepare('SELECT * FROM purchase_orders ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    const allItemRows = this.db
      .prepare('SELECT * FROM purchase_items')
      .all() as Array<Record<string, unknown>>;
    const returnsByPurchase = this.mapPurchaseReturnsByOrder();

    const itemsByPurchase = new Map<string, PurchaseOrderItem[]>();
    for (const it of allItemRows) {
      const pid = String(it.purchase_id);
      const list = itemsByPurchase.get(pid) || [];
      list.push(this.mapPurchaseItemRow(it));
      itemsByPurchase.set(pid, list);
    }

    return rows.map((r) => {
      const id = String(r.id);
      return this.mapPurchaseOrderRow(
        r,
        itemsByPurchase.get(id) || [],
        returnsByPurchase.get(id) || []
      );
    });
  }

  public getPurchaseOrderById(id: string): PurchaseOrder | null {
    const r = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    const itemRows = this.db
      .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
      .all(id) as Array<Record<string, unknown>>;
    const returnsByPurchase = this.mapPurchaseReturnsByOrder();
    return this.mapPurchaseOrderRow(
      r,
      itemRows.map((it) => this.mapPurchaseItemRow(it)),
      returnsByPurchase.get(id) || []
    );
  }

  public createPurchaseOrder(input: {
    supplierId: string;
    supplierInvoiceRef?: string;
    paidAmount: number;
    paymentSource: 'cash' | 'bank_transfer' | 'credit';
    treasuryId?: string | null;
    notes?: string;
    actorName: string;
    terminalName: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitCost: number;
      newSalePrice?: number;
      batchCode?: string;
      expiryDate?: string | null;
    }>;
  }): {
    purchase: PurchaseOrder;
    updatedProducts: Product[];
    movements: StockMovement[];
  } {
    if (!input.items || input.items.length === 0) {
      throw new Error('يجب إضافة صنف واحد على الأقل في فاتورة المشتريات.');
    }
    const supplier = this.deps.getSuppliers().find((s) => s.id === input.supplierId);
    if (!supplier) throw new Error('المورد غير موجود.');

    const settings = this.deps.getSettings();
    const now = new Date().toISOString();
    const purchaseId = `pur-${crypto.randomBytes(4).toString('hex')}`;
    const purchaseNumber = this.deps.nextYearlySequenceNumber(
      'purchase_orders',
      'purchase_number',
      'PUR'
    );

    const resolvedItems: Array<{
      id: string;
      product: Product;
      quantity: number;
      unitCost: number;
      newSalePrice?: number;
      batchCode: string;
      expiryDate: string | null;
      lineTotal: number;
    }> = [];

    let grandTotal = 0;
    for (const raw of input.items) {
      const prod = this.deps.getProductById(raw.productId);
      if (!prod) throw new Error('أحد الأصناف المختارة غير موجود.');
      const qty = Number(raw.quantity);
      const cost = Number(raw.unitCost);
      if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost < 0) {
        throw new Error(`الكمية أو التكلفة غير صالحة للصنف: ${prod.name}`);
      }
      const lineTotal = roundMoney(qty * cost);
      grandTotal = roundMoney(grandTotal + lineTotal);
      resolvedItems.push({
        id: `pi-${crypto.randomBytes(4).toString('hex')}`,
        product: prod,
        quantity: qty,
        unitCost: cost,
        newSalePrice:
          raw.newSalePrice !== undefined &&
          Number.isFinite(Number(raw.newSalePrice)) &&
          Number(raw.newSalePrice) > 0
            ? Number(raw.newSalePrice)
            : undefined,
        batchCode: (raw.batchCode || '').trim(),
        expiryDate:
          raw.expiryDate && String(raw.expiryDate).trim()
            ? String(raw.expiryDate).trim().slice(0, 10)
            : null,
        lineTotal,
      });
    }

    const actorName = (input.actorName || '').trim() || 'النظام';
    const terminalName = (input.terminalName || '').trim() || 'إدارة المشتريات';
    const paymentSource = input.paymentSource || 'cash';
    const rawPaid = Number(input.paidAmount ?? 0);
    if (!Number.isFinite(rawPaid) || rawPaid < 0) {
      throw new Error('قيمة المبلغ المدفوع غير صالحة.');
    }

    const paidAmount =
      paymentSource === 'credit' ? 0 : roundMoney(Math.max(0, Math.min(grandTotal, rawPaid)));
    const remainingDebt = roundMoney(Math.max(0, grandTotal - paidAmount));

    const treasuries = this.deps.getTreasuries();
    let treasury: TreasuryAccount | null = null;
    if (paymentSource !== 'credit' && paidAmount > 0) {
      if (input.treasuryId) {
        treasury = treasuries.find((t) => t.id === input.treasuryId) || null;
      }
      if (!treasury) {
        const preferredTypes: TreasuryType[] =
          paymentSource === 'bank_transfer' ? ['instapay', 'bank_pos', 'wallet'] : ['cash_drawer'];
        treasury =
          treasuries.find((t) => t.active && preferredTypes.includes(t.type) && t.isDefault) ||
          treasuries.find((t) => t.active && preferredTypes.includes(t.type)) ||
          null;
      }
    }

    const updatedProductIds: string[] = [];
    const createdMovementIds: string[] = [];

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO purchase_orders (
            id, purchase_number, supplier_id, supplier_name, activity_id, created_at, actor_name,
            supplier_invoice_ref, grand_total, returned_total, paid_amount, remaining_debt, payment_source, treasury_id, treasury_name, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          purchaseId,
          purchaseNumber,
          supplier.id,
          supplier.name,
          settings.activityId,
          now,
          actorName,
          (input.supplierInvoiceRef || '').trim(),
          grandTotal,
          paidAmount,
          remainingDebt,
          paymentSource,
          treasury?.id || null,
          treasury?.name || '',
          (input.notes || '').trim()
        );

      for (const item of resolvedItems) {
        this.db
          .prepare(
            `INSERT INTO purchase_items (id, purchase_id, product_id, product_name, unit, quantity, returned_quantity, unit_cost, new_sale_price, batch_code, expiry_date, line_total)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
          )
          .run(
            item.id,
            purchaseId,
            item.product.id,
            item.product.name,
            item.product.unit,
            item.quantity,
            item.unitCost,
            item.newSalePrice ?? null,
            item.batchCode,
            item.expiryDate,
            item.lineTotal
          );

        if (item.batchCode || item.expiryDate) {
          this.deps.batchRepo.createBatch({
            productId: item.product.id,
            batchCode: item.batchCode || `LOT-${purchaseNumber.slice(-4)}`,
            expiryDate: item.expiryDate,
            qty: item.quantity,
            costPrice: item.unitCost,
            supplierId: supplier.id,
            purchaseId,
            syncProductStock: false,
          });
        }

        const nextQty = Number((item.product.stockQty + item.quantity).toFixed(3));
        const nextSale = item.newSalePrice ?? item.product.currentSalePrice;
        const priceChanged =
          item.unitCost !== item.product.currentCostPrice ||
          nextSale !== item.product.currentSalePrice;

        this.db
          .prepare(
            `UPDATE products
             SET stock_qty = ?, current_cost_price = ?, current_sale_price = ?, supplier_id = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(nextQty, item.unitCost, nextSale, supplier.id, now, item.product.id);

        if (priceChanged) {
          this.db
            .prepare(
              `INSERT INTO product_price_history (id, product_id, product_name, old_cost_price, new_cost_price, old_sale_price, new_sale_price, changed_by, reason, changed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              `ph-${crypto.randomBytes(4).toString('hex')}`,
              item.product.id,
              item.product.name,
              item.product.currentCostPrice,
              item.unitCost,
              item.product.currentSalePrice,
              nextSale,
              actorName,
              `تحديث سعر عند فاتورة التوريد ${purchaseNumber}`,
              now
            );
        }

        const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
        this.db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            moveId,
            item.product.id,
            item.product.name,
            item.quantity,
            nextQty,
            `فاتورة توريد ${purchaseNumber} — ${supplier.name}`,
            terminalName,
            actorName,
            now
          );

        updatedProductIds.push(item.product.id);
        createdMovementIds.push(moveId);
      }

      this.db
        .prepare(
          'UPDATE suppliers SET balance_due = ROUND(balance_due + ?, 2), last_supply_at = ? WHERE id = ?'
        )
        .run(remainingDebt, now, supplier.id);

      if (paidAmount > 0 && treasury) {
        const txMethod: PaymentMethod =
          treasury.type === 'instapay'
            ? 'instapay'
            : treasury.type === 'wallet'
              ? 'vodafone_cash'
              : treasury.type === 'bank_pos'
                ? 'card'
                : 'cash';

        this.db
          .prepare(
            'UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?'
          )
          .run(paidAmount, now, treasury.id);

        this.db
          .prepare(
            `INSERT INTO payment_transactions (id, invoice_id, invoice_number, partner_id, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'settled', ?)`
          )
          .run(
            `tx-${crypto.randomBytes(4).toString('hex')}`,
            purchaseNumber,
            supplier.id,
            treasury.id,
            treasury.name,
            txMethod,
            `صرف توريد - ${supplier.name}`,
            paidAmount,
            paidAmount,
            (input.supplierInvoiceRef || '').trim() || purchaseNumber,
            now
          );
      }
    });

    tx();

    const purchase = this.getPurchaseOrderById(purchaseId)!;
    const updatedProducts = updatedProductIds.map((pid) => this.deps.getProductById(pid)!);
    const movements = createdMovementIds.map((mid) => this.deps.getMovementById(mid)!);
    return { purchase, updatedProducts, movements };
  }

  /**
   * Atomic Purchase Return to Supplier:
   * 1) Validates return quantities <= purchased - already returned, and checks stock sufficiency
   * 2) Deducts stock & linked PO batches + logs stock movements
   * 3) Reduces PO remainingDebt and supplier.balanceDue up to remaining debt
   * 4) Refunds any paid excess into selected treasury and records ledger transaction
   */
  public createPurchaseReturn(input: {
    purchaseId: string;
    items: Array<{ purchaseItemId: string; quantity: number }>;
    treasuryId?: string | null;
    reason?: string;
    actorName: string;
    terminalName?: string;
  }): {
    purchase: PurchaseOrder;
    returnRecord: PurchaseReturnRecord;
    updatedProducts: Product[];
    movements: StockMovement[];
  } {
    const po = this.getPurchaseOrderById(input.purchaseId);
    if (!po) throw new Error('فاتورة المشتريات غير موجودة.');
    const requested = (input.items || []).filter((i) => Number(i.quantity) > 0);
    if (requested.length === 0) {
      throw new Error('يرجى تحديد كمية صنف واحدة على الأقل لإرجاعها للمورد.');
    }

    const settings = this.deps.getSettings();
    const now = new Date().toISOString();
    const actorName = sanitizeText(input.actorName, 80) || 'المسؤول';
    const terminalName = sanitizeText(input.terminalName, 80) || 'مرتجع مشتريات';
    const reason = sanitizeText(input.reason, 200) || `مرتجع بضاعة للمورد — ${po.purchaseNumber}`;

    const resolvedLines: Array<{
      poItem: PurchaseOrderItem;
      product: Product;
      qty: number;
      refundAmount: number;
    }> = [];

    let returnTotal = 0;
    for (const req of requested) {
      const poItem = po.items.find((it) => it.id === req.purchaseItemId);
      if (!poItem) throw new Error('أحد الأصناف المحددة غير موجود بفاتورة الشراء.');
      const alreadyReturned = Number(poItem.returnedQuantity || 0);
      const maxReturnable = Number((poItem.quantity - alreadyReturned).toFixed(3));
      const qty = Number(req.quantity);
      if (!Number.isFinite(qty) || qty <= 0 || qty > maxReturnable + 0.0001) {
        throw new Error(
          `الكمية المرتجعة للصنف (${poItem.productName}) تتجاوز الكمية المتاحة للإرجاع (${maxReturnable}).`
        );
      }
      const product = this.deps.getProductById(poItem.productId);
      if (!product) throw new Error(`الصنف (${poItem.productName}) لم يعد موجوداً في قاعدة البضاعة.`);
      if (!settings.allowNegativeStock && product.stockQty < qty - 0.0001) {
        throw new Error(
          `الرصيد الحالي للصنف (${product.name}) هو ${product.stockQty} ولا يكفي لإرجاع ${qty} للمورد.`
        );
      }

      const refundAmount = roundMoney(qty * poItem.unitCost);
      returnTotal = roundMoney(returnTotal + refundAmount);
      resolvedLines.push({ poItem, product, qty, refundAmount });
    }

    const supplier = this.deps.getSuppliers().find((s) => s.id === po.supplierId);
    const maxDebtOnPoAndSupplier = Math.max(
      0,
      Math.min(po.remainingDebt, supplier?.balanceDue ?? po.remainingDebt)
    );
    const debtReduced = roundMoney(Math.min(returnTotal, maxDebtOnPoAndSupplier));
    const cashRefunded = roundMoney(Math.max(0, returnTotal - debtReduced));

    const treasuries = this.deps.getTreasuries();
    let treasury: TreasuryAccount | null = null;
    if (cashRefunded > 0) {
      treasury =
        (input.treasuryId ? treasuries.find((t) => t.id === input.treasuryId) : undefined) ||
        (po.treasuryId ? treasuries.find((t) => t.id === po.treasuryId) : undefined) ||
        treasuries.find((t) => t.active && t.type === 'cash_drawer' && t.isDefault) ||
        treasuries.find((t) => t.active) ||
        null;
      if (!treasury) {
        throw new Error('لا توجد خزينة نشطة لاسترداد قيمة المرتجع النقدي من المورد.');
      }
    }

    const returnId = `pret-${crypto.randomBytes(4).toString('hex')}`;
    const updatedProductIds: string[] = [];
    const createdMovementIds: string[] = [];

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO purchase_returns (id, purchase_id, created_at, actor_name, reason, return_total, debt_reduced, cash_refunded, treasury_id, treasury_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          returnId,
          po.id,
          now,
          actorName,
          reason,
          returnTotal,
          debtReduced,
          cashRefunded,
          treasury?.id || null,
          treasury?.name || ''
        );

      for (const line of resolvedLines) {
        this.db
          .prepare(
            `INSERT INTO purchase_return_items (id, return_id, purchase_item_id, product_id, product_name, quantity, refund_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `pri-${crypto.randomBytes(4).toString('hex')}`,
            returnId,
            line.poItem.id,
            line.product.id,
            line.product.name,
            line.qty,
            line.refundAmount
          );

        const nextItemReturned = Number(
          ((line.poItem.returnedQuantity || 0) + line.qty).toFixed(3)
        );
        this.db
          .prepare('UPDATE purchase_items SET returned_quantity = ? WHERE id = ?')
          .run(nextItemReturned, line.poItem.id);

        const nextStock = Number((line.product.stockQty - line.qty).toFixed(3));
        this.db
          .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
          .run(nextStock, now, line.product.id);

        // Deduct from PO-linked batches first if present
        let batchRem = line.qty;
        const linkedBatches = this.db
          .prepare(
            'SELECT id, qty FROM product_batches WHERE product_id = ? AND purchase_id = ? AND qty > 0 ORDER BY created_at DESC'
          )
          .all(line.product.id, po.id) as Array<{ id: string; qty: number }>;
        for (const b of linkedBatches) {
          if (batchRem <= 0.0001) break;
          const take = Math.min(b.qty, batchRem);
          this.db
            .prepare('UPDATE product_batches SET qty = ROUND(qty - ?, 3) WHERE id = ?')
            .run(take, b.id);
          batchRem = Number((batchRem - take).toFixed(3));
        }

        const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
        this.db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            moveId,
            line.product.id,
            line.product.name,
            -line.qty,
            nextStock,
            `مرتجع مشتريات ${po.purchaseNumber} للمورد (${po.supplierName})`,
            terminalName,
            actorName,
            now
          );

        updatedProductIds.push(line.product.id);
        createdMovementIds.push(moveId);
      }

      const nextReturnedTotal = roundMoney((po.returnedTotal || 0) + returnTotal);
      const nextRemainingDebt = roundMoney(Math.max(0, po.remainingDebt - debtReduced));
      const nextPaidAmount = roundMoney(Math.max(0, po.paidAmount - cashRefunded));
      this.db
        .prepare(
          `UPDATE purchase_orders
           SET returned_total = ?, remaining_debt = ?, paid_amount = ?
           WHERE id = ?`
        )
        .run(nextReturnedTotal, nextRemainingDebt, nextPaidAmount, po.id);

      if (debtReduced > 0) {
        this.db
          .prepare('UPDATE suppliers SET balance_due = ROUND(MAX(0, balance_due - ?), 2) WHERE id = ?')
          .run(debtReduced, po.supplierId);
      }

      if (cashRefunded > 0 && treasury) {
        const txMethod: PaymentMethod =
          treasury.type === 'instapay'
            ? 'instapay'
            : treasury.type === 'wallet'
              ? 'vodafone_cash'
              : treasury.type === 'bank_pos'
                ? 'card'
                : 'cash';

        this.db
          .prepare(
            'UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?'
          )
          .run(cashRefunded, now, treasury.id);

        this.db
          .prepare(
            `INSERT INTO payment_transactions (id, invoice_id, invoice_number, partner_id, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'settled', ?)`
          )
          .run(
            `tx-${crypto.randomBytes(4).toString('hex')}`,
            `${po.purchaseNumber}-RET`,
            po.supplierId,
            treasury.id,
            treasury.name,
            txMethod,
            `استرداد مرتجع مشتريات - ${po.supplierName}`,
            cashRefunded,
            cashRefunded,
            `${po.purchaseNumber}-RET`,
            now
          );
      }
    });

    tx();

    const updatedPurchase = this.getPurchaseOrderById(po.id)!;
    const returnRecord = updatedPurchase.returns?.find((r) => r.id === returnId)!;
    return {
      purchase: updatedPurchase,
      returnRecord,
      updatedProducts: updatedProductIds.map((pid) => this.deps.getProductById(pid)!),
      movements: createdMovementIds.map((mid) => this.deps.getMovementById(mid)!),
    };
  }

  public applyStocktake(input: {
    items: Array<{ productId: string; actualQty: number }>;
    reason?: string;
    actorName: string;
    terminalName: string;
  }): { adjustedCount: number; updatedProducts: Product[]; movements: StockMovement[] } {
    if (!input.items || input.items.length === 0) {
      throw new Error('لا توجد أصناف لتطبيق الجرد.');
    }
    const actorName = (input.actorName || '').trim() || 'النظام';
    const terminalName = (input.terminalName || '').trim() || 'جرد المخزون الفعلي';
    const now = new Date().toISOString();
    const updatedProductIds: string[] = [];
    const createdMovementIds: string[] = [];

    const tx = this.db.transaction(() => {
      for (const row of input.items) {
        const prod = this.deps.getProductById(row.productId);
        if (!prod) continue;
        const actual = Math.max(0, Number(row.actualQty));
        if (!Number.isFinite(actual)) continue;
        const delta = Number((actual - prod.stockQty).toFixed(3));
        if (Math.abs(delta) < 0.0001) continue;

        this.db
          .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
          .run(actual, now, prod.id);

        const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
        this.db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            moveId,
            prod.id,
            prod.name,
            delta,
            actual,
            input.reason?.trim() || `مطابقة جرد فعلي (${delta > 0 ? 'فائض' : 'عجز'})`,
            terminalName,
            actorName,
            now
          );

        updatedProductIds.push(prod.id);
        createdMovementIds.push(moveId);
      }
    });

    tx();

    return {
      adjustedCount: updatedProductIds.length,
      updatedProducts: updatedProductIds.map((pid) => this.deps.getProductById(pid)!),
      movements: createdMovementIds.map((mid) => this.deps.getMovementById(mid)!),
    };
  }
}
