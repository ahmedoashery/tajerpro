import type { ReportsPayload } from '../../shared/types';
import { EXPENSE_CATEGORY_LABELS, formatEGP } from '../../utils/formatters';

interface ProfitLossTabProps {
  report: ReportsPayload;
  canViewProfits: boolean;
}

export function ProfitLossTab({ report, canViewProfits }: ProfitLossTabProps) {
  const pl = report.profitLoss;

  if (!pl) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        لا تتوفر بيانات قائمة الأرباح والخسائر حالياً.
      </div>
    );
  }

  const netProfitPositive = pl.netOperatingProfit >= 0;
  const cmp = report.periodComparison;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Structured P&L Waterfall */}
      <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              قائمة الأرباح والخسائر التفصيلية (Income Statement / P&amp;L)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              صافي الربح التشغيلي يستبعد مسحوبات المالك لأنها توزيع أرباح وليست خسارة نشاط
            </p>
            {cmp && (
              <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono-num text-[11px] text-slate-500">
                <span>
                  المبيعات مقارنة بالسابقة:{' '}
                  <strong
                    className={
                      cmp.revenueDeltaPercent !== null && cmp.revenueDeltaPercent >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }
                  >
                    {cmp.revenueDeltaPercent !== null
                      ? `${cmp.revenueDeltaPercent >= 0 ? '+' : ''}${cmp.revenueDeltaPercent}%`
                      : `سابقة ${formatEGP(cmp.previousRevenue)}`}
                  </strong>
                </span>
                {canViewProfits && (
                  <span>
                    الربح مقارنة بالسابقة:{' '}
                    <strong
                      className={
                        cmp.profitDeltaPercent !== null && cmp.profitDeltaPercent >= 0
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                      }
                    >
                      {cmp.profitDeltaPercent !== null
                        ? `${cmp.profitDeltaPercent >= 0 ? '+' : ''}${cmp.profitDeltaPercent}%`
                        : `سابقة ${formatEGP(cmp.previousProfit)}`}
                    </strong>
                  </span>
                )}
                <span>
                  المصروفات:{' '}
                  <strong
                    className={
                      cmp.expensesDeltaPercent !== null && cmp.expensesDeltaPercent <= 0
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                    }
                  >
                    {cmp.expensesDeltaPercent !== null
                      ? `${cmp.expensesDeltaPercent >= 0 ? '+' : ''}${cmp.expensesDeltaPercent}%`
                      : `سابقة ${formatEGP(cmp.previousExpenses)}`}
                  </strong>
                </span>
              </div>
            )}
          </div>
          {canViewProfits && (
            <span
              className={`font-mono-num text-sm font-bold ${
                netProfitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              هامش الصافي: {pl.netOperatingMarginPercent}%
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">البند المحاسبي</th>
                <th className="px-3 py-2.5 text-left">القيمة (ج.م)</th>
                <th className="px-3 py-2.5 text-center">النسبة / التوضيح</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-300">
                  إجمالي المبيعات قبل المرتجعات
                </td>
                <td className="px-3 py-2.5 text-left font-mono-num font-semibold">
                  {formatEGP(pl.grossSalesBeforeReturns)}
                </td>
                <td className="px-3 py-2.5 text-center text-slate-500">مبيعات إجمالية</td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium text-rose-600 dark:text-rose-400">
                  (-) مرتجعات المبيعات
                </td>
                <td className="px-3 py-2.5 text-left font-mono-num text-rose-600 dark:text-rose-400">
                  -{formatEGP(pl.returnsTotal)}
                </td>
                <td className="px-3 py-2.5 text-center font-mono-num text-slate-500">
                  {report.totals.returnedCount} فاتورة
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-medium text-slate-600 dark:text-slate-400">
                  (-) الخصومات الممنوحة بالفواتير
                </td>
                <td className="px-3 py-2.5 text-left font-mono-num text-slate-600 dark:text-slate-300">
                  {formatEGP(pl.discountsTotal)}
                </td>
                <td className="px-3 py-2.5 text-center text-slate-500">خصم فوري للعميل</td>
              </tr>
              <tr className="bg-slate-50 font-bold dark:bg-slate-800/40">
                <td className="px-3 py-3 text-slate-900 dark:text-white">(=) صافي إيراد المبيعات</td>
                <td className="px-3 py-3 text-left font-mono-num text-slate-900 dark:text-white">
                  {formatEGP(pl.netSalesRevenue)}
                </td>
                <td className="px-3 py-3 text-center font-mono-num text-slate-600 dark:text-slate-300">100%</td>
              </tr>

              {canViewProfits ? (
                <>
                  <tr>
                    <td className="px-3 py-2.5 font-medium text-rose-600 dark:text-rose-400">
                      (-) تكلفة البضاعة المباعة (COGS وقت الفاتورة)
                    </td>
                    <td className="px-3 py-2.5 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(pl.historicalCogs)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">بتكلفة الشراء التاريخية</td>
                  </tr>
                  <tr className="bg-emerald-50/70 font-bold dark:bg-emerald-950/20">
                    <td className="px-3 py-3 text-emerald-800 dark:text-emerald-300">
                      (=) مجمل الربح التجاري (Gross Profit)
                    </td>
                    <td className="px-3 py-3 text-left font-mono-num text-emerald-700 dark:text-emerald-400">
                      {formatEGP(pl.grossProfit)}
                    </td>
                    <td className="px-3 py-3 text-center font-mono-num text-emerald-700 dark:text-emerald-400">
                      {pl.grossMarginPercent}%
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-medium text-rose-600 dark:text-rose-400">
                      (-) عمولات البطاقات وبوابات الدفع الإلكتروني
                    </td>
                    <td className="px-3 py-2.5 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(pl.cardFeesTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">رسوم التحصيل</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 font-medium text-rose-600 dark:text-rose-400">
                      (-) المصروفات التشغيلية (إيجار · رواتب · مرافق)
                    </td>
                    <td className="px-3 py-2.5 text-left font-mono-num text-rose-600 dark:text-rose-400">
                      -{formatEGP(pl.operatingExpensesTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">بدون مسحوبات الشركاء</td>
                  </tr>
                  <tr className="bg-slate-100 text-sm font-extrabold dark:bg-slate-800">
                    <td className="px-3 py-3.5 text-slate-900 dark:text-white">
                      (=) صافي الربح التشغيلي القابل للتوزيع
                    </td>
                    <td
                      className={`px-3 py-3.5 text-left font-mono-num ${
                        netProfitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatEGP(pl.netOperatingProfit)}
                    </td>
                    <td className="px-3 py-3.5 text-center font-mono-num">
                      {pl.netOperatingMarginPercent}%
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                      بند معلوماتي: مسحوبات مالك مسجلة في دفتر المصروفات
                    </td>
                    <td className="px-3 py-2.5 text-left font-mono-num text-slate-700 dark:text-slate-300">
                      {formatEGP(pl.ownerDrawingsInExpenses)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400">توزيع أرباح وليس مصروفاً</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                    بنود التكلفة وصافي الربح مقيدة حسب صلاحيات المستخدم الحالي.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right column: Expense Breakdown + Cashflow Reconciliation */}
      <div className="lg:col-span-5 space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            التدفق النقدي والمشتريات في الفترة
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">النقدي والإلكتروني المحصل من المبيعات</span>
              <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(pl.cashCollectedInPeriod)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">إجمالي فواتير المشتريات والتوريد</span>
              <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                {formatEGP(pl.purchasesTotalInPeriod)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-600 dark:text-slate-300">المصروفات التشغيلية + العمولات</span>
              <span className="font-mono-num font-bold text-rose-600 dark:text-rose-400">
                {formatEGP(pl.operatingExpensesTotal + pl.cardFeesTotal)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            تحليل بنود المصروفات حسب الفئة
          </h3>
          {pl.expensesByCategory.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              لا توجد مصروفات مسجلة في هذه الفترة.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pl.expensesByCategory.map((ex) => (
                <div key={ex.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {EXPENSE_CATEGORY_LABELS[ex.category]} ({ex.count})
                    </span>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatEGP(ex.total)} · {ex.percent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-rose-500 dark:bg-rose-400"
                      style={{ width: `${Math.max(2, ex.percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
