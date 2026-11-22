import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CustomReportConfig,
  EquityDrawing,
  EquityPartner,
  SavedCustomReportPreset,
} from '../../shared/types.ts';
import {
  assertFiniteNonNegative,
  assertPositiveFinite,
  assertValidPercent,
  roundMoney,
  sanitizeText,
} from '../security/requestValidation.ts';

/**
 * EquityRepository manages store business partners, capital contributions,
 * profit share percentages (strictly capped at 100%), partner drawings/settlements
 * synchronized atomically with treasuries, and saved custom report presets.
 */
export class EquityRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public ensureDefaultPartners(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS c FROM equity_partners').get() as { c: number };
    if (Number(countRow?.c || 0) > 0) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO equity_partners (id, name, phone, role_title, capital_contribution, profit_share_percent, active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    );
    stmt.run(
      'eqp-owner-1',
      'أحمد العشري (المؤسس والمدير)',
      '01001234567',
      'شريك مؤسس ومدير تنفيذي',
      250000,
      70,
      'حصة الإدارة والتأسيس في رأس المال والأرباح',
      now,
      now
    );
    stmt.run(
      'eqp-partner-2',
      'كريم محمود (شريك ممول)',
      '01112223334',
      'شريك بالرأس المال',
      110000,
      30,
      'شريك ممول — توزيع أرباح شهري',
      now,
      now
    );
  }

  private mapPartnerRow(r: Record<string, unknown>): EquityPartner {
    return {
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone || ''),
      roleTitle: String(r.role_title || 'شريك'),
      capitalContribution: Number(r.capital_contribution || 0),
      profitSharePercent: Number(r.profit_share_percent || 0),
      active: Number(r.active ?? 1) === 1,
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapDrawingRow(r: Record<string, unknown>): EquityDrawing {
    const rawType = String(r.type || 'draw');
    const type: EquityDrawing['type'] =
      rawType === 'settlement' || rawType === 'capital_add' ? rawType : 'draw';
    return {
      id: String(r.id),
      partnerId: String(r.partner_id),
      partnerName: String(r.partner_name),
      amount: Number(r.amount || 0),
      treasuryId: r.treasury_id ? String(r.treasury_id) : null,
      treasuryName: String(r.treasury_name || ''),
      type,
      notes: String(r.notes || ''),
      actorName: String(r.actor_name || ''),
      createdAt: String(r.created_at),
    };
  }

  public listPartners(): EquityPartner[] {
    const rows = this.db
      .prepare('SELECT * FROM equity_partners ORDER BY active DESC, profit_share_percent DESC, name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPartnerRow(r));
  }

  public getPartnerById(id: string): EquityPartner | null {
    const row = this.db.prepare('SELECT * FROM equity_partners WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapPartnerRow(row) : null;
  }

  private assertTotalShareWithin100(candidatePercent: number, excludePartnerId?: string): void {
    const partners = this.listPartners().filter((p) => p.active && p.id !== excludePartnerId);
    const currentTotal = partners.reduce((sum, p) => sum + p.profitSharePercent, 0);
    if (roundMoney(currentTotal + candidatePercent) > 100.001) {
      const remaining = Math.max(0, roundMoney(100 - currentTotal));
      throw new Error(
        `مجموع نسب الأرباح للشركاء النشطين لا يمكن أن يتجاوز 100%. النسبة المتاحة حالياً: ${remaining}%.`
      );
    }
  }

  public createPartner(input: {
    name: string;
    phone?: string;
    roleTitle?: string;
    capitalContribution?: number;
    profitSharePercent: number;
    notes?: string;
  }): EquityPartner {
    const name = sanitizeText(input.name, 120);
    if (!name) throw new Error('اسم الشريك مطلوب.');
    const sharePercent = assertValidPercent(input.profitSharePercent, 'نسبة حصة الأرباح');
    const capital = assertFiniteNonNegative(input.capitalContribution ?? 0, 'رأس المال المساهم');
    this.assertTotalShareWithin100(sharePercent);

    const id = `eqp-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO equity_partners (id, name, phone, role_title, capital_contribution, profit_share_percent, active, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        name,
        sanitizeText(input.phone, 40),
        sanitizeText(input.roleTitle || 'شريك', 80) || 'شريك',
        capital,
        sharePercent,
        sanitizeText(input.notes, 300),
        now,
        now
      );

    return this.getPartnerById(id)!;
  }

  public updatePartner(
    id: string,
    patch: {
      name?: string;
      phone?: string;
      roleTitle?: string;
      capitalContribution?: number;
      profitSharePercent?: number;
      active?: boolean;
      notes?: string;
    }
  ): EquityPartner {
    const existing = this.getPartnerById(id);
    if (!existing) throw new Error('بيانات الشريك غير موجودة.');

    const nextName = patch.name !== undefined ? sanitizeText(patch.name, 120) : existing.name;
    if (!nextName) throw new Error('اسم الشريك لا يمكن أن يكون فارغاً.');
    const nextShare =
      patch.profitSharePercent !== undefined
        ? assertValidPercent(patch.profitSharePercent, 'نسبة حصة الأرباح')
        : existing.profitSharePercent;
    const nextCapital =
      patch.capitalContribution !== undefined
        ? assertFiniteNonNegative(patch.capitalContribution, 'رأس المال المساهم')
        : existing.capitalContribution;
    const nextActive = patch.active !== undefined ? Boolean(patch.active) : existing.active;

    if (nextActive) {
      this.assertTotalShareWithin100(nextShare, id);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE equity_partners
         SET name = ?, phone = ?, role_title = ?, capital_contribution = ?, profit_share_percent = ?, active = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        nextName,
        patch.phone !== undefined ? sanitizeText(patch.phone, 40) : existing.phone,
        patch.roleTitle !== undefined ? sanitizeText(patch.roleTitle, 80) || 'شريك' : existing.roleTitle,
        nextCapital,
        nextShare,
        nextActive ? 1 : 0,
        patch.notes !== undefined ? sanitizeText(patch.notes, 300) : existing.notes,
        now,
        id
      );

    return this.getPartnerById(id)!;
  }

  public deletePartner(id: string): void {
    const existing = this.getPartnerById(id);
    if (!existing) throw new Error('الشريك غير موجود.');
    const activeCount = (
      this.db.prepare('SELECT COUNT(*) AS c FROM equity_partners WHERE active = 1').get() as { c: number }
    ).c;
    if (existing.active && activeCount <= 1) {
      throw new Error('لا يمكن حذف الشريك الوحيد النشط في المتجر.');
    }
    const drawingsCount = (
      this.db.prepare('SELECT COUNT(*) AS c FROM equity_drawings WHERE partner_id = ?').get(id) as { c: number }
    ).c;
    if (drawingsCount > 0) {
      throw new Error('لا يمكن حذف شريك لديه مسحوبات أو توزيعات مسجلة؛ يمكنك تعطيل حسابه بدلاً من الحذف.');
    }
    this.db.prepare('DELETE FROM equity_partners WHERE id = ?').run(id);
  }

  public listDrawings(partnerId?: string, limit: number | null = 200): EquityDrawing[] {
    const limitClause = limit && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : '';
    const rows = partnerId
      ? (this.db
          .prepare('SELECT * FROM equity_drawings WHERE partner_id = ? ORDER BY created_at DESC')
          .all(partnerId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(`SELECT * FROM equity_drawings ORDER BY created_at DESC${limitClause}`)
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapDrawingRow(r));
  }

  public recordDrawing(input: {
    partnerId: string;
    amount: number;
    type?: 'draw' | 'settlement' | 'capital_add';
    treasuryId?: string | null;
    notes?: string;
    actorName: string;
  }): EquityDrawing {
    const partner = this.getPartnerById(input.partnerId);
    if (!partner) throw new Error('الشريك غير موجود.');
    const amount = assertPositiveFinite(input.amount, 'المبلغ');
    const type: EquityDrawing['type'] =
      input.type === 'settlement' || input.type === 'capital_add' ? input.type : 'draw';
    const notes = sanitizeText(input.notes, 300);
    const actorName = sanitizeText(input.actorName || 'صاحب المحل', 100) || 'صاحب المحل';
    const now = new Date().toISOString();
    const drawId = `eqd-${crypto.randomBytes(4).toString('hex')}`;

    const tx = this.db.transaction(() => {
      let resolvedTreasuryId: string | null = null;
      let resolvedTreasuryName = 'تسوية خارج الخزينة';

      if (input.treasuryId) {
        const tr = this.db
          .prepare('SELECT id, name, current_balance FROM treasuries WHERE id = ?')
          .get(input.treasuryId) as { id: string; name: string; current_balance: number } | undefined;
        if (!tr) throw new Error('الخزينة المختارة غير موجودة.');
        resolvedTreasuryId = tr.id;
        resolvedTreasuryName = tr.name;

        if (type === 'capital_add') {
          this.db
            .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?')
            .run(amount, now, tr.id);
          this.db
            .prepare(
              'UPDATE equity_partners SET capital_contribution = ROUND(capital_contribution + ?, 2), updated_at = ? WHERE id = ?'
            )
            .run(amount, now, partner.id);
        } else {
          if (Number(tr.current_balance) + 0.001 < amount) {
            throw new Error(`رصيد الخزينة (${tr.name}) الحالي ${roundMoney(Number(tr.current_balance))} ج.م لا يكفي لصرف هذا المبلغ.`);
          }
          this.db
            .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?')
            .run(amount, now, tr.id);
        }
      } else if (type === 'capital_add') {
        this.db
          .prepare(
            'UPDATE equity_partners SET capital_contribution = ROUND(capital_contribution + ?, 2), updated_at = ? WHERE id = ?'
          )
          .run(amount, now, partner.id);
      }

      this.db
        .prepare(
          `INSERT INTO equity_drawings (id, partner_id, partner_name, amount, treasury_id, treasury_name, type, notes, actor_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(drawId, partner.id, partner.name, amount, resolvedTreasuryId, resolvedTreasuryName, type, notes, actorName, now);
    });

    tx();
    const row = this.db.prepare('SELECT * FROM equity_drawings WHERE id = ?').get(drawId) as Record<string, unknown>;
    return this.mapDrawingRow(row);
  }

  public listCustomPresets(): SavedCustomReportPreset[] {
    const rows = this.db
      .prepare('SELECT * FROM custom_report_presets ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      config: JSON.parse(String(r.config_json)) as CustomReportConfig,
      createdBy: String(r.created_by || ''),
      updatedAt: String(r.updated_at),
    }));
  }

  public saveCustomPreset(config: CustomReportConfig, actorName: string): SavedCustomReportPreset {
    const name = sanitizeText(config.name, 120);
    if (!name) throw new Error('يرجى إدخال اسم واضح للتقرير المخصص قبل الحفظ.');
    const now = new Date().toISOString();
    const id = config.id?.trim() || `crp-${crypto.randomBytes(4).toString('hex')}`;
    const cleanConfig: CustomReportConfig = {
      ...config,
      id,
      name,
    };

    const existing = this.db.prepare('SELECT id FROM custom_report_presets WHERE id = ?').get(id);
    if (existing) {
      this.db
        .prepare('UPDATE custom_report_presets SET name = ?, config_json = ?, created_by = ?, updated_at = ? WHERE id = ?')
        .run(name, JSON.stringify(cleanConfig), sanitizeText(actorName, 80), now, id);
    } else {
      this.db
        .prepare(
          'INSERT INTO custom_report_presets (id, name, config_json, created_by, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, name, JSON.stringify(cleanConfig), sanitizeText(actorName, 80), now);
    }

    return {
      id,
      name,
      config: cleanConfig,
      createdBy: sanitizeText(actorName, 80),
      updatedAt: now,
    };
  }

  public deleteCustomPreset(id: string): void {
    this.db.prepare('DELETE FROM custom_report_presets WHERE id = ?').run(id);
  }
}
