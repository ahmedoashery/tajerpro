import nodemailer from 'nodemailer';
import type {
  ScheduledReportConfig,
  ScheduledReportDigest,
  ScheduledReportDigestSummary,
  ScheduledReportEmailStatus,
  ScheduledReportFrequency,
} from '../../shared/types.ts';
import type { StoreDatabase } from '../db/storeDatabase.ts';
import type { RealtimeHub } from '../realtime/wsHub.ts';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getIsoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad2(weekNo)}`;
}

export function computeSchedulePeriodWindow(
  frequency: ScheduledReportFrequency,
  now: Date
): { fromDate: string; toDate: string; periodKey: string } {
  const toDate = formatLocalDateKey(now);
  if (frequency === 'daily') {
    return {
      fromDate: toDate,
      toDate,
      periodKey: toDate,
    };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return {
    fromDate: formatLocalDateKey(start),
    toDate,
    periodKey: getIsoWeekKey(now),
  };
}

export function isScheduleDue(schedule: ScheduledReportConfig, now: Date): boolean {
  if (!schedule.active) return false;
  const nowHHmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (nowHHmm < schedule.sendTime) return false;
  if (schedule.frequency === 'weekly' && now.getDay() !== schedule.dayOfWeek) {
    return false;
  }
  const { periodKey } = computeSchedulePeriodWindow(schedule.frequency, now);
  return schedule.lastRunPeriodKey !== periodKey;
}

export function isEmailTransportConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n: number): string {
  return `${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

export function formatDigestEmailHtml(storeName: string, digest: ScheduledReportDigest): string {
  const s = digest.summary;
  const alertsHtml =
    s.alerts.length > 0
      ? s.alerts
          .map(
            (a) =>
              `<li style="margin-bottom:8px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:${
                a.severity === 'danger' ? '#fff1f2' : a.severity === 'warning' ? '#fffbeb' : '#f8fafc'
              }">
                <strong style="color:#0f172a;">${escapeHtml(a.title)}</strong>
                <div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(a.message)}</div>
              </li>`
          )
          .join('')
      : '<li style="color:#059669;font-size:13px;">لا توجد تحذيرات مالية أو تشغيلية حرجة حالياً.</li>';

  const profitRows = s.profitsIncluded
    ? `
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">مجمل الربح (${s.grossMarginPercent}%)</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${fmtMoney(s.grossProfit)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">المصروفات التشغيلية</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#be123c;">${fmtMoney(s.operatingExpenses)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">عمولات التحصيل الإلكتروني</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${fmtMoney(s.cardFees)}</td></tr>
      <tr style="background:#ecfdf5;"><td style="padding:10px 8px;font-weight:bold;">صافي الربح التشغيلي (${s.netMarginPercent}%)</td><td style="padding:10px 8px;font-weight:bold;color:#047857;">${fmtMoney(s.netOperatingProfit)}</td></tr>
    `
    : '';

  return `
    <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <div style="border-bottom:2px solid #059669;padding-bottom:12px;margin-bottom:16px;">
        <div style="font-size:18px;font-weight:bold;">${escapeHtml(storeName)}</div>
        <div style="font-size:14px;color:#047857;margin-top:4px;">${escapeHtml(digest.title)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">الفترة: ${digest.fromDate} إلى ${digest.toDate}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px;">
        <tbody>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">صافي المبيعات</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${fmtMoney(s.revenue)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">عدد الفواتير / المرتجعات</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${s.invoiceCount} فاتورة · ${s.returnedCount} مرتجع (متوسط ${fmtMoney(s.avgInvoiceValue)})</td></tr>
          ${profitRows}
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">السيولة المتاحة بالخزائن</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${fmtMoney(s.treasuriesTotal)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">ذمم العملاء / مستحقات الموردين</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">لنا ${fmtMoney(s.customerReceivables)} · علينا ${fmtMoney(s.supplierPayables)}</td></tr>
          <tr><td style="padding:8px;">حالة نواقص المخزون</td><td style="padding:8px;">${s.outOfStockCount} نافد · ${s.lowStockCount} منخفض</td></tr>
        </tbody>
      </table>

      <div>
        <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">التحذيرات المالية والتشغيلية (${s.alerts.length})</div>
        <ul style="list-style:none;padding:0;margin:0;">${alertsHtml}</ul>
      </div>
    </div>
  `;
}

export function formatDigestEmailText(storeName: string, digest: ScheduledReportDigest): string {
  const s = digest.summary;
  const lines = [
    `${storeName} - ${digest.title}`,
    `الفترة: ${digest.fromDate} إلى ${digest.toDate}`,
    `صافي المبيعات: ${fmtMoney(s.revenue)} (${s.invoiceCount} فاتورة، ${s.returnedCount} مرتجع)`,
  ];
  if (s.profitsIncluded) {
    lines.push(
      `مجمل الربح: ${fmtMoney(s.grossProfit)} (${s.grossMarginPercent}%)`,
      `المصروفات التشغيلية: ${fmtMoney(s.operatingExpenses)}`,
      `صافي الربح التشغيلي: ${fmtMoney(s.netOperatingProfit)} (${s.netMarginPercent}%)`
    );
  }
  lines.push(
    `السيولة بالخزائن: ${fmtMoney(s.treasuriesTotal)}`,
    `ذمم العملاء: ${fmtMoney(s.customerReceivables)} | مستحقات الموردين: ${fmtMoney(s.supplierPayables)}`,
    `نواقص المخزون: ${s.outOfStockCount} نافد / ${s.lowStockCount} منخفض`,
    `التحذيرات (${s.alerts.length}):`,
    ...(s.alerts.length > 0
      ? s.alerts.map((a) => `- ${a.title}: ${a.message}`)
      : ['- لا توجد تحذيرات مالية أو تشغيلية حالياً.'])
  );
  return lines.join('\n');
}

export class ScheduledReportsService {
  private runningTick = false;
  private readonly storeDb: StoreDatabase;
  private readonly wsHub: RealtimeHub | null;

  constructor(storeDb: StoreDatabase, wsHub: RealtimeHub | null) {
    this.storeDb = storeDb;
    this.wsHub = wsHub;
  }

  public buildDigestSummary(
    schedule: ScheduledReportConfig,
    fromDate: string,
    toDate: string
  ): ScheduledReportDigestSummary {
    const reports = this.storeDb.getReportsData({
      period: 'daily',
      activityFilter: schedule.activityFilter,
      fromDate,
      toDate,
    });
    const pl = reports.profitLoss;
    const exec = reports.executiveSummary;
    const customers = this.storeDb.getCustomers();
    const suppliers = this.storeDb.getSuppliers();
    const treasuries = this.storeDb.getTreasuries();
    const alerts = schedule.includeAlerts ? this.storeDb.getOwnerAlerts() : [];

    const treasuriesTotal = Number(
      treasuries.reduce((s, t) => s + Number(t.currentBalance || 0), 0).toFixed(2)
    );
    const customerReceivables = Number(
      customers.reduce((s, c) => s + Number(c.balanceDue || 0), 0).toFixed(2)
    );
    const supplierPayables = Number(
      suppliers.reduce((s, sup) => s + Number(sup.balanceDue || 0), 0).toFixed(2)
    );

    const profitsIncluded = Boolean(schedule.includeProfits);

    return {
      profitsIncluded,
      revenue: reports.totals.revenue,
      grossProfit: profitsIncluded ? pl?.grossProfit ?? reports.totals.profit : 0,
      grossMarginPercent: profitsIncluded ? pl?.grossMarginPercent ?? reports.totals.marginPercent : 0,
      operatingExpenses: profitsIncluded ? pl?.operatingExpensesTotal ?? 0 : 0,
      cardFees: profitsIncluded ? pl?.cardFeesTotal ?? 0 : 0,
      netOperatingProfit: profitsIncluded ? pl?.netOperatingProfit ?? 0 : 0,
      netMarginPercent: profitsIncluded ? pl?.netOperatingMarginPercent ?? 0 : 0,
      invoiceCount: reports.totals.invoiceCount,
      returnedCount: reports.totals.returnedCount,
      avgInvoiceValue: exec?.avgInvoiceValue ?? 0,
      revenueDeltaPercent: reports.periodComparison?.revenueDeltaPercent ?? null,
      treasuriesTotal,
      customerReceivables,
      supplierPayables,
      lowStockCount: reports.inventoryReport.counts.low,
      outOfStockCount: reports.inventoryReport.counts.out,
      alerts,
    };
  }

  private async trySendEmail(
    storeName: string,
    digest: ScheduledReportDigest
  ): Promise<{ status: ScheduledReportEmailStatus; error: string }> {
    const wantsEmail = digest.channel === 'email' || digest.channel === 'both';
    if (!wantsEmail) {
      return { status: 'not_requested', error: '' };
    }
    if (digest.recipientEmails.length === 0) {
      return { status: 'failed', error: 'لا توجد عناوين بريد إلكتروني مسجلة' };
    }
    if (!isEmailTransportConfigured()) {
      return {
        status: 'skipped_not_configured',
        error: 'خادم البريد SMTP غير مضبوط في متغيرات البيئة (.env)',
      };
    }

    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      });

      const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@tajirpro.local';
      await transporter.sendMail({
        from: fromAddress,
        to: digest.recipientEmails.join(', '),
        subject: `${storeName} — ${digest.title} (${digest.fromDate})`,
        text: formatDigestEmailText(storeName, digest),
        html: formatDigestEmailHtml(storeName, digest),
      });

      return { status: 'sent', error: '' };
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : 'فشل إرسال البريد الإلكتروني',
      };
    }
  }

  public async dispatchSchedule(
    scheduleId: string,
    options: { manual?: boolean; now?: Date } = {}
  ): Promise<ScheduledReportDigest> {
    const schedule = this.storeDb.getScheduledReportById(scheduleId);
    if (!schedule) {
      throw new Error('جدولة التقرير غير موجودة');
    }

    const now = options.now || new Date();
    const isManualRun = Boolean(options.manual);
    const { fromDate, toDate, periodKey } = computeSchedulePeriodWindow(schedule.frequency, now);
    const summary = this.buildDigestSummary(schedule, fromDate, toDate);
    const settings = this.storeDb.getSettings();

    const freqLabel = schedule.frequency === 'weekly' ? 'التقرير الأسبوعي' : 'التقرير اليومي';
    const title = `${freqLabel}: ${schedule.name}`;

    // Deliver in-app automatically if selected OR as fallback when SMTP is not configured
    const inAppDelivered =
      schedule.channel === 'in_app' ||
      schedule.channel === 'both' ||
      !isEmailTransportConfigured();

    let emailStatus: ScheduledReportEmailStatus = 'not_requested';
    let emailError = '';

    const tempDigest: ScheduledReportDigest = {
      id: 'pending',
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      frequency: schedule.frequency,
      periodKey: isManualRun ? `manual-${now.toISOString()}` : periodKey,
      fromDate,
      toDate,
      title,
      summary,
      channel: schedule.channel,
      inAppDelivered,
      emailStatus: 'not_requested',
      emailError: '',
      recipientEmails: schedule.recipientEmails,
      readByUserIds: [],
      isManualRun,
      createdAt: now.toISOString(),
    };

    const emailRes = await this.trySendEmail(settings.storeName, tempDigest);
    emailStatus = emailRes.status;
    emailError = emailRes.error;

    const saved = this.storeDb.createReportDigest({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      frequency: schedule.frequency,
      periodKey: tempDigest.periodKey,
      fromDate,
      toDate,
      title,
      summary,
      channel: schedule.channel,
      inAppDelivered,
      emailStatus,
      emailError,
      recipientEmails: schedule.recipientEmails,
      isManualRun,
      createdAt: tempDigest.createdAt,
    });

    this.storeDb.markScheduledReportExecuted(
      schedule.id,
      tempDigest.createdAt,
      isManualRun ? undefined : periodKey
    );

    if (inAppDelivered && this.wsHub) {
      this.wsHub.broadcast({ type: 'digest:created', digest: saved });
    }

    return saved;
  }

  public async tick(now = new Date()): Promise<ScheduledReportDigest[]> {
    if (this.runningTick) return [];
    this.runningTick = true;
    const dispatched: ScheduledReportDigest[] = [];
    try {
      const schedules = this.storeDb.listScheduledReports();
      for (const sched of schedules) {
        if (!isScheduleDue(sched, now)) continue;
        try {
          const digest = await this.dispatchSchedule(sched.id, { manual: false, now });
          dispatched.push(digest);
        } catch (err) {
          console.error('[ScheduledReportsService] Dispatch error for', sched.id, err);
        }
      }
      return dispatched;
    } finally {
      this.runningTick = false;
    }
  }
}
