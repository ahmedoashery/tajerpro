import crypto from 'node:crypto';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { getLicenseSecret, logSecurityAudit, requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

const activateSchema = z.object({
  plan: z.enum(['TRIAL', 'PRO_COMMERCIAL', 'ENTERPRISE']).default('PRO_COMMERCIAL'),
  maxTerminals: z.number().int().min(1).max(100).default(10),
  durationDays: z.number().int().min(1).max(3650).default(365),
  storeId: z.string().min(3).default('STORE-EGY-001'),
});

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'manage_security_rbac');
  const body = activateSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const fingerprint = crypto
    .createHash('sha256')
    .update(`tajirpro-mysql-host:${body.storeId}`)
    .digest('hex')
    .slice(0, 24);
  const signatureHex = crypto
    .createHmac('sha256', getLicenseSecret())
    .update(`${body.storeId}:${body.plan}`)
    .digest('hex');
  const expiresAt = new Date(Date.now() + body.durationDays * 24 * 60 * 60 * 1000);

  if (!signatureHex) {
    throw createError({ statusCode: 400, statusMessage: 'تعذر توقيع الترخيص' });
  }

  const license = await prisma.appLicense.upsert({
    where: { id: 1 },
    update: {
      storeId: body.storeId,
      plan: body.plan,
      status: 'ACTIVE',
      maxTerminals: body.maxTerminals,
      hardwareFingerprint: fingerprint,
      signatureHex,
      expiresAt,
    },
    create: {
      id: 1,
      storeId: body.storeId,
      plan: body.plan,
      status: 'ACTIVE',
      maxTerminals: body.maxTerminals,
      hardwareFingerprint: fingerprint,
      signatureHex,
      expiresAt,
    },
  });

  await logSecurityAudit(actor, `تفعيل/تحديث ترخيص النظام (${body.plan})`, 'security', body.storeId);
  return { license };
});
