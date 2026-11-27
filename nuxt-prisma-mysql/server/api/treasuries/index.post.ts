import { TreasuryType } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const treasurySchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(TreasuryType),
  accountNumber: z.string().default(''),
  currentBalance: z.number().default(0),
  isDefault: z.boolean().default(false),
  notes: z.string().default(''),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'manage_payments');
  const body = treasurySchema.parse(await readBody(event));
  const prisma = getPrisma();

  if (body.isDefault) {
    await prisma.treasuryAccount.updateMany({ data: { isDefault: false } });
  }
  const treasury = await prisma.treasuryAccount.create({ data: body });
  return { treasury };
});
