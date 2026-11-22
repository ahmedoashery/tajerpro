import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  Boxes,
  Calculator,
  CreditCard,
  FileSpreadsheet,
  PackagePlus,
  PackageX,
  Pin,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type {
  DashboardSummary,
  Product,
  StaffUser,
  StockMovement,
  StoreActivityId,
  StoreActivityProfile,
  StoreSettings,
} from '../shared/types';
import { formatDateTimeAr, formatEGP, formatNum, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

interface QuickActionDef {
  id: string;
  label: string;
  tab?: NavTabId;
  action?: 'shift_closing';
  icon: typeof ShoppingCart;
}

const ALL_QUICK_ACTIONS: QuickActionDef[] = [
  { id: 'pos', label: 'فتح الكاشير', tab: 'pos', icon: ShoppingCart },
  { id: 'invoices', label: 'فواتير المبيعات', tab: 'invoices', icon: Receipt },
  { id: 'purchases', label: 'أمر شراء وتوريد', tab: 'purchases', icon: Truck },
  { id: 'expenses', label: 'تسجيل مصروف', tab: 'expenses', icon: Wallet },
  { id: 'inventory', label: 'المخزون والتشغيلات', tab: 'inventory', icon: Boxes },
  { id: 'partners_payments', label: 'العملاء والذمم', tab: 'partners_payments', icon: Users },
  { id: 'reports', label: 'التقارير والأرباح', tab: 'reports', icon: FileSpreadsheet },
  { id: 'shift', label: 'تقفيل الوردية', action: 'shift_closing', icon: Calculator },
];

const DEFAULT_PINNED_IDS = ['pos', 'purchases', 'expenses', 'partners_payments', 'reports', 'shift'];

interface DashboardViewProps {
  dashboard: DashboardSummary;
  settings: StoreSettings;
  activities: StoreActivityProfile[];
  products: Product[];
  movements: StockMovement[];
  currentUser: StaffUser;
  canViewProfits: boolean;
  canEditStock: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onNavigate: (tab: NavTabId) => void;
  onSwitchActivity: (activityId: StoreActivityId) => Promise<void>;
  onQuickRestocked: (msg: string) => void;
  onOpenShiftClosing?: () => void;
}

export function DashboardView({
  dashboard,
  settings,
  activities,
  products,
  movements,
  currentUser,
  canViewProfits,
  canEditStock,
  apiFetch,
  onNavigate,
  onSwitchActivity,
  onQuickRestocked,
  onOpenShiftClosing,
}: DashboardViewProps) {
  const [switchingAct, setSwitchingAct] = useState<StoreActivityId | null>(null);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alertSearch, setAlertSearch] = useState('');
  const debouncedAlertSearch = useDebouncedValue(alertSearch, 200);
  const [moveSearch, setMoveSearch] = useState('');
  const debouncedMoveSearch = useDebouncedValue(moveSearch, 200);
  const [customizingActions, setCustomizingActions] = useState(false);
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('tajirpro_pinned_actions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_PINNED_IDS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('tajirpro_pinned_actions', JSON.stringify(pinnedActionIds));
    } catch {
      // ignore storage errors
    }
  }, [pinnedActionIds]);

  const maxDailyRev = Math.max(100, ...dashboard.dailySeries.map((d) => d.revenue));

  const outOfStockProducts = products.filter((p) => p.stockQty <= 0);
  const lowOnlyProducts = products.filter((p) => p.stockQty > 0 && p.stockQty <= p.minStockAlert);
  const allAlertProducts = useMemo(
    () => [...outOfStockProducts, ...lowOnlyProducts],
    [outOfStockProducts, lowOnlyProducts]
  );
  const filteredAlerts = useMemo(() => {
    const q = debouncedAlertSearch.trim().toLowerCase();
    if (!q) return allAlertProducts;
    return allAlertProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }, [allAlertProducts, debouncedAlertSearch]);
  const filteredMovements = useMemo(() => {
    const q = debouncedMoveSearch.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter(
      (m) => m.productName.toLowerCase().includes(q) || m.reason.toLowerCase().includes(q)
    );
  }, [movements, debouncedMoveSearch]);
  const healthyCount = Math.max(0, products.length - allAlertProducts.length);

  const handleSelectActivity = async (actId: StoreActivityId) => {
    if (actId === settings.activityId) return;
    setSwitchingAct(actId);
    try {
      await onSwitchActivity(actId);
    } finally {
      setSwitchingAct(null);
    }
  };

  const handleQuickRestock = async (prod: Product, qty = 10) => {
    setRestockingId(prod.id);
    setActionError(null);
    try {
      await apiFetch(`/api/products/${prod.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          deltaQty: qty,
          reason: 'توريد سريع من لوحة النواقص',
          actorName: currentUser.name,
          terminalName: 'لوحة التحكم الرئيسية',
        }),
      });
      onQuickRestocked(`تم توريد +${qty} ${prod.unit} من "${prod.name}" وتحديث المخزون لحظياً`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذر تنفيذ التوريد السريع');
    } finally {
      setRestockingId(null);
    }
  };

  const renderDeltaText = (delta: number | null | undefined, inverseGood = false) => {
    if (delta === null || delta === undefined) return null;
    const isUp = delta >= 0;
    const isGood = inverseGood ? !isUp : isUp;
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-mono-num text-[11px] font-semibold ${
          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {isUp ? <ArrowUpLeft className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
        {isUp ? '+' : ''}
        {delta}% عن أمس
      </span>
    );
  };

  const pinnedActions = ALL_QUICK_ACTIONS.filter((a) => pinnedActionIds.includes(a.id));
  const ownerAlerts = dashboard.ownerAlerts || [];

  return (
    <div className="space-y-6">
      {/* Customizable Pinned Quick Actions Bar */}
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Pin className="h-3.5 w-3.5 text-emerald-600" />
            <span>اختصاراتك السريعة المثبتة</span>
          </div>
          <button
            type="button"
            onClick={() => setCustomizingActions((v) => !v)}
            className="text-xs font-semibold text-slate-500 hover:text-emerald-600 dark:text-slate-400"
          >
            {customizingActions ? 'إنهاء التخصيص' : 'تخصيص الاختصارات'}
          </button>
        </div>

        {customizingActions && (
          <div className="mb-3 flex flex-wrap gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 text-xs">
            {ALL_QUICK_ACTIONS.map((qa) => {
              const checked = pinnedActionIds.includes(qa.id);
              return (
                <label key={qa.id} className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setPinnedActionIds((prev) =>
                        e.target.checked
                          ? [...prev, qa.id]
                          : prev.length > 1
                            ? prev.filter((id) => id !== qa.id)
                            : prev
                      );
                    }}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>{qa.label}</span>
                </label>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {pinnedActions.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                type="button"
                onClick={() => {
                  if (qa.action === 'shift_closing' && onOpenShiftClosing) onOpenShiftClosing();
                  else if (qa.tab) onNavigate(qa.tab);
                }}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:border-emerald-500 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 px-3.5 text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors"
              >
                <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>{qa.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Primary Owner-Friendly KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>مبيعات اليوم الإجمالية</span>
            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {formatEGP(dashboard.todayRevenue)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              <span className="font-mono-num">{dashboard.todayInvoiceCount}</span> فاتورة اليوم
            </span>
            {renderDeltaText(dashboard.periodComparison?.revenueDeltaPercent)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>صافي ربح اليوم (حسب وقت الفاتورة)</span>
            <ArrowUpLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 font-mono-num text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {canViewProfits ? formatEGP(dashboard.todayProfit) : 'مقيد حسب الصلاحية'}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {canViewProfits
                ? `بعد مصروفات اليوم (${formatEGP(dashboard.todayExpenses)}): ${formatEGP(dashboard.todayNetAfterExpenses)}`
                : 'خاص بالمالك ومدير الفرع'}
            </span>
            {canViewProfits && renderDeltaText(dashboard.periodComparison?.profitDeltaPercent)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>صافي نقدية الدرج والإلكتروني</span>
            <Wallet className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          </div>
          <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {formatEGP(dashboard.cashDrawerBalance)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            إلكتروني: <span className="font-mono-num">{formatEGP(dashboard.electronicSalesToday)}</span> · آجل:{' '}
            <span className="font-mono-num">{formatEGP(dashboard.creditSalesToday)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>المخزون ورأس مال البضاعة</span>
            <Boxes className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {canViewProfits ? formatEGP(dashboard.inventoryCapitalCost) : `${products.length} صنف`}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono-num">
              {lowOnlyProducts.length} نواقص
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-rose-600 dark:text-rose-400 font-mono-num">
              {outOfStockProducts.length} نفذ
            </span>
            {(dashboard.expiringBatchesCount || 0) > 0 && (
              <>
                {' '}·{' '}
                <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono-num">
                  {dashboard.expiringBatchesCount} صلاحية قريبة
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Smart Owner Anomaly Alerts */}
      {ownerAlerts.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                تنبيهات المالك الذكية والمخاطر التشغيلية
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                فحص آلي لصلاحية التشغيلات، الفواتير الآجلة المتأخرة، الهوامش المنخفضة، وفروق الدرج.
              </p>
            </div>
            <span className="font-mono-num text-xs font-bold text-slate-500">
              {ownerAlerts.length} تنبيه نشط
            </span>
          </div>
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {ownerAlerts.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <span
                      className={
                        alert.severity === 'danger'
                          ? 'text-rose-600 dark:text-rose-400'
                          : alert.severity === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-sky-600 dark:text-sky-400'
                      }
                    >
                      {alert.title}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="font-mono-num text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {alert.metricValue}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{alert.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate(alert.actionTab)}
                  className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 shrink-0"
                >
                  {alert.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mini Control Panel for Low Stock & Out-of-Stock Items */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                allAlertProducts.length > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                لوحة متابعة الأصناف المنخفضة وحد الطلب
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                تحديث تلقائي فوري لأي صنف يصل إلى حد الطلب أو ينفذ من المخزن أثناء البيع.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">أصناف منخفضة: </span>
              <strong className="font-mono-num text-base text-amber-600 dark:text-amber-400">
                {lowOnlyProducts.length}
              </strong>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">أصناف نافذة: </span>
              <strong className="font-mono-num text-base text-rose-600 dark:text-rose-400">
                {outOfStockProducts.length}
              </strong>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">رصيد آمن: </span>
              <strong className="font-mono-num text-base text-emerald-600 dark:text-emerald-400">
                {healthyCount}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              عرض كل المخزون
            </button>
            {onOpenShiftClosing && (
              <button
                type="button"
                onClick={onOpenShiftClosing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 dark:bg-slate-700 whitespace-nowrap"
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>تقفيل الوردية</span>
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="rounded p-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/40"
              aria-label="إغلاق رسالة الخطأ"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {allAlertProducts.length > 0 && (
          <div className="mt-3 relative max-w-xs">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
              placeholder="تصفية النواقص بالاسم أو التصنيف..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        )}

        {filteredAlerts.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {allAlertProducts.length === 0
              ? 'لا توجد أصناف منخفضة أو نافذة حالياً — جميع أصناف النشاط متوفرة فوق حد الطلب.'
              : 'لا توجد أصناف مطابقة للبحث في النواقص.'}
          </div>
        ) : (
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {filteredAlerts.slice(0, 6).map((item) => {
              const isOut = item.stockQty <= 0;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isOut ? (
                      <PackageX className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {item.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {item.category} · حد الطلب:{' '}
                        <span className="font-mono-num">{formatNum(item.minStockAlert)}</span> {item.unit}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-left">
                      <div
                        className={`font-mono-num text-sm font-bold ${
                          isOut
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isOut ? `نفذ (0 ${item.unit})` : `متبقي ${formatNum(item.stockQty)} ${item.unit}`}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {isOut ? 'توقف البيع لحين التوريد' : 'وصل لحد إعادة الطلب'}
                      </div>
                    </div>

                    {canEditStock && (
                      <button
                        type="button"
                        disabled={restockingId === item.id}
                        onClick={() => handleQuickRestock(item, 10)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        <PackagePlus className="h-3.5 w-3.5" />
                        <span>{restockingId === item.id ? 'جاري التوريد...' : 'توريد +10'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Store Activity Switcher — Egyptian Market Multi-Activity Support */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Store className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>نشاط المحل التجاري في السوق المصري</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              يدعم البرنامج تكييف التصنيفات والوحدات والباركود تلقائياً حسب نشاط محلك.
            </p>
          </div>
          {switchingAct && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>جاري تبديل النشاط...</span>
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {activities.map((act) => {
            const isSelected = act.id === settings.activityId;
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => handleSelectActivity(act.id)}
                className={`rounded-lg border p-3 text-right transition-colors ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-semibold truncate ${
                      isSelected ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {act.nameAr}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  {act.subtitleAr}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Analytics Split: 7-Day Sales & Profit + Live Stock Movements */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  مبيعات وأرباح آخر 7 أيام
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  كل فاتورة محسوبة بالتكلفة الفعلية المسجلة وقت إصدارها
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('invoices')}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0"
              >
                <span>مراجعة الفواتير</span>
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-7 gap-3 items-end h-52 pt-4">
              {dashboard.dailySeries.map((day) => {
                const revHeight = Math.max(8, Math.round((day.revenue / maxDailyRev) * 100));
                const profHeight =
                  day.revenue > 0 ? Math.max(4, Math.round((day.profit / maxDailyRev) * 100)) : 0;
                return (
                  <div key={day.date} className="flex flex-col items-center gap-2 h-full justify-end">
                    <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                      {day.revenue > 0 ? Math.round(day.revenue) : '0'}
                    </div>
                    <div className="flex w-full max-w-[38px] items-end justify-center gap-1 h-32">
                      <div
                        className="w-1/2 rounded-t bg-slate-200 dark:bg-slate-700 transition-all"
                        style={{ height: `${revHeight}%` }}
                        title={`مبيعات: ${formatEGP(day.revenue)}`}
                      />
                      {canViewProfits && (
                        <div
                          className="w-1/2 rounded-t bg-emerald-600 dark:bg-emerald-500 transition-all"
                          style={{ height: `${profHeight}%` }}
                          title={`ربح: ${formatEGP(day.profit)}`}
                        />
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate max-w-full">
                      {day.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-6 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-700" />
              <span>إجمالي البيع (ج.م)</span>
            </span>
            {canViewProfits && (
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500" />
                <span>صافي الربح التاريخي (ج.م)</span>
              </span>
            )}
          </div>
        </section>

        {/* Live WebSocket Stock Movements */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                حركة المخزون اللحظية
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                تتحدث تلقائياً عند أي بيع أو توريد أو مرتجع
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 whitespace-nowrap"
            >
              فتح المخزون
            </button>
          </div>

          <div className="mt-3 relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={moveSearch}
              onChange={(e) => setMoveSearch(e.target.value)}
              placeholder="بحث في حركات المخزون..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-3 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {filteredMovements.slice(0, 6).map((mv) => (
              <div key={mv.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {mv.productName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {mv.reason} · {formatDateTimeAr(mv.createdAt)}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div
                    className={`font-mono-num text-sm font-semibold ${
                      mv.deltaQty >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {mv.deltaQty > 0 ? `+${formatNum(mv.deltaQty)}` : formatNum(mv.deltaQty)}
                  </div>
                  <div className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                    الرصيد: {formatNum(mv.afterQty)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Bottom Row: Top Products + Payment Methods */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-slate-800">
            الأصناف الأكثر تحقيقاً للربح والمبيعات
          </h3>
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {dashboard.topProducts.map((tp) => (
              <div key={tp.productId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {tp.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    مباع: <span className="font-mono-num">{formatNum(tp.qtySold)}</span> · مبيعات:{' '}
                    <span className="font-mono-num">{formatEGP(tp.revenue)}</span>
                  </div>
                </div>
                {canViewProfits && (
                  <div className="font-mono-num text-sm font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                    +{formatEGP(tp.profit)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-500" />
              <span>توزيع وسائل الدفع</span>
            </h3>
          </div>
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {dashboard.paymentBreakdown.map((pm) => (
              <div key={pm.method} className="flex items-center justify-between py-2.5 text-sm">
                <div className="text-slate-700 dark:text-slate-300">
                  {PAYMENT_METHOD_LABELS[pm.method]}{' '}
                  <span className="text-xs text-slate-400 font-mono-num">({pm.count})</span>
                </div>
                <div className="font-mono-num font-semibold text-slate-900 dark:text-white">
                  {formatEGP(pm.total)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
