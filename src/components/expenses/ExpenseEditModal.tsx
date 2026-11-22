import { Edit3, X } from 'lucide-react';
import { useState } from 'react';
import type { ExpenseCategory, StoreExpense, TreasuryAccount } from '../../shared/types';
import { EXPENSE_CATEGORY_LABELS, formatEGP, TREASURY_TYPE_LABELS } from '../../utils/formatters';
import { SearchableSelect } from '../ui/SearchableSelect';

const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

function sourceFromTreasury(t?: TreasuryAccount): 'cash_drawer' | 'bank_instapay' | 'wallet' {
  if (!t) return 'cash_drawer';
  if (t.type === 'instapay' || t.type === 'bank_pos') return 'bank_instapay';
  if (t.type === 'wallet') return 'wallet';
  return 'cash_drawer';
}

interface ExpenseEditModalProps {
  expense: StoreExpense;
  activeTreasuries: TreasuryAccount[];
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function ExpenseEditModal({
  expense,
  activeTreasuries,
  apiFetch,
  onClose,
  onSaved,
}: ExpenseEditModalProps) {
  const [editForm, setEditForm] = useState({
    title: expense.title,
    category: expense.category,
    amount: String(expense.amount),
    treasuryId: expense.treasuryId || '',
    paymentSource: expense.paymentSource,
    receiptRef: expense.receiptRef || '',
    createdAt: expense.createdAt.slice(0, 10),
    notes: expense.notes || '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(editForm.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrMsg('يرجى إدخال مبلغ صحيح أكبر من صفر.');
      return;
    }
    setSavingEdit(true);
    setErrMsg(null);
    try {
      await apiFetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title.trim(),
          category: editForm.category,
          amount: numericAmount,
          treasuryId: editForm.treasuryId || null,
          paymentSource: editForm.paymentSource,
          receiptRef: editForm.receiptRef.trim(),
          createdAt: editForm.createdAt || undefined,
          notes: editForm.notes.trim(),
        }),
      });
      onSaved('تم تعديل بند المصروف وإعادة تسوية رصيد الخزينة تلقائياً');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تعديل المصروف');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSaveEdit}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-emerald-600" />
            <span>تعديل بند المصروف وإعادة تسوية الخزينة</span>
          </h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-medium mb-1">بيان المصروف</label>
            <input
              required
              value={editForm.title}
              onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">التصنيف</label>
              <SearchableSelect
                value={editForm.category}
                onChange={(v) => setEditForm((p) => ({ ...p, category: v as ExpenseCategory }))}
                options={EXPENSE_CATEGORIES.map((c) => ({
                  value: c,
                  label: EXPENSE_CATEGORY_LABELS[c],
                }))}
              />
            </div>
            <div>
              <label className="block font-medium mb-1">المبلغ (ج.م)</label>
              <input
                required
                type="number"
                min={0.5}
                step="0.01"
                value={editForm.amount}
                onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">تاريخ المصروف</label>
              <input
                type="date"
                value={editForm.createdAt}
                onChange={(e) => setEditForm((p) => ({ ...p, createdAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">رقم الإيصال / المرجع</label>
              <input
                value={editForm.receiptRef}
                onChange={(e) => setEditForm((p) => ({ ...p, receiptRef: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>

          {activeTreasuries.length > 0 && (
            <div>
              <label className="block font-medium mb-1">الخزينة المصروف منها</label>
              <SearchableSelect
                value={editForm.treasuryId}
                onChange={(v) => {
                  const t = activeTreasuries.find((item) => item.id === v);
                  setEditForm((p) => ({
                    ...p,
                    treasuryId: v,
                    paymentSource: sourceFromTreasury(t),
                  }));
                }}
                options={activeTreasuries.map((t) => ({
                  value: t.id,
                  label: t.name,
                  sublabel: `${TREASURY_TYPE_LABELS[t.type]} · المتاح: ${formatEGP(t.currentBalance)}`,
                }))}
              />
            </div>
          )}

          <div>
            <label className="block font-medium mb-1">ملاحظات</label>
            <input
              value={editForm.notes}
              onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errMsg && <div className="text-xs font-medium text-rose-600">{errMsg}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={savingEdit}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {savingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات وتسوية الخزينة'}
          </button>
        </div>
      </form>
    </div>
  );
}
