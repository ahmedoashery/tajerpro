import crypto from 'node:crypto';
import { PrismaClient, StaffRole } from '@prisma/client';

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
      receiptFooter: 'شكراً لتعاملكم معنا — البضاعة المباعة ترد وتستبدل خلال 14 يوماً',
      currency: 'EGP',
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
    },
  });

  const defaultPerms: Record<StaffRole, Record<string, boolean>> = {
    OWNER: {
      pos_sell: true,
      view_profits_costs: true,
      edit_prices_stock: true,
      invoice_return: true,
      view_reports: true,
      manage_partners: true,
      manage_payments: true,
      manage_security_rbac: true,
    },
    MANAGER: {
      pos_sell: true,
      view_profits_costs: true,
      edit_prices_stock: true,
      invoice_return: true,
      view_reports: true,
      manage_partners: true,
      manage_payments: true,
      manage_security_rbac: false,
    },
    CASHIER: {
      pos_sell: true,
      view_profits_costs: false,
      edit_prices_stock: false,
      invoice_return: false,
      view_reports: false,
      manage_partners: false,
      manage_payments: false,
      manage_security_rbac: false,
    },
  };

  for (const role of Object.values(StaffRole)) {
    await prisma.rolePermission.upsert({
      where: { role },
      update: {},
      create: {
        role,
        permissionsJson: defaultPerms[role],
      },
    });
  }

  const demoProducts = [
    {
      id: 'prd-oil-1',
      activityId: 'grocery',
      sku: 'GR-1001',
      barcode: '6221000100101',
      name: 'زيت ذرة كريستال 1 لتر',
      category: 'زيوت وسمن',
      unit: 'زجاجة',
      salePrice: 92,
      costPrice: 74,
      stockQty: 38,
      minStockAlert: 10,
      maxStockTarget: 80,
    },
    {
      id: 'prd-rice-1',
      activityId: 'grocery',
      sku: 'GR-1002',
      barcode: '6221000100102',
      name: 'أرز مصري الضحى 1 كجم',
      category: 'حبوب وبقوليات',
      unit: 'كيس',
      salePrice: 44,
      costPrice: 35,
      stockQty: 6,
      minStockAlert: 15,
      maxStockTarget: 100,
    },
    {
      id: 'prd-tea-1',
      activityId: 'grocery',
      sku: 'GR-1003',
      barcode: '6221000100103',
      name: 'شاي العروسة ناعم 250 جم',
      category: 'مشروبات',
      unit: 'عبوة',
      salePrice: 68,
      costPrice: 54,
      stockQty: 0,
      minStockAlert: 12,
      maxStockTarget: 60,
    },
    {
      id: 'prd-cable-1',
      activityId: 'electronics',
      sku: 'EL-2001',
      barcode: '6222000200201',
      name: 'كابل شحن سريع Anker Type-C',
      category: 'إكسسوارات موبايل',
      unit: 'قطعة',
      salePrice: 340,
      costPrice: 230,
      stockQty: 14,
      minStockAlert: 5,
      maxStockTarget: 40,
    },
  ];

  for (const p of demoProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
  }

  await prisma.customer.upsert({
    where: { id: 'cus-1' },
    update: {},
    create: {
      id: 'cus-1',
      name: 'محمد عبد الله (عميل دائم)',
      phone: '01098765432',
      balanceDue: 450,
      loyaltyPoints: 180,
    },
  });

  await prisma.supplier.upsert({
    where: { id: 'sup-1' },
    update: {},
    create: {
      id: 'sup-1',
      name: 'شركة النيل لتوزيع السلع',
      phone: '01122334455',
      company: 'النيل للتجارة والتوريد',
      balanceOwed: 3200,
    },
  });

  const existingInv = await prisma.invoice.count();
  if (existingInv === 0) {
    const prevHash = 'GENESIS_00000000';
    const invNumber = 'INV-2026-0001';
    const recordHash = hashInvoice(`${prevHash}|${invNumber}|228.00|completed`);
    await prisma.invoice.create({
      data: {
        invoiceNumber: invNumber,
        activityId: 'grocery',
        customerName: 'عميل نقدي',
        cashierId: owner.id,
        paymentMethod: 'INSTAPAY',
        status: 'COMPLETED',
        subtotal: 228,
        discountTotal: 0,
        grandTotal: 228,
        totalCost: 183,
        netProfit: 45,
        paymentRef: 'IPN-884210',
        prevHash,
        recordHash,
        items: {
          create: [
            {
              productId: 'prd-oil-1',
              productName: 'زيت ذرة كريستال 1 لتر',
              sku: 'GR-1001',
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
              quantity: 1,
              unitPriceSnapshot: 44,
              unitCostSnapshot: 35,
              discountAmount: 0,
              lineTotal: 44,
              lineProfit: 9,
            },
          ],
        },
      },
    });
  }

  await prisma.appLicense.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeId: 'STORE-EGY-001',
      plan: 'PRO_COMMERCIAL',
      status: 'ACTIVE',
      hardwareFingerprint: crypto.createHash('sha256').update('tajirpro-mysql-host').digest('hex').slice(0, 24),
      signatureHex: crypto.createHmac('sha256', process.env.NUXT_LICENSE_SECRET || 'TAJIRPRO-PRODUCTION-HMAC-KEY').update('STORE-EGY-001:PRO_COMMERCIAL').digest('hex'),
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
