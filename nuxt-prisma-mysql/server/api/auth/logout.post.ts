import { defineEventHandler } from 'h3';
import { logSecurityAudit, resolveActor } from '../../utils/crypto';

export default defineEventHandler(async (event) => {
  const actor = await resolveActor(event).catch(() => null);
  if (actor) {
    await logSecurityAudit(actor, 'تسجيل خروج من الجلسة', 'auth', actor.id);
  }
  return { ok: true };
});
