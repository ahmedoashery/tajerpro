import {
  AlertTriangle,
  Bell,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  KeyRound,
  Moon,
  PackageX,
  PanelRightClose,
  PanelRightOpen,
  PlusSquare,
  Search,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  RolePermissionsMap,
  ScheduledReportDigest,
  StaffUser,
  StoreNotification,
} from '../shared/types';
import {
  formatDateTimeAr,
  formatEGP,
  formatNum,
  getEffectivePermissions,
} from '../utils/formatters';
import type { NavTabId } from './Sidebar';
import { PWAInstallButton } from './PWAInstallButton';

interface DesktopMenuBarProps {
  storeName: string;
  sidebarVisible: boolean;
  darkMode: boolean;
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  notifications: StoreNotification[];
  reportDigests: ScheduledReportDigest[];
  unreadCount: number;
  onToggleSidebar: () => void;
  onToggleDark: () => void;
  onOpenTab: (viewId: NavTabId, options?: { forceNew?: boolean; customTitle?: string }) => void;
  onOpenUserSwitch: () => void;
  onOpenServerConfig: () => void;
  onOpenCommandPalette: () => void;
  onDownloadBackup: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenDigest: (digest: ScheduledReportDigest) => void;
  onOpenScheduledReports: () => void;
}

export function DesktopMenuBar({
  storeName,
  sidebarVisible,
  darkMode,
  currentUser,
  rolePermissions,
  notifications,
  reportDigests,
  unreadCount,
  onToggleSidebar,
  onToggleDark,
  onOpenTab,
  onOpenUserSwitch,
  onOpenServerConfig,
  onOpenCommandPalette,
  onDownloadBackup,
  onMarkRead,
  onMarkAllRead,
  onOpenDigest,
  onOpenScheduledReports,
}: DesktopMenuBarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'digests' | 'stock'>('all');

  const notifRef = useRef<HTMLDivElement>(null);

  const perms = getEffectivePermissions(currentUser, rolePermissions);
  const canViewReports = Boolean(perms?.view_reports);
  const canViewProfits = Boolean(perms?.view_profits_costs);
  const visibleDigests = canViewReports ? reportDigests.filter((d) => d.inAppDelivered) : [];

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="no-print flex h-11 lg:h-10 items-center justify-between gap-2 lg:gap-4 border-b border-slate-200 bg-white px-2.5 sm:px-3 text-xs select-none dark:border-slate-800 dark:bg-slate-900">
      {/* Right Side (RTL start): Sidebar Toggle + Brand Mark */}
      <div className="flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarVisible ? 'إخفاء الشريط الجانبي (Ctrl+B)' : 'إظهار الشريط الجانبي (Ctrl+B)'}
          className="hidden lg:flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap shrink-0"
        >
          {sidebarVisible ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
          <span className="hidden xl:inline font-medium">
            {sidebarVisible ? 'إخفاء الجانبي' : 'إظهار الجانبي'}
          </span>
        </button>

        <span className="hidden lg:inline mx-1 h-4 w-px bg-slate-200 dark:bg-slate-800 shrink-0" />

        <span className="font-display font-bold text-slate-900 dark:text-white px-1 sm:px-2 truncate">
          تاجر برو — {storeName}
        </span>
      </div>

      {/* Left Side (RTL end): Quick Desktop Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="البحث الشامل والأوامر السريعة (Ctrl+K)"
          className="flex min-h-[36px] lg:min-h-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <span className="hidden xl:inline">بحث سريع</span>
          <span className="hidden sm:inline font-mono-num text-[10px] text-slate-400" dir="ltr">
            Ctrl+K
          </span>
        </button>

        {perms?.pos_sell && (
          <button
            type="button"
            onClick={() => onOpenTab('pos', { forceNew: true })}
            title="فتح شاشة كاشير جديدة (F2)"
            className="hidden md:flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
          >
            <PlusSquare className="h-3.5 w-3.5" />
            <span>كاشير جديد</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenUserSwitch}
          title="تبديل الموظف (PIN)"
          className="hidden lg:flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
          <span>{currentUser.name.split(' ')[0]}</span>
        </button>

        {/* Notifications Bell */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((o) => !o)}
            className="relative flex min-h-[36px] lg:min-h-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            aria-label="إشعارات المخزون"
          >
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline font-medium">التنبيهات</span>
            {unreadCount > 0 && (
              <span className="font-mono-num rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute left-0 top-10 z-50 w-[min(24rem,calc(100vw-1.5rem))] sm:w-[410px] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <div className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    مركز الإشعارات وتقارير المديرين
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                    {visibleDigests.length} ملخص تقارير · {notifications.length} تنبيه مخزون
                  </div>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>تحديد الكل كمقروء</span>
                  </button>
                )}
              </div>

              {canViewReports && (
                <div className="grid grid-cols-3 gap-1 border-b border-slate-100 bg-slate-50/70 p-1.5 dark:border-slate-800 dark:bg-slate-950/40">
                  {(
                    [
                      ['all', `الكل (${visibleDigests.length + notifications.length})`],
                      ['digests', `تقارير المديرين (${visibleDigests.length})`],
                      ['stock', `المخزون (${notifications.length})`],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setNotifFilter(id)}
                      className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                        notifFilter === id
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}

              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {(notifFilter === 'all' || notifFilter === 'digests') &&
                  visibleDigests.map((d) => {
                    const isUnread = !d.readByUserIds.includes(currentUser.id);
                    return (
                      <div
                        key={d.id}
                        onClick={() => {
                          setNotifOpen(false);
                          onOpenDigest(d);
                        }}
                        className={`cursor-pointer px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          isUnread ? 'bg-emerald-50/45 dark:bg-emerald-950/15' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                                {d.title}
                              </span>
                              <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                {isUnread ? 'جديد' : 'مقروء'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-num">
                              مبيعات: <strong>{formatEGP(d.summary.revenue)}</strong>
                              {canViewProfits && d.summary.profitsIncluded && (
                                <>
                                  {' · '}ربح صافي:{' '}
                                  <strong className="text-emerald-600 dark:text-emerald-400">
                                    {formatEGP(d.summary.netOperatingProfit)}
                                  </strong>
                                </>
                              )}
                              {d.summary.alerts.length > 0 && (
                                <>
                                  {' · '}
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {d.summary.alerts.length} تحذير
                                  </span>
                                </>
                              )}
                            </p>
                            <div className="text-[11px] text-slate-400 font-mono-num">
                              {d.fromDate} ← {d.toDate} · {formatDateTimeAr(d.createdAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {(notifFilter === 'all' || notifFilter === 'stock') &&
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => onMarkRead(n.id)}
                      className={`cursor-pointer px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        !n.read ? 'bg-amber-50/40 dark:bg-amber-950/15' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {n.severity === 'out_of_stock' ? (
                          <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        )}
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                              {n.productName}
                            </span>
                            <span
                              className={`shrink-0 text-[11px] font-semibold ${
                                n.severity === 'out_of_stock' ? 'text-rose-600' : 'text-amber-600'
                              }`}
                            >
                              {n.severity === 'out_of_stock' ? 'نفذ بالكامل' : 'حد الطلب'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            المتبقي: <strong className="font-mono-num">{formatNum(n.currentQty)}</strong> {n.unit} ·
                            الحد الأدنى: <span className="font-mono-num">{formatNum(n.minStockAlert)}</span>
                          </p>
                          <div className="text-[11px] text-slate-400">
                            {formatDateTimeAr(n.createdAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                {((notifFilter === 'digests' && visibleDigests.length === 0) ||
                  (notifFilter === 'stock' && notifications.length === 0) ||
                  (notifFilter === 'all' && visibleDigests.length === 0 && notifications.length === 0)) && (
                  <div className="p-6 text-center text-xs text-slate-500">
                    لا توجد إشعارات أو تقارير في هذا القسم حالياً.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-100 p-2.5 dark:border-slate-800">
                {canViewReports && (
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      onOpenScheduledReports();
                    }}
                    className="flex-1 rounded-lg border border-slate-200 py-2 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    جدولة التقارير
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    onOpenTab('inventory');
                  }}
                  className="flex-1 rounded-lg bg-slate-900 py-2 px-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-800"
                >
                  فتح المخزون والنواقص
                </button>
              </div>
            </div>
          )}
        </div>

        <PWAInstallButton compact />

        <button
          type="button"
          onClick={onDownloadBackup}
          title="نسخة احتياطية سريعة (JSON)"
          className="hidden xl:flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onOpenServerConfig}
          title="إعدادات الخادم وقواعد البيانات"
          className="hidden xl:flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Database className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onToggleDark}
          title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
