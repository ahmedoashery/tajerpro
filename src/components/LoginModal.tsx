import { Database, Eye, EyeOff, KeyRound, Lock, Server, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LicenseStatus, StaffUser, StoreSettings } from '../shared/types';
import { ROLE_LABELS } from '../utils/formatters';
import type { ServerConfigTab } from './ServerConfigModal';
import { SearchableSelect } from './ui/SearchableSelect';

interface LoginModalProps {
  open: boolean;
  lockedMode?: boolean;
  onClose: () => void;
  staff: StaffUser[];
  currentUserId: string;
  settings: StoreSettings;
  license?: LicenseStatus | null;
  serverUrl: string;
  onLoginSubmit: (userId: string, pin: string) => Promise<StaffUser>;
  onSuccessLogin: (user: StaffUser) => void;
  onOpenServerConfig: (tab?: ServerConfigTab) => void;
}

export function LoginModal({
  open,
  lockedMode = false,
  onClose,
  staff,
  currentUserId,
  settings,
  license,
  serverUrl,
  onLoginSubmit,
  onSuccessLogin,
  onOpenServerConfig,
}: LoginModalProps) {
  const activeStaff = useMemo(() => staff.filter((u) => u.active), [staff]);
  const [selectedId, setSelectedId] = useState(currentUserId);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(currentUserId || activeStaff[0]?.id || '');
      setPin('');
      setError(null);
      setShowPin(false);
    }
  }, [open, currentUserId, activeStaff]);

  if (!open) return null;

  const staffOptions = activeStaff.map((u) => ({
    value: u.id,
    label: u.name,
    sublabel: ROLE_LABELS[u.role],
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setVerifying(true);
    setError(null);
    try {
      const user = await onLoginSubmit(selectedId, pin);
      onSuccessLogin(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'الرمز السري (PIN) غير صحيح');
    } finally {
      setVerifying(false);
    }
  };

  const quickFillRole = (role: 'owner' | 'manager' | 'cashier', demoPin: string) => {
    const match = activeStaff.find((u) => u.role === role) || activeStaff[0];
    if (match) setSelectedId(match.id);
    setPin(demoPin);
    setError(null);
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-[3px]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {lockedMode ? (
                <Lock className="h-4 w-4 text-emerald-600" />
              ) : (
                <KeyRound className="h-4 w-4 text-emerald-600" />
              )}
              <span>{lockedMode ? 'بوابة الدخول الموثق للنظام' : 'تسجيل الدخول / تبديل الموظف (PIN)'}</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {settings.storeName} · المحرك:{' '}
              <span className="font-mono-num font-semibold text-slate-700 dark:text-slate-200">
                {settings.dbDriver === 'mysql' ? 'MySQL 8.0' : 'SQLite WAL'}
              </span>{' '}
              · الترخيص:{' '}
              <span
                className={`font-semibold ${
                  license?.valid ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {license?.valid ? `${license.payload?.tier.toUpperCase()} (${license.daysRemaining} يوم)` : 'غير مفعل'}
              </span>
            </p>
          </div>
          {!lockedMode && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Debounced + Infinite Scroll Staff Picker */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            اختر الموظف أو صاحب المحل
          </label>
          <SearchableSelect
            value={selectedId}
            onChange={setSelectedId}
            options={staffOptions}
            placeholder="اختر حساب الدخول..."
            searchPlaceholder="ابحث باسم الموظف أو الدور..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
            الرمز السري (PIN)
          </label>
          <div className="relative">
            <input
              type={showPin ? 'text' : 'password'}
              required
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="أدخل رمز الدخول..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 pl-10 font-mono-num text-sm focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title={showPin ? 'إخفاء الرمز' : 'إظهار الرمز'}
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500">تعبئة سريعة للتجربة:</span>
            <button
              type="button"
              onClick={() => quickFillRole('owner', '1234')}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono-num font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              المالك (1234)
            </button>
            <button
              type="button"
              onClick={() => quickFillRole('manager', '2222')}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono-num font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              المدير (2222)
            </button>
            <button
              type="button"
              onClick={() => quickFillRole('cashier', '1111')}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono-num font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              الكاشير (1111)
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Full Server, Database & License Control directly on Login Screen */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>تحكم السيرفر وقواعد البيانات والترخيص</span>
              </div>
              <div className="truncate font-mono-num mt-0.5" dir="ltr">
                {serverUrl || window.location.origin} · {settings.dbDriver.toUpperCase()}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onOpenServerConfig('server')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Server className="h-3.5 w-3.5 text-emerald-600" />
              <span>عنوان السيرفر</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenServerConfig('database')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Database className="h-3.5 w-3.5 text-emerald-600" />
              <span>قاعدة البيانات</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenServerConfig('license')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
              <span>إدارة الترخيص</span>
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          {!lockedMode && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
            >
              إلغاء
            </button>
          )}
          <button
            type="submit"
            disabled={verifying}
            className="flex-1 sm:flex-none rounded-lg bg-emerald-600 px-6 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {verifying ? 'جاري التحقق والتوثيق...' : 'دخول آمن للنظام'}
          </button>
        </div>
      </form>
    </div>
  );
}
