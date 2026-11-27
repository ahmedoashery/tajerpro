import { PaymentMethod, PriceTier } from '@prisma/client';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { hashInvoiceRecord, requirePermission } from '../../utils/crypto';
import { getPrisma, num } from '../../utils/prisma';

const allocationSchema = z.object({
  treasuryId: z.string().nullable().optional(),
  method: z.nativeEnum(PaymentMethod).exclude(['SPLIT']),
  amount: z.number().positive(),
  referenceCode: z.string().optional(),
});

const checkoutSchema = z.object({
  activityId: z.string().min(1),
  customerId: z.string().nullable().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentRef: z.string().optional(),
  paidAmount: z.number().nonnegative().optional(),
  discountTotal: z.number().min(0).default(0),
  applyPromotions: z.boolean().default(true),
  redeemPoints: z.number().int().min(0).default(0),
  useStoreCredit: z.number().min(0).default(0),
  fromQuotationId: z.string().nullable().optional(),
  notes: z.string().optional(),
  allocations: z.array(allocationSchema).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        priceTier: z.nativeEnum(PriceTier).default(PriceTier.RETAIL),
        customUnitPrice: z.number().nonnegative().optional(),
        discountAmount: z.number().min(0).default(0),
      })
    )
    .min(1),
});

function treasuryTypeForMethod(method: PaymentMethod): string {
  if (method === 'INSTAPAY') return 'INSTAPAY';
  if (method === 'VODAFONE_CASH') return 'WALLET';
  if (method === 'CARD') return 'BANK_POS';
  return 'CASH_DRAWER';
}

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'pos_sell');
  const body = checkoutSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const settings = await tx.storeSettings.findUnique({ where: { id: 1 } });
    const allowNegative = Boolean(settings?.allowNegativeStock);
    const vatPercent = num(settings?.vatPercent);
    const cardFeePercent = num(settings?.cardFeePercent, 1.5);

    let subtotal = 0;
    let itemDiscountTotal = 0;
    let totalCost = 0;

    const preparedItems: Array<{
      productId: string;
      productName: string;
      sku: string;
      unit: string;
      category: string;
      priceTier: PriceTier;
      quantity: number;
      unitPriceSnapshot: number;
      unitCostSnapshot: number;
      discountAmount: number;
      lineTotal: number;
      lineProfit: number;
      stockAfter: number;
    }> = [];

    for (const line of body.items) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product) {
        throw createError({ statusCode: 404, statusMessage: 'أحد الأصناف غير موجود' });
      }
      const available = num(product.stockQty);
      if (!allowNegative && available < line.quantity) {
        throw createError({
          statusCode: 409,
          statusMessage: `الرصيد غير كافٍ للصنف ${product.name} (المتاح ${available})`,
        });
      }

      let unitPrice = num(product.salePrice);
      if (line.priceTier === PriceTier.HALF_WHOLESALE && num(product.halfWholesalePrice) > 0) {
        unitPrice = num(product.halfWholesalePrice);
      } else if (line.priceTier === PriceTier.WHOLESALE && num(product.wholesalePrice) > 0) {
        unitPrice = num(product.wholesalePrice);
      } else if (line.priceTier === PriceTier.CUSTOM && line.customUnitPrice !== undefined) {
        unitPrice = line.customUnitPrice;
      }

      const unitCost = num(product.costPrice);
      const gross = unitPrice * line.quantity;
      const lineTotal = Math.max(0, gross - line.discountAmount);
      const lineCost = unitCost * line.quantity;
      const lineProfit = Number((lineTotal - lineCost).toFixed(2));
      const stockAfter = Number((available - line.quantity).toFixed(2));

      subtotal += gross;
      itemDiscountTotal += line.discountAmount;
      totalCost += lineCost;

      preparedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        category: product.category,
        priceTier: line.priceTier,
        quantity: line.quantity,
        unitPriceSnapshot: unitPrice,
        unitCostSnapshot: unitCost,
        discountAmount: line.discountAmount,
        lineTotal: Number(lineTotal.toFixed(2)),
        lineProfit,
        stockAfter,
      });
    }

    // Active promotion calculation
    let promotionDiscount = 0;
    if (body.applyPromotions) {
      const now = new Date();
      const promos = await tx.storePromotion.findMany({ where: { active: true } });
      const totalQty = preparedItems.reduce((s, i) => s + i.quantity, 0);
      for (const promo of promos) {
        if (promo.startsAt && promo.startsAt > now) continue;
        if (promo.endsAt && promo.endsAt < now) continue;
        if (subtotal < num(promo.minSubtotal) || totalQty < num(promo.minQty)) continue;
        let candidate = 0;
        if (promo.ruleType === 'PERCENT') {
          candidate = (subtotal * num(promo.value)) / 100;
        } else if (promo.ruleType === 'FIXED') {
          candidate = num(promo.value);
        }
        if (candidate > promotionDiscount) promotionDiscount = candidate;
      }
      promotionDiscount = Number(Math.min(subtotal - itemDiscountTotal, promotionDiscount).toFixed(2));
    }

    // Customer validation & Loyalty / Store Credit redemption
    let customerName = 'عميل نقدي';
    let loyaltyDiscount = 0;
    let storeCreditApplied = 0;
    let redeemedPoints = 0;
    const customer = body.customerId
      ? await tx.customer.findUnique({ where: { id: body.customerId } })
      : null;

    if (customer) {
      customerName = customer.name;
      if (body.redeemPoints > 0 && settings?.loyaltyEnabled) {
        const minPts = settings.minRedeemPoints || 10;
        if (body.redeemPoints <= customer.loyaltyPoints && body.redeemPoints >= minPts) {
          redeemedPoints = body.redeemPoints;
          loyaltyDiscount = Number((redeemedPoints * num(settings.pointValueEgp, 1)).toFixed(2));
        }
      }
      if (body.useStoreCredit > 0 && num(customer.storeCreditBalance) > 0) {
        storeCreditApplied = Math.min(num(customer.storeCreditBalance), body.useStoreCredit);
      }
    }

    const totalDiscounts = Number((itemDiscountTotal + body.discountTotal + promotionDiscount + loyaltyDiscount).toFixed(2));
    const taxableBase = Math.max(0, subtotal - totalDiscounts);
    const vatAmount = Number(((taxableBase * vatPercent) / 100).toFixed(2));
    const grandTotal = Number(Math.max(0, taxableBase + vatAmount - storeCreditApplied).toFixed(2));
    const netProfit = Number((grandTotal - totalCost).toFixed(2));

    // Check Credit Limit if CREDIT
    if (customer && body.paymentMethod === PaymentMethod.CREDIT && num(customer.creditLimit) > 0) {
      if (num(customer.balanceDue) + grandTotal > num(customer.creditLimit)) {
        throw createError({
          statusCode: 409,
          statusMessage: `تجاوز الحد الائتماني للعميل (${num(customer.creditLimit).toFixed(2)} ج.م)`,
        });
      }
    }

    const activeTreasuries = await tx.treasuryAccount.findMany({ where: { active: true } });
    const allocInputs =
      body.allocations && body.allocations.length > 0
        ? body.allocations
        : body.paymentMethod === PaymentMethod.CREDIT
          ? []
          : [
              {
                treasuryId: null,
                method: body.paymentMethod === PaymentMethod.SPLIT ? PaymentMethod.CASH : body.paymentMethod,
                amount: grandTotal,
                referenceCode: body.paymentRef || '',
              },
            ];

    const resolvedAllocations: Array<{
      treasuryId: string | null;
      treasuryName: string;
      method: PaymentMethod;
      amount: number;
      feeAmount: number;
      referenceCode: string;
    }> = [];

    for (const al of allocInputs) {
      if (al.method === PaymentMethod.CREDIT) {
        resolvedAllocations.push({
          treasuryId: null,
          treasuryName: 'آجل على العميل',
          method: al.method,
          amount: al.amount,
          feeAmount: 0,
          referenceCode: al.referenceCode || '',
        });
        continue;
      }
      const targetType = treasuryTypeForMethod(al.method);
      const treasury =
        (al.treasuryId ? activeTreasuries.find((t) => t.id === al.treasuryId) : null) ||
        activeTreasuries.find((t) => t.type === targetType) ||
        activeTreasuries.find((t) => t.isDefault) ||
        activeTreasuries[0];
      const feeAmount = al.method === PaymentMethod.CARD ? Number(((al.amount * cardFeePercent) / 100).toFixed(2)) : 0;
      const netDeposit = Number((al.amount - feeAmount).toFixed(2));
      if (treasury) {
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: { currentBalance: { increment: netDeposit } },
        });
      }
      resolvedAllocations.push({
        treasuryId: treasury?.id || null,
        treasuryName: treasury?.name || 'الخزينة الرئيسية',
        method: al.method,
        amount: al.amount,
        feeAmount,
        referenceCode: al.referenceCode || body.paymentRef || '',
      });
    }

    const creditTotalFromAlloc = resolvedAllocations
      .filter((a) => a.method === PaymentMethod.CREDIT)
      .reduce((s, a) => s + a.amount, 0);
    const creditIncrement =
      body.paymentMethod === PaymentMethod.CREDIT ? grandTotal : creditTotalFromAlloc;

    const paidAmount =
      body.paymentMethod === PaymentMethod.CREDIT
        ? 0
        : body.paidAmount !== undefined
          ? body.paidAmount
          : grandTotal;
    const changeAmount = Number(Math.max(0, paidAmount - grandTotal).toFixed(2));

    const lastInvoice = await tx.invoice.findFirst({ orderBy: { createdAt: 'desc' } });
    const prevHash = lastInvoice?.recordHash || 'GENESIS_00000000';
    const count = await tx.invoice.count();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    const recordHash = hashInvoiceRecord(prevHash, invoiceNumber, grandTotal, 'completed');

    const earnRate = num(settings?.earnRateEgpPerPoint, 50);
    const earnedPoints =
      customer && settings?.loyaltyEnabled && body.paymentMethod !== PaymentMethod.CREDIT
        ? Math.floor(grandTotal / Math.max(1, earnRate))
        : 0;

    if (customer) {
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          balanceDue: { increment: creditIncrement },
          totalPurchases: { increment: grandTotal },
          loyaltyPoints: Math.max(0, customer.loyaltyPoints - redeemedPoints + earnedPoints),
          storeCreditBalance: Math.max(0, num(customer.storeCreditBalance) - storeCreditApplied),
          lastPurchaseAt: new Date(),
        },
      });
    }

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        activityId: body.activityId,
        customerId: customer?.id || null,
        customerName,
        cashierId: actor.id,
        cashierName: actor.name,
        paymentMethod: body.paymentMethod,
        status: 'COMPLETED',
        subtotal: Number(subtotal.toFixed(2)),
        discountTotal: Number((itemDiscountTotal + body.discountTotal + loyaltyDiscount).toFixed(2)),
        promotionDiscount,
        vatAmount,
        grandTotal,
        totalCost: Number(totalCost.toFixed(2)),
        netProfit,
        paidAmount,
        changeAmount,
        loyaltyPointsEarned: earnedPoints,
        loyaltyPointsRedeemed: redeemedPoints,
        storeCreditUsed: storeCreditApplied,
        paymentRef: body.paymentRef || '',
        notes: body.notes || '',
        prevHash,
        recordHash,
        items: {
          create: preparedItems.map(({ stockAfter: _sa, category: _cat, ...rest }) => rest),
        },
        allocations: {
          create: resolvedAllocations,
        },
      },
      include: { items: true, allocations: true },
    });

    // Update stock & FEFO batches
    for (const item of preparedItems) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: item.stockAfter },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'SALE',
          deltaQty: -item.quantity,
          stockAfter: item.stockAfter,
          refId: invoice.invoiceNumber,
          note: `بيع فاتورة ${invoice.invoiceNumber}`,
          actorId: actor.id,
        },
      });

      // FEFO Batch deduction
      let rem = item.quantity;
      const batches = await tx.productBatch.findMany({
        where: { productId: item.productId, qty: { gt: 0 } },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      });
      for (const b of batches) {
        if (rem <= 0) break;
        const bQty = num(b.qty);
        const take = Math.min(bQty, rem);
        await tx.productBatch.update({
          where: { id: b.id },
          data: { qty: Number((bQty - take).toFixed(2)) },
        });
        rem -= take;
      }
    }

    // Payment transactions log
    for (const al of resolvedAllocations) {
      if (al.method !== PaymentMethod.CASH && al.method !== PaymentMethod.CREDIT) {
        await tx.paymentTransaction.create({
          data: {
            invoiceId: invoice.id,
            customerId: customer?.id || null,
            treasuryId: al.treasuryId,
            treasuryName: al.treasuryName,
            gateway: al.method,
            referenceCode: al.referenceCode || `REF-${Date.now()}`,
            amount: al.amount,
            feeAmount: al.feeAmount,
            netAmount: Number((al.amount - al.feeAmount).toFixed(2)),
            status: 'CONFIRMED',
          },
        });
      }
    }

    if (body.fromQuotationId) {
      await tx.salesQuotation
        .update({
          where: { id: body.fromQuotationId },
          data: { status: 'CONVERTED', convertedInvoiceId: invoice.id },
        })
        .catch(() => {});
    }

    return { invoice };
  });
});
