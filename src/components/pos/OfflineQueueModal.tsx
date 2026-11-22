import { CloudOff, RefreshCw, Trash2, UploadCloud, X } from 'lucide-react';
import type { OfflineQueuedInvoice } from '../../shared/types';
import { formatDateTimeAr, formatEGP } from '../../utils/formatters';

export const OFFLINE_QUEUE_STORAGE_KEY = 'tajirpro_offline_queue_v1';

export function loadOfflineQueue(): OfflineQueuedInvoice[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueuedInvoice[]) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(items: OfflineQueuedInvoice[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

interface OfflineQueueModalProps {
  open: boolean;
  queue: OfflineQueuedInvoice[];
  syncing: boolean;
  isOnline: boolean;
  onClose: () => void;
  onSyncAll: () => void;
  onSyncOne: (localId: string) => void;
  onRemoveOne: (localId: string) => void;
}

export function OfflineQueueModal({
  open,
  queue,
  syncing,
  isOnline,
  onClose,
  onSyncAll,
  onSyncOne,
  onRemoveOne,
}: OfflineQueueModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex w-full max-w-2xl max-h-[88dvh] flex-col rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CloudOff className="h-5 w-5 text-amber-600" />
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                طابور فواتير البيع دون اتصال ({queue.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تتم مزامنة الفواتير تلقائياً عند عودة الشبكة أو يدوياً من هنا بالترتيب.
              </p>
            </div>
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

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
          <span
            className={`font-semibold ${
              isOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            حالة الاتصال: {isOnline ? 'متصل بالخادم وجاهز للمزامنة' : 'غير متصل بالشبكة حالياً'}
          </span>
          {queue.length > 0 && (
            <button
              type="button"
              disabled={syncing || !isOnline}
              onClick={onSyncAll}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>{syncing ? 'جاري المزامنة...' : 'مزامنة الكل الآن'}</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5">
          {queue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800">
              لا توجد فواتير معلقة في طابور عدم الاتصال.
            </div>
          ) : (
            queue.map((item) => (
              <div
                key={item.localId}
                className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60 space-y-1.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {item.customerName}
                    </div>
                    <div className="font-mono-num text-[11px] text-slate-500">
                      حُفظت محلياً: {formatDateTimeAr(item.queuedAt)} · التقدير:{' '}
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        {formatEGP(item.estimatedTotal)}
                      </strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={syncing || !isOnline}
                      onClick={() => onSyncOne(item.localId)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>ترحيل</span>
                    </button>
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => onRemoveOne(item.localId)}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md border border-rose-200 px-2 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400"
                      title="حذف الفاتورة من الطابور"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {item.lastError && (
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    آخر ملاحظة: {item.lastError}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
