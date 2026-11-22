import type { ReportsPayload, StoreActivityProfile } from '../../shared/types';
import {
  EXPENSE_CATEGORY_LABELS,
  formatEGP,
  formatNum,
  PAYMENT_METHOD_LABELS,
} from '../../utils/formatters';

interface ExecutiveOverviewTabProps {
  report: ReportsPayload;
  activities: StoreActivityProfile[];
  canViewProfits: boolean;
}

export function ExecutiveOverviewTab({
  report,
  activities,
  canViewProfits,
}: ExecutiveOverviewTabProps) {
  const exec = report.executiveSummary;
  const activityNameMap = new Map(activities.map((a) => [a.id, a.nameAr]));

  if (!exec) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        لا تتوفر بيانات الملخص التنفيذي حالياً.
      </div>
    );
  }

  const netIncomePositive = exec.netIncomeAfterExpenses >= 0;
  const cmp = report.periodComparison;

  return (
    <div className="space-y-5">
      {/* 1. Owner Executive Decision Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">صافي المبيعات الفعلية</div>
            {cmp && cmp.revenueDeltaPercent !== null && (
              <span
                className={`font-mono-num text-[11px] font-bold ${
                  cmp.revenueDeltaPercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {cmp.revenueDeltaPercent >= 0 ? '+' : ''}
                {cmp.revenueDeltaPercent}%
              </span>
            )}
          </div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {formatEGP(report.totals.revenue)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            قبل المرتجع: {formatEGP(exec.grossSalesBeforeReturns)} · مرتجع: {formatEGP(exec.returnsTotal)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">متوسط قيمة الفاتورة والخصومات</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {formatEGP(exec.avgInvoiceValue)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            إجمالي الخصومات الممنوحة: {formatEGP(exec.totalDiscountGiven)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">المصروفات وصافي الدخل بالفترة</div>
            {cmp && cmp.expensesDeltaPercent !== null && (
              <span
                className={`font-mono-num text-[11px] font-bold ${
                  cmp.expensesDeltaPercent <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                مصروفات {cmp.expensesDeltaPercent >= 0 ? '+' : ''}
                {cmp.expensesDeltaPercent}%
              </span>
            )}
          </div>
          <div
            className={`mt-1 font-mono-num text-xl font-bold ${
              !canViewProfits
                ? 'text-slate-500'
                : netIncomePositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {canViewProfits ? formatEGP(exec.netIncomeAfterExpenses) : 'مقيد بالصلاحية'}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            مصروفات: {formatEGP(exec.operatingExpensesTotal)} · هامش صافي:{' '}
            {canViewProfits ? `${exec.netMarginPercent}%` : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">السيولة المتاحة مقابل الذمم</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-sky-600 dark:text-sky-400">
            {formatEGP(exec.businessHealth.treasuriesTotal)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            لنا: {formatEGP(exec.businessHealth.customerReceivables)} · علينا:{' '}
            {formatEGP(exec.businessHealth.supplierPayables)}
          </div>
        </div>
      </div>

      {/* 2. Store Balance Health Snapshot */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            تقييم رأس المال وصحة النشاط
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">قيمة المخزون الحالي (بالتكلفة)</span>
              <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                {canViewProfits ? formatEGP(exec.businessHealth.inventoryCostValue) : 'مقيد'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">قيمة المخزون بسعر البيع المتوقع</span>
              <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(exec.businessHealth.inventoryRetailValue)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">نواقص المخزون وأصناف نفذت</span>
              <span className="font-mono-num font-semibold text-amber-600 dark:text-amber-400">
                {exec.businessHealth.lowStockCount} ناقص · {exec.businessHealth.outOfStockCount} نفذ
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">عملاء قاربوا/تجاوزوا حد الائتمان</span>
              <span className="font-mono-num font-semibold text-rose-600 dark:text-rose-400">
                {exec.businessHealth.overLimitCustomersCount} عميل
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">موردون لهم أرصدة مستحقة</span>
              <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                {exec.businessHealth.suppliersWithDebtCount} مورد
              </span>
            </div>
          </div>
        </div>

        {/* 3. Payment Method Mix */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              توزيع المبيعات حسب طرق الدفع والتحصيل
            </h3>
            <span className="text-xs text-slate-500 font-mono-num">
              {exec.byPaymentMethod.length} قنوات دفع
            </span>
          </div>

          {exec.byPaymentMethod.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              لا توجد معاملات بيع مكتملة في هذا النطاق.
            </div>
          ) : (
            <div className="space-y-3">
              {exec.byPaymentMethod.map((pm) => (
                <div key={pm.method} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {PAYMENT_METHOD_LABELS[pm.method] || pm.method}{' '}
                      <span className="text-slate-400 font-mono-num">({pm.count} عملية)</span>
                    </span>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatEGP(pm.total)}{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">({pm.percent}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-emerald-600 dark:bg-emerald-500"
                      style={{ width: `${Math.max(2, pm.percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {exec.expensesByCategory.length > 0 && (
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                أبرز بنود المصروفات في الفترة
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {exec.expensesByCategory.slice(0, 4).map((c) => (
                  <div
                    key={c.category}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950/60"
                  >
                    <span className="text-slate-600 dark:text-slate-300">
                      {EXPENSE_CATEGORY_LABELS[c.category]} ({c.count})
                    </span>
                    <span className="font-mono-num font-bold text-rose-600 dark:text-rose-400">
                      {formatEGP(c.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Leaderboards: By Activity, By Cashier, Top Customers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
            أداء الأنشطة التجارية
          </h3>
          {exec.byActivity.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">لا توجد بيانات</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2">النشاط</th>
                    <th className="py-2 text-center">فواتير</th>
                    <th className="py-2 text-left">المبيعات</th>
                    {canViewProfits && <th className="py-2 text-left">الربح</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {exec.byActivity.map((a) => (
                    <tr key={a.activityId}>
                      <td className="py-2.5 font-semibold text-slate-900 dark:text-white">
                        {activityNameMap.get(a.activityId) || a.activityId}
                      </td>
                      <td className="py-2.5 text-center font-mono-num">{a.invoiceCount}</td>
                      <td className="py-2.5 text-left font-mono-num">{formatEGP(a.revenue)}</td>
                      {canViewProfits && (
                        <td className="py-2.5 text-left font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                          {formatEGP(a.profit)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
            ترتيب الكاشير والمبيعات
          </h3>
          {exec.byCashier.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">لا توجد بيانات</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2">الموظف</th>
                    <th className="py-2 text-center">فواتير</th>
                    <th className="py-2 text-left">متوسط السلة</th>
                    <th className="py-2 text-left">المبيعات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {exec.byCashier.map((c) => (
                    <tr key={c.cashierName}>
                      <td className="py-2.5 font-semibold text-slate-900 dark:text-white">
                        {c.cashierName}
                      </td>
                      <td className="py-2.5 text-center font-mono-num">{c.invoiceCount}</td>
                      <td className="py-2.5 text-left font-mono-num text-slate-500">
                        {formatEGP(c.avgBasket)}
                      </td>
                      <td className="py-2.5 text-left font-mono-num font-bold">{formatEGP(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
            كبار العملاء بالفترة
          </h3>
          {exec.topCustomers.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              لا توجد فواتير مربوطة بعملاء مسجلين في هذا النطاق.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2">العميل</th>
                    <th className="py-2 text-center">فواتير</th>
                    <th className="py-2 text-left">إجمالي المسحوبات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {exec.topCustomers.map((cu) => (
                    <tr key={cu.customerId}>
                      <td className="py-2.5 font-semibold text-slate-900 dark:text-white">
                        {cu.customerName}
                      </td>
                      <td className="py-2.5 text-center font-mono-num">{formatNum(cu.invoiceCount)}</td>
                      <td className="py-2.5 text-left font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(cu.totalSpent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 5. Peak Hours & Day-of-Week Traffic Analytics */}
      {report.peakTimeAnalytics && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              تحليل أوقات الذروة والمبيعات حسب الساعة واليوم
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                ساعة الذروة:{' '}
                <strong className="font-mono-num text-emerald-700 dark:text-emerald-400">
                  {report.peakTimeAnalytics.peakHourLabel}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                أعلى يوم:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {report.peakTimeAnalytics.peakDayLabel}
                </strong>
              </span>
            </div>
          </div>

          {(() => {
            const peak = report.peakTimeAnalytics!;
            const activeHours = peak.byHour.filter((h) => h.invoiceCount > 0 || h.revenue > 0);
            const maxHourRev = Math.max(1, ...activeHours.map((h) => h.revenue));
            const maxDayRev = Math.max(1, ...peak.byDayOfWeek.map((d) => d.revenue));

            return (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    التوزيع على أيام الأسبوع
                  </div>
                  <div className="space-y-2">
                    {peak.byDayOfWeek.map((day) => {
                      const pct = day.revenue > 0 ? Math.max(3, Math.round((day.revenue / maxDayRev) * 100)) : 0;
                      const isPeak = day.dayNameAr === peak.peakDayLabel && day.revenue > 0;
                      return (
                        <div key={day.dayIndex} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className={isPeak ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}>
                              {day.dayNameAr}{' '}
                              <span className="font-mono-num text-[11px] text-slate-400">
                                ({day.invoiceCount} فاتورة)
                              </span>
                            </span>
                            <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                              {formatEGP(day.revenue)}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                            <div
                              className={isPeak ? 'h-full bg-emerald-600 dark:bg-emerald-500' : 'h-full bg-slate-400 dark:bg-slate-600'}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      الساعات النشطة باليوم ({activeHours.length} ساعة)
                    </span>
                    <span className="text-[11px] text-slate-400">مرتبة من بداية اليوم</span>
                  </div>
                  {activeHours.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      لا توجد مبيعات مسجلة بالساعات في هذه الفترة.
                    </div>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-y-auto pl-1">
                      {activeHours.map((bucket) => {
                        const pct = Math.max(4, Math.round((bucket.revenue / maxHourRev) * 100));
                        const isPeak = bucket.label === peak.peakHourLabel;
                        return (
                          <div key={bucket.hour} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className={isPeak ? 'font-bold text-emerald-700 dark:text-emerald-400 font-mono-num' : 'font-mono-num text-slate-700 dark:text-slate-300'}>
                                {bucket.label}{' '}
                                <span className="text-[11px] text-slate-400">
                                  ({bucket.invoiceCount} فاتورة)
                                </span>
                              </span>
                              <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
                                {formatEGP(bucket.revenue)}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                              <div
                                className={isPeak ? 'h-full bg-emerald-600 dark:bg-emerald-500' : 'h-full bg-sky-500/80 dark:bg-sky-500'}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
