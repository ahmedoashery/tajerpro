import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ExpenseCategory,
  PaymentMethod,
  RecurringExpense,
  RecurringExpenseFrequency,
  StoreExpense,
  TreasuryAccount,
  TreasuryType,
} from '../../shared/types.ts';
import { roundMoney, sanitizeText } from '../security/requestValidation.ts';

function advanceDueDateIso(currentYmd: string, frequency: RecurringExpenseFrequency): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(currentYmd)
    ? new Date(`${currentYmd}T12:00:00.000Z`)
    : new Date();
  if (Number.isNaN(base.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  if (frequency === 'daily') {
    base.setUTCDate(base.getUTCDate() + 1);
  } else if (frequency === 'weekly') {
    base.setUTCDate(base.getUTCDate() + 7);
  } else {
    base.setUTCMonth(base.getUTCMonth() + 1);
  }
  return base.toISOString().slice(0, 10);
}

/**
 * TreasuryAndExpensesRepository owns registered safes/treasuries,
 * inter-treasury transfers, operating expenses, and scheduled recurring bills.
 */
export class TreasuryAndExpensesRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public getTreasuries(): TreasuryAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM treasuries ORDER BY is_default DESC, type ASC, name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: String(r.type) as TreasuryType,
      accountNumber: String(r.account_number || ''),
      currentBalance: Number(r.current_balance || 0),
      active: Boolean(r.active),
      isDefault: Boolean(r.is_default),
      notes: String(r.notes || ''),
      updatedAt: String(r.updated_at),
    }));
  }

  public createTreasury(input: {
    name: string;
    type: TreasuryType;
    accountNumber?: string;
    currentBalance?: number;
    isDefault?: boolean;
    notes?: string;
  }): TreasuryAccount {
    if (!input.name?.trim()) throw new Error('اسم الخزينة / الحساب مطلوب.');
    const id = `trs-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (input.isDefault) {
        this.db.prepare('UPDATE treasuries SET is_default = 0 WHERE type = ?').run(input.type);
      }
      this.db
        .prepare(
          `INSERT INTO treasuries (id, name, type, account_number, current_balance, active, is_default, notes, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          id,
          input.name.trim(),
          input.type,
          (input.accountNumber || '').trim(),
          Number(input.currentBalance || 0),
          input.isDefault ? 1 : 0,
          (input.notes || '').trim(),
          now
        );
    });
    tx();
    return this.getTreasuries().find((t) => t.id === id)!;
  }

  public updateTreasury(
    id: string,
    patch: {
      name?: string;
      type?: TreasuryType;
      accountNumber?: string;
      currentBalance?: number;
      active?: boolean;
      isDefault?: boolean;
      notes?: string;
    }
  ): TreasuryAccount {
    const existing = this.getTreasuries().find((t) => t.id === id);
    if (!existing) throw new Error('الخزينة غير موجودة.');
    const now = new Date().toISOString();
    const nextType = patch.type || existing.type;
    const tx = this.db.transaction(() => {
      if (patch.isDefault) {
        this.db.prepare('UPDATE treasuries SET is_default = 0 WHERE type = ?').run(nextType);
      }
      this.db
        .prepare(
          `UPDATE treasuries
           SET name = ?, type = ?, account_number = ?, current_balance = ?, active = ?, is_default = ?, notes = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          patch.name?.trim() || existing.name,
          nextType,
          patch.accountNumber !== undefined ? patch.accountNumber.trim() : existing.accountNumber,
          patch.currentBalance !== undefined ? Number(patch.currentBalance) : existing.currentBalance,
          patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active ? 1 : 0,
          patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
          patch.notes !== undefined ? patch.notes.trim() : existing.notes || '',
          now,
          id
        );
    });
    tx();
    return this.getTreasuries().find((t) => t.id === id)!;
  }

  public deleteTreasury(id: string): void {
    const existing = this.getTreasuries().find((t) => t.id === id);
    if (!existing) throw new Error('الخزينة غير موجودة.');
    const used = this.db
      .prepare('SELECT COUNT(*) as c FROM invoice_payment_allocations WHERE treasury_id = ?')
      .get(id) as { c: number };
    if (used.c > 0) {
      throw new Error('لا يمكن حذف خزينة مرتبطة بعمليات مبيعات سابقة. يمكنك تعطيلها بدلاً من الحذف.');
    }
    this.db.prepare('DELETE FROM treasuries WHERE id = ?').run(id);
  }

  public transferBetweenTreasuries(input: {
    fromTreasuryId: string;
    toTreasuryId: string;
    amount: number;
    actorName: string;
    notes?: string;
    referenceCode?: string;
  }): { fromTreasury: TreasuryAccount; toTreasury: TreasuryAccount } {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('مبلغ التحويل بين الخزائن يجب أن يكون أكبر من صفر.');
    }
    if (!input.fromTreasuryId || !input.toTreasuryId || input.fromTreasuryId === input.toTreasuryId) {
      throw new Error('يجب اختيار خزينة مصدر وخزينة وجهة مختلفتين.');
    }

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const fromRow = this.db
        .prepare('SELECT id, name, type, current_balance, active FROM treasuries WHERE id = ?')
        .get(input.fromTreasuryId) as
        | { id: string; name: string; type: TreasuryType; current_balance: number; active: number }
        | undefined;
      const toRow = this.db
        .prepare('SELECT id, name, type, current_balance, active FROM treasuries WHERE id = ?')
        .get(input.toTreasuryId) as
        | { id: string; name: string; type: TreasuryType; current_balance: number; active: number }
        | undefined;

      if (!fromRow || !toRow) {
        throw new Error('إحدى الخزينتين المختارتين غير موجودة.');
      }
      if (!fromRow.active || !toRow.active) {
        throw new Error('لا يمكن التحويل من أو إلى خزينة معطلة.');
      }

      this.db
        .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?')
        .run(amount, now, fromRow.id);
      this.db
        .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?')
        .run(amount, now, toRow.id);

      const method: PaymentMethod =
        toRow.type === 'instapay'
          ? 'instapay'
          : toRow.type === 'wallet'
            ? 'vodafone_cash'
            : toRow.type === 'bank_pos'
              ? 'card'
              : 'cash';

      this.db
        .prepare(
          `INSERT INTO payment_transactions (
            id, invoice_id, invoice_number, method, provider, amount, fee_amount, net_amount,
            reference_code, status, created_at, treasury_id, treasury_name, partner_id
          ) VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?, 'settled', ?, ?, ?, NULL)`
        )
        .run(
          `tx-tr-${crypto.randomBytes(4).toString('hex')}`,
          'تحويل خزينة',
          method,
          (input.notes || `تحويل داخلي بواسطة ${input.actorName}`).trim(),
          amount,
          amount,
          (input.referenceCode || `TRF-${Date.now().toString().slice(-6)}`).trim(),
          now,
          fromRow.id,
          `${fromRow.name} ← ${toRow.name}`
        );
    });

    tx();
    const list = this.getTreasuries();
    return {
      fromTreasury: list.find((t) => t.id === input.fromTreasuryId)!,
      toTreasury: list.find((t) => t.id === input.toTreasuryId)!,
    };
  }

  private mapExpenseRow(r: Record<string, unknown>): StoreExpense {
    return {
      id: String(r.id),
      title: String(r.title),
      category: String(r.category) as ExpenseCategory,
      amount: Number(r.amount),
      paymentSource: String(r.payment_source) as 'cash_drawer' | 'bank_instapay' | 'wallet',
      treasuryId: r.treasury_id ? String(r.treasury_id) : null,
      treasuryName: String(r.treasury_name || ''),
      receiptRef: String(r.receipt_ref || ''),
      actorName: String(r.actor_name),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
    };
  }

  public resolveExpenseTreasuryAndSource(
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet',
    treasuryId?: string | null
  ): {
    paymentSource: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasury: TreasuryAccount | null;
  } {
    const treasuries = this.getTreasuries();
    const explicit = treasuryId ? treasuries.find((t) => t.id === treasuryId) || null : null;
    if (explicit) {
      const derivedSource: 'cash_drawer' | 'bank_instapay' | 'wallet' =
        explicit.type === 'instapay' || explicit.type === 'bank_pos'
          ? 'bank_instapay'
          : explicit.type === 'wallet'
            ? 'wallet'
            : 'cash_drawer';
      return { paymentSource: derivedSource, treasury: explicit };
    }
    const source = paymentSource || 'cash_drawer';
    const mappedType: TreasuryType =
      source === 'bank_instapay' ? 'instapay' : source === 'wallet' ? 'wallet' : 'cash_drawer';
    const fallback =
      treasuries.find((t) => t.active && t.type === mappedType && t.isDefault) ||
      treasuries.find((t) => t.active && t.type === mappedType) ||
      null;
    return { paymentSource: source, treasury: fallback };
  }

  private normalizeExpenseDate(dateStr?: string): string {
    const raw = (dateStr || '').trim();
    if (!raw) return new Date().toISOString();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const nowTime = new Date().toISOString().slice(10);
      return `${raw}${nowTime}`;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  public getExpenses(): StoreExpense[] {
    const rows = this.db
      .prepare('SELECT * FROM store_expenses ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapExpenseRow(r));
  }

  public getExpenseById(id: string): StoreExpense | null {
    const r = this.db.prepare('SELECT * FROM store_expenses WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.mapExpenseRow(r) : null;
  }

  public createExpense(input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasuryId?: string | null;
    receiptRef?: string;
    createdAt?: string;
    actorName: string;
    notes?: string;
  }): StoreExpense {
    const title = String(input.title || '').trim();
    const amount = Number(input.amount);
    if (!title) throw new Error('بيان المصروف مطلوب.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ المصروف غير صالح.');

    const actorName = (input.actorName || '').trim() || 'النظام';
    const { paymentSource, treasury } = this.resolveExpenseTreasuryAndSource(
      input.paymentSource,
      input.treasuryId
    );
    const id = `exp-${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = this.normalizeExpenseDate(input.createdAt);
    const now = new Date().toISOString();
    const roundedAmount = roundMoney(amount);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO store_expenses (id, title, category, amount, payment_source, treasury_id, treasury_name, receipt_ref, actor_name, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          title,
          input.category || 'misc',
          roundedAmount,
          paymentSource,
          treasury?.id || null,
          treasury?.name || '',
          (input.receiptRef || '').trim(),
          actorName,
          (input.notes || '').trim(),
          createdAt
        );

      if (treasury) {
        this.db
          .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?')
          .run(roundedAmount, now, treasury.id);
      }
    });
    tx();

    return this.getExpenseById(id)!;
  }

  public updateExpense(
    id: string,
    patch: {
      title?: string;
      category?: ExpenseCategory;
      amount?: number;
      paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
      treasuryId?: string | null;
      receiptRef?: string;
      createdAt?: string;
      notes?: string;
    }
  ): StoreExpense {
    const existing = this.getExpenseById(id);
    if (!existing) throw new Error('بند المصروف غير موجود.');

    const nextTitle = patch.title !== undefined ? patch.title.trim() : existing.title;
    if (!nextTitle) throw new Error('بيان المصروف لا يمكن أن يكون فارغاً.');

    const nextAmount =
      patch.amount !== undefined ? roundMoney(Number(patch.amount)) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new Error('مبلغ المصروف غير صالح.');
    }

    const nextCategory = patch.category || existing.category;
    const nextNotes = patch.notes !== undefined ? patch.notes.trim() : existing.notes;
    const nextReceiptRef =
      patch.receiptRef !== undefined ? patch.receiptRef.trim() : existing.receiptRef || '';
    const nextCreatedAt =
      patch.createdAt !== undefined && patch.createdAt.trim() !== ''
        ? this.normalizeExpenseDate(patch.createdAt)
        : existing.createdAt;

    const targetTreasuryId =
      patch.treasuryId !== undefined ? patch.treasuryId : existing.treasuryId;
    const targetSource = patch.paymentSource || existing.paymentSource;
    const { paymentSource: resolvedSource, treasury: nextTreasury } =
      this.resolveExpenseTreasuryAndSource(targetSource, targetTreasuryId);

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (existing.treasuryId) {
        this.db
          .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?')
          .run(existing.amount, now, existing.treasuryId);
      }

      this.db
        .prepare(
          `UPDATE store_expenses
           SET title = ?, category = ?, amount = ?, payment_source = ?, treasury_id = ?, treasury_name = ?, receipt_ref = ?, notes = ?, created_at = ?
           WHERE id = ?`
        )
        .run(
          nextTitle,
          nextCategory,
          nextAmount,
          resolvedSource,
          nextTreasury?.id || null,
          nextTreasury?.name || '',
          nextReceiptRef,
          nextNotes,
          nextCreatedAt,
          id
        );

      if (nextTreasury) {
        this.db
          .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?')
          .run(nextAmount, now, nextTreasury.id);
      }
    });
    tx();

    return this.getExpenseById(id)!;
  }

  public deleteExpense(id: string): void {
    const existing = this.getExpenseById(id);
    if (!existing) throw new Error('بند المصروف غير موجود.');
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      if (existing.treasuryId) {
        this.db
          .prepare('UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?')
          .run(existing.amount, now, existing.treasuryId);
      }
      this.db.prepare('DELETE FROM store_expenses WHERE id = ?').run(id);
    });
    tx();
  }

  private mapRecurringRow(r: Record<string, unknown>): RecurringExpense {
    return {
      id: String(r.id),
      title: String(r.title),
      category: String(r.category) as ExpenseCategory,
      amount: Number(r.amount || 0),
      paymentSource: String(r.payment_source) as 'cash_drawer' | 'bank_instapay' | 'wallet',
      treasuryId: r.treasury_id ? String(r.treasury_id) : null,
      treasuryName: String(r.treasury_name || ''),
      frequency: (String(r.frequency || 'monthly') as RecurringExpenseFrequency),
      nextDueDate: String(r.next_due_date),
      lastPaidAt: r.last_paid_at ? String(r.last_paid_at) : null,
      active: Boolean(r.active),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
    };
  }

  public getRecurringExpenses(): RecurringExpense[] {
    const rows = this.db
      .prepare('SELECT * FROM recurring_expenses ORDER BY active DESC, next_due_date ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRecurringRow(r));
  }

  public createRecurringExpense(input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasuryId?: string | null;
    frequency?: RecurringExpenseFrequency;
    nextDueDate?: string;
    notes?: string;
  }): RecurringExpense {
    const title = sanitizeText(input.title, 120);
    const amount = roundMoney(Number(input.amount));
    if (!title) throw new Error('اسم المصروف الدوري مطلوب.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر.');

    const { paymentSource, treasury } = this.resolveExpenseTreasuryAndSource(
      input.paymentSource,
      input.treasuryId
    );
    const frequency: RecurringExpenseFrequency =
      input.frequency === 'daily' || input.frequency === 'weekly' ? input.frequency : 'monthly';
    const nextDueDate =
      input.nextDueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.nextDueDate.trim())
        ? input.nextDueDate.trim()
        : new Date().toISOString().slice(0, 10);

    const id = `rec-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO recurring_expenses (id, title, category, amount, payment_source, treasury_id, treasury_name, frequency, next_due_date, last_paid_at, active, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`
      )
      .run(
        id,
        title,
        input.category || 'misc',
        amount,
        paymentSource,
        treasury?.id || null,
        treasury?.name || '',
        frequency,
        nextDueDate,
        sanitizeText(input.notes, 200),
        now
      );

    return this.getRecurringExpenses().find((r) => r.id === id)!;
  }

  public updateRecurringExpense(
    id: string,
    patch: Partial<{
      title: string;
      category: ExpenseCategory;
      amount: number;
      treasuryId: string | null;
      frequency: RecurringExpenseFrequency;
      nextDueDate: string;
      active: boolean;
      notes: string;
    }>
  ): RecurringExpense {
    const existing = this.getRecurringExpenses().find((r) => r.id === id);
    if (!existing) throw new Error('المصروف الدوري غير موجود.');

    const nextAmount =
      patch.amount !== undefined ? roundMoney(Number(patch.amount)) : existing.amount;
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      throw new Error('المبلغ غير صالح.');
    }

    const { paymentSource, treasury } =
      patch.treasuryId !== undefined
        ? this.resolveExpenseTreasuryAndSource(existing.paymentSource, patch.treasuryId)
        : {
            paymentSource: existing.paymentSource,
            treasury: existing.treasuryId
              ? this.getTreasuries().find((t) => t.id === existing.treasuryId) || null
              : null,
          };

    this.db
      .prepare(
        `UPDATE recurring_expenses
         SET title = ?, category = ?, amount = ?, payment_source = ?, treasury_id = ?, treasury_name = ?,
             frequency = ?, next_due_date = ?, active = ?, notes = ?
         WHERE id = ?`
      )
      .run(
        patch.title !== undefined ? sanitizeText(patch.title, 120) || existing.title : existing.title,
        patch.category || existing.category,
        nextAmount,
        paymentSource,
        treasury?.id || null,
        treasury?.name || existing.treasuryName,
        patch.frequency || existing.frequency,
        patch.nextDueDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.nextDueDate.trim())
          ? patch.nextDueDate.trim()
          : existing.nextDueDate,
        patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active ? 1 : 0,
        patch.notes !== undefined ? sanitizeText(patch.notes, 200) : existing.notes,
        id
      );

    return this.getRecurringExpenses().find((r) => r.id === id)!;
  }

  public deleteRecurringExpense(id: string): void {
    this.db.prepare('DELETE FROM recurring_expenses WHERE id = ?').run(id);
  }

  public executeRecurringExpense(
    id: string,
    actorName: string,
    overrideAmount?: number,
    overrideTreasuryId?: string | null
  ): { expense: StoreExpense; recurring: RecurringExpense } {
    const rec = this.getRecurringExpenses().find((r) => r.id === id);
    if (!rec) throw new Error('المصروف الدوري غير موجود.');

    const finalAmount =
      overrideAmount !== undefined && Number.isFinite(Number(overrideAmount)) && Number(overrideAmount) > 0
        ? roundMoney(Number(overrideAmount))
        : rec.amount;
    const finalTreasuryId = overrideTreasuryId !== undefined ? overrideTreasuryId : rec.treasuryId;
    const now = new Date().toISOString();
    const nextDue = advanceDueDateIso(rec.nextDueDate, rec.frequency);

    const tx = this.db.transaction(() => {
      const expense = this.createExpense({
        title: rec.title,
        category: rec.category,
        amount: finalAmount,
        paymentSource: rec.paymentSource,
        treasuryId: finalTreasuryId,
        receiptRef: `REC-${rec.nextDueDate}`,
        createdAt: now,
        actorName,
        notes: rec.notes || `صرف مصروف دوري مجدول (${rec.frequency})`,
      });

      this.db
        .prepare('UPDATE recurring_expenses SET last_paid_at = ?, next_due_date = ? WHERE id = ?')
        .run(now, nextDue, rec.id);

      return expense;
    });

    const expense = tx();
    const updatedRec = this.getRecurringExpenses().find((r) => r.id === id)!;
    return { expense, recurring: updatedRec };
  }
}
