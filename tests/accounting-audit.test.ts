import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StoreDatabase as StoreDatabaseType } from '../src/server/db/storeDatabase.ts';
import {
  computeSchedulePeriodWindow,
  formatDigestEmailHtml,
  formatDigestEmailText,
  isScheduleDue,
  ScheduledReportsService,
} from '../src/server/services/scheduledReportsService.ts';
import { SlidingWindowRateLimiter } from '../src/server/security/rateLimiter.ts';
import { computeWhatIfProjection, createDefaultWhatIfInputs } from '../src/shared/whatIfMath.ts';
import { matchScaleBarcode } from '../src/utils/scaleBarcode.ts';

const TEMP_DB_PATH = path.join(
  os.tmpdir(),
  `tajirpro-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.SQLITE_PATH = TEMP_DB_PATH;

let db: StoreDatabaseType;

describe('TajirPro Comprehensive Financial, Inventory & Shift Accounting Audit', () => {
  before(async () => {
    const mod = await import('../src/server/db/storeDatabase.ts');
    db = new mod.StoreDatabase();
  });

  after(() => {
    if (db) {
      db.close();
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${TEMP_DB_PATH}${suffix}`;
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
  });

  it('1. Multi-tier Pricing (retail/half_wholesale/wholesale), Discount Clamping & Product Profit Consistency', () => {
    const { product } = db.createProduct({
      name: 'صنف اختبار التسعير المتعدد',
      category: 'مواد غذائية',
      unit: 'كجم',
      currentCostPrice: 40,
      currentSalePrice: 100,
      halfWholesalePrice: 85,
      wholesalePrice: 70,
      stockQty: 50,
      minStockAlert: 5,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    // Excess invoice discount clamping: 3*70 (210) + (2*85 - 20 = 150) = 360 -> discount 9999 clamps to 360
    const clampedSale = db.createSaleInvoice({
      items: [
        { productId: product.id, quantity: 3, priceTier: 'wholesale' },
        { productId: product.id, quantity: 2, priceTier: 'half_wholesale', discountAmount: 20 },
      ],
      paymentMethod: 'cash',
      invoiceDiscount: 9999,
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(clampedSale.invoice.subtotal, 380);
    assert.equal(clampedSale.invoice.discountTotal, 380);
    assert.equal(clampedSale.invoice.grandTotal, 0);
    assert.equal(clampedSale.invoice.totalCostAtSale, 200);
    assert.equal(clampedSale.invoice.totalProfit, -200);

    // Standard multi-tier sale without excessive discount
    const normalSale = db.createSaleInvoice({
      items: [
        { productId: product.id, quantity: 2, priceTier: 'retail' }, // 200
        { productId: product.id, quantity: 3, priceTier: 'wholesale' }, // 210
      ],
      paymentMethod: 'cash',
      invoiceDiscount: 10,
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(normalSale.invoice.subtotal, 410);
    assert.equal(normalSale.invoice.discountTotal, 10);
    assert.equal(normalSale.invoice.grandTotal, 400);
    assert.equal(normalSale.invoice.totalCostAtSale, 200);
    assert.equal(normalSale.invoice.totalProfit, 200);
    assert.equal(normalSale.invoice.items[0].priceTier, 'retail');
    assert.equal(normalSale.invoice.items[0].unitSalePrice, 100);
    assert.equal(normalSale.invoice.items[1].priceTier, 'wholesale');
    assert.equal(normalSale.invoice.items[1].unitSalePrice, 70);

    const today = new Date().toISOString().slice(0, 10);
    const reports = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });

    const sumProductRev = Number(reports.productProfitRows.reduce((s, r) => s + r.revenue, 0).toFixed(2));
    const sumProductCost = Number(reports.productProfitRows.reduce((s, r) => s + r.historicalCost, 0).toFixed(2));
    const sumProductProfit = Number(reports.productProfitRows.reduce((s, r) => s + r.historicalProfit, 0).toFixed(2));
    assert.equal(sumProductRev, reports.totals.revenue);
    assert.equal(sumProductCost, reports.totals.cost);
    assert.equal(sumProductProfit, reports.totals.profit);
  });

  it('2. Split Allocations (Cash + Card) & Card Fee Deduction in Treasury + ProfitLoss', () => {
    db.updatePaymentConfig({ cardFeePercent: 2.5 });
    const { product } = db.createProduct({
      name: 'صنف الدفع المقسم والبطاقة',
      category: 'مواد غذائية',
      unit: 'قطعة',
      currentCostPrice: 150,
      currentSalePrice: 300,
      stockQty: 20,
      minStockAlert: 2,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const beforeTreasuries = db.getTreasuries();
    const cashBefore = beforeTreasuries.find((t) => t.id === 'trs-cash-main')!.currentBalance;
    const posBefore = beforeTreasuries.find((t) => t.id === 'trs-bankpos-1')!.currentBalance;

    const today = new Date().toISOString().slice(0, 10);
    const feesBefore = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    }).profitLoss!.cardFeesTotal;

    const splitSale = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'split',
      allocations: [
        { method: 'cash', treasuryId: 'trs-cash-main', amount: 100 },
        { method: 'card', treasuryId: 'trs-bankpos-1', amount: 200, referenceCode: 'AUTH-8821' },
      ],
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(splitSale.invoice.paymentMethod, 'split');
    assert.equal(splitSale.invoice.allocations!.length, 2);
    const cardAlloc = splitSale.invoice.allocations!.find((a) => a.method === 'card')!;
    assert.equal(cardAlloc.feeAmount, 5); // 2.5% of 200

    const afterTreasuries = db.getTreasuries();
    const cashAfter = afterTreasuries.find((t) => t.id === 'trs-cash-main')!.currentBalance;
    const posAfter = afterTreasuries.find((t) => t.id === 'trs-bankpos-1')!.currentBalance;
    assert.equal(Number((cashAfter - cashBefore).toFixed(2)), 100);
    assert.equal(Number((posAfter - posBefore).toFixed(2)), 195); // 200 - 5 card fee

    const feesAfter = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    }).profitLoss!.cardFeesTotal;
    assert.equal(Number((feesAfter - feesBefore).toFixed(2)), 5);
  });

  it('3. Full Return (returnInvoice) Reverses Credit Customer Debt, Stock, Purchases & Statement', () => {
    const { product } = db.createProduct({
      name: 'صنف اختبار المرتجع الكامل',
      category: 'مواد غذائية',
      unit: 'علبة',
      currentCostPrice: 30,
      currentSalePrice: 50,
      stockQty: 15,
      minStockAlert: 3,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const customer = db.addCustomer({
      name: 'عميل آجل مرتجع كامل',
      phone: '01099887766',
      creditLimit: 2000,
    });

    const creditSale = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 5 }], // 250 EGP
      customerId: customer.id,
      paymentMethod: 'credit',
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(db.getProductById(product.id)!.stockQty, 10);
    let refreshedCust = db.getCustomers().find((c) => c.id === customer.id)!;
    assert.equal(refreshedCust.balanceDue, 250);
    assert.equal(refreshedCust.totalPurchases, 250);
    assert.equal(db.getCustomerStatement(customer.id).closingBalance, 250);

    const returned = db.returnInvoice(creditSale.invoice.id, 'مدقق الاختبار', 'اختبار-1');
    assert.equal(returned.invoice.status, 'returned');
    assert.equal(db.getProductById(product.id)!.stockQty, 15);

    refreshedCust = db.getCustomers().find((c) => c.id === customer.id)!;
    assert.equal(refreshedCust.balanceDue, 0);
    assert.equal(refreshedCust.totalPurchases, 0);
    assert.equal(db.getCustomerStatement(customer.id).closingBalance, 0);
  });

  it('4. Partial Return + Linked Exchange Invoice + Final Return Completion + SHA-256 Chain Intact', () => {
    const { product: p1 } = db.createProduct({
      name: 'صنف مرتجع جزئي أ',
      category: 'مواد غذائية',
      unit: 'قطعة',
      currentCostPrice: 50,
      currentSalePrice: 100,
      stockQty: 20,
      minStockAlert: 2,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    const { product: p2 } = db.createProduct({
      name: 'صنف بديل استبدال ب',
      category: 'مواد غذائية',
      unit: 'قطعة',
      currentCostPrice: 40,
      currentSalePrice: 80,
      stockQty: 20,
      minStockAlert: 2,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const customer = db.addCustomer({
      name: 'عميل مرتجع جزئي واستبدال',
      phone: '01122334455',
      creditLimit: 5000,
    });

    // Sell 4 units of p1 (subtotal 400) with 40 EGP invoice discount => net 360 EGP (90 per unit)
    const orig = db.createSaleInvoice({
      items: [{ productId: p1.id, quantity: 4 }],
      customerId: customer.id,
      paymentMethod: 'cash',
      invoiceDiscount: 40,
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    assert.equal(orig.invoice.grandTotal, 360);
    assert.equal(db.getProductById(p1.id)!.stockQty, 16);

    // Partial return 2 units to store_credit (should add 180 EGP store credit) + exchange 1 unit of p2 (80 EGP)
    const partialRes = db.partialReturnOrExchange({
      invoiceId: orig.invoice.id,
      items: [{ invoiceItemId: orig.invoice.items[0].id, quantity: 2 }],
      refundStrategy: 'store_credit',
      reason: 'استبدال مقاس',
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
      exchangeItems: [{ productId: p2.id, quantity: 1 }],
      exchangeDifferenceMethod: 'cash',
    });

    assert.equal(partialRes.invoice.status, 'partial_returned');
    assert.equal(partialRes.invoice.returnedTotal, 180);
    assert.equal(partialRes.invoice.grandTotal, 180);
    assert.equal(partialRes.invoice.totalCostAtSale, 100);
    assert.equal(partialRes.invoice.totalProfit, 80);
    assert.equal(partialRes.invoice.items[0].returnedQuantity, 2);
    assert.equal(db.getProductById(p1.id)!.stockQty, 18);
    assert.equal(db.getProductById(p2.id)!.stockQty, 19);

    assert.ok(partialRes.exchangeInvoice);
    assert.equal(partialRes.exchangeInvoice!.exchangeForInvoiceId, orig.invoice.id);
    assert.equal(partialRes.exchangeInvoice!.grandTotal, 80);

    const custAfterPartial = db.getCustomers().find((c) => c.id === customer.id)!;
    assert.equal(custAfterPartial.storeCreditBalance, 180);

    // Return remaining 2 units -> transitions invoice to fully 'returned' with grandTotal === 0
    const finalPartial = db.partialReturnOrExchange({
      invoiceId: orig.invoice.id,
      items: [{ invoiceItemId: orig.invoice.items[0].id, quantity: 2 }],
      refundStrategy: 'cash',
      treasuryId: 'trs-cash-main',
      reason: 'إرجاع الباقي',
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(finalPartial.invoice.status, 'returned');
    assert.equal(finalPartial.invoice.grandTotal, 0);
    assert.equal(finalPartial.invoice.returnedTotal, 360);
    assert.equal(db.getProductById(p1.id)!.stockQty, 20);

    const integrity = db.verifyLedgerIntegrity();
    assert.equal(integrity.chainIntact, true);
    assert.equal(integrity.brokenInvoiceIds.length, 0);
  });

  it('5. Promotions, Loyalty Earn/Redeem, Store Credit Tender, Credit Limit Guard & Overdue Alerts', () => {
    db.updateStoreSettings({
      loyaltyConfig: {
        enabled: true,
        earnRateEgpPerPoint: 50,
        pointValueEgp: 1,
        minRedeemPoints: 2,
      },
    });

    const { product } = db.createProduct({
      name: 'صنف العروض والولاء',
      category: 'عروض خاصة',
      unit: 'قطعة',
      currentCostPrice: 60,
      currentSalePrice: 100,
      stockQty: 30,
      minStockAlert: 5,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const promo = db.createPromotion({
      name: 'عرض خاص 20% على صنف الاختبار',
      ruleType: 'percent',
      value: 20,
      productId: product.id,
      minQty: 2,
      active: true,
    });
    assert.ok(promo.id);

    const customer = db.addCustomer({
      name: 'عميل الولاء والائتمان',
      phone: '01234567890',
      creditLimit: 300,
    });

    // Buy 2 units => 200 EGP - 20% promo (40 EGP) = 160 EGP => earns floor(160/50) = 3 points
    const saleWithPromo = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 2 }],
      customerId: customer.id,
      paymentMethod: 'cash',
      applyPromotion: true,
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    assert.equal(saleWithPromo.invoice.promotionDiscount, 40);
    assert.equal(saleWithPromo.invoice.grandTotal, 160);
    assert.equal(saleWithPromo.invoice.loyaltyPointsEarned, 3);

    // Give customer 50 store credit & redeem 2 loyalty points on next 100 EGP sale:
    // 100 - 2 (points) = 98 grandTotal; storeCreditUsed = 50; remaining cash = 48
    db.updateCustomer(customer.id, { storeCreditBalance: 50 });
    const saleRedeem = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 1 }],
      customerId: customer.id,
      paymentMethod: 'cash',
      redeemLoyaltyPoints: 2,
      useStoreCredit: true,
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    assert.equal(saleRedeem.invoice.loyaltyPointsRedeemed, 2);
    assert.equal(saleRedeem.invoice.storeCreditUsed, 50);
    assert.equal(saleRedeem.invoice.grandTotal, 98);
    // Remaining points: 3 - 2 + floor(98/50)=1 => 2
    const custNow = db.getCustomers().find((c) => c.id === customer.id)!;
    assert.equal(custNow.storeCreditBalance, 0);
    assert.equal(custNow.loyaltyPoints, 2);

    // Credit limit guard: limit is 300, attempt credit sale of 400 => must throw
    assert.throws(() => {
      db.createSaleInvoice({
        items: [{ productId: product.id, quantity: 4 }],
        customerId: customer.id,
        paymentMethod: 'credit',
        cashierName: 'مدقق الاختبار',
        terminalName: 'اختبار-1',
      });
    }, /الحد الائتماني/);

    // Overdue credit alert: sell 200 on credit with past dueDate ('2020-01-01')
    const overdueSale = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 2 }],
      customerId: customer.id,
      paymentMethod: 'credit',
      dueDate: '2020-01-01',
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    assert.equal(overdueSale.invoice.dueDate, '2020-01-01');
    const alerts = db.getOwnerAlerts();
    assert.ok(alerts.some((a) => a.id === 'alert-overdue-credit' && a.category === 'credit'));
  });

  it('6. Purchase Order Creates Batches & Sales Consume Earliest Expiry First (FEFO)', () => {
    const supplier = db.addSupplier({
      name: 'مورد التشغيلات الاختباري',
      phone: '01555666777',
      category: 'ألبان',
    });

    const { product } = db.createProduct({
      name: 'صنف اختبار FEFO',
      category: 'ألبان',
      unit: 'عبوة',
      currentCostPrice: 20,
      currentSalePrice: 30,
      stockQty: 0,
      minStockAlert: 5,
      supplierId: supplier.id,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    // Purchase late batch first, early batch second
    db.createPurchaseOrder({
      supplierId: supplier.id,
      paymentSource: 'credit',
      paidAmount: 0,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
      items: [
        {
          productId: product.id,
          quantity: 5,
          unitCost: 20,
          batchCode: 'LOT-LATE',
          expiryDate: '2028-12-31',
        },
      ],
    });
    db.createPurchaseOrder({
      supplierId: supplier.id,
      paymentSource: 'credit',
      paidAmount: 0,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
      items: [
        {
          productId: product.id,
          quantity: 5,
          unitCost: 20,
          batchCode: 'LOT-EARLY',
          expiryDate: '2026-06-30',
        },
      ],
    });

    assert.equal(db.getProductById(product.id)!.stockQty, 10);

    // Sell 6 units => must fully consume LOT-EARLY (5) and take 1 from LOT-LATE (leaving 4)
    db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 6 }],
      paymentMethod: 'cash',
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const batches = db.getBatches(product.id);
    const earlyBatch = batches.find((b) => b.batchCode === 'LOT-EARLY')!;
    const lateBatch = batches.find((b) => b.batchCode === 'LOT-LATE')!;
    assert.equal(earlyBatch.qty, 0);
    assert.equal(lateBatch.qty, 4);
    assert.equal(db.getProductById(product.id)!.stockQty, 4);
  });

  it('7. Expenses CRUD Treasury Reconciliation & owner_draw Exclusion from Operating Expenses', () => {
    const today = new Date().toISOString().slice(0, 10);
    const cashBefore = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;
    const dashBefore = db.getDashboardSummary().todayExpenses;
    const reportBefore = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });

    const opExp = db.createExpense({
      title: 'فاتورة كهرباء اختبارية',
      category: 'utilities',
      amount: 120,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      actorName: 'مدقق الاختبار',
    });
    assert.equal(
      Number((cashBefore - db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance).toFixed(2)),
      120
    );

    const updatedExp = db.updateExpense(opExp.id, { amount: 200 });
    assert.equal(updatedExp.amount, 200);
    assert.equal(
      Number((cashBefore - db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance).toFixed(2)),
      200
    );

    const drawExp = db.createExpense({
      title: 'مسحوب شخصي للمالك',
      category: 'owner_draw',
      amount: 500,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      actorName: 'مدقق الاختبار',
    });

    const dashAfter = db.getDashboardSummary().todayExpenses;
    // todayExpenses excludes owner_draw, so delta must be +200 (not +700)
    assert.equal(Number((dashAfter - dashBefore).toFixed(2)), 200);

    const reportAfter = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });
    assert.equal(
      Number(
        (reportAfter.profitLoss!.operatingExpensesTotal - reportBefore.profitLoss!.operatingExpensesTotal).toFixed(2)
      ),
      200
    );
    assert.equal(
      Number(
        (reportAfter.profitLoss!.ownerDrawingsInExpenses - reportBefore.profitLoss!.ownerDrawingsInExpenses).toFixed(2)
      ),
      500
    );

    db.deleteExpense(opExp.id);
    db.deleteExpense(drawExp.id);
    assert.equal(db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance, cashBefore);
  });

  it('8. Full 6-Factor Shift Closing Reconciliation (Sales + Collections - Returns - Expenses - Supplier - Equity)', async () => {
    const { product } = db.createProduct({
      name: 'صنف وردية الإغلاق',
      category: 'مواد غذائية',
      unit: 'قطعة',
      currentCostPrice: 50,
      currentSalePrice: 100,
      stockQty: 50,
      minStockAlert: 5,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    // Shift A sale (to be refunded in Shift B)
    const prevShiftSale = db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 1 }], // 100 EGP cash
      paymentMethod: 'cash',
      treasuryId: 'trs-cash-main',
      cashierName: 'كاشير أ',
      terminalName: 'نقطة 1',
    });
    db.closeShift({
      cashierId: 'usr-admin',
      cashierName: 'كاشير أ',
      openingFloat: 500,
      actualCash: 600,
      notes: 'إغلاق بداية الاختبار',
    });

    // Wait 5ms so new operations strictly have createdAt > Shift A closedAt
    await new Promise((r) => setTimeout(r, 10));

    // Create customer with credit debt from previous shift or collect payment in Shift B
    const cust = db.addCustomer({ name: 'عميل تحصيل وردية', phone: '01011112222', creditLimit: 2000 });
    db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 3 }], // 300 credit
      customerId: cust.id,
      paymentMethod: 'credit',
      cashierName: 'كاشير ب',
      terminalName: 'نقطة 1',
    });

    // 1) Cash sales: +200
    db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: 'cash',
      treasuryId: 'trs-cash-main',
      cashierName: 'كاشير ب',
      terminalName: 'نقطة 1',
    });

    // 2) Cash collection from customer: +150
    db.collectCustomerPayment({
      customerId: cust.id,
      amount: 150,
      method: 'cash',
      treasuryId: 'trs-cash-main',
    });

    // 3) Cash return of Shift A invoice: -100
    db.returnInvoice(prevShiftSale.invoice.id, 'كاشير ب', 'نقطة 1');

    // 4) Cash expense: -40
    db.createExpense({
      title: 'مصروف وردية نقدي',
      category: 'misc',
      amount: 40,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      actorName: 'كاشير ب',
    });

    // 5) Supplier debt + cash payout: -70
    const sup = db.addSupplier({ name: 'مورد سداد نقدي', phone: '01033334444', category: 'عام' });
    db.createPurchaseOrder({
      supplierId: sup.id,
      paymentSource: 'credit',
      paidAmount: 0,
      actorName: 'كاشير ب',
      terminalName: 'نقطة 1',
      items: [{ productId: product.id, quantity: 2, unitCost: 50 }], // 100 debt
    });
    db.paySupplierDebt(sup.id, 70, 'cash', 'PAY-70', 'trs-cash-main');

    // 6) Cash equity drawing: -30
    const partner = db.getEquityPartners().find((p) => p.active)!;
    db.recordEquityDrawing({
      partnerId: partner.id,
      amount: 30,
      type: 'draw',
      treasuryId: 'trs-cash-main',
      actorName: 'كاشير ب',
    });

    const summary = db.getShiftSummary();
    assert.equal(summary.cashSales, 200);
    assert.equal(summary.cashCollections, 150);
    assert.equal(summary.cashReturns, 100);
    assert.equal(summary.cashExpenses, 40);
    assert.equal(summary.cashSupplierPayouts, 70);
    assert.equal(summary.cashEquityDrawings, 30);

    const openingFloat = 1000;
    // Expected = 1000 + 200 + 150 - 100 - 40 - 70 - 30 = 1110
    const closedShift = db.closeShift({
      cashierId: 'usr-admin',
      cashierName: 'كاشير ب',
      openingFloat,
      actualCash: 1110,
      notes: 'تطابق كامل للعوامل الستة',
    });

    assert.equal(closedShift.expectedCash, 1110);
    assert.equal(closedShift.variance, 0);
  });

  it('9. Equity Partners Profit Distribution & Penny Remainder Parity with Active 0%-Share Partner', () => {
    const existingPartners = db.getEquityPartners();
    for (const p of existingPartners) {
      if (p.active) {
        db.updateEquityPartner(p.id, { profitSharePercent: 0, active: true });
      }
    }

    const pA = db.createEquityPartner({ name: 'شريك أ (33.33%)', profitSharePercent: 33.33, capitalContribution: 10000 });
    const pB = db.createEquityPartner({ name: 'شريك ب (33.33%)', profitSharePercent: 33.33, capitalContribution: 10000 });
    const pC = db.createEquityPartner({ name: 'شريك ج (33.34%)', profitSharePercent: 33.34, capitalContribution: 10000 });
    const pZero = db.createEquityPartner({ name: 'شريك إداري (0%)', profitSharePercent: 0, capitalContribution: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const report = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });

    const eq = report.equityDistribution!;
    const activeRows = eq.rows.filter((r) => r.partner.active);
    const totalDistributed = Number(activeRows.reduce((s, r) => s + r.periodProfitShare, 0).toFixed(2));
    assert.equal(eq.totalSharePercentConfigured, 100);
    assert.equal(totalDistributed, eq.netDistributableProfit);

    const zeroRow = eq.rows.find((r) => r.partner.id === pZero.id)!;
    assert.equal(zeroRow.periodProfitShare, 0);

    assert.ok(eq.rows.some((r) => r.partner.id === pA.id));
    assert.ok(eq.rows.some((r) => r.partner.id === pB.id));
    assert.ok(eq.rows.some((r) => r.partner.id === pC.id));
  });

  it('10. Scale Barcode Parsing (Weight 20/21 & Price 22) and Period-over-Period Comparison', () => {
    const { product: weightedProd } = db.createProduct({
      name: 'جبنة رومي قديمة ميزان',
      barcode: '2012345000000',
      sku: 'SCALE-12345',
      category: 'أجبان',
      unit: 'كجم',
      currentCostPrice: 200,
      currentSalePrice: 250,
      stockQty: 30,
      minStockAlert: 5,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    // Prefix 20 + itemCode 12345 + 01500g (1.5 kg) + check digit 7
    const weightMatch = matchScaleBarcode('2012345015007', [weightedProd]);
    assert.ok(weightMatch);
    assert.equal(weightMatch!.mode, 'weight');
    assert.equal(weightMatch!.quantity, 1.5);

    // Prefix 22 + itemCode 12345 + 06250 piasters (62.50 EGP) / 250 EGP/kg = 0.25 kg
    const priceMatch = matchScaleBarcode('2212345062504', [weightedProd]);
    assert.ok(priceMatch);
    assert.equal(priceMatch!.mode, 'price');
    assert.equal(priceMatch!.quantity, 0.25);

    const today = new Date().toISOString().slice(0, 10);
    const report = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });
    assert.ok(report.periodComparison);
    assert.equal(typeof report.periodComparison!.previousRevenue, 'number');
    assert.equal(typeof report.periodComparison!.revenueDeltaPercent, 'number');
    assert.equal(typeof report.periodComparison!.profitDeltaPercent, 'number');
    assert.equal(typeof report.periodComparison!.invoiceCountDeltaPercent, 'number');
  });

  it('11. Atomic Purchase Return (createPurchaseReturn): Stock, PO Batch, Debt Offset & Cash Refund Parity', () => {
    const { product } = db.createProduct({
      name: 'صنف اختبار مرتجع المشتريات',
      category: 'مواد غذائية',
      unit: 'كرتونة',
      currentCostPrice: 50,
      currentSalePrice: 75,
      stockQty: 10,
      minStockAlert: 2,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    const supplier = db.addSupplier({
      name: 'مورد مرتجع المشتريات',
      phone: '01044445555',
      category: 'جملة',
    });

    const cashBefore = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;

    // Purchase 10 units @ 50 = 500 EGP; pay 200 EGP cash, leaving 300 EGP debt
    const { purchase } = db.createPurchaseOrder({
      supplierId: supplier.id,
      paymentSource: 'cash',
      treasuryId: 'trs-cash-main',
      paidAmount: 200,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
      items: [
        {
          productId: product.id,
          quantity: 10,
          unitCost: 50,
          batchCode: 'BATCH-PRET-1',
          expiryDate: '2027-08-15',
        },
      ],
    });

    const cashAfterPo = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;
    assert.equal(Number((cashBefore - cashAfterPo).toFixed(2)), 200);
    assert.equal(db.getProductById(product.id)!.stockQty, 20);
    assert.equal(db.getSuppliers().find((s) => s.id === supplier.id)!.balanceDue, 300);

    // Return 8 units @ 50 = 400 EGP -> 300 offsets debt, 100 refunds cash to trs-cash-main
    const retRes = db.createPurchaseReturn({
      purchaseId: purchase.id,
      items: [{ purchaseItemId: purchase.items[0].id, quantity: 8 }],
      treasuryId: 'trs-cash-main',
      reason: 'كمية زائدة عن الحاجة',
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    assert.equal(retRes.returnRecord.returnTotal, 400);
    assert.equal(retRes.returnRecord.debtReduced, 300);
    assert.equal(retRes.returnRecord.cashRefunded, 100);
    assert.equal(retRes.purchase.returnedTotal, 400);
    assert.equal(retRes.purchase.remainingDebt, 0);
    assert.equal(retRes.purchase.items[0].returnedQuantity, 8);

    // Stock drops 20 -> 12 and PO-linked batch drops 10 -> 2
    assert.equal(db.getProductById(product.id)!.stockQty, 12);
    const poBatch = db.getBatches(product.id).find((b) => b.batchCode === 'BATCH-PRET-1')!;
    assert.equal(poBatch.qty, 2);

    // Treasury gets +100 cash refund back (net -100 from original cashBefore)
    const cashAfterRet = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;
    assert.equal(Number((cashAfterRet - cashAfterPo).toFixed(2)), 100);

    // Supplier debt & statement closing balance both reconcile to 0
    const updatedSupplier = db.getSuppliers().find((s) => s.id === supplier.id)!;
    assert.equal(updatedSupplier.balanceDue, 0);
    assert.equal(db.getSupplierStatement(supplier.id).closingBalance, 0);
  });

  it('12. Recurring Expenses Execution: Treasury Deduction, Store Expense Log & Schedule Rollover', () => {
    const cashBefore = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;

    const dailyRec = db.createRecurringExpense({
      title: 'نثرية تشغيل يومية',
      category: 'misc',
      amount: 75,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      frequency: 'daily',
      nextDueDate: '2026-05-10',
      notes: 'دوري يومي',
    });
    const weeklyRec = db.createRecurringExpense({
      title: 'توريد نظافة أسبوعي',
      category: 'maintenance',
      amount: 150,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      frequency: 'weekly',
      nextDueDate: '2026-05-10',
    });
    const monthlyRec = db.createRecurringExpense({
      title: 'إيجار المحل الشهري',
      category: 'rent',
      amount: 1200,
      paymentSource: 'cash_drawer',
      treasuryId: 'trs-cash-main',
      frequency: 'monthly',
      nextDueDate: '2026-05-10',
    });

    const dailyExec = db.executeRecurringExpense(dailyRec.id, 'مدقق الاختبار');
    assert.equal(dailyExec.expense.amount, 75);
    assert.equal(dailyExec.expense.category, 'misc');
    assert.equal(dailyExec.recurring.nextDueDate, '2026-05-11');
    assert.ok(dailyExec.recurring.lastPaidAt);

    const weeklyExec = db.executeRecurringExpense(weeklyRec.id, 'مدقق الاختبار');
    assert.equal(weeklyExec.recurring.nextDueDate, '2026-05-17');

    const monthlyExec = db.executeRecurringExpense(monthlyRec.id, 'مدقق الاختبار');
    assert.equal(monthlyExec.recurring.nextDueDate, '2026-06-10');

    const cashAfter = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;
    assert.equal(Number((cashBefore - cashAfter).toFixed(2)), 1425); // 75 + 150 + 1200

    const loggedIds = new Set(db.getExpenses().map((e) => e.id));
    assert.ok(loggedIds.has(dailyExec.expense.id));
    assert.ok(loggedIds.has(weeklyExec.expense.id));
    assert.ok(loggedIds.has(monthlyExec.expense.id));
  });

  it('13. Customer Default Price Tier / Discount Persistence & Report Peak Time Analytics', () => {
    const cust = db.addCustomer({
      name: 'عميل جملة مميز',
      phone: '01077778888',
      creditLimit: 10000,
      defaultPriceTier: 'wholesale',
      defaultDiscountPercent: 7.5,
    });
    assert.equal(cust.defaultPriceTier, 'wholesale');
    assert.equal(cust.defaultDiscountPercent, 7.5);

    const updated = db.updateCustomer(cust.id, {
      defaultPriceTier: 'half_wholesale',
      defaultDiscountPercent: 12,
    });
    assert.equal(updated.defaultPriceTier, 'half_wholesale');
    assert.equal(updated.defaultDiscountPercent, 12);

    const fetched = db.getCustomers().find((c) => c.id === cust.id)!;
    assert.equal(fetched.defaultPriceTier, 'half_wholesale');
    assert.equal(fetched.defaultDiscountPercent, 12);

    const today = new Date().toISOString().slice(0, 10);
    const reports = db.getReportsData({
      period: 'daily',
      activityFilter: 'all',
      fromDate: today,
      toDate: today,
    });

    assert.ok(reports.peakTimeAnalytics);
    assert.equal(reports.peakTimeAnalytics!.byHour.length, 24);
    assert.equal(reports.peakTimeAnalytics!.byDayOfWeek.length, 7);
    const totalHourRev = Number(
      reports.peakTimeAnalytics!.byHour.reduce((s, h) => s + h.revenue, 0).toFixed(2)
    );
    const totalDayRev = Number(
      reports.peakTimeAnalytics!.byDayOfWeek.reduce((s, d) => s + d.revenue, 0).toFixed(2)
    );
    assert.equal(totalHourRev, reports.totals.revenue);
    assert.equal(totalDayRev, reports.totals.revenue);
    assert.ok(reports.peakTimeAnalytics!.peakHourLabel.length > 0);
    assert.ok(reports.peakTimeAnalytics!.peakDayLabel.length > 0);
  });

  it('14. What-If Profit & OpEx Simulator: Baseline Parity, Break-Even Precision, Partner Impact & Edge Guards', () => {
    const reports = db.getReportsData({ period: 'daily', activityFilter: 'all' });
    const pl = reports.profitLoss!;
    const eqRows = reports.equityDistribution?.rows || [];

    // 1. Baseline parity check (zero drift)
    const defaultInputs = createDefaultWhatIfInputs(pl);
    const baselineSim = computeWhatIfProjection(pl, defaultInputs, eqRows);
    assert.equal(baselineSim.simulated.revenue, baselineSim.baseline.revenue);
    assert.equal(baselineSim.simulated.grossProfit, baselineSim.baseline.grossProfit);
    assert.equal(baselineSim.simulated.operatingExpenses, baselineSim.baseline.operatingExpenses);
    assert.equal(baselineSim.simulated.netOperatingProfit, baselineSim.baseline.netOperatingProfit);
    assert.equal(baselineSim.deltas.netProfitDelta, 0);
    for (const p of baselineSim.partnerImpacts) {
      assert.equal(p.simulatedShare, p.baselineShare);
      assert.equal(p.deltaShare, 0);
    }

    // 2. Synthetic P&L exact math + break-even verification
    const syntheticPl = {
      ...pl,
      netSalesRevenue: 10000,
      historicalCogs: 7500,
      grossProfit: 2500,
      grossMarginPercent: 25,
      cardFeesTotal: 100, // 1% of revenue
      operatingExpensesTotal: 1200,
      netOperatingProfit: 1200,
      netOperatingMarginPercent: 12,
    };
    const sim = computeWhatIfProjection(
      syntheticPl,
      {
        targetGrossMarginPct: 31, // +6% margin
        salesVolumeDeltaPct: 20,  // revenue -> 12,000
        opExDeltaPct: -10,        // 1200 * 0.9 = 1080
        fixedOpExDeltaEgp: 120,   // +120 -> 1200 total OpEx
      },
      eqRows
    );
    assert.equal(sim.simulated.revenue, 12000);
    assert.equal(sim.simulated.grossProfit, 3720); // 12000 * 31%
    assert.equal(sim.simulated.cogs, 8280);        // 12000 - 3720
    assert.equal(sim.simulated.cardFees, 120);     // 1% of 12000
    assert.equal(sim.simulated.operatingExpenses, 1200);
    assert.equal(sim.simulated.netOperatingProfit, 2400); // 3720 - 120 - 1200
    assert.equal(sim.simulated.netMarginPct, 20);
    // Contribution ratio = 31% - 1% = 30%; Break-even = 1200 / 0.30 = 4000
    assert.equal(sim.simulated.breakEvenRevenue, 4000);
    assert.equal(sim.baseline.breakEvenRevenue, 5000); // 1200 / (25% - 1%)

    // Partner shares must reconcile cleanly to total configured % of sim net profit
    const activeTotalPct = eqRows
      .filter((r) => r.partner.active)
      .reduce((s, r) => s + r.partner.profitSharePercent, 0);
    const expectedPool = Number(((2400 * activeTotalPct) / 100).toFixed(2));
    const sumPartnerShares = Number(
      sim.partnerImpacts.reduce((s, p) => s + p.simulatedShare, 0).toFixed(2)
    );
    assert.equal(sumPartnerShares, expectedPool);

    // 3. Zero-revenue & non-positive contribution safety (no NaN / Infinity)
    const zeroPl = {
      ...syntheticPl,
      netSalesRevenue: 0,
      historicalCogs: 0,
      grossProfit: 0,
      grossMarginPercent: 0,
      cardFeesTotal: 0,
      operatingExpensesTotal: 500,
      netOperatingProfit: -500,
      netOperatingMarginPercent: 0,
    };
    const zeroSim = computeWhatIfProjection(zeroPl, {
      targetGrossMarginPct: 0,
      salesVolumeDeltaPct: 0,
      opExDeltaPct: 0,
      fixedOpExDeltaEgp: 0,
    });
    assert.equal(zeroSim.simulated.revenue, 0);
    assert.equal(zeroSim.simulated.netOperatingProfit, -500);
    assert.equal(zeroSim.simulated.breakEvenRevenue, null);
    assert.equal(zeroSim.deltas.breakEvenMarginPct, null);
    assert.ok(Number.isFinite(zeroSim.simulated.netMarginPct));
  });

  it('15. Scheduled Daily/Weekly Reports: Period Windows, Duplicate Dispatch Guard, Profit Masking & Read Tracking', async () => {
    // 1. Period window calculation (daily = same day; weekly = 7-day rolling window + ISO week key)
    const sampleWed = new Date(2026, 10, 18, 21, 15, 0); // Wed Nov 18 2026, 21:15 local
    const dailyWin = computeSchedulePeriodWindow('daily', sampleWed);
    assert.equal(dailyWin.fromDate, '2026-11-18');
    assert.equal(dailyWin.toDate, '2026-11-18');
    assert.equal(dailyWin.periodKey, '2026-11-18');

    const weeklyWin = computeSchedulePeriodWindow('weekly', sampleWed);
    assert.equal(weeklyWin.fromDate, '2026-11-12');
    assert.equal(weeklyWin.toDate, '2026-11-18');
    assert.match(weeklyWin.periodKey, /^\d{4}-W\d{2}$/);

    // 2. isScheduleDue checks (active, time, weekday, duplicate periodKey)
    const baseSched = db.createScheduledReport({
      name: 'ملخص المبيعات والأرباح اليومي للمديرين',
      frequency: 'daily',
      dayOfWeek: 5,
      sendTime: '21:00',
      channel: 'both',
      recipientEmails: ['manager@tajirpro.example'],
      activityFilter: 'all',
      includeProfits: true,
      includeAlerts: true,
      active: true,
    });
    assert.equal(isScheduleDue(baseSched, new Date(2026, 10, 18, 20, 59, 0)), false); // too early
    assert.equal(isScheduleDue(baseSched, sampleWed), true); // 21:15 >= 21:00

    const weeklySched = db.createScheduledReport({
      name: 'تقرير الجمعة الأسبوعي',
      frequency: 'weekly',
      dayOfWeek: 5, // Friday
      sendTime: '18:00',
      channel: 'in_app',
      recipientEmails: [],
      activityFilter: 'all',
      includeProfits: false, // Masked profits
      includeAlerts: true,
      active: true,
    });
    assert.equal(isScheduleDue(weeklySched, sampleWed), false); // Wednesday != Friday
    const fridayLate = new Date(2026, 10, 20, 19, 0, 0); // Fri Nov 20 2026
    assert.equal(isScheduleDue(weeklySched, fridayLate), true);

    // 3. Create a real sale today so digest aggregates non-zero revenue/profit
    const { product } = db.createProduct({
      name: 'صنف اختبار التقارير المجدولة',
      category: 'مواد غذائية',
      unit: 'قطعة',
      currentCostPrice: 60,
      currentSalePrice: 110,
      stockQty: 15,
      minStockAlert: 5,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    db.createSaleInvoice({
      items: [{ productId: product.id, quantity: 4 }], // 440 revenue, 240 COGS, 200 profit
      paymentMethod: 'cash',
      treasuryId: 'trs-cash-main',
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });

    // Ensure no SMTP_HOST interferes during unit test -> verifies graceful fallback
    const prevSmtpHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    try {
      const service = new ScheduledReportsService(db, null);

      // Scheduled tick at sampleWed (21:15) should dispatch baseSched (+ maybe seeded default if <= 21:15)
      const nowToday = new Date();
      const dueNowSched = db.updateScheduledReport(baseSched.id, { sendTime: '00:00' });
      assert.equal(dueNowSched.sendTime, '00:00');

      const digests = await service.tick(nowToday);
      const createdForBase = digests.find((d) => d.scheduleId === baseSched.id);
      assert.ok(createdForBase, 'Scheduled tick must dispatch due schedule');
      assert.equal(createdForBase.isManualRun, false);
      assert.equal(createdForBase.inAppDelivered, true); // fallback when SMTP not configured
      assert.equal(createdForBase.emailStatus, 'skipped_not_configured');
      assert.equal(createdForBase.summary.profitsIncluded, true);
      assert.ok(createdForBase.summary.revenue >= 440);
      assert.ok(createdForBase.summary.grossProfit >= 200);

      // Second tick on same day must NOT duplicate dispatch for baseSched
      const reloadedBase = db.getScheduledReportById(baseSched.id)!;
      assert.equal(isScheduleDue(reloadedBase, nowToday), false);
      const secondTick = await service.tick(nowToday);
      assert.equal(
        secondTick.some((d) => d.scheduleId === baseSched.id),
        false,
        'Duplicate dispatch in same period must be blocked'
      );

      // 4. Manual dispatch with includeProfits = false masks profit figures
      const maskedDigest = await service.dispatchSchedule(weeklySched.id, { manual: true, now: nowToday });
      assert.equal(maskedDigest.isManualRun, true);
      assert.equal(maskedDigest.summary.profitsIncluded, false);
      assert.equal(maskedDigest.summary.grossProfit, 0);
      assert.equal(maskedDigest.summary.netOperatingProfit, 0);
      assert.equal(maskedDigest.emailStatus, 'not_requested');
      assert.ok(maskedDigest.summary.revenue >= 440);

      // Email HTML & Text formatters render clean RTL Arabic without throwing
      const html = formatDigestEmailHtml('متجر تاجر برو الاختباري', createdForBase);
      const text = formatDigestEmailText('متجر تاجر برو الاختباري', createdForBase);
      assert.ok(html.includes('dir="rtl"'));
      assert.ok(html.includes(createdForBase.title));
      assert.ok(text.includes(createdForBase.fromDate));

      // 5. Read tracking & RBAC bootstrap visibility
      const markedOne = db.markReportDigestRead(createdForBase.id, 'usr-admin');
      assert.ok(markedOne?.readByUserIds.includes('usr-admin'));

      db.markAllReportDigestsRead('usr-admin');
      const allDigests = db.listReportDigests(20);
      for (const d of allDigests) {
        assert.ok(d.readByUserIds.includes('usr-admin'));
      }

      // Clean up test schedules
      db.deleteScheduledReport(baseSched.id);
      db.deleteScheduledReport(weeklySched.id);
      assert.equal(db.getScheduledReportById(baseSched.id), null);
      assert.equal(db.getScheduledReportById(weeklySched.id), null);
    } finally {
      if (prevSmtpHost !== undefined) {
        process.env.SMTP_HOST = prevSmtpHost;
      }
    }
  });

  it('16. Security Rate Limiter & Sales Quotations (Proforma): Zero-Stock Side Effects and Atomic Checkout Conversion', () => {
    // 1. SlidingWindowRateLimiter enforcement & recovery after window expires
    const limiter = new SlidingWindowRateLimiter(1000, 3);
    const t0 = 1_700_000_000_000;
    assert.equal(limiter.check('127.0.0.1:/api/auth/login', t0).allowed, true);
    assert.equal(limiter.check('127.0.0.1:/api/auth/login', t0 + 100).remaining, 1);
    assert.equal(limiter.check('127.0.0.1:/api/auth/login', t0 + 200).remaining, 0);
    const blocked = limiter.check('127.0.0.1:/api/auth/login', t0 + 300);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1);
    // Different key stays independent; expired window recovers
    assert.equal(limiter.check('10.0.0.2:/api/auth/login', t0 + 300).allowed, true);
    assert.equal(limiter.check('127.0.0.1:/api/auth/login', t0 + 1200).allowed, true);

    // 2. Create product & customer, snapshot balances before quotation
    const { product } = db.createProduct({
      name: 'صنف اختبار عروض الأسعار',
      category: 'مواد غذائية',
      unit: 'كرتونة',
      currentCostPrice: 80,
      currentSalePrice: 120,
      halfWholesalePrice: 110,
      wholesalePrice: 100,
      stockQty: 25,
      minStockAlert: 3,
      actorName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
    });
    const cust = db.addCustomer({
      name: 'شركة النيل التجارية',
      phone: '01099990000',
      creditLimit: 50000,
      defaultPriceTier: 'wholesale',
    });

    const cashBefore = db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance;

    // 3. Create quotation using wholesale price (100) * 5 - 20 line discount - 30 invoice discount = 450
    const qt = db.createQuotation({
      customerId: cust.id,
      items: [
        {
          productId: product.id,
          quantity: 5,
          priceTier: 'wholesale',
          discountAmount: 20,
        },
      ],
      invoiceDiscount: 30,
      validDays: 14,
      notes: 'عرض سعر لتوريد أسبوعي',
      createdBy: 'مدقق الاختبار',
    });

    assert.match(qt.quotationNumber, /^QT-\d{4}-\d{4,}$/);
    assert.equal(qt.status, 'active');
    assert.equal(qt.items.length, 1);
    assert.equal(qt.items[0].unitSalePrice, 100);
    assert.equal(qt.items[0].lineTotal, 480);
    assert.equal(qt.subtotal, 480);
    assert.equal(qt.discountTotal, 30);
    assert.equal(qt.grandTotal, 450);

    // Stock, treasury & customer balance MUST remain completely untouched
    assert.equal(db.getProductById(product.id)!.stockQty, 25);
    assert.equal(db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance, cashBefore);
    assert.equal(db.getCustomers().find((c) => c.id === cust.id)!.balanceDue, 0);

    // 4. Status transitions: cancel & reactivate
    const cancelled = db.updateQuotationStatus(qt.id, 'cancelled');
    assert.equal(cancelled.status, 'cancelled');
    assert.throws(() => {
      db.createSaleInvoice({
        items: [{ productId: product.id, quantity: 5, priceTier: 'wholesale', unitSalePrice: 100 }],
        customerId: cust.id,
        paymentMethod: 'cash',
        treasuryId: 'trs-cash-main',
        cashierName: 'مدقق الاختبار',
        terminalName: 'اختبار-1',
        quotationId: qt.id,
      });
    }, /ملغي/);

    const reactivated = db.updateQuotationStatus(qt.id, 'active');
    assert.equal(reactivated.status, 'active');

    // 5. Atomic checkout conversion marks quotation converted & updates stock + treasury
    const saleRes = db.createSaleInvoice({
      items: [
        {
          productId: product.id,
          quantity: 5,
          priceTier: 'wholesale',
          unitSalePrice: 100,
          discountAmount: 20,
        },
      ],
      customerId: cust.id,
      invoiceDiscount: 30,
      paymentMethod: 'cash',
      treasuryId: 'trs-cash-main',
      cashierName: 'مدقق الاختبار',
      terminalName: 'اختبار-1',
      quotationId: qt.id,
    });

    assert.equal(saleRes.invoice.grandTotal, 450);
    assert.equal(db.getProductById(product.id)!.stockQty, 20);
    assert.equal(
      Number((db.getTreasuries().find((t) => t.id === 'trs-cash-main')!.currentBalance - cashBefore).toFixed(2)),
      450
    );

    const convertedQt = db.getQuotationById(qt.id)!;
    assert.equal(convertedQt.status, 'converted');
    assert.equal(convertedQt.convertedInvoiceId, saleRes.invoice.id);

    // Duplicate conversion must be rejected
    assert.throws(() => {
      db.createSaleInvoice({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'cash',
        treasuryId: 'trs-cash-main',
        cashierName: 'مدقق الاختبار',
        terminalName: 'اختبار-1',
        quotationId: qt.id,
      });
    }, /تحويل عرض السعر/);

    // Cannot cancel or modify an already converted quotation
    assert.throws(() => db.updateQuotationStatus(qt.id, 'cancelled'), /تحويله بالفعل/);
  });
});


