import { Store, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StoreSettings } from '../shared/types';

interface StoreProfileModalProps {
  open: boolean;
  onClose: () => void;
  settings: StoreSettings;
  canEdit: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onSaved: (msg: string) => void;
}

export function StoreProfileModal({
  open,
  onClose,
  settings,
  canEdit,
  apiFetch,
  onSaved,
}: StoreProfileModalProps) {
  const [form, setForm] = useState({
    storeName: settings.storeName,
    phone: settings.phone,
    address: settings.address,
    taxNumber: settings.taxNumber,
    receiptFooter: settings.receiptFooter,
  });
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        storeName: settings.storeName,
        phone: settings.phone,
        address: settings.address,
        taxNumber: settings.taxNumber,
        receiptFooter: settings.receiptFooter,
      });
      setErrMsg(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onSaved('تم تحديث بيانات المحل وترويسة الفواتير المطبوعة بنجاح');
      onClose();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ البيانات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Store className="h-4 w-4 text-emerald-600" />
            <span>هوية المحل وترويسة الطباعة (الفواتير والتقارير)</span>
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="sm:col-span-2">
            <label className="block font-medium mb-1">اسم المحل / النشاط التجاري</label>
            <input
              required
              disabled={!canEdit}
              value={form.storeName}
              onChange={(e) => setForm({ ...form, storeName: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">رقم الهاتف</label>
            <input
              disabled={!canEdit}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">الرقم الضريبي (اختياري)</label>
            <input
              disabled={!canEdit}
              value={form.taxNumber}
              onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-medium mb-1">العنوان</label>
            <input
              disabled={!canEdit}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-medium mb-1">نص تذييل الفاتورة والإيصال</label>
            <textarea
              rows={2}
              disabled={!canEdit}
              value={form.receiptFooter}
              onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {errMsg && <div className="text-xs text-rose-600">{errMsg}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
          >
            إلغاء
          </button>
          {canEdit && (
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
