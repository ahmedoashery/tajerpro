import {
  BellRing,
  Clock,
  Edit3,
  Eye,
  Mail,
  Play,
  Plus,
  Power,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  ScheduledReportChannel,
  ScheduledReportConfig,
  ScheduledReportDigest,
  ScheduledReportFrequency,
  StoreActivityId,
  StoreActivityProfile,
} from '../../shared/types';
import { formatDateTimeAr, formatEGP } from '../../utils/formatters';

interface ScheduledReportsTabProps {
  activities: StoreActivityProfile[];
  canManageSettings: boolean;
  canViewProfits: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onOpenDigest: (digest: ScheduledReportDigest) => void;
  onMutated?: (msg: string) => void;
}

const WEEKDAYS_AR = [
  { value: 6, label: 'السبت' },
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الإثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
];

const CHANNEL_LABELS: Record<ScheduledReportChannel, string> = {
  in_app: 'إشعار بالتطبيق للمديرين',
  email: 'بريد إلكتروني تلقائي',
  both: 'البريد + إشعار التطبيق معاً',
};

const EMAIL_STATUS_TEXT: Record<ScheduledReportDigest['emailStatus'], string> = {
  sent: 'تم الإرسال بالبريد',
  failed: 'فشل إرسال البريد',
  skipped_not_configured: 'داخلي (SMTP غير مضبوط)',
  not_requested: 'إشعار داخلي فقط',
};

