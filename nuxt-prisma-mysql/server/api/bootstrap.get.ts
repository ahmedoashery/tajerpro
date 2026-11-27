import { createError, defineEventHandler } from 'h3';
import { STORE_ACTIVITIES } from '../utils/activities';
import { buildDashboardAndAlerts } from '../utils/analytics';
import { getEffectivePermissions, resolveActor } from '../utils/crypto';
import { getPrisma, isDatabaseConfigured, num } from '../utils/prisma';

export default defineEventHandler(async (event) => {
  if (!isDatabaseConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'قاعدة بيانات MySQL غير مضبوطة: أضف DATABASE_URL في Vercel أو افتح إعدادات الخادم للربط المباشر.',
    });
  }

  const prisma = getPrisma();
  const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
  const staffRows = await prisma.staffUser.findMany({
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      tokenVersion: true,
      customPermissionsJson: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const rolePerms = await prisma.rolePermission.findMany();
  const rolePermissions = Object.fromEntries(
    rolePerms.map((r) => [r.role, r.permissionsJson as Record<string, boolean>])
  );
  const license = await prisma.appLicense.findUnique({ where: { id: 1 } });

  const staff = staffRows.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    active: u.active,
    tokenVersion: u.tokenVersion,
    lastLoginAt: u.lastLoginAt,
    customPermissions: (u.customPermissionsJson as Record<string, boolean> | null) || {},
    effectivePermissions: getEffectivePermissions(
      rolePermissions[u.role],
      u.customPermissionsJson as Record<string, boolean> | null
    ),
  }));

  const actor = await resolveActor(event);
  const locked = Boolean(settings?.requireLoginOnStart && !actor);

  const normalizedSettings = settings
    ? {
        ...settings,
        vatPercent: num(settings.vatPercent),
        earnRateEgpPerPoint: num(settings.earnRateEgpPerPoint, 50),
        pointValueEgp: num(settings.pointValueEgp, 1),
        cardFeePercent: num(settings.cardFeePercent, 1.5),
      }
    : null;

  if (locked) {
    return {
      locked: true,
      authenticated: false,
      settings: normalizedSettings,
      activities: STORE_ACTIVITIES,
      staff: staff.map(({ customPermissions: _c, effectivePermissions: _e, ...basic }) => basic),
      rolePermissions: {},
      currentUser: null,
      license,
      products: [],
      allProducts: [],
      treasuries: [],
      invoices: [],
      purchases: [],
      expenses: [],
      recurringExpenses: [],
      customers: [],
      suppliers: [],
      batches: [],
      promotions: [],
      quotations: [],
      equityPartners: [],
      equityDrawings: [],
      scheduledReports: [],
      reportDigests: [],
      movements: [],
      priceHistory: [],
      auditLogs: [],
      dashboard: null,
      ownerAlerts: [],
      reorderSuggestions: [],
    };
  }

  const [
    products,
    treasuries,
    invoices,
    purchases,
    expenses,
    recurringExpenses,
    customers,
    suppliers,
    batches,
    promotions,
    quotations,
    equityPartners,
    equityDrawings,
    scheduledReports,
    reportDigests,
    movements,
    priceHistory,
    auditLogs,
    analytics,
  ] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: 'asc' } }),
    prisma.treasuryAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    prisma.invoice.findMany({
      include: {
        items: true,
        allocations: true,
        returns: { include: { items: true } },
        cashier: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    }),
    prisma.purchaseOrder.findMany({
      include: { items: true, returns: { include: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
    prisma.storeExpense.findMany({ orderBy: { createdAt: 'desc' }, take: 120 }),
    prisma.recurringExpense.findMany({ orderBy: { nextDueDate: 'asc' } }),
    prisma.customer.findMany({ orderBy: { name: 'asc' } }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.productBatch.findMany({ orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }] }),
    prisma.storePromotion.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.salesQuotation.findMany({ orderBy: { createdAt: 'desc' }, take: 80 }),
    prisma.equityPartner.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.equityDrawing.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
    prisma.scheduledReportConfig.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.scheduledReportDigest.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
    prisma.productPriceHistory.findMany({ orderBy: { changedAt: 'desc' }, take: 60 }),
    prisma.securityAuditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 80 }),
    buildDashboardAndAlerts(prisma),
  ]);

  const currentUser = staff.find((u) => u.id === actor?.id) || staff[0] || null;
  const serializedProducts = products.map((p) => ({
    ...p,
    salePrice: num(p.salePrice),
    halfWholesalePrice: num(p.halfWholesalePrice),
    wholesalePrice: num(p.wholesalePrice),
    costPrice: num(p.costPrice),
    stockQty: num(p.stockQty),
    minStockAlert: num(p.minStockAlert),
    maxStockTarget: num(p.maxStockTarget),
  }));

  const activeActivityId = normalizedSettings?.activityId || 'grocery';

  return {
    locked: false,
    authenticated: Boolean(actor),
    settings: normalizedSettings,
    activities: STORE_ACTIVITIES,
    products: serializedProducts.filter((p) => p.activityId === activeActivityId),
    allProducts: serializedProducts,
    treasuries: treasuries.map((t) => ({ ...t, currentBalance: num(t.currentBalance) })),
    invoices: invoices.map((inv) => ({
      ...inv,
      subtotal: num(inv.subtotal),
      discountTotal: num(inv.discountTotal),
      promotionDiscount: num(inv.promotionDiscount),
      vatAmount: num(inv.vatAmount),
      grandTotal: num(inv.grandTotal),
      totalCost: num(inv.totalCost),
      netProfit: num(inv.netProfit),
      paidAmount: num(inv.paidAmount),
      changeAmount: num(inv.changeAmount),
      returnedTotal: num(inv.returnedTotal),
      storeCreditUsed: num(inv.storeCreditUsed),
      items: inv.items.map((it) => ({
        ...it,
        quantity: num(it.quantity),
        returnedQuantity: num(it.returnedQuantity),
        unitPriceSnapshot: num(it.unitPriceSnapshot),
        unitCostSnapshot: num(it.unitCostSnapshot),
        discountAmount: num(it.discountAmount),
        lineTotal: num(it.lineTotal),
        lineProfit: num(it.lineProfit),
      })),
      allocations: inv.allocations.map((a) => ({
        ...a,
        amount: num(a.amount),
        feeAmount: num(a.feeAmount),
      })),
      returns: inv.returns.map((r) => ({
        ...r,
        returnTotal: num(r.returnTotal),
        cashRefunded: num(r.cashRefunded),
        creditDebtReduced: num(r.creditDebtReduced),
        storeCreditAdded: num(r.storeCreditAdded),
        items: r.items.map((ri) => ({
          ...ri,
          quantity: num(ri.quantity),
          refundAmount: num(ri.refundAmount),
          costRecovered: num(ri.costRecovered),
        })),
      })),
    })),
    purchases: purchases.map((po) => ({
      ...po,
      grandTotal: num(po.grandTotal),
      returnedTotal: num(po.returnedTotal),
      paidAmount: num(po.paidAmount),
      remainingDebt: num(po.remainingDebt),
      items: po.items.map((it) => ({
        ...it,
        quantity: num(it.quantity),
        returnedQuantity: num(it.returnedQuantity),
        unitCost: num(it.unitCost),
        newSalePrice: it.newSalePrice !== null ? num(it.newSalePrice) : null,
        lineTotal: num(it.lineTotal),
      })),
      returns: po.returns.map((r) => ({
        ...r,
        returnTotal: num(r.returnTotal),
        debtReduced: num(r.debtReduced),
        cashRefunded: num(r.cashRefunded),
        items: r.items.map((ri) => ({
          ...ri,
          quantity: num(ri.quantity),
          refundAmount: num(ri.refundAmount),
        })),
      })),
    })),
    expenses: expenses.map((e) => ({ ...e, amount: num(e.amount) })),
    recurringExpenses: recurringExpenses.map((r) => ({ ...r, amount: num(r.amount) })),
    customers: customers.map((c) => ({
      ...c,
      balanceDue: num(c.balanceDue),
      totalPurchases: num(c.totalPurchases),
      creditLimit: num(c.creditLimit),
      defaultDiscountPercent: num(c.defaultDiscountPercent),
      storeCreditBalance: num(c.storeCreditBalance),
    })),
    suppliers: suppliers.map((s) => ({ ...s, balanceOwed: num(s.balanceOwed) })),
    batches: batches.map((b) => ({
      ...b,
      qty: num(b.qty),
      costPrice: num(b.costPrice),
    })),
    promotions: promotions.map((p) => ({
      ...p,
      value: num(p.value),
      minSubtotal: num(p.minSubtotal),
      minQty: num(p.minQty),
    })),
    quotations: quotations.map((q) => ({
      ...q,
      items: Array.isArray(q.itemsJson) ? q.itemsJson : [],
      subtotal: num(q.subtotal),
      discountTotal: num(q.discountTotal),
      grandTotal: num(q.grandTotal),
    })),
    equityPartners: equityPartners.map((ep) => ({
      ...ep,
      capitalContribution: num(ep.capitalContribution),
      profitSharePercent: num(ep.profitSharePercent),
    })),
    equityDrawings: equityDrawings.map((ed) => ({ ...ed, amount: num(ed.amount) })),
    scheduledReports,
    reportDigests,
    staff,
    rolePermissions,
    currentUser,
    license,
    movements: movements.map((m) => ({
      ...m,
      deltaQty: num(m.deltaQty),
      stockAfter: num(m.stockAfter),
    })),
    priceHistory: priceHistory.map((h) => ({
      ...h,
      oldSalePrice: num(h.oldSalePrice),
      newSalePrice: num(h.newSalePrice),
      oldCostPrice: num(h.oldCostPrice),
      newCostPrice: num(h.newCostPrice),
    })),
    auditLogs,
    dashboard: analytics.dashboard,
    ownerAlerts: analytics.ownerAlerts,
    reorderSuggestions: analytics.reorderSuggestions,
  };
});
