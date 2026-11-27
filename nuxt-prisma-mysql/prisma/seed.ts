import crypto from 'node:crypto';
import {
  ExpenseCategory,
  ExpensePaymentSource,
  PaymentMethod,
  PriceTier,
  PrismaClient,
  PromotionRuleType,
  RecurringFrequency,
  ScheduledChannel,
  ScheduledFrequency,
  StaffRole,
  TreasuryType,
} from '@prisma/client';

const prisma = new PrismaClient();

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`tajirpro_pin::${pin}`).digest('hex');
}

function hashInvoice(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function main() {
  await prisma.storeSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeName: 'أسواق البركة الحديثة',
      activityId: 'grocery',
      phone: '01012345678',
      address: 'شارع فيصل الرئيسي، الجيزة',
      taxNumber: '310-482-991',
      vatPercent: 0,
      receiptFooter: 'شكراً لتعاملكم معنا — البضاعة المباعة ترد وتستبدل خلال 14 يوماً',
      currency: 'EGP',
      allowNegativeStock: false,
      autoPrintAfterSale: true,
      requireLoginOnStart: false,
      loyaltyEnabled: true,
      earnRateEgpPerPoint: 50,
      pointValueEgp: 1,
      minRedeemPoints: 10,
      instapayIpa: 'tajirpro@instapay',
      vodafoneCashNumber: '01012345678',
      cardFeePercent: 1.5,
    },
  });

  const owner = await prisma.staffUser.upsert({
    where: { id: 'usr-owner' },
    update: {},
    create: {
      id: 'usr-owner',
      name: 'الحاج محمود (المالك)',
      role: StaffRole.OWNER,
      pinHash: hashPin('1234'),
      active: true,
      tokenVersion: 1,
    },
  });

  await prisma.staffUser.upsert({
    where: { id: 'usr-manager' },
    update: {},
    create: {
      id: 'usr-manager',
      name: 'أحمد سعيد (المدير)',
      role: StaffRole.MANAGER,
      pinHash: hashPin('2222'),
      active: true,
      tokenVersion: 1,
    },
  });

  await prisma.staffUser.upsert({
    where: { id: 'usr-cashier' },
    update: {},
    create: {
      id: 'usr-cashier',
      name: 'كريم عادل (كاشير)',
      role: StaffRole.CASHIER,
      pinHash: hashPin('1111'),
      active: true,
      tokenVersion: 1,
    },
  });

  const defaultPerms: Record<StaffRole, Record<string, boolean>> = {
    OWNER: {
      pos_sell: true,
      invoice_return: true,
      view_profits_costs: true,
      edit_prices_stock: true,
      view_reports: true,
      manage_partners: true,
      manage_payments: true,
      manage_purchases: true,
      manage_expenses: true,
      manage_settings: true,
      manage_data_xlsx: true,
      manage_security_rbac: true,
    },
    MANAGER: {
      pos_sell: true,
      invoice_return: true,
      view_profits_costs: true,
      edit_prices_stock: true,
      view_reports: true,
      manage_partners: true,
      manage_payments: true,
      manage_purchases: true,
      manage_expenses: true,
      manage_settings: true,
      manage_data_xlsx: true,
      manage_security_rbac: false,
    },
    CASHIER: {
      pos_sell: true,
      invoice_return: false,
      view_profits_costs: false,
      edit_prices_stock: false,
      view_reports: false,
      manage_partners: false,
      manage_payments: false,
      manage_purchases: false,
      manage_expenses: false,
      manage_settings: false,
      manage_data_xlsx: false,
      manage_security_rbac: false,
    },
  };

  for (const role of Object.values(StaffRole)) {
    await prisma.rolePermission.upsert({
      where: { role },
      update: { permissionsJson: defaultPerms[role] },
      create: {
        role,
        permissionsJson: defaultPerms[role],
      },
    });
  }

  // Default Treasuries
  const defaultTreasuries = [
    {
      id: 'trs-cash-main',
      name: 'درج الكاشير الرئيسي',
      type: TreasuryType.CASH_DRAWER,
      accountNumber: 'CASH-01',
      currentBalance: 12500,
      isDefault: true,
      notes: 'الدرج اليومي الرئيسي لنقطة البيع',
    },
    {
      id: 'trs-instapay',
      name: 'حساب إنستا باي (InstaPay)',
      type: TreasuryType.INSTAPAY,
      accountNumber: 'tajirpro@instapay',
      currentBalance: 8400,
      isDefault: false,
      notes: 'التحصيل الفوري بالتحويلات البنكية',
    },
    {
      id: 'trs-wallet',
      name: 'محفظة فودافون كاش',
      type: TreasuryType.WALLET,
      accountNumber: '01012345678',
      currentBalance: 3200,
      isDefault: false,
      notes: 'محفظة المحل التجارية',
    },
    {
      id: 'trs-pos-bank',
      name: 'ماكينة فيزا / ميزة (البنك الأهلي)',
      type: TreasuryType.BANK_POS,
      accountNumber: 'POS-NBE-902',
      currentBalance: 15600,
      isDefault: false,
      notes: 'تسوية بطاقات الائتمان والخصم',
    },
  ];

  for (const t of defaultTreasuries) {
    await prisma.treasuryAccount.upsert({
      where: { id: t.id },
      update: {},
      create: t,
    });
  }

  // Suppliers
  const sup1 = await prisma.supplier.upsert({
    where: { id: 'sup-1' },
    update: {},
    create: {
      id: 'sup-1',
      name: 'شركة النيل لتوزيع السلع',
      phone: '01122334455',
      company: 'النيل للتجارة والتوريد',
      category: 'مواد غذائية وألبان',
      balanceOwed: 3200,
      notes: 'توريد أسبوعي كل يوم أحد',
    },
  });

  const sup2 = await prisma.supplier.upsert({
    where: { id: 'sup-2' },
    update: {},
    create: {
      id: 'sup-2',
      name: 'مؤسسة الدلتا للإلكترونيات والأجهزة',
      phone: '01233445566',
      company: 'الدلتا تك',
      category: 'موبايلات وإلكترونيات',
      balanceOwed: 1850,
    },
  });

  // Customers
  const cus1 = await prisma.customer.upsert({
    where: { id: 'cus-1' },
    update: {},
    create: {
      id: 'cus-1',
      name: 'محمد عبد الله (عميل دائم)',
      phone: '01098765432',
      balanceDue: 450,
      totalPurchases: 4250,
      creditLimit: 3000,
      defaultPriceTier: PriceTier.HALF_WHOLESALE,
      defaultDiscountPercent: 2,
      loyaltyPoints: 180,
      storeCreditBalance: 0,
      notes: 'سداد أسبوعي منتظم',
    },
  });

  await prisma.customer.upsert({
    where: { id: 'cus-2' },
    update: {},
    create: {
      id: 'cus-2',
      name: 'أسواق الرحمة (تاجر جملة)',
      phone: '01055443322',
      balanceDue: 1200,
      totalPurchases: 18500,
      creditLimit: 10000,
      defaultPriceTier: PriceTier.WHOLESALE,
      defaultDiscountPercent: 3,
      loyaltyPoints: 420,
      storeCreditBalance: 150,
    },
  });

  // Demo Products across multiple activities with wholesale & half-wholesale tiers
  const demoProducts = [
    {
      id: 'prd-oil-1',
      activityId: 'grocery',
      sku: 'GR-1001',
      barcode: '6221000100101',
      name: 'زيت ذرة كريستال 1 لتر',
      category: 'مواد غذائية',
      unit: 'زجاجة',
      attributeValue: '1 لتر',
      salePrice: 92,
      halfWholesalePrice: 86,
      wholesalePrice: 82,
      costPrice: 74,
      stockQty: 38,
      minStockAlert: 10,
      maxStockTarget: 80,
      supplierId: sup1.id,
    },
    {
      id: 'prd-rice-1',
      activityId: 'grocery',
      sku: 'GR-1002',
      barcode: '6221000100102',
      name: 'أرز مصري الضحى 1 كجم',
      category: 'مواد غذائية',
      unit: 'كيس',
      attributeValue: '1 كجم',
      salePrice: 44,
      halfWholesalePrice: 41,
      wholesalePrice: 39,
      costPrice: 35,
      stockQty: 6,
      minStockAlert: 15,
      maxStockTarget: 100,
      supplierId: sup1.id,
    },
    {
      id: 'prd-milk-1',
      activityId: 'grocery',
      sku: 'GR-1003',
      barcode: '6221000100103',
      name: 'لبن جهينة كامل الدسم 1 لتر',
      category: 'ألبان وأجبان',
      unit: 'لتر',
      attributeValue: '1 لتر',
      salePrice: 46,
      halfWholesalePrice: 43.5,
      wholesalePrice: 41.5,
      costPrice: 38,
      stockQty: 24,
      minStockAlert: 12,
      maxStockTarget: 60,
      supplierId: sup1.id,
    },
    {
      id: 'prd-tea-1',
      activityId: 'grocery',
      sku: 'GR-1004',
      barcode: '6221000100104',
      name: 'شاي العروسة ناعم 250 جم',
      category: 'مشروبات وعصائر',
      unit: 'عبوة',
      attributeValue: '250 جم',
      salePrice: 68,
      halfWholesalePrice: 63,
      wholesalePrice: 59,
      costPrice: 54,
      stockQty: 0,
      minStockAlert: 12,
      maxStockTarget: 60,
      supplierId: sup1.id,
    },
    {
      id: 'prd-cable-1',
      activityId: 'electronics',
      sku: 'EL-2001',
      barcode: '6222000200201',
      name: 'كابل شحن سريع Anker Type-C',
      category: 'شواحن وكابلات',
      unit: 'قطعة',
      attributeValue: 'ضمان 12 شهر',
      salePrice: 340,
      halfWholesalePrice: 300,
      wholesalePrice: 275,
      costPrice: 230,
      stockQty: 14,
      minStockAlert: 5,
      maxStockTarget: 40,
      supplierId: sup2.id,
    },
    {
      id: 'prd-polo-1',
      activityId: 'apparel',
      sku: 'AP-3001',
      barcode: '6223000300301',
      name: 'تيشيرت قطن مصري بولو',
      category: 'تيشيرتات وقمصان',
      unit: 'قطعة',
      attributeValue: 'L / كحلي',
      salePrice: 340,
      halfWholesalePrice: 295,
      wholesalePrice: 265,
      costPrice: 220,
      stockQty: 22,
      minStockAlert: 6,
      maxStockTarget: 50,
      supplierId: null,
    },
    {
      id: 'prd-serum-1',
      activityId: 'cosmetics',
      sku: 'CS-4001',
      barcode: '6224000400401',
      name: 'سيروم فيتامين سي للوجه 30 مل',
      category: 'عناية بالبشرة',
      unit: 'عبوة',
      attributeValue: '30 مل',
      salePrice: 295,
      halfWholesalePrice: 260,
      wholesalePrice: 240,
      costPrice: 210,
      stockQty: 18,
      minStockAlert: 5,
      maxStockTarget: 40,
      supplierId: null,
    },
    {
      id: 'prd-led-1',
      activityId: 'hardware',
      sku: 'HW-5001',
      barcode: '6225000500501',
      name: 'لمبة فينوس ليد موفرة 18 وات',
      category: 'مستلزمات كهرباء',
      unit: 'قطعة',
      attributeValue: 'ضمان سنتين',
      salePrice: 80,
      halfWholesalePrice: 70,
      wholesalePrice: 64,
      costPrice: 58,
      stockQty: 40,
      minStockAlert: 10,
      maxStockTarget: 100,
      supplierId: sup2.id,
    },
  ];

  for (const p of demoProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
  }

  // FEFO Batch sample
  const soonDate = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000);
  await prisma.productBatch.upsert({
    where: { id: 'bth-milk-1' },
    update: {},
    create: {
      id: 'bth-milk-1',
      productId: 'prd-milk-1',
      productName: 'لبن جهينة كامل الدسم 1 لتر',
      batchCode: 'BATCH-2026-A1',
      expiryDate: soonDate,
      qty: 24,
      costPrice: 38,
      supplierId: sup1.id,
    },
  });

  // Sample Promotion
  await prisma.storePromotion.upsert({
    where: { id: 'prm-weekend-5' },
    update: {},
    create: {
      id: 'prm-weekend-5',
      name: 'خصم 5% للفواتير فوق 500 ج.م',
      active: true,
      ruleType: PromotionRuleType.PERCENT,
      value: 5,
      minSubtotal: 500,
      minQty: 0,
      category: '',
    },
  });

  // Initial Invoice with Hash Chain & Treasury Allocation
  const existingInv = await prisma.invoice.count();
  if (existingInv === 0) {
    const prevHash = 'GENESIS_00000000';
    const invNumber = 'INV-2026-0001';
    const recordHash = hashInvoice(`${prevHash}|${invNumber}|228.00|completed`);
    await prisma.invoice.create({
      data: {
        invoiceNumber: invNumber,
        activityId: 'grocery',
        customerId: cus1.id,
        customerName: cus1.name,
        cashierId: owner.id,
        cashierName: owner.name,
        paymentMethod: PaymentMethod.INSTAPAY,
        status: 'COMPLETED',
        subtotal: 228,
        discountTotal: 0,
        grandTotal: 228,
        totalCost: 183,
        netProfit: 45,
        paidAmount: 228,
        changeAmount: 0,
        paymentRef: 'IPN-884210',
        prevHash,
        recordHash,
        items: {
          create: [
            {
              productId: 'prd-oil-1',
              productName: 'زيت ذرة كريستال 1 لتر',
              sku: 'GR-1001',
              unit: 'زجاجة',
              priceTier: PriceTier.RETAIL,
              quantity: 2,
              unitPriceSnapshot: 92,
              unitCostSnapshot: 74,
              discountAmount: 0,
              lineTotal: 184,
              lineProfit: 36,
            },
            {
              productId: 'prd-rice-1',
              productName: 'أرز مصري الضحى 1 كجم',
              sku: 'GR-1002',
              unit: 'كيس',
              priceTier: PriceTier.RETAIL,
              quantity: 1,
              unitPriceSnapshot: 44,
              unitCostSnapshot: 35,
              discountAmount: 0,
              lineTotal: 44,
              lineProfit: 9,
            },
          ],
        },
        allocations: {
          create: [
            {
              treasuryId: 'trs-instapay',
              treasuryName: 'حساب إنستا باي (InstaPay)',
              method: PaymentMethod.INSTAPAY,
              amount: 228,
              feeAmount: 0,
              referenceCode: 'IPN-884210',
            },
          ],
        },
      },
    });
  }

  // Sample Expense & Recurring Expense
  const existingExp = await prisma.storeExpense.count();
  if (existingExp === 0) {
    await prisma.storeExpense.create({
      data: {
        title: 'فاتورة كهرباء وإنترنت المحل',
        category: ExpenseCategory.UTILITIES,
        amount: 450,
        paymentSource: ExpensePaymentSource.CASH_DRAWER,
        treasuryId: 'trs-cash-main',
        treasuryName: 'درج الكاشير الرئيسي',
        actorName: owner.name,
        notes: 'سداد شهري منتظم',
      },
    });
  }

  await prisma.recurringExpense.upsert({
    where: { id: 'rec-rent-1' },
    update: {},
    create: {
      id: 'rec-rent-1',
      title: 'إيجار المقر التجاري الشهري',
      category: ExpenseCategory.RENT,
      amount: 6500,
      paymentSource: ExpensePaymentSource.CASH_DRAWER,
      treasuryId: 'trs-cash-main',
      treasuryName: 'درج الكاشير الرئيسي',
      frequency: RecurringFrequency.MONTHLY,
      nextDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      active: true,
      notes: 'يستحق أول كل شهر ميلادي',
    },
  });

  // Sample Equity Partner
  await prisma.equityPartner.upsert({
    where: { id: 'prt-owner-1' },
    update: {},
    create: {
      id: 'prt-owner-1',
      name: 'الحاج محمود (المؤسس)',
      phone: '01012345678',
      roleTitle: 'شريك مدير',
      capitalContribution: 250000,
      profitSharePercent: 60,
      active: true,
    },
  });
  await prisma.equityPartner.upsert({
    where: { id: 'prt-partner-2' },
    update: {},
    create: {
      id: 'prt-partner-2',
      name: 'م. طارق حسن',
      phone: '01087654321',
      roleTitle: 'شريك ممول',
      capitalContribution: 150000,
      profitSharePercent: 40,
      active: true,
    },
  });

  // Sample Scheduled Report
  await prisma.scheduledReportConfig.upsert({
    where: { id: 'sch-daily-1' },
    update: {},
    create: {
      id: 'sch-daily-1',
      name: 'ملخص الإغلاق اليومي التلقائي للمالك',
      active: true,
      frequency: ScheduledFrequency.DAILY,
      dayOfWeek: 0,
      sendTime: '22:00',
      channel: ScheduledChannel.IN_APP,
      recipientEmailsJson: [],
      activityFilter: 'all',
      includeProfits: true,
      includeAlerts: true,
    },
  });

  await prisma.appLicense.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeId: 'STORE-EGY-001',
      plan: 'PRO_COMMERCIAL',
      status: 'ACTIVE',
      maxTerminals: 10,
      hardwareFingerprint: crypto
        .createHash('sha256')
        .update('tajirpro-mysql-host')
        .digest('hex')
        .slice(0, 24),
      signatureHex: crypto
        .createHmac('sha256', process.env.NUXT_LICENSE_SECRET || 'TAJIRPRO-PRODUCTION-HMAC-KEY')
        .update('STORE-EGY-001:PRO_COMMERCIAL')
        .digest('hex'),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('TajirPro MySQL database seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
