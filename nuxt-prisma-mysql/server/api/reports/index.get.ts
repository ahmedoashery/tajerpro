import { defineEventHandler, getQuery } from 'h3';
import { buildReportsPayload } from '../../utils/analytics';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'view_reports');
  const query = getQuery(event);
  const period = String(query.period || 'daily') as 'daily' | 'monthly' | 'yearly';
  const activityId = query.activityId ? String(query.activityId) : 'all';
  const fromDate = query.fromDate ? String(query.fromDate) : undefined;
  const toDate = query.toDate ? String(query.toDate) : undefined;

  const prisma = getPrisma();
  return await buildReportsPayload(prisma, { period, activityId, fromDate, toDate });
});
