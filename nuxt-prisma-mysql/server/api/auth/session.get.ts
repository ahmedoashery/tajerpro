import { defineEventHandler } from 'h3';
import { getEffectivePermissions, resolveActor } from '../../utils/crypto';
import { getPrisma, isDatabaseConfigured } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  if (!isDatabaseConfigured()) {
    return { authenticated: false, user: null };
  }
  const actor = await resolveActor(event).catch(() => null);
  if (!actor) return { authenticated: false, user: null };
  const prisma = getPrisma();
  const rolePerm = await prisma.rolePermission.findUnique({ where: { role: actor.role } });
  return {
    authenticated: true,
    user: {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      active: actor.active,
      effectivePermissions: getEffectivePermissions(
        rolePerm?.permissionsJson as Record<string, boolean> | null,
        actor.customPermissionsJson as Record<string, boolean> | null
      ),
    },
  };
});
