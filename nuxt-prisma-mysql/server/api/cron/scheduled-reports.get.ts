import { createError, defineEventHandler, getHeader } from 'h3';
import { buildDashboardAndAlerts, buildReportsPayload } from '../../utils/analytics';
import { getPrisma, isDatabaseConfigured } from '../../utils/prisma';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig();
  const cronSecret = String(cfg.cronSecret || process.env.CRON_SECRET || '').trim();
  if (cronSecret) {
    const auth = getHeader(event, 'authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized cron call' });
    }
  }

  if (!isDatabaseConfigured()) {
    return { ok: false, skipped: true, reason: 'DATABASE_URL not configured' };
  }

  const prisma = getPrisma();
  const schedules = await prisma.scheduledReportConfig.findMany({ where: { active: true } });
  const now = new Date();
  const periodKey = now.toISOString().slice(0, 10);
  const createdIds: string[] = [];

  for (const sched of schedules) {
    if (sched.lastRunPeriodKey === periodKey) continue;
    const from =
      sched.frequency === 'WEEKLY'
        ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const report = await buildReportsPayload(prisma, {
      period: 'daily',
      activityId: sched.activityFilter || 'all',
      fromDate: from.toISOString(),
      toDate: now.toISOString(),
    });
    const dash = await buildDashboardAndAlerts(prisma);
    const digest = await prisma.scheduledReportDigest.create({
      data: {
        scheduleId: sched.id,
        scheduleName: sched.name,
        frequency: sched.frequency,
        periodKey,
        fromDate: from,
        toDate: now,
        title: `${sched.name} (${periodKey})`,
        summaryJson: {
          revenue: report.profitLoss.netSalesRevenue,
          grossProfit: sched.includeProfits ? report.profitLoss.grossProfit : 0,
          operatingExpenses: report.profitLoss.operatingExpensesTotal,
          netOperatingProfit: sched.includeProfits ? report.profitLoss.netOperatingProfit : 0,
          invoiceCount: report.totals.invoiceCount,
          alertsCount: dash.ownerAlerts.length,
        },
        channel: sched.channel,
        inAppDelivered: true,
        isManualRun: false,
      },
    });
    await prisma.scheduledReportConfig.update({
      where: { id: sched.id },
      data: { lastRunAt: now, lastRunPeriodKey: periodKey },
    });
    createdIds.push(digest.id);
  }

  return { ok: true, generatedCount: createdIds.length, digestIds: createdIds };
});
