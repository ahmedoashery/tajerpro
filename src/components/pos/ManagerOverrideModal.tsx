import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UserRole } from '../../shared/types';
import { formatEGP } from '../../utils/formatters';

interface OverrideResponse {
  authorized: boolean;
  authorizerId?: string;
  authorizerName?: string;
  authorizerRole?: UserRole;
  reason?: string;
  error?: string;
}

interface ManagerOverrideModalProps {
  open: boolean;
  discountAmount: number;
  baseAmount: number;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onClose: () => void;
  onApproved: (approver: { authorizerName: string; authorizerRole?: UserRole }) => void;
}

export function ManagerOverrideModal({
  open,
  discountAmount,
  baseAmount,
  apiFetch,
  onClose,
  onApproved,
}: ManagerOverrideModalProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPin('');
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const pct = baseAmount > 0 ? ((discountAmount / baseAmount) * 100).toFixed(1) : '0';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<OverrideResponse>('/api/auth/verify-override-pin', {
        method: 'POST',
        body: JSON.stringify({ pin: pin.trim() }),
      });
      if (!res.authorized || !res.authorizerName) {
        setErrorMsg(res.reason || res.error || 'رمز الاعتماد غير صحيح.');
        return;
      }
      onApproved({
        authorizerName: res.authorizerName,
        authorizerRole: res.authorizerRole,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر التحقق من رمز اعتماد المدير.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              موافقة المدير / المالك على الخصم
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 space-y-1">
          <div>
            قيمة الخصم اليدوي المدخلة (<strong className="font-mono-num">{formatEGP(discountAmount)}</strong>{' '}
            بما يعادل <strong className="font-mono-num">{pct}%</strong>) تتجاوز الحد المسموح للكاشير (10%).
          </div>
          <div className="text-[11px] opacity-85">
            أدخل رمز PIN الخاص بالمدير أو صاحب المحل لاعتماد العملية دون تسجيل خروج الكاشير.
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            رمز PIN للاعتماد (المدير أو المالك)
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center font-mono-num text-lg tracking-widest focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
          >
            إلغاء وتعديل الخصم
          </button>
          <button
            type="submit"
            disabled={submitting || !pin.trim()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{submitting ? 'جاري التحقق...' : 'اعتماد وإتمام الفاتورة'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
