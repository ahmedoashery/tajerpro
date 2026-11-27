import { createError, defineEventHandler, getRouterParam } from 'h3';
import { buildDashboardAndAlerts, buildReportsPayload } from '../../../utils/analytics';
import { requirePermission } from '../../../utils/crypto';
import { getPrisma } from '../../../utils/prisma';

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'view_reports');
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'معرف الجدولة مطلوب' });
  const prisma = getPrisma();

  const sched = await prisma.scheduledReportConfig.findUnique({ where: { id } });
  if (!sched) throw createError({ statusCode: 404, statusMessage: 'الجدولة غير موجودة' });

  const now = new Date();
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
  const periodKey = now.toISOString().slice(0, 10);

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
      isManualRun: true,
    },
  });

  await prisma.scheduledReportConfig.update({
    where: { id: sched.id },
    data: { lastRunAt: now, lastRunPeriodKey: periodKey },
  });

  return { digest };
});
