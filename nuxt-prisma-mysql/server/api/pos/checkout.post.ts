import { PaymentMethod } from '@prisma/client';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { hashInvoiceRecord, requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const checkoutSchema = z.object({
  activityId: z.string().min(1),
  customerId: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentRef: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        discountAmount: z.number().min(0).default(0),
      })
    )
    .min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'pos_sell');
  const body = checkoutSchema.parse(await readBody(event));
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    let discountTotal = 0;
    let totalCost = 0;

    const preparedItems: Array<{
      productId: string;
      productName: string;
      sku: string;
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
      const available = Number(product.stockQty);
      if (available < line.quantity) {
        throw createError({
          statusCode: 409,
          statusMessage: `الرصيد غير كافٍ للصنف ${product.name} (المتاح ${available})`,
        });
      }

      const unitPrice = Number(product.salePrice);
      const unitCost = Number(product.costPrice);
      const gross = unitPrice * line.quantity;
      const lineTotal = Math.max(0, gross - line.discountAmount);
      const lineCost = unitCost * line.quantity;
      const lineProfit = Number((lineTotal - lineCost).toFixed(2));
      const stockAfter = Number((available - line.quantity).toFixed(2));

      subtotal += gross;
      discountTotal += line.discountAmount;
      totalCost += lineCost;

      preparedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: line.quantity,
        unitPriceSnapshot: unitPrice,
        unitCostSnapshot: unitCost,
        discountAmount: line.discountAmount,
        lineTotal: Number(lineTotal.toFixed(2)),
        lineProfit,
        stockAfter,
      });
    }

    const grandTotal = Number((subtotal - discountTotal).toFixed(2));
    const netProfit = Number((grandTotal - totalCost).toFixed(2));

    const lastInvoice = await tx.invoice.findFirst({ orderBy: { createdAt: 'desc' } });
    const prevHash = lastInvoice?.recordHash || 'GENESIS_00000000';
    const count = await tx.invoice.count();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    const recordHash = hashInvoiceRecord(prevHash, invoiceNumber, grandTotal, 'completed');

    let customerName = 'عميل نقدي';
    if (body.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
      if (customer) {
        customerName = customer.name;
        if (body.paymentMethod === PaymentMethod.CREDIT) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { balanceDue: { increment: grandTotal } },
          });
        } else {
          await tx.customer.update({
            where: { id: customer.id },
            data: { loyaltyPoints: { increment: Math.floor(grandTotal / 20) } },
          });
        }
      }
    }

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        activityId: body.activityId,
        customerId: body.customerId || null,
        customerName,
        cashierId: actor.id,
        paymentMethod: body.paymentMethod,
        status: 'COMPLETED',
        subtotal: Number(subtotal.toFixed(2)),
        discountTotal: Number(discountTotal.toFixed(2)),
        grandTotal,
        totalCost: Number(totalCost.toFixed(2)),
        netProfit,
        paymentRef: body.paymentRef || '',
        prevHash,
        recordHash,
        items: {
          create: preparedItems.map(({ stockAfter: _sa, ...rest }) => rest),
        },
      },
      include: { items: true },
    });

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
    }

    if (body.paymentMethod !== PaymentMethod.CASH && body.paymentMethod !== PaymentMethod.CREDIT) {
      await tx.paymentTransaction.create({
        data: {
          invoiceId: invoice.id,
          customerId: body.customerId || null,
          gateway: body.paymentMethod,
          referenceCode: body.paymentRef || `REF-${Date.now()}`,
          amount: grandTotal,
          status: 'CONFIRMED',
        },
      });
    }

    return { invoice };
  });
});
