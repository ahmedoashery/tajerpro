import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ScheduledReportChannel,
  ScheduledReportConfig,
  ScheduledReportDigest,
  ScheduledReportDigestSummary,
  ScheduledReportEmailStatus,
  ScheduledReportFrequency,
  StoreActivityId,
} from '../../shared/types.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface DbScheduleRow {
  id: string;
  name: string;
  active: number;
  frequency: string;
  day_of_week: number;
  send_time: string;
  channel: string;
  recipient_emails_json: string;
  activity_filter: string;
  include_profits: number;
  include_alerts: number;
  last_run_at: string | null;
  last_run_period_key: string | null;
  created_at: string;
  updated_at: string;
}

interface DbDigestRow {
  id: string;
  schedule_id: string;
  schedule_name: string;
  frequency: string;
  period_key: string;
  from_date: string;
  to_date: string;
  title: string;
  summary_json: string;
  channel: string;
  in_app_delivered: number;
  email_status: string;
  email_error: string;
  recipient_emails_json: string;
  read_by_user_ids_json: string;
  is_manual_run: number;
  created_at: string;
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeEmails(emails?: unknown): string[] {
  const list = Array.isArray(emails)
    ? emails
    : typeof emails === 'string'
      ? emails.split(/[,;\s]+/)
      : [];
  const unique = new Set<string>();
  for (const item of list) {
    const clean = String(item || '').trim().toLowerCase();
    if (!clean) continue;
    if (!EMAIL_RE.test(clean)) {
      throw new Error(`صيغة البريد الإلكتروني غير صحيحة: ${clean}`);
    }
    unique.add(clean);
  }
  return Array.from(unique);
}

function normalizeSendTime(raw?: string): string {
  const clean = String(raw || '21:00').trim();
  if (!TIME_RE.test(clean)) {
    throw new Error('صيغة وقت الإرسال يجب أن تكون بصيغة 24 ساعة مثل 21:00');
  }
  return clean;
}

export class ScheduledReportsRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.seedDefaultScheduleIfEmpty();
  }

  private seedDefaultScheduleIfEmpty(): void {
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM scheduled_report_configs')
      .get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scheduled_report_configs (
          id, name, active, frequency, day_of_week, send_time, channel,
          recipient_emails_json, activity_filter, include_profits, include_alerts,
          last_run_at, last_run_period_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(
        'sched-daily-managers',
        'ملخص المبيعات والأرباح اليومي للمديرين',
        1,
        'daily',
        6,
        '21:00',
        'in_app',
        '[]',
        'all',
        1,
        1,
        now,
        now
      );
  }

  private mapScheduleRow(r: DbScheduleRow): ScheduledReportConfig {
    return {
      id: r.id,
      name: r.name,
      active: Boolean(r.active),
      frequency: r.frequency === 'weekly' ? 'weekly' : 'daily',
      dayOfWeek: Number.isInteger(r.day_of_week) ? Math.min(6, Math.max(0, r.day_of_week)) : 6,
      sendTime: r.send_time || '21:00',
      channel:
        r.channel === 'email' || r.channel === 'both' ? r.channel : 'in_app',
      recipientEmails: safeParseJson<string[]>(r.recipient_emails_json, []),
      activityFilter: (r.activity_filter || 'all') as StoreActivityId | 'all',
      includeProfits: Boolean(r.include_profits),
      includeAlerts: Boolean(r.include_alerts),
      lastRunAt: r.last_run_at || null,
      lastRunPeriodKey: r.last_run_period_key || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapDigestRow(r: DbDigestRow): ScheduledReportDigest {
    return {
      id: r.id,
      scheduleId: r.schedule_id,
      scheduleName: r.schedule_name,
      frequency: r.frequency === 'weekly' ? 'weekly' : 'daily',
      periodKey: r.period_key,
      fromDate: r.from_date,
      toDate: r.to_date,
      title: r.title,
      summary: safeParseJson<ScheduledReportDigestSummary>(r.summary_json, {
        profitsIncluded: true,
        revenue: 0,
        grossProfit: 0,
        grossMarginPercent: 0,
        operatingExpenses: 0,
        cardFees: 0,
        netOperatingProfit: 0,
        netMarginPercent: 0,
        invoiceCount: 0,
        returnedCount: 0,
        avgInvoiceValue: 0,
        revenueDeltaPercent: null,
        treasuriesTotal: 0,
        customerReceivables: 0,
        supplierPayables: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        alerts: [],
      }),
      channel:
        r.channel === 'email' || r.channel === 'both' ? r.channel : 'in_app',
      inAppDelivered: Boolean(r.in_app_delivered),
      emailStatus: (r.email_status as ScheduledReportEmailStatus) || 'not_requested',
      emailError: r.email_error || '',
      recipientEmails: safeParseJson<string[]>(r.recipient_emails_json, []),
      readByUserIds: safeParseJson<string[]>(r.read_by_user_ids_json, []),
      isManualRun: Boolean(r.is_manual_run),
      createdAt: r.created_at,
    };
  }

  public listSchedules(): ScheduledReportConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM scheduled_report_configs ORDER BY created_at DESC')
      .all() as DbScheduleRow[];
    return rows.map((r) => this.mapScheduleRow(r));
  }

  public getScheduleById(id: string): ScheduledReportConfig | null {
    const row = this.db
      .prepare('SELECT * FROM scheduled_report_configs WHERE id = ?')
      .get(id) as DbScheduleRow | undefined;
    return row ? this.mapScheduleRow(row) : null;
  }

  public createSchedule(input: {
    name?: string;
    active?: boolean;
    frequency?: ScheduledReportFrequency;
    dayOfWeek?: number;
    sendTime?: string;
    channel?: ScheduledReportChannel;
    recipientEmails?: string[] | string;
    activityFilter?: StoreActivityId | 'all';
    includeProfits?: boolean;
    includeAlerts?: boolean;
  }): ScheduledReportConfig {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('يرجى إدخال اسم واضح لجدولة التقرير');

    const frequency: ScheduledReportFrequency =
      input.frequency === 'weekly' ? 'weekly' : 'daily';
    const dayOfWeek = Math.min(6, Math.max(0, Math.round(Number(input.dayOfWeek ?? 6))));
    const sendTime = normalizeSendTime(input.sendTime);
    const channel: ScheduledReportChannel =
      input.channel === 'email' || input.channel === 'both' ? input.channel : 'in_app';
    const recipientEmails = normalizeEmails(input.recipientEmails);

    if ((channel === 'email' || channel === 'both') && recipientEmails.length === 0) {
      throw new Error('يرجى إدخال بريد إلكتروني واحد على الأقل لاستلام التقارير عبر البريد');
    }

    const id = `sched-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO scheduled_report_configs (
          id, name, active, frequency, day_of_week, send_time, channel,
          recipient_emails_json, activity_filter, include_profits, include_alerts,
          last_run_at, last_run_period_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(
        id,
        name,
        input.active !== false ? 1 : 0,
        frequency,
        dayOfWeek,
        sendTime,
        channel,
        JSON.stringify(recipientEmails),
        String(input.activityFilter || 'all'),
        input.includeProfits !== false ? 1 : 0,
        input.includeAlerts !== false ? 1 : 0,
        now,
        now
      );

    return this.getScheduleById(id)!;
  }

  public updateSchedule(
    id: string,
    patch: Partial<{
      name: string;
      active: boolean;
      frequency: ScheduledReportFrequency;
      dayOfWeek: number;
      sendTime: string;
      channel: ScheduledReportChannel;
      recipientEmails: string[] | string;
      activityFilter: StoreActivityId | 'all';
      includeProfits: boolean;
      includeAlerts: boolean;
    }>
  ): ScheduledReportConfig {
    const existing = this.getScheduleById(id);
    if (!existing) throw new Error('جدولة التقرير المطلوبة غير موجودة');

    const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
    if (!name) throw new Error('يرجى إدخال اسم واضح لجدولة التقرير');

    const frequency =
      patch.frequency !== undefined
        ? patch.frequency === 'weekly'
          ? 'weekly'
          : 'daily'
        : existing.frequency;
    const dayOfWeek =
      patch.dayOfWeek !== undefined
        ? Math.min(6, Math.max(0, Math.round(Number(patch.dayOfWeek))))
        : existing.dayOfWeek;
    const sendTime =
      patch.sendTime !== undefined ? normalizeSendTime(patch.sendTime) : existing.sendTime;
    const channel: ScheduledReportChannel =
      patch.channel !== undefined
        ? patch.channel === 'email' || patch.channel === 'both'
          ? patch.channel
          : 'in_app'
        : existing.channel;
    const recipientEmails =
      patch.recipientEmails !== undefined
        ? normalizeEmails(patch.recipientEmails)
        : existing.recipientEmails;

    if ((channel === 'email' || channel === 'both') && recipientEmails.length === 0) {
      throw new Error('يرجى إدخال بريد إلكتروني واحد على الأقل لاستلام التقارير عبر البريد');
    }

    const active = patch.active !== undefined ? Boolean(patch.active) : existing.active;
    const activityFilter =
      patch.activityFilter !== undefined
        ? (String(patch.activityFilter || 'all') as StoreActivityId | 'all')
        : existing.activityFilter;
    const includeProfits =
      patch.includeProfits !== undefined ? Boolean(patch.includeProfits) : existing.includeProfits;
    const includeAlerts =
      patch.includeAlerts !== undefined ? Boolean(patch.includeAlerts) : existing.includeAlerts;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE scheduled_report_configs
         SET name = ?, active = ?, frequency = ?, day_of_week = ?, send_time = ?,
             channel = ?, recipient_emails_json = ?, activity_filter = ?,
             include_profits = ?, include_alerts = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        name,
        active ? 1 : 0,
        frequency,
        dayOfWeek,
        sendTime,
        channel,
        JSON.stringify(recipientEmails),
        activityFilter,
        includeProfits ? 1 : 0,
        includeAlerts ? 1 : 0,
        now,
        id
      );

    return this.getScheduleById(id)!;
  }

  public deleteSchedule(id: string): void {
    const info = this.db.prepare('DELETE FROM scheduled_report_configs WHERE id = ?').run(id);
    if (info.changes === 0) {
      throw new Error('جدولة التقرير غير موجودة');
    }
  }

  public markScheduleExecuted(
    id: string,
    lastRunAt: string,
    periodKey?: string
  ): ScheduledReportConfig | null {
    if (periodKey) {
      this.db
        .prepare(
          'UPDATE scheduled_report_configs SET last_run_at = ?, last_run_period_key = ?, updated_at = ? WHERE id = ?'
        )
        .run(lastRunAt, periodKey, lastRunAt, id);
    } else {
      this.db
        .prepare(
          'UPDATE scheduled_report_configs SET last_run_at = ?, updated_at = ? WHERE id = ?'
        )
        .run(lastRunAt, lastRunAt, id);
    }
    return this.getScheduleById(id);
  }

  public listDigests(limit = 50): ScheduledReportDigest[] {
    const rows = this.db
      .prepare('SELECT * FROM scheduled_report_digests ORDER BY created_at DESC LIMIT ?')
      .all(limit) as DbDigestRow[];
    return rows.map((r) => this.mapDigestRow(r));
  }

  public getDigestById(id: string): ScheduledReportDigest | null {
    const row = this.db
      .prepare('SELECT * FROM scheduled_report_digests WHERE id = ?')
      .get(id) as DbDigestRow | undefined;
    return row ? this.mapDigestRow(row) : null;
  }

  public createDigest(input: {
    scheduleId: string;
    scheduleName: string;
    frequency: ScheduledReportFrequency;
    periodKey: string;
    fromDate: string;
    toDate: string;
    title: string;
    summary: ScheduledReportDigestSummary;
    channel: ScheduledReportChannel;
    inAppDelivered: boolean;
    emailStatus: ScheduledReportEmailStatus;
    emailError?: string;
    recipientEmails: string[];
    isManualRun: boolean;
    createdAt?: string;
  }): ScheduledReportDigest {
    const id = `dig-${crypto.randomUUID().slice(0, 10)}`;
    const createdAt = input.createdAt || new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO scheduled_report_digests (
          id, schedule_id, schedule_name, frequency, period_key, from_date, to_date,
          title, summary_json, channel, in_app_delivered, email_status, email_error,
          recipient_emails_json, read_by_user_ids_json, is_manual_run, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      )
      .run(
        id,
        input.scheduleId,
        input.scheduleName,
        input.frequency,
        input.periodKey,
        input.fromDate,
        input.toDate,
        input.title,
        JSON.stringify(input.summary),
        input.channel,
        input.inAppDelivered ? 1 : 0,
        input.emailStatus,
        input.emailError || '',
        JSON.stringify(input.recipientEmails),
        input.isManualRun ? 1 : 0,
        createdAt
      );

    return this.getDigestById(id)!;
  }

  public markDigestRead(digestId: string, userId: string): ScheduledReportDigest | null {
    const digest = this.getDigestById(digestId);
    if (!digest) return null;
    if (!digest.readByUserIds.includes(userId)) {
      const next = [...digest.readByUserIds, userId];
      this.db
        .prepare('UPDATE scheduled_report_digests SET read_by_user_ids_json = ? WHERE id = ?')
        .run(JSON.stringify(next), digestId);
    }
    return this.getDigestById(digestId);
  }

  public markAllDigestsRead(userId: string): void {
    const rows = this.db
      .prepare('SELECT id, read_by_user_ids_json FROM scheduled_report_digests')
      .all() as Array<{ id: string; read_by_user_ids_json: string }>;
    const stmt = this.db.prepare(
      'UPDATE scheduled_report_digests SET read_by_user_ids_json = ? WHERE id = ?'
    );
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const current = safeParseJson<string[]>(row.read_by_user_ids_json, []);
        if (!current.includes(userId)) {
          stmt.run(JSON.stringify([...current, userId]), row.id);
        }
      }
    });
    tx();
  }
}
