import { RotateCcw, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReportsPayload, WhatIfInputs, WhatIfSimulationSummary } from '../../shared/types';
import {
  computeWhatIfProjection,
  createDefaultWhatIfInputs,
  getBaselineGrossMarginPct,
} from '../../shared/whatIfMath';
import { formatEGP } from '../../utils/formatters';

interface WhatIfAnalysisTabProps {
  report: ReportsPayload;
  canViewProfits: boolean;
  onSimulationChange?: (summary: WhatIfSimulationSummary | null) => void;
}

function formatSignedEGP(value: number): string {
  if (Math.abs(value) < 0.005) return formatEGP(0);
  return `${value > 0 ? '+' : '-'}${formatEGP(Math.abs(value))}`;
}

export function WhatIfAnalysisTab({
  report,
  canViewProfits,
  onSimulationChange,
}: WhatIfAnalysisTabProps) {
  const pl = report.profitLoss;
  const equityRows = report.equityDistribution?.rows || [];

  const [inputs, setInputs] = useState<WhatIfInputs>(() =>
    pl
      ? createDefaultWhatIfInputs(pl)
      : {
          targetGrossMarginPct: 20,
          salesVolumeDeltaPct: 0,
          opExDeltaPct: 0,
          fixedOpExDeltaEgp: 0,
        }
  );

  // Sync baseline margin whenever the loaded report period / activity filter changes
  const reportSyncKey = pl
    ? `${report.fromDate}|${report.toDate}|${report.activityFilter}|${pl.netSalesRevenue}|${pl.grossProfit}|${pl.operatingExpensesTotal}`
    : 'none';

  useEffect(() => {
    if (!pl) return;
    setInputs(createDefaultWhatIfInputs(pl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportSyncKey]);

  const summary = useMemo(() => {
    if (!pl || !canViewProfits) return null;
    return computeWhatIfProjection(pl, inputs, equityRows);
  }, [pl, canViewProfits, inputs, equityRows]);

  useEffect(() => {
    onSimulationChange?.(summary);
  }, [summary, onSimulationChange]);

  if (!canViewProfits) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        تم تقييد عرض أداة محاكاة الأرباح (What-If Analysis) حسب صلاحية الدور الوظيفي الحالية لأنها تعرض هوامش الربح والتكاليف.
      </div>
    );
  }

  if (!pl || !summary) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        لا توجد بيانات مالية كافية لإجراء المحاكاة في هذا النطاق.
      </div>
    );
  }

  const baseExactMargin = getBaselineGrossMarginPct(pl);
  const isAtBaseline =
    Math.abs(summary.inputs.targetGrossMarginPct - baseExactMargin) < 0.01 &&
    summary.inputs.salesVolumeDeltaPct === 0 &&
    summary.inputs.opExDeltaPct === 0 &&
    summary.inputs.fixedOpExDeltaEgp === 0;

  const maxBarScale = Math.max(
    1,
    summary.baseline.revenue,
    summary.simulated.revenue,
    Math.abs(summary.baseline.grossProfit),
    Math.abs(summary.simulated.grossProfit),
    summary.baseline.operatingExpenses,
    summary.simulated.operatingExpenses,
    Math.abs(summary.baseline.netOperatingProfit),
    Math.abs(summary.simulated.netOperatingProfit)
  );

  const resetToBaseline = () => {
    setInputs(createDefaultWhatIfInputs(pl));
  };

  const applyPreset = (
    marginOffset: number,
    volumeDelta: number,
    opExPctDelta: number,
    fixedOpExDelta = 0
  ) => {
    setInputs({
      targetGrossMarginPct: Number(Math.min(90, Math.max(0, baseExactMargin + marginOffset)).toFixed(2)),
      salesVolumeDeltaPct: volumeDelta,
      opExDeltaPct: opExPctDelta,
      fixedOpExDeltaEgp: fixedOpExDelta,
    });
  };

  const marginDiffFromBase = Number((summary.inputs.targetGrossMarginPct - baseExactMargin).toFixed(2));

  return (
    <div className="space-y-5">
      {/* Header & Quick Scenario Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>محاكي الأرباح والتكاليف الافتراضية (What-If Analysis)</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              عدّل هامش الربح أو حجم المبيعات أو مصروفات التشغيل لمشاهدة التأثير المحاسبي الفوري على صافي الربح ونقطة التعادل وحصص الشركاء.
            </p>
          </div>
          <button
            type="button"
            onClick={resetToBaseline}
            disabled={isAtBaseline}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>استعادة الواقع الحالي</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            سيناريوهات سريعة:
          </span>
          <button
            type="button"
            onClick={() => applyPreset(3, 0, -10, 0)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-emerald-950/40"
          >
            تحسين التسعير (+3% هامش) وضبط المصروفات (-10%)
          </button>
          <button
            type="button"
            onClick={() => applyPreset(-3, 25, 0, 0)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-sky-950/40"
          >
            عروض ترويجية (-3% هامش مع +25% مبيعات)
          </button>
          <button
            type="button"
            onClick={() => applyPreset(0, 0, 15, 2000)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-rose-950/40"
          >
            اختبار ضغط التكاليف (+15% و+2,000 ج.م مصروفات)
          </button>
        </div>
      </div>

      {/* Top Instant Projection KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>صافي الربح التشغيلي المتوقع</span>
            {summary.deltas.netProfitDelta !== 0 && (
              <span
                className={`inline-flex items-center gap-1 font-mono-num font-bold ${
                  summary.deltas.netProfitDelta >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {summary.deltas.netProfitDelta >= 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {formatSignedEGP(summary.deltas.netProfitDelta)}
              </span>
            )}
          </div>
          <div
            className={`mt-1.5 font-mono-num text-xl font-extrabold ${
              summary.simulated.netOperatingProfit >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatEGP(summary.simulated.netOperatingProfit)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            الفعلي: {formatEGP(summary.baseline.netOperatingProfit)}
            {summary.deltas.netProfitDeltaPct !== null
              ? ` (${summary.deltas.netProfitDeltaPct >= 0 ? '+' : ''}${summary.deltas.netProfitDeltaPct}%)`
              : ''}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">هامش صافي الربح المتوقع</div>
          <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {summary.simulated.netMarginPct}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            الفعلي: {summary.baseline.netMarginPct}% · كل 1% هامش إجمالي = {formatEGP(summary.deltas.margin1PctImpactEgp)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">مجمل الربح / تكلفة المبيعات</div>
          <div className="mt-1.5 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {formatEGP(summary.simulated.grossProfit)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            تكلفة البضاعة المتوقعة: {formatEGP(summary.simulated.cogs)} ({summary.simulated.grossMarginPct}% هامش)
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">مبيعات نقطة التعادل (Break-Even)</div>
          <div className="mt-1.5 font-mono-num text-xl font-bold text-amber-600 dark:text-amber-400">
            {summary.simulated.breakEvenRevenue !== null
              ? formatEGP(summary.simulated.breakEvenRevenue)
              : 'غير قابل للتحقق'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            الفعلي: {summary.baseline.breakEvenRevenue !== null ? formatEGP(summary.baseline.breakEvenRevenue) : '—'}
            {summary.deltas.breakEvenMarginPct !== null
              ? ` · أدنى هامش تعادل: ${summary.deltas.breakEvenMarginPct}%`
              : ''}
          </div>
        </div>
      </div>

      {/* Main Workspace: Interactive Levers + Side-by-Side Comparison */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Controls Column */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              متغيرات المحاكاة الافتراضية
            </h4>
            <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
              {isAtBaseline ? 'مطابق للوضع الفعلي' : 'وضع محاكاة نشط'}
            </span>
          </div>

          {/* 1. Target Gross Profit Margin % */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor="whatif-margin" className="font-semibold text-slate-800 dark:text-slate-200">
                هامش الربح الإجمالي الافتراضي (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="whatif-margin"
                  type="number"
                  min={0}
                  max={90}
                  step={0.5}
                  value={inputs.targetGrossMarginPct}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      targetGrossMarginPct: Number(e.target.value || 0),
                    }))
                  }
                  className="w-24 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-mono-num text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <span className="font-mono-num text-xs font-bold text-slate-500">%</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={85}
              step={0.5}
              aria-label="منزلق هامش الربح الإجمالي"
              value={Math.min(85, Math.max(0, inputs.targetGrossMarginPct))}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  targetGrossMarginPct: Number(e.target.value),
                }))
              }
              className="w-full accent-emerald-600 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-num">
              <span>الأساس الفعلي: {baseExactMargin}%</span>
              <span
                className={
                  marginDiffFromBase > 0
                    ? 'text-emerald-600 font-bold'
                    : marginDiffFromBase < 0
                      ? 'text-rose-600 font-bold'
                      : ''
                }
              >
                {marginDiffFromBase > 0 ? `+${marginDiffFromBase}` : marginDiffFromBase}% فرق
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 pt-0.5">
              {[-5, -2, 2, 5].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() =>
                    setInputs((prev) => ({
                      ...prev,
                      targetGrossMarginPct: Number(
                        Math.min(90, Math.max(0, baseExactMargin + delta)).toFixed(2)
                      ),
                    }))
                  }
                  className="min-h-[34px] rounded-md border border-slate-200 bg-slate-50 text-[11px] font-mono-num font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {delta > 0 ? `+${delta}%` : `${delta}%`}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Operating Expenses % Delta */}
          <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor="whatif-opex-pct" className="font-semibold text-slate-800 dark:text-slate-200">
                تغير تكاليف التشغيل بنسبة (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="whatif-opex-pct"
                  type="number"
                  min={-95}
                  max={200}
                  step={1}
                  value={inputs.opExDeltaPct}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      opExDeltaPct: Number(e.target.value || 0),
                    }))
                  }
                  className="w-24 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-mono-num text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <span className="font-mono-num text-xs font-bold text-slate-500">%</span>
              </div>
            </div>
            <input
              type="range"
              min={-50}
              max={100}
              step={1}
              aria-label="منزلق تغير تكاليف التشغيل"
              value={Math.min(100, Math.max(-50, inputs.opExDeltaPct))}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  opExDeltaPct: Number(e.target.value),
                }))
              }
              className="w-full accent-rose-600 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-num">
              <span>المصروف الفعلي: {formatEGP(summary.baseline.operatingExpenses)}</span>
              <span>المتوقع: {formatEGP(summary.simulated.operatingExpenses)}</span>
            </div>
          </div>

          {/* 3. Fixed OpEx Adjustment (EGP) */}
          <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor="whatif-opex-fixed" className="font-semibold text-slate-800 dark:text-slate-200">
                تعديل ثابت في المصروفات (ج.م)
              </label>
              <input
                id="whatif-opex-fixed"
                type="number"
                step={100}
                value={inputs.fixedOpExDeltaEgp}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    fixedOpExDeltaEgp: Number(e.target.value || 0),
                  }))
                }
                placeholder="مثال: 2000 أو -1000"
                className="w-32 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-mono-num text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[-2000, -500, 1000, 3000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() =>
                    setInputs((prev) => ({
                      ...prev,
                      fixedOpExDeltaEgp: amt,
                    }))
                  }
                  className="min-h-[34px] rounded-md border border-slate-200 bg-slate-50 text-[11px] font-mono-num font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {amt > 0 ? `+${amt}` : amt}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Sales Volume % Delta */}
          <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor="whatif-sales-delta" className="font-semibold text-slate-800 dark:text-slate-200">
                تغير حجم المبيعات المتوقع (%)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="whatif-sales-delta"
                  type="number"
                  min={-90}
                  max={300}
                  step={1}
                  value={inputs.salesVolumeDeltaPct}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      salesVolumeDeltaPct: Number(e.target.value || 0),
                    }))
                  }
                  className="w-24 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-mono-num text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <span className="font-mono-num text-xs font-bold text-slate-500">%</span>
              </div>
            </div>
            <input
              type="range"
              min={-50}
              max={100}
              step={1}
              aria-label="منزلق تغير حجم المبيعات"
              value={Math.min(100, Math.max(-50, inputs.salesVolumeDeltaPct))}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  salesVolumeDeltaPct: Number(e.target.value),
                }))
              }
              className="w-full accent-sky-600 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-num">
              <span>المبيعات الفعلية: {formatEGP(summary.baseline.revenue)}</span>
              <span>المتوقعة: {formatEGP(summary.simulated.revenue)}</span>
            </div>
          </div>
        </div>

        {/* Comparison Column */}
        <div className="lg:col-span-7 space-y-5">
          {/* Side-by-Side P&L Waterfall Comparison Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 flex items-center justify-between">
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                مقارنة قائمة الدخل (الوضع الفعلي مقابل المحاكاة)
              </h4>
              <span className="text-xs text-slate-500 font-mono-num">
                عمولات الدفع تتناسب طردياً مع حجم المبيعات
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs sm:text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">البند المالي</th>
                    <th className="px-4 py-3 text-left">الوضع الفعلي</th>
                    <th className="px-4 py-3 text-left">نتيجة المحاكاة</th>
                    <th className="px-4 py-3 text-left">الفرق (الأثر)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                      صافي إيراد المبيعات
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num">
                      {formatEGP(summary.baseline.revenue)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatEGP(summary.simulated.revenue)}
                    </td>
                    <td
                      className={`px-4 py-3 text-left font-mono-num font-semibold ${
                        summary.deltas.revenueDelta >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedEGP(summary.deltas.revenueDelta)}
                    </td>
                  </tr>

                  <tr>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      (-) تكلفة البضاعة المباعة المقدرة
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.baseline.cogs)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.simulated.cogs)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-slate-500">
                      {formatSignedEGP(summary.simulated.cogs - summary.baseline.cogs)}
                    </td>
                  </tr>

                  <tr className="bg-slate-50/60 dark:bg-slate-800/30 font-semibold">
                    <td className="px-4 py-3 text-slate-900 dark:text-white">
                      (=) مجمل الربح التجاري ({summary.simulated.grossMarginPct}%)
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num">
                      {formatEGP(summary.baseline.grossProfit)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                      {formatEGP(summary.simulated.grossProfit)}
                    </td>
                    <td
                      className={`px-4 py-3 text-left font-mono-num font-bold ${
                        summary.deltas.grossProfitDelta >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedEGP(summary.deltas.grossProfitDelta)}
                    </td>
                  </tr>

                  <tr>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      (-) عمولات التحصيل الإلكتروني
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.baseline.cardFees)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.simulated.cardFees)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-slate-500">
                      {formatSignedEGP(summary.simulated.cardFees - summary.baseline.cardFees)}
                    </td>
                  </tr>

                  <tr>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      (-) المصروفات التشغيلية
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.baseline.operatingExpenses)}
                    </td>
                    <td className="px-4 py-3 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(summary.simulated.operatingExpenses)}
                    </td>
                    <td
                      className={`px-4 py-3 text-left font-mono-num font-semibold ${
                        summary.deltas.operatingExpensesDelta <= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedEGP(summary.deltas.operatingExpensesDelta)}
                    </td>
                  </tr>

                  <tr className="bg-emerald-50/70 dark:bg-emerald-950/25 font-extrabold">
                    <td className="px-4 py-3.5 text-slate-900 dark:text-white">
                      (=) صافي الربح التشغيلي المتوقع
                    </td>
                    <td className="px-4 py-3.5 text-left font-mono-num text-slate-800 dark:text-slate-200">
                      {formatEGP(summary.baseline.netOperatingProfit)}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-left font-mono-num text-base ${
                        summary.simulated.netOperatingProfit >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatEGP(summary.simulated.netOperatingProfit)}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-left font-mono-num ${
                        summary.deltas.netProfitDelta >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedEGP(summary.deltas.netProfitDelta)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual Bar Comparison (Actual vs Simulated) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                المقارنة البصرية (الفعلي مقابل المتوقع)
              </h4>
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400 dark:bg-slate-600" />
                  الوضع الفعلي
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500" />
                  سيناريو المحاكاة
                </span>
              </div>
            </div>

            <div className="space-y-3.5 text-xs">
              {(
                [
                  {
                    label: 'صافي المبيعات',
                    base: summary.baseline.revenue,
                    sim: summary.simulated.revenue,
                    simColor: 'bg-sky-600 dark:bg-sky-500',
                  },
                  {
                    label: 'مجمل الربح',
                    base: summary.baseline.grossProfit,
                    sim: summary.simulated.grossProfit,
                    simColor: 'bg-emerald-600 dark:bg-emerald-500',
                  },
                  {
                    label: 'مصروفات التشغيل',
                    base: summary.baseline.operatingExpenses,
                    sim: summary.simulated.operatingExpenses,
                    simColor: 'bg-rose-600 dark:bg-rose-500',
                  },
                  {
                    label: 'صافي الربح التشغيلي',
                    base: summary.baseline.netOperatingProfit,
                    sim: summary.simulated.netOperatingProfit,
                    simColor:
                      summary.simulated.netOperatingProfit >= 0
                        ? 'bg-emerald-600 dark:bg-emerald-500'
                        : 'bg-rose-600 dark:bg-rose-500',
                  },
                ] as const
              ).map((metric) => {
                const basePct = Math.max(2, Math.round((Math.max(0, metric.base) / maxBarScale) * 100));
                const simPct = Math.max(2, Math.round((Math.max(0, metric.sim) / maxBarScale) * 100));
                return (
                  <div key={metric.label} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{metric.label}</span>
                      <span className="font-mono-num text-slate-600 dark:text-slate-300">
                        فعلي: {formatEGP(metric.base)} · متوقع: <strong>{formatEGP(metric.sim)}</strong>
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full bg-slate-400 dark:bg-slate-600 transition-all duration-150"
                          style={{ width: `${metric.base <= 0 ? 0 : basePct}%` }}
                        />
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-full ${metric.simColor} transition-all duration-150`}
                          style={{ width: `${metric.sim <= 0 ? 0 : simPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Equity Partners Projected Impact Table */}
      {summary.partnerImpacts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              تأثير المحاكاة على حصص أرباح الشركاء النشطين
            </h4>
            <span className="text-xs text-slate-500">
              يتم توزيع صافي الربح التشغيلي المتوقع بنفس نسب الشركاء الفعلية
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs sm:text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">الشريك</th>
                  <th className="px-4 py-3 text-center">النسبة %</th>
                  <th className="px-4 py-3 text-left">حصة الفترة الفعلية</th>
                  <th className="px-4 py-3 text-left">الحصة المتوقعة بالمحاكاة</th>
                  <th className="px-4 py-3 text-left">الفرق المتوقع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {summary.partnerImpacts.map((p) => (
                  <tr key={p.partnerId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{p.partnerName}</div>
                      <div className="text-[11px] text-slate-500">{p.roleTitle}</div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono-num font-bold">{p.sharePercent}%</td>
                    <td className="px-4 py-3 text-left font-mono-num">{formatEGP(p.baselineShare)}</td>
                    <td
                      className={`px-4 py-3 text-left font-mono-num font-bold ${
                        p.simulatedShare >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatEGP(p.simulatedShare)}
                    </td>
                    <td
                      className={`px-4 py-3 text-left font-mono-num font-semibold ${
                        p.deltaShare >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedEGP(p.deltaShare)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
