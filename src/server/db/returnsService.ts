import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Invoice,
  InvoiceReturnItem,
  InvoiceReturnRecord,
  PaymentMethod,
  PriceTier,
  Product,
  StockMovement,
  TreasuryAccount,
  TreasuryType,
} from '../../shared/types.ts';
import { roundMoney } from '../security/requestValidation.ts';
import type { BatchAndPromotionRepository } from './batchAndPromotionRepo.ts';

export type PartialRefundStrategy = 'cash' | 'instapay' | 'wallet' | 'reduce_credit' | 'store_credit';

export interface PartialReturnOrExchangeInput {
  invoiceId: string;
  items: Array<{ invoiceItemId: string; quantity: number }>;
  refundStrategy: PartialRefundStrategy;
  treasuryId?: string | null;
  reason?: string;
  actorName: string;
  terminalName: string;
  exchangeItems?: Array<{
    productId: string;
    quantity: number;
    priceTier?: PriceTier;
    unitSalePrice?: number;
    discountAmount?: number;
  }>;
  exchangeDifferenceMethod?: PaymentMethod;
  exchangeDifferenceTreasuryId?: string | null;
}

export interface PartialReturnDeps {
  db: Database.Database;
  batchRepo: BatchAndPromotionRepository;
  getInvoiceById: (id: string) => Invoice | null;
  getProductById: (id: string) => Product | null;
  getMovementById: (id: string) => StockMovement | null;
  getTreasuries: () => TreasuryAccount[];
  recomputeChain: () => void;
  createSaleInvoice: (input: {
    items: Array<{
      productId: string;
      quantity: number;
      discountAmount?: number;
      priceTier?: PriceTier;
      unitSalePrice?: number;
    }>;
    customerId?: string | null;
    paymentMethod: PaymentMethod;
    treasuryId?: string | null;
    cashierName?: string;
    terminalName?: string;
    notes?: string;
    exchangeForInvoiceId?: string | null;
  }) => { invoice: Invoice; updatedProducts: Product[]; movements: StockMovement[] };
}

/**
 * Executes atomic itemized partial return (and optional linked replacement exchange invoice)
 * with exact proportional discount/COGS preservation, stock & batch restoration,
 * customer debt/store-credit/loyalty adjustment, treasury ledger updates, and SHA-256 chain recomputation.
 */