export function ScheduledReportsTab({
  activities,
  canManageSettings,
  canViewProfits,
  apiFetch,
  onOpenDigest,
  onMutated,
}: ScheduledReportsTabProps) {
  const [schedules, setSchedules] = useState<ScheduledReportConfig[]>([]);
  const [digests, setDigests] = useState<ScheduledReportDigest[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReportConfig | null>(null);
  const [fName, setFName] = useState('');
  const [fFrequency, setFFrequency] = useState<ScheduledReportFrequency>('daily');
  const [fDayOfWeek, setFDayOfWeek] = useState<number>(6);
  const [fSendTime, setFSendTime] = useState('21:00');
  const [fChannel, setFChannel] = useState<ScheduledReportChannel>('both');
  const [fEmailsText, setFEmailsText] = useState('');
  const [fActivityFilter, setFActivityFilter] = useState<StoreActivityId | 'all'>('all');
  const [fIncludeProfits, setFIncludeProfits] = useState(true);
  const [fIncludeAlerts, setFIncludeAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        schedules: ScheduledReportConfig[];
        digests: ScheduledReportDigest[];
        emailTransportConfigured: boolean;
      }>('/api/scheduled-reports');
      setSchedules(res.schedules || []);
      setDigests(res.digests || []);
      setEmailConfigured(Boolean(res.emailTransportConfigured));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل إعدادات التقارير المجدولة');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditing(null);
    setFName('تقرير المبيعات والأرباح التلقائي');
    setFFrequency('daily');
    setFDayOfWeek(6);
    setFSendTime('21:00');
    setFChannel('both');
    setFEmailsText('');
    setFActivityFilter('all');
    setFIncludeProfits(true);
    setFIncludeAlerts(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (s: ScheduledReportConfig) => {
    setEditing(s);
    setFName(s.name);
    setFFrequency(s.frequency);
    setFDayOfWeek(s.dayOfWeek);
    setFSendTime(s.sendTime);
    setFChannel(s.channel);
    setFEmailsText(s.recipientEmails.join(', '));
    setFActivityFilter(s.activityFilter);
    setFIncludeProfits(s.includeProfits);
    setFIncludeAlerts(s.includeAlerts);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const recipientEmails = fEmailsText
        .split(/[,;\n\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);

      const payload = {
        name: fName.trim(),
        frequency: fFrequency,
        dayOfWeek: fDayOfWeek,
        sendTime: fSendTime,
        channel: fChannel,
        recipientEmails,
        activityFilter: fActivityFilter,
        includeProfits: fIncludeProfits,
        includeAlerts: fIncludeAlerts,
      };

      if (editing) {
        await apiFetch(`/api/scheduled-reports/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setModalOpen(false);
        await loadData();
        onMutated?.(`تم تحديث جدولة التقرير: ${payload.name}`);
      } else {
        await apiFetch('/api/scheduled-reports', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setModalOpen(false);
        await loadData();
        onMutated?.(`تمت إضافة جدولة التقرير: ${payload.name}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ جدولة التقرير');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (s: ScheduledReportConfig) => {
    try {
      await apiFetch(`/api/scheduled-reports/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !s.active }),
      });
      await loadData();
      onMutated?.(s.active ? `تم إيقاف الجدولة: ${s.name}` : `تم تفعيل الجدولة: ${s.name}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تغيير حالة الجدولة');
    }
  };

  const handleDelete = async (s: ScheduledReportConfig) => {
    try {
      await apiFetch(`/api/scheduled-reports/${s.id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await loadData();
      onMutated?.(`تم حذف جدولة التقرير: ${s.name}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الجدولة');
    }
  };

  const handleRunNow = async (s: ScheduledReportConfig) => {
    setRunningId(s.id);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ digest: ScheduledReportDigest }>(
        `/api/scheduled-reports/${s.id}/run-now`,
        { method: 'POST' }
      );
      await loadData();
      const statusMsg =
        res.digest.emailStatus === 'sent'
          ? 'تم إنشاء التقرير وإرساله عبر البريد وإشعار التطبيق بنجاح'
          : res.digest.emailStatus === 'failed'
            ? `تم حفظ الإشعار بالتطبيق، لكن تعذر الإرسال البريدي: ${res.digest.emailError}`
            : 'تم إنشاء ملخص التقرير وإرساله لإشعارات المديرين داخل التطبيق';
      onMutated?.(statusMsg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تشغيل التقرير الآن');
    } finally {
      setRunningId(null);
    }
  };

  const weekdayName = (idx: number) =>
    WEEKDAYS_AR.find((d) => d.value === idx)?.label || 'السبت';
  const activityNameMap = new Map(activities.map((a) => [a.id, a.nameAr]));

  return (
    <div className="space-y-5">
      {/* Header & Email Transport Diagnostics */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BellRing className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>جدولة التقارير التلقائية وإشعارات المديرين</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              إرسال ملخص يومي أو أسبوعي آلياً للمبيعات والأرباح والتحذيرات المالية والتشغيلية عبر البريد الإلكتروني أو جرس إشعارات المديرين.
            </p>
          </div>
          {canManageSettings && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة جدولة جديدة</span>
            </button>
          )}
        </div>

        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
            emailConfigured
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <span>
              {emailConfigured
                ? 'خادم البريد (SMTP) متصل ومهيأ — سيتم إرسال التقارير البريدية تلقائياً في المواعيد المحددة.'
                : 'خادم البريد (SMTP) غير مضبوط في متغيرات البيئة على الخادم — تصل التقارير تلقائياً كإشعارات للمديرين داخل التطبيق، وعند ضبط متغيرات SMTP في الخادم يبدأ الإرسال البريدي مباشرة.'}
            </span>
          </div>
          <span className="font-mono-num text-[11px] font-semibold">
            فحص الجدولة التلقائي: كل 60 ثانية
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* Configured Schedules Grid */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 flex items-center justify-between">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            جداول الإرسال المفعلة والمهيأة ({schedules.length})
          </h4>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">جاري تحميل الجداول...</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            لا توجد جداول تقارير مضافة بعد. اضغط على «إضافة جدولة جديدة» للبدء.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {schedules.map((s) => (
              <div
                key={s.id}
                className={`p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
                  !s.active ? 'opacity-65' : ''
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{s.name}</span>
                    <span
                      className={`text-xs font-semibold ${
                        s.active
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      · {s.active ? 'مفعل' : 'متوقف مؤقتاً'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1 font-mono-num">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {s.frequency === 'daily'
                        ? `يومياً الساعة ${s.sendTime}`
                        : `أسبوعياً كل ${weekdayName(s.dayOfWeek)} الساعة ${s.sendTime}`}
                    </span>
                    <span>القناة: {CHANNEL_LABELS[s.channel]}</span>
                    <span>
                      النشاط:{' '}
                      {s.activityFilter === 'all'
                        ? 'كل الأنشطة'
                        : activityNameMap.get(s.activityFilter) || s.activityFilter}
                    </span>
                    <span>
                      المحتوى: المبيعات
                      {s.includeProfits ? ' + الأرباح' : ''}
                      {s.includeAlerts ? ' + التحذيرات' : ''}
                    </span>
                  </div>

                  {s.recipientEmails.length > 0 && (
                    <div className="text-[11px] text-slate-500 font-mono-num" dir="ltr">
                      {s.recipientEmails.join(' · ')}
                    </div>
                  )}

                  <div className="text-[11px] text-slate-400 font-mono-num">
                    آخر تشغيل: {s.lastRunAt ? formatDateTimeAr(s.lastRunAt) : 'لم يعمل بعد'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={runningId === s.id}
                    onClick={() => handleRunNow(s)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{runningId === s.id ? 'جاري الإرسال...' : 'تشغيل وإرسال الآن'}</span>
                  </button>

                  {canManageSettings && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(s)}
                        title="تعديل الجدولة"
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(s)}
                        title={s.active ? 'إيقاف مؤقت' : 'تفعيل'}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 text-amber-600 hover:bg-amber-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      {confirmDeleteId === s.id ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="min-h-[38px] rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                          تأكيد الحذف
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(s.id)}
                          title="حذف الجدولة"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dispatch Log & Digest Archive */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 flex items-center justify-between">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            سجل التقارير والملخصات المرسلة للمديرين ({digests.length})
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">التاريخ والوقت</th>
                <th className="px-4 py-3">التقرير والفترة</th>
                <th className="px-4 py-3 text-left">صافي المبيعات</th>
                {canViewProfits && <th className="px-4 py-3 text-left">صافي الربح</th>}
                <th className="px-4 py-3 text-center">التحذيرات</th>
                <th className="px-4 py-3">حالة البريد / الإشعار</th>
                <th className="px-4 py-3">عرض</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {digests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    لم يتم إرسال أي تقارير مجدولة بعد. اضغط على «تشغيل وإرسال الآن» لتجربة الملخص الفوري.
                  </td>
                </tr>
              ) : (
                digests.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono-num text-slate-500 whitespace-nowrap">
                      {formatDateTimeAr(d.createdAt)}
                      {d.isManualRun && (
                        <div className="text-[10px] text-sky-600 dark:text-sky-400">تشغيل فوري</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{d.scheduleName}</div>
                      <div className="font-mono-num text-[11px] text-slate-500">
                        {d.fromDate} ← {d.toDate}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num font-bold">
                      {formatEGP(d.summary.revenue)}
                    </td>
                    {canViewProfits && (
                      <td className="px-4 py-3 text-left font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {d.summary.profitsIncluded ? formatEGP(d.summary.netOperatingProfit) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center font-mono-num font-bold">
                      <span
                        className={
                          d.summary.alerts.length > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {d.summary.alerts.length}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className={`font-semibold ${
                          d.emailStatus === 'sent'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : d.emailStatus === 'failed'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {EMAIL_STATUS_TEXT[d.emailStatus]}
                      </div>
                      {d.emailError && d.emailStatus === 'failed' && (
                        <div className="text-[11px] text-rose-500 truncate max-w-[200px]" title={d.emailError}>
                          {d.emailError}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onOpenDigest(d)}
                        className="min-h-[36px] inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>التفاصيل</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Schedule Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {editing ? `تعديل جدولة: ${editing.name}` : 'إضافة جدولة تقارير تلقائية'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  اسم التقرير المجدول
                </label>
                <input
                  type="text"
                  required
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="مثال: ملخص إغلاق اليوم للمديرين"
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    التكرار
                  </label>
                  <select
                    value={fFrequency}
                    onChange={(e) => setFFrequency(e.target.value as ScheduledReportFrequency)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="daily">يومي</option>
                    <option value="weekly">أسبوعي</option>
                  </select>
                </div>

                {fFrequency === 'weekly' && (
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                      يوم الإرسال
                    </label>
                    <select
                      value={fDayOfWeek}
                      onChange={(e) => setFDayOfWeek(Number(e.target.value))}
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                    >
                      {WEEKDAYS_AR.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    وقت الإرسال (24 ساعة)
                  </label>
                  <input
                    type="time"
                    required
                    value={fSendTime}
                    onChange={(e) => setFSendTime(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    قناة التوصيل
                  </label>
                  <select
                    value={fChannel}
                    onChange={(e) => setFChannel(e.target.value as ScheduledReportChannel)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="both">البريد الإلكتروني + إشعار التطبيق</option>
                    <option value="in_app">إشعار داخل التطبيق للمديرين</option>
                    <option value="email">البريد الإلكتروني فقط</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    نطاق النشاط التجاري
                  </label>
                  <select
                    value={fActivityFilter}
                    onChange={(e) => setFActivityFilter(e.target.value as StoreActivityId | 'all')}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="all">كل الأنشطة التجارية</option>
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(fChannel === 'email' || fChannel === 'both') && (
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    عناوين البريد الإلكتروني المستلمة (افصل بفاصلة أو مسافة)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={fEmailsText}
                    onChange={(e) => setFEmailsText(e.target.value)}
                    placeholder="owner@store.com, manager@store.com"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              )}

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fIncludeProfits}
                    onChange={(e) => setFIncludeProfits(e.target.checked)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    تضمين ملخص الأرباح والمصروفات وصافي الدخل
                  </span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fIncludeAlerts}
                    onChange={(e) => setFIncludeAlerts(e.target.checked)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    تضمين التحذيرات المالية والتشغيلية (الذمم، النواقص، الصلاحية، الهوامش)
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الجدولة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
