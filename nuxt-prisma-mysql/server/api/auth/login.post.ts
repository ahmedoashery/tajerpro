import { createError, defineEventHandler, getHeader, readBody } from 'h3';
import { z } from 'zod';
import {
  checkPinRateLimit,
  clearPinFailures,
  getEffectivePermissions,
  hashPin,
  issueAuthToken,
  logSecurityAudit,
  recordPinFailure,
} from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const schema = z.object({
  userId: z.string().min(1),
  pin: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const body = schema.parse(await readBody(event));
  const fwd = getHeader(event, 'x-forwarded-for');
  const clientIp = (fwd ? fwd.split(',')[0].trim() : 'local') + `::${body.userId}`;
  const rate = checkPinRateLimit(clientIp);
  if (!rate.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `تم إيقاف محاولات الدخول مؤقتاً (${rate.retryAfterSec} ثانية)`,
    });
  }

  const prisma = getPrisma();
  const user = await prisma.staffUser.findUnique({ where: { id: body.userId } });
  if (!user || !user.active || user.pinHash !== hashPin(body.pin)) {
    recordPinFailure(clientIp);
    throw createError({ statusCode: 401, statusMessage: 'رمز الدخول (PIN) غير صحيح أو الحساب معطل' });
  }

  clearPinFailures(clientIp);
  await prisma.staffUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const rolePerm = await prisma.rolePermission.findUnique({ where: { role: user.role } });
  const effectivePermissions = getEffectivePermissions(
    rolePerm?.permissionsJson as Record<string, boolean> | null,
    user.customPermissionsJson as Record<string, boolean> | null
  );
  const token = issueAuthToken({ id: user.id, role: user.role, tokenVersion: user.tokenVersion });

  await logSecurityAudit(user, `تسجيل دخول ناجح (${user.name})`, 'auth', user.id);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      active: user.active,
      tokenVersion: user.tokenVersion,
      effectivePermissions,
    },
  };
});