export function executePartialReturnOrExchange(
  deps: PartialReturnDeps,
  input: PartialReturnOrExchangeInput
): {
  invoice: Invoice;
  returnRecord: InvoiceReturnRecord;
  exchangeInvoice: Invoice | null;
  netExchangeDifference: number;
  updatedProducts: Product[];
  movements: StockMovement[];
} {
  if (!input.items || input.items.length === 0) {
    throw new Error('يجب تحديد صنف واحد على الأقل لإتمام المرتجع الجزئي.');
  }

  const existing = deps.getInvoiceById(input.invoiceId);
  if (!existing) throw new Error('الفاتورة غير موجودة.');
  if (existing.status === 'returned') throw new Error('هذه الفاتورة مرتجعة بالكامل بالفعل.');

  const safeActor = (input.actorName || 'صاحب المحل').trim();
  const safeTerminal = (input.terminalName || 'إدارة الفواتير').trim();
  const safeReason = (input.reason || 'مرتجع جزئي / استبدال').trim();
  const now = new Date().toISOString();

  // Compute current original net ratio to preserve any invoice-level discount / promotion / loyalty discount
  const originalInvoiceTotal = roundMoney(existing.grandTotal + Number(existing.returnedTotal || 0));
  const fullItemsLineSum = roundMoney(existing.items.reduce((s, it) => s + Number(it.lineTotal || 0), 0));
  const netRatio = fullItemsLineSum > 0 ? originalInvoiceTotal / fullItemsLineSum : 1;

  // Map requested returns cleanly and check bounds
  const reqQtyByItemId = new Map<string, number>();
  for (const r of input.items) {
    const q = Number(r.quantity);
    if (!Number.isFinite(q) || q <= 0) throw new Error('كمية المرتجع يجب أن تكون أكبر من صفر.');
    reqQtyByItemId.set(r.invoiceItemId, Number(((reqQtyByItemId.get(r.invoiceItemId) || 0) + q).toFixed(3)));
  }

  let isReturningAllRemaining = true;
  const linePlans: Array<{
    item: Invoice['items'][number];
    returnQty: number;
    refundAmount: number;
    costRecovered: number;
  }> = [];

  for (const item of existing.items) {
    const alreadyReturned = Number(item.returnedQuantity || 0);
    const remainingQty = Number(Math.max(0, item.quantity - alreadyReturned).toFixed(3));
    const reqQty = reqQtyByItemId.get(item.id) || 0;
    if (reqQty > remainingQty + 0.0001) {
      throw new Error(`الكمية المطلوب إرجاعها من "${item.productName}" (${reqQty}) تتجاوز المتبقي بالفاتورة (${remainingQty}).`);
    }
    if (remainingQty - reqQty > 0.0001) {
      isReturningAllRemaining = false;
    }
    if (reqQty > 0) {
      const unitNetPrice = item.quantity > 0 ? (item.lineTotal / item.quantity) * netRatio : 0;
      const refundAmount = roundMoney(unitNetPrice * reqQty);
      const costRecovered = roundMoney(item.unitCostAtSale * reqQty);
      linePlans.push({ item, returnQty: reqQty, refundAmount, costRecovered });
    }
  }

  for (const reqId of reqQtyByItemId.keys()) {
    if (!existing.items.some((it) => it.id === reqId)) {
      throw new Error('أحد بنود المرتجع لا ينتمي لهذه الفاتورة.');
    }
  }

  if (linePlans.length === 0) {
    throw new Error('لم يتم تحديد كميات صالحة للإرجاع.');
  }

  let returnTotal = roundMoney(linePlans.reduce((s, p) => s + p.refundAmount, 0));
  let costRecoveredTotal = roundMoney(linePlans.reduce((s, p) => s + p.costRecovered, 0));

  if (isReturningAllRemaining) {
    // Reconcile any penny rounding remainder so final invoice reaches strictly 0.00
    returnTotal = roundMoney(existing.grandTotal);
    costRecoveredTotal = roundMoney(existing.totalCostAtSale);
    if (linePlans.length > 0) {
      const sumExceptLast = roundMoney(linePlans.slice(0, -1).reduce((s, p) => s + p.refundAmount, 0));
      linePlans[linePlans.length - 1].refundAmount = roundMoney(Math.max(0, returnTotal - sumExceptLast));
    }
  } else {
    returnTotal = Math.min(roundMoney(existing.grandTotal), returnTotal);
    costRecoveredTotal = Math.min(roundMoney(existing.totalCostAtSale), costRecoveredTotal);
  }

  const allTreasuries = deps.getTreasuries();
  const resolveRefundTreasury = (strategy: PartialRefundStrategy): TreasuryAccount | null => {
    if (strategy === 'reduce_credit' || strategy === 'store_credit') return null;
    if (input.treasuryId) {
      const explicit = allTreasuries.find((t) => t.id === input.treasuryId);
      if (explicit) return explicit;
    }
    const typeMap: Record<'cash' | 'instapay' | 'wallet', TreasuryType> = {
      cash: 'cash_drawer',
      instapay: 'instapay',
      wallet: 'wallet',
    };
    const tType = typeMap[strategy];
    return (
      allTreasuries.find((t) => t.active && t.type === tType && t.isDefault) ||
      allTreasuries.find((t) => t.active && t.type === tType) ||
      null
    );
  };

  let cashRefunded = 0;
  let creditDebtReduced = 0;
  let storeCreditAdded = 0;
  let refundTreasury: TreasuryAccount | null = null;

  if (input.refundStrategy === 'reduce_credit') {
    if (!existing.customerId) {
      throw new Error('لا يمكن خصم المديونية لأن الفاتورة غير مرتبطة بعميل مسجل.');
    }
    const cRow = deps.db
      .prepare('SELECT balance_due FROM customers WHERE id = ?')
      .get(existing.customerId) as { balance_due: number } | undefined;
    const curDebt = Number(cRow?.balance_due || 0);
    creditDebtReduced = roundMoney(Math.min(curDebt, returnTotal));
    storeCreditAdded = roundMoney(Math.max(0, returnTotal - creditDebtReduced));
  } else if (input.refundStrategy === 'store_credit') {
    if (!existing.customerId) {
      throw new Error('يجب ربط الفاتورة بعميل مسجل لإضافة رصيد دائن (Store Credit).');
    }
    storeCreditAdded = returnTotal;
  } else {
    refundTreasury = resolveRefundTreasury(input.refundStrategy);
    if (refundTreasury?.type === 'cash_drawer' || input.refundStrategy === 'cash') {
      cashRefunded = returnTotal;
    }
  }

  const updatedProducts: Product[] = [];
  const movements: StockMovement[] = [];
  const returnId = `ret-${crypto.randomBytes(4).toString('hex')}`;
  const createdReturnItems: InvoiceReturnItem[] = [];

  const tx = deps.db.transaction(() => {
    for (const plan of linePlans) {
      const prod = deps.getProductById(plan.item.productId);
      if (prod) {
        const nextStock = Number((prod.stockQty + plan.returnQty).toFixed(3));
        deps.db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(nextStock, now, prod.id);
        deps.batchRepo.restoreBatchQty(prod.id, plan.returnQty);

        const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
        deps.db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            moveId,
            prod.id,
            prod.name,
            plan.returnQty,
            nextStock,
            `مرتجع جزئي ${existing.invoiceNumber} (${safeReason})`,
            safeTerminal,
            safeActor,
            now
          );

        updatedProducts.push({ ...prod, stockQty: nextStock, updatedAt: now });
        const mv = deps.getMovementById(moveId);
        if (mv) movements.push(mv);
      }

      const nextItemReturned = Number(((plan.item.returnedQuantity || 0) + plan.returnQty).toFixed(3));
      deps.db
        .prepare('UPDATE invoice_items SET returned_quantity = ? WHERE id = ?')
        .run(nextItemReturned, plan.item.id);
    }

    const nextReturnedTotal = roundMoney(Number(existing.returnedTotal || 0) + returnTotal);
    const nextGrandTotal = isReturningAllRemaining ? 0 : roundMoney(Math.max(0, existing.grandTotal - returnTotal));
    const nextTotalCost = isReturningAllRemaining
      ? 0
      : roundMoney(Math.max(0, existing.totalCostAtSale - costRecoveredTotal));
    const nextTotalProfit = roundMoney(nextGrandTotal - nextTotalCost);
    const nextStatus = isReturningAllRemaining ? 'returned' : 'partial_returned';

    deps.db
      .prepare(
        `UPDATE invoices
         SET status = ?, returned_total = ?, grand_total = ?, total_cost_at_sale = ?, total_profit = ?
         WHERE id = ?`
      )
      .run(nextStatus, nextReturnedTotal, nextGrandTotal, nextTotalCost, nextTotalProfit, existing.id);

    if (isReturningAllRemaining) {
      deps.db.prepare("UPDATE payment_transactions SET status = 'refunded' WHERE invoice_id = ?").run(existing.id);
    }

    if (existing.customerId) {
      const custRow = deps.db
        .prepare('SELECT total_purchases, balance_due, store_credit_balance, loyalty_points FROM customers WHERE id = ?')
        .get(existing.customerId) as
        | {
            total_purchases: number;
            balance_due: number;
            store_credit_balance: number;
            loyalty_points: number;
          }
        | undefined;
      if (custRow) {
        const nextTotalPurchases = roundMoney(Math.max(0, Number(custRow.total_purchases) - returnTotal));
        const nextBalanceDue = roundMoney(Math.max(0, Number(custRow.balance_due) - creditDebtReduced));
        const nextStoreCredit = roundMoney(Number(custRow.store_credit_balance || 0) + storeCreditAdded);
        const origPoints = Number(existing.loyaltyPointsEarned || 0);
        const ratio = originalInvoiceTotal > 0 ? returnTotal / originalInvoiceTotal : 0;
        const pointsDeduct = roundMoney(origPoints * ratio);
        const nextPoints = roundMoney(Math.max(0, Number(custRow.loyalty_points || 0) - pointsDeduct));

        deps.db
          .prepare(
            `UPDATE customers
             SET total_purchases = ?, balance_due = ?, store_credit_balance = ?, loyalty_points = ?
             WHERE id = ?`
          )
          .run(nextTotalPurchases, nextBalanceDue, nextStoreCredit, nextPoints, existing.customerId);
      }
    }

    const treasuryRefundAmt = roundMoney(returnTotal - creditDebtReduced - storeCreditAdded);
    if (treasuryRefundAmt > 0 && refundTreasury) {
      deps.db
        .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?')
        .run(treasuryRefundAmt, now, refundTreasury.id);

      const method: Exclude<PaymentMethod, 'split'> =
        input.refundStrategy === 'instapay'
          ? 'instapay'
          : input.refundStrategy === 'wallet'
            ? 'vodafone_cash'
            : 'cash';

      deps.db
        .prepare(
          `INSERT INTO payment_transactions (id, invoice_id, invoice_number, partner_id, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'refunded', ?)`
        )
        .run(
          `tx-ret-${crypto.randomBytes(4).toString('hex')}`,
          existing.id,
          existing.invoiceNumber,
          existing.customerId || null,
          refundTreasury.id,
          refundTreasury.name,
          method,
          `رد نقدي مرتجع - ${refundTreasury.name}`,
          treasuryRefundAmt,
          treasuryRefundAmt,
          safeReason,
          now
        );
    }

    deps.db
      .prepare(
        `INSERT INTO invoice_returns (
          id, invoice_id, created_at, actor_name, reason, return_total, cash_refunded,
          credit_debt_reduced, store_credit_added, treasury_id, treasury_name,
          exchange_invoice_id, exchange_invoice_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        returnId,
        existing.id,
        now,
        safeActor,
        safeReason,
        returnTotal,
        cashRefunded,
        creditDebtReduced,
        storeCreditAdded,
        refundTreasury?.id || null,
        refundTreasury?.name || (storeCreditAdded > 0 ? 'رصيد دائن للعميل' : creditDebtReduced > 0 ? 'خصم من الآجل' : '')
      );

    const insRetItem = deps.db.prepare(
      `INSERT INTO invoice_return_items (id, return_id, invoice_item_id, product_id, product_name, quantity, refund_amount, cost_recovered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const plan of linePlans) {
      const retItemId = `rti-${crypto.randomBytes(4).toString('hex')}`;
      insRetItem.run(
        retItemId,
        returnId,
        plan.item.id,
        plan.item.productId,
        plan.item.productName,
        plan.returnQty,
        plan.refundAmount,
        plan.costRecovered
      );
      createdReturnItems.push({
        id: retItemId,
        returnId,
        invoiceItemId: plan.item.id,
        productId: plan.item.productId,
        productName: plan.item.productName,
        quantity: plan.returnQty,
        refundAmount: plan.refundAmount,
        costRecovered: plan.costRecovered,
      });
    }

    deps.recomputeChain();
  });

  tx();

  // Optional linked replacement exchange invoice created cleanly right after return commit
  let exchangeInvoice: Invoice | null = null;
  let netExchangeDifference = roundMoney(-returnTotal);

  if (input.exchangeItems && input.exchangeItems.length > 0) {
    const exMethod: PaymentMethod = input.exchangeDifferenceMethod || 'cash';
    const exResult = deps.createSaleInvoice({
      items: input.exchangeItems,
      customerId: existing.customerId,
      paymentMethod: exMethod,
      treasuryId: input.exchangeDifferenceTreasuryId || input.treasuryId || null,
      cashierName: safeActor,
      terminalName: safeTerminal,
      notes: `فاتورة استبدال مرتبطة بمرتجع ${existing.invoiceNumber}`,
      exchangeForInvoiceId: existing.id,
    });
    exchangeInvoice = exResult.invoice;
    netExchangeDifference = roundMoney(exchangeInvoice.grandTotal - returnTotal);
    updatedProducts.push(...exResult.updatedProducts);
    movements.push(...exResult.movements);

    deps.db
      .prepare('UPDATE invoice_returns SET exchange_invoice_id = ?, exchange_invoice_number = ? WHERE id = ?')
      .run(exchangeInvoice.id, exchangeInvoice.invoiceNumber, returnId);
  }

  const returnRecord: InvoiceReturnRecord = {
    id: returnId,
    invoiceId: existing.id,
    createdAt: now,
    actorName: safeActor,
    reason: safeReason,
    returnTotal,
    cashRefunded,
    creditDebtReduced,
    storeCreditAdded,
    treasuryId: refundTreasury?.id || null,
    treasuryName:
      refundTreasury?.name || (storeCreditAdded > 0 ? 'رصيد دائن للعميل' : creditDebtReduced > 0 ? 'خصم من الآجل' : ''),
    exchangeInvoiceId: exchangeInvoice?.id || null,
    exchangeInvoiceNumber: exchangeInvoice?.invoiceNumber || null,
    items: createdReturnItems,
  };

  return {
    invoice: deps.getInvoiceById(existing.id)!,
    returnRecord,
    exchangeInvoice,
    netExchangeDifference,
    updatedProducts,
    movements,
  };
}
