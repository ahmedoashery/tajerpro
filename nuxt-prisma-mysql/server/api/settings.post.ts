import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { logSecurityAudit, requirePermission } from '../utils/crypto';
import { getPrisma } from '../utils/prisma';

const settingsSchema = z.object({
  storeName: z.string().min(1).optional(),
  activityId: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
  vatPercent: z.number().min(0).max(100).optional(),
  receiptFooter: z.string().optional(),
  allowNegativeStock: z.boolean().optional(),
  autoPrintAfterSale: z.boolean().optional(),
  requireLoginOnStart: z.boolean().optional(),
  loyaltyEnabled: z.boolean().optional(),
  earnRateEgpPerPoint: z.number().positive().optional(),
  pointValueEgp: z.number().positive().optional(),
  minRedeemPoints: z.number().int().min(1).optional(),
  instapayIpa: z.string().optional(),
  vodafoneCashNumber: z.string().optional(),
  cardFeePercent: z.number().min(0).max(20).optional(),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_settings');
  const body = settingsSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const updated = await prisma.storeSettings.update({
    where: { id: 1 },
    data: body,
  });

  await logSecurityAudit(actor, 'تحديث إعدادات المتجر والسياسات والنشاط', 'settings', 'store_settings');
  return { settings: updated };
});
