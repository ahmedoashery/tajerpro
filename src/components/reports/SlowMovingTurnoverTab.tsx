import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import type { ReportsPayload, SlowMovingProductRow, StoreActivityProfile } from '../../shared/types';
import { formatEGP, formatNum } from '../../utils/formatters';
import { InfiniteTableFooter } from '../ui/ExcelColumnFilter';

interface SlowMovingTurnoverTabProps {
  report: ReportsPayload;
  activities: StoreActivityProfile[];
  canViewProfits: boolean;
}

export function SlowMovingTurnoverTab({
  report,
  activities,
  canViewProfits,
}: SlowMovingTurnoverTabProps) {
  const sm = report.slowMovingReport;
  const [abcFilter, setAbcFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | SlowMovingProductRow['healthTag']>('all');
  const [search, setSearch] = useState('');

  const activityNameMap = useMemo(
    () => new Map(activities.map((a) => [a.id, a.nameAr])),
    [activities]
  );

  const filteredRows = useMemo(() => {
    const rows = sm?.rows || [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (abcFilter !== 'all' && r.abcClass !== abcFilter) return false;
      if (healthFilter !== 'all' && r.healthTag !== healthFilter) return false;
      if (q && !r.productName.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sm?.rows, abcFilter, healthFilter, search]);

  const scroll = useInfiniteScroll(filteredRows, {
    batchSize: 18,
    resetKey: `sm-${abcFilter}-${healthFilter}-${search}`,
  });

  if (!sm) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        لا تتوفر بيانات تحليل دوران المخزون حالياً.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">أصناف راكدة تماماً (45+ يوم بدون بيع)</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-rose-600 dark:text-rose-400">
            {sm.deadStockCount} صنف
          </div>
          <div className="mt-1 text-xs text-slate-500">تحتاج تخفيض سعر أو تصفية عاجلة</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">أصناف بطيئة الحركة (21+ يوم)</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-amber-600 dark:text-amber-400">
            {sm.slowStockCount} صنف
          </div>
          <div className="mt-1 text-xs text-slate-500">يُفضل تقليل كميات التوريد منها</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">رأس المال المجمد في البضاعة الراكدة/البطيئة</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {canViewProfits ? formatEGP(sm.tiedUpCapital) : 'مقيد بالصلاحية'}
          </div>
          <div className="mt-1 text-xs text-slate-500">تكلفة شراء محتجزة على الأرفف</div>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['all', 'كل التصنيف'],
                ['A', 'فئة A (80% من الإيراد)'],
                ['B', 'فئة B'],
                ['C', 'فئة C'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setAbcFilter(k)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  abcFilter === k
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'الكل'],
                ['dead', 'راكد'],
                ['slow', 'بطيء'],
                ['normal', 'متوازن'],
                ['fast', 'سريع الدوران'],
              ] as const
            ).map(([hId, hLbl]) => (
              <button
                key={hId}
                type="button"
                onClick={() => setHealthFilter(hId)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  healthFilter === hId
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {hLbl}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف أو القسم..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs sm:text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">الصنف</th>
                <th className="px-4 py-3">النشاط</th>
                <th className="px-4 py-3 text-center">فئة ABC</th>
                <th className="px-4 py-3 text-center">المخزون المتاح</th>
                <th className="px-4 py-3 text-center">المباع (90 يوم)</th>
                <th className="px-4 py-3 text-center">معدل الدوران</th>
                <th className="px-4 py-3 text-center">منذ آخر بيع</th>
                {canViewProfits && <th className="px-4 py-3">رأس المال المحتجز</th>}
                <th className="px-4 py-3">التصنيف الحركي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {scroll.visibleItems.map((row) => (
                <tr key={row.productId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 dark:text-white">{row.productName}</div>
                    <div className="text-[11px] text-slate-500">{row.category}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {activityNameMap.get(row.activityId) || row.activityId}
                  </td>
                  <td className="px-4 py-3 text-center font-mono-num font-bold text-slate-800 dark:text-slate-200">
                    {row.abcClass}
                  </td>
                  <td className="px-4 py-3 text-center font-mono-num">
                    {formatNum(row.stockQty)} {row.unit}
                  </td>
                  <td className="px-4 py-3 text-center font-mono-num">{formatNum(row.qtySoldLast90d)}</td>
                  <td className="px-4 py-3 text-center font-mono-num">{row.turnoverRate}×</td>
                  <td className="px-4 py-3 text-center font-mono-num text-xs text-slate-600 dark:text-slate-300">
                    {row.daysSinceLastSale === null ? 'لم يُبع مطلقاً' : `${row.daysSinceLastSale} يوم`}
                  </td>
                  {canViewProfits && (
                    <td className="px-4 py-3 font-mono-num font-semibold">{formatEGP(row.stockCostValue)}</td>
                  )}
                  <td className="px-4 py-3 text-xs font-bold">
                    {row.healthTag === 'dead' && <span className="text-rose-600">راكد</span>}
                    {row.healthTag === 'slow' && <span className="text-amber-600">بطيء الحركة</span>}
                    {row.healthTag === 'normal' && <span className="text-slate-600 dark:text-slate-300">متوازن</span>}
                    {row.healthTag === 'fast' && <span className="text-emerald-600">سريع الدوران</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <InfiniteTableFooter
          visibleCount={scroll.visibleCount}
          totalCount={scroll.totalCount}
          hasMore={scroll.hasMore}
          onLoadMore={scroll.loadMore}
          sentinelRef={scroll.sentinelRef}
        />
      </div>
    </div>
  );
}
