import { CalendarClock, ChevronDown, ChevronUp, Pause, Play, Plus, Trash2, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ExpenseCategory,
  RecurringExpense,
  RecurringExpenseFrequency,
  StaffUser,
  TreasuryAccount,
} from '../../shared/types';
import { EXPENSE_CATEGORY_LABELS, formatEGP, TREASURY_TYPE_LABELS } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

const FREQ_LABELS: Record<RecurringExpenseFrequency, string> = {
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
};

interface RecurringExpensesPanelProps {
  recurringExpenses: RecurringExpense[];
  activeTreasuries: TreasuryAccount[];
  currentUser: StaffUser;
  canManageExpenses: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
}

export function RecurringExpensesPanel({
  recurringExpenses,
  activeTreasuries,
  currentUser,
  canManageExpenses,
  apiFetch,
  onMutated,
}: RecurringExpensesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('rent');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringExpenseFrequency>('monthly');
  const [nextDueDate, setNextDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [treasuryId, setTreasuryId] = useState<string>(() => activeTreasuries[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const dueCount = useMemo(
    () => recurringExpenses.filter((r) => r.active && r.nextDueDate <= todayIso).length,
    [recurringExpenses, todayIso]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (!title.trim() || !Number.isFinite(numAmt) || numAmt <= 0) {
      setErrMsg('يرجى إدخال البيان والمبلغ بشكل صحيح.');
      return;
    }
    setBusyId('create');
    setErrMsg(null);
    try {
      await apiFetch('/api/expenses/recurring', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          category,
          amount: numAmt,
          frequency,
          nextDueDate,
          treasuryId: treasuryId || null,
          notes: notes.trim(),
        }),
      });
      setTitle('');
      setAmount('');
      setNotes('');
      setShowAdd(false);
      setExpanded(true);
      onMutated('تمت إضافة جدول المصروف المتكرر بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر الحفظ');
    } finally {
      setBusyId(null);
    }
  };

  const handleExecuteNow = async (rec: RecurringExpense) => {
    setBusyId(rec.id);
    setErrMsg(null);
    try {
      await apiFetch(`/api/expenses/recurring/${rec.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ actorName: currentUser.name }),
      });
      onMutated(`تم صرف (${rec.title}) بقيمة ${formatEGP(rec.amount)} وتحديث موعد الاستحقاق التالي`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تنفيذ المصروف');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (rec: RecurringExpense) => {
    setBusyId(rec.id);
    try {
      await apiFetch(`/api/expenses/recurring/${rec.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !rec.active }),
      });
      onMutated(rec.active ? 'تم إيقاف المصروف الدوري مؤقتاً' : 'تم تفعيل المصروف الدوري');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر التحديث');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/expenses/recurring/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      onMutated('تم حذف المصروف الدوري');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر الحذف');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-emerald-600 shrink-0" />
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white">
            المصروفات الدورية المجدولة ({recurringExpenses.length})
          </span>
          {dueCount > 0 && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              · {dueCount} مستحق الصرف الآن
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManageExpenses && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setShowAdd((v) => !v);
              }}
              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>جدولة مصروف دوري</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span>{expanded ? 'إخفاء الجدول' : 'عرض الجدول'}</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {errMsg && <div className="text-xs font-medium text-rose-600">{errMsg}</div>}

      {expanded && (
        <div className="space-y-3 pt-1">
          {showAdd && canManageExpenses && (
            <form
              onSubmit={handleCreate}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60 items-end"
            >
              <div className="lg:col-span-2">
                <label className="block font-semibold mb-1">اسم البند الدوري</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="إيجار المحل / إنترنت / كهرباء..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">التصنيف</label>
                <SearchableSelect
                  value={category}
                  onChange={(v) => setCategory(v as ExpenseCategory)}
                  options={(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((c) => ({
                    value: c,
                    label: EXPENSE_CATEGORY_LABELS[c],
                  }))}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المبلغ (ج.م)</label>
                <input
                  required
                  type="number"
                  min={0.5}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">التكرار</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as RecurringExpenseFrequency)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-semibold dark:border-slate-700 dark:bg-slate-900"
                >
                  {(Object.keys(FREQ_LABELS) as RecurringExpenseFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQ_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">أول استحقاق</label>
                <input
                  required
                  type="date"
                  value={nextDueDate}
                  onChange={(e) => setNextDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              {activeTreasuries.length > 0 && (
                <div className="lg:col-span-2">
                  <label className="block font-semibold mb-1">الخزينة الافتراضية للصرف</label>
                  <SearchableSelect
                    value={treasuryId}
                    onChange={setTreasuryId}
                    options={activeTreasuries.map((t) => ({
                      value: t.id,
                      label: t.name,
                      sublabel: `${TREASURY_TYPE_LABELS[t.type]} · ${formatEGP(t.currentBalance)}`,
                    }))}
                  />
                </div>
              )}
              <div className="lg:col-span-3">
                <label className="block font-semibold mb-1">ملاحظات</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="تفاصيل اختيارية..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold dark:border-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busyId === 'create'}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  حفظ الجدول
                </button>
              </div>
            </form>
          )}

          {recurringExpenses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
              لا توجد مصروفات دورية مجدولة حالياً. يمكنك إضافة الإيجار أو الرواتب لتنفيذها بضغطة واحدة.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {recurringExpenses.map((rec) => {
                const isDue = rec.active && rec.nextDueDate <= todayIso;
                return (
                  <div
                    key={rec.id}
                    className={`rounded-xl border p-3 text-xs space-y-2 ${
                      !rec.active
                        ? 'border-slate-200 bg-slate-50/50 opacity-70 dark:border-slate-800 dark:bg-slate-950/30'
                        : isDue
                          ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20'
                          : 'border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-950/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">{rec.title}</div>
                        <div className="text-[11px] text-slate-500 font-mono-num">
                          {EXPENSE_CATEGORY_LABELS[rec.category]} · {FREQ_LABELS[rec.frequency]} ·{' '}
                          {rec.treasuryName || 'خزينة تلقائية'}
                        </div>
                      </div>
                      <div className="font-mono-num text-sm font-bold text-rose-600 dark:text-rose-400">
                        {formatEGP(rec.amount)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono-num">
                      <span
                        className={
                          isDue
                            ? 'font-bold text-amber-700 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        الاستحقاق التالي: {rec.nextDueDate}
                        {isDue ? ' (مستحق الآن)' : ''}
                      </span>
                      {rec.lastPaidAt && (
                        <span className="text-slate-400">آخر صرف: {rec.lastPaidAt.slice(0, 10)}</span>
                      )}
                    </div>

                    {canManageExpenses && (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-800">
                        <button
                          type="button"
                          disabled={!rec.active || busyId === rec.id}
                          onClick={() => void handleExecuteNow(rec)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Zap className="h-3 w-3" />
                          <span>صرف الآن وتحديث الموعد</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === rec.id}
                          onClick={() => void handleToggleActive(rec)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          {rec.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                          <span>{rec.active ? 'إيقاف' : 'تفعيل'}</span>
                        </button>
                        {confirmDeleteId === rec.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDelete(rec.id)}
                              className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white"
                            >
                              تأكيد
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                            >
                              لا
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(rec.id)}
                            className="inline-flex min-h-[32px] items-center rounded-md border border-rose-200 px-2 py-1 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
