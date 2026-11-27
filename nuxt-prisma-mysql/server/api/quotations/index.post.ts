import { QuotationStatus } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const quotationSchema = z.object({
  activityId: z.string().min(1),
  customerId: z.string().nullable().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().default(''),
  discountTotal: z.number().min(0).default(0),
  validDays: z.number().int().min(1).max(365).default(7),
  notes: z.string().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        sku: z.string().default(''),
        unit: z.string().default('قطعة'),
        priceTier: z.string().default('RETAIL'),
        quantity: z.number().positive(),
        unitSalePrice: z.number().nonnegative(),
        discountAmount: z.number().min(0).default(0),
        lineTotal: z.number().nonnegative(),
      })
    )
    .min(1),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'pos_sell');
  const body = quotationSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const subtotal = body.items.reduce((s, i) => s + i.unitSalePrice * i.quantity, 0);
  const grandTotal = Math.max(0, subtotal - body.discountTotal - body.items.reduce((s, i) => s + i.discountAmount, 0));
  const count = await prisma.salesQuotation.count();
  const quotationNumber = `QT-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

  const quotation = await prisma.salesQuotation.create({
    data: {
      quotationNumber,
      activityId: body.activityId,
      customerId: body.customerId || null,
      customerName: body.customerName.trim(),
      customerPhone: body.customerPhone.trim(),
      status: QuotationStatus.ACTIVE,
      itemsJson: body.items,
      subtotal: Number(subtotal.toFixed(2)),
      discountTotal: Number(body.discountTotal.toFixed(2)),
      grandTotal: Number(grandTotal.toFixed(2)),
      validUntil: new Date(Date.now() + body.validDays * 24 * 60 * 60 * 1000),
      notes: body.notes,
      createdBy: actor.name,
    },
  });

  return { quotation };
});
