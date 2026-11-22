import type { PrintDocumentPayload } from '../../context/PrintContext';
import { formatEGP, formatNum, PAYMENT_METHOD_LABELS } from '../../utils/formatters';

type ReportPrintPayload = Extract<PrintDocumentPayload, { kind: 'report' }>;

export function ReportPrintSheets({
  payload,
  printedAt,
}: {
  payload: ReportPrintPayload;
  printedAt: string;
}) {
  const {
    report,
    subTab,
    invStatusFilter,
    canViewProfits,
    settings,
    activities,
    printedBy,
    financialSummary,
    customReport,
    whatIfSummary,
  } = payload;

  const activityNameMap = new Map(activities.map((a) => [a.id, a.nameAr]));
  const reportTitles: Record<typeof subTab, string> = {
    executive_overview: 'التقرير الشامل لصاحب العمل (ملخص النشاط الكامل)',
    profit_loss: 'قائمة الأرباح والخسائر التفصيلية (P&L)',
    what_if_analysis: 'تقرير محاكاة الأرباح والتكاليف الافتراضية (What-If)',
    equity_partners: 'تقرير حصص الشركاء وتوزيع الأرباح والمسحوبات',
    sales_profit: `تقرير المبيعات والأرباح (${report.period === 'daily' ? 'يومي' : report.period === 'monthly' ? 'شهري' : 'سنوي'})`,
    product_profit: 'تقرير أرباح الأصناف التفصيلي (بتاريخ الفاتورة)',
    slow_moving: 'تقرير الأصناف الراكدة ومعدل دوران المخزون (ABC)',
    inventory_health: 'تقرير جرد وحالة المخزون والتقييم المالي',
    custom_report: customReport?.title || 'تقرير مخصص',
    financial_summary: 'التقرير المالي الشامل (الأرباح والمصروفات والأرصدة)',
    scheduled_reports: 'ملخص التقارير التلقائية والتحذيرات المالية للمديرين',
  };

  const filteredInvRows = report.inventoryReport.rows.filter(
    (r) => invStatusFilter === 'all' || r.status === invStatusFilter
  );

  const exec = report.executiveSummary;
  const pl = report.profitLoss;
  const eq = report.equityDistribution;
  const sm = report.slowMovingReport;
  const peak = report.peakTimeAnalytics;

  return (
    <div className="print-a4-sheet space-y-5" dir="rtl">
      <header className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
        <div className="space-y-1">
          <div className="font-display text-xl font-bold text-slate-900">{settings.storeName}</div>
          <div className="text-xs text-slate-600">
            {settings.address} · هاتف: <span className="font-mono-num">{settings.phone}</span>
          </div>
          {settings.taxNumber && (
            <div className="text-xs text-slate-600 font-mono-num">
              الرقم الضريبي: {settings.taxNumber}
            </div>
          )}
        </div>

        <div className="text-left space-y-1">
          <div className="font-display text-base font-bold text-slate-900">
            {reportTitles[subTab]}
          </div>
          <div className="text-xs text-slate-600">
            النشاط:{' '}
            {report.activityFilter === 'all'
              ? 'كل الأنشطة التجارية'
              : activityNameMap.get(report.activityFilter) || report.activityFilter}
          </div>
          <div className="text-xs text-slate-600 font-mono-num">
            الفترة: {report.fromDate || 'البداية'} ← {report.toDate || 'اليوم'}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-3 text-xs print-avoid-break">
        <div className="rounded border border-slate-300 p-2.5">
          <div className="text-slate-500">إجمالي المبيعات</div>
          <div className="mt-1 font-mono-num text-sm font-bold">
            {formatEGP(report.totals.revenue)}
          </div>
          <div className="text-[10px] text-slate-500 font-mono-num">
            {report.totals.invoiceCount} فاتورة · {report.totals.returnedCount} مرتجع
          </div>
        </div>

        <div className="rounded border border-slate-300 p-2.5">
          <div className="text-slate-500">التكلفة التاريخية</div>
          <div className="mt-1 font-mono-num text-sm font-bold">
            {canViewProfits ? formatEGP(report.totals.cost) : 'مقيد'}
          </div>
          <div className="text-[10px] text-slate-500">بتكلفة وقت الفاتورة</div>
        </div>

        <div className="rounded border border-slate-300 p-2.5">
          <div className="text-slate-500">مجمل الربح المحقق</div>
          <div className="mt-1 font-mono-num text-sm font-bold text-emerald-700">
            {canViewProfits ? formatEGP(report.totals.profit) : 'مقيد'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono-num">
            الهامش: {canViewProfits ? `${report.totals.marginPercent}%` : '—'}
          </div>
        </div>

        <div className="rounded border border-slate-300 p-2.5">
          <div className="text-slate-500">حالة المخزون</div>
          <div className="mt-1 font-mono-num text-xs font-bold">
            {report.inventoryReport.counts.available} متوفر · {report.inventoryReport.counts.low} ناقص
          </div>
          <div className="text-[10px] text-slate-600 font-mono-num">
            {report.inventoryReport.counts.out} نافذ · {report.inventoryReport.counts.overstock} فوق الحد
          </div>
        </div>
      </section>

      {subTab === 'executive_overview' && exec && (
        <div className="space-y-4">
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>مؤشر النشاط الرئيسي</th>
                <th className="text-left">القيمة</th>
                <th>تفصيل / دلالة سريعة</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">صافي المبيعات بعد المرتجعات</td>
                <td className="text-left font-mono-num font-bold">{formatEGP(report.totals.revenue)}</td>
                <td className="text-slate-600 font-mono-num">
                  قبل المرتجعات: {formatEGP(exec.grossSalesBeforeReturns)} · مرتجع: {formatEGP(exec.returnsTotal)}
                </td>
              </tr>
              {canViewProfits && (
                <>
                  <tr>
                    <td className="font-semibold">مجمل ربح المبيعات</td>
                    <td className="text-left font-mono-num font-bold text-emerald-700">
                      {formatEGP(report.totals.profit)}
                    </td>
                    <td className="text-slate-600 font-mono-num">هامش مجمل {report.totals.marginPercent}%</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">إجمالي المصروفات والمسحوبات</td>
                    <td className="text-left font-mono-num text-rose-700">
                      {formatEGP(exec.operatingExpensesTotal)}
                    </td>
                    <td className="text-slate-600">مصروفات الفترة المسجلة</td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td>صافي الربح بعد المصروفات</td>
                    <td className="text-left font-mono-num text-emerald-700">
                      {formatEGP(exec.netIncomeAfterExpenses)}
                    </td>
                    <td className="font-mono-num">صافي هامش {exec.netMarginPercent}%</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="font-semibold">متوسط قيمة الفاتورة</td>
                <td className="text-left font-mono-num font-semibold">{formatEGP(exec.avgInvoiceValue)}</td>
                <td className="text-slate-600 font-mono-num">خصومات ممنوحة: {formatEGP(exec.totalDiscountGiven)}</td>
              </tr>
              <tr>
                <td className="font-semibold">السيولة المتاحة بالخزائن</td>
                <td className="text-left font-mono-num font-bold">{formatEGP(exec.businessHealth.treasuriesTotal)}</td>
                <td className="text-slate-600 font-mono-num">
                  لنا عند العملاء: {formatEGP(exec.businessHealth.customerReceivables)} · علينا للموردين: {formatEGP(exec.businessHealth.supplierPayables)}
                </td>
              </tr>
            </tbody>
          </table>

          {exec.byPaymentMethod.length > 0 && (
            <table className="print-table text-xs">
              <thead>
                <tr>
                  <th>طريقة الدفع</th>
                  <th className="text-center">عدد العمليات</th>
                  <th className="text-left">إجمالي التحصيل</th>
                  <th className="text-center">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {exec.byPaymentMethod.map((pm) => (
                  <tr key={pm.method}>
                    <td className="font-semibold">{PAYMENT_METHOD_LABELS[pm.method] || pm.method}</td>
                    <td className="text-center font-mono-num">{pm.count}</td>
                    <td className="text-left font-mono-num font-bold">{formatEGP(pm.total)}</td>
                    <td className="text-center font-mono-num">{pm.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {peak && (
            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs flex justify-between print-avoid-break">
              <span>
                ساعة الذروة الأكثر مبيعاً: <strong className="font-mono-num">{peak.peakHourLabel}</strong>
              </span>
              <span>
                يوم الذروة الأسبوعي: <strong>{peak.peakDayLabel}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {subTab === 'profit_loss' && pl && (
        <div className="space-y-4">
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>بند قائمة الدخل والأرباح والخسائر (P&L)</th>
                <th className="text-left">المبلغ (ج.م)</th>
                <th className="text-center">النسبة / ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">إجمالي المبيعات قبل المرتجعات</td>
                <td className="text-left font-mono-num">{formatEGP(pl.grossSalesBeforeReturns)}</td>
                <td className="text-center text-slate-600">مبيعات خام</td>
              </tr>
              <tr>
                <td className="font-semibold">(-) مرتجعات المبيعات</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(pl.returnsTotal)}</td>
                <td className="text-center text-slate-600">{report.totals.returnedCount} فاتورة مرتجعة</td>
              </tr>
              <tr>
                <td className="font-semibold">(-) الخصومات الممنوحة للعملاء</td>
                <td className="text-left font-mono-num text-slate-700">{formatEGP(pl.discountsTotal)}</td>
                <td className="text-center text-slate-600">مخصومة من الفواتير</td>
              </tr>
              <tr className="bg-slate-50 font-bold">
                <td>(=) صافي إيرادات المبيعات</td>
                <td className="text-left font-mono-num">{formatEGP(pl.netSalesRevenue)}</td>
                <td className="text-center font-mono-num">100%</td>
              </tr>
              {canViewProfits && (
                <>
                  <tr>
                    <td className="font-semibold">(-) تكلفة البضاعة المباعة (COGS)</td>
                    <td className="text-left font-mono-num text-rose-700">-{formatEGP(pl.historicalCogs)}</td>
                    <td className="text-center text-slate-600">بتكلفة وقت البيع الفعلي</td>
                  </tr>
                  <tr className="bg-emerald-50 font-bold">
                    <td>(=) مجمل الربح (Gross Profit)</td>
                    <td className="text-left font-mono-num text-emerald-700">{formatEGP(pl.grossProfit)}</td>
                    <td className="text-center font-mono-num">{pl.grossMarginPercent}%</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">(-) عمولات البطاقات وبوابات الدفع</td>
                    <td className="text-left font-mono-num text-rose-700">-{formatEGP(pl.cardFeesTotal)}</td>
                    <td className="text-center text-slate-600">رسوم التحصيل الإلكتروني</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">(-) المصروفات التشغيلية (بدون مسحوبات الشركاء)</td>
                    <td className="text-left font-mono-num text-rose-700">-{formatEGP(pl.operatingExpensesTotal)}</td>
                    <td className="text-center text-slate-600">إيجار · رواتب · مرافق · نثرية</td>
                  </tr>
                  <tr className="bg-slate-100 font-extrabold text-sm">
                    <td>(=) صافي الربح التشغيلي القابل للتوزيع</td>
                    <td className="text-left font-mono-num text-emerald-700">{formatEGP(pl.netOperatingProfit)}</td>
                    <td className="text-center font-mono-num">{pl.netOperatingMarginPercent}%</td>
                  </tr>
                  <tr>
                    <td className="text-slate-600">مسحوبات مالك مسجلة كمصروف (بند توزيع رأس مال)</td>
                    <td className="text-left font-mono-num">{formatEGP(pl.ownerDrawingsInExpenses)}</td>
                    <td className="text-center text-slate-500">لا يخصم من ربح النشاط</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'what_if_analysis' && whatIfSummary && canViewProfits && (
        <div className="space-y-4">
          <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs flex flex-wrap justify-between gap-2 font-mono-num">
            <span>هامش الربح الإجمالي المحاكى: <strong>{whatIfSummary.inputs.targetGrossMarginPct}%</strong></span>
            <span>تغير حجم المبيعات: <strong>{whatIfSummary.inputs.salesVolumeDeltaPct >= 0 ? `+${whatIfSummary.inputs.salesVolumeDeltaPct}` : whatIfSummary.inputs.salesVolumeDeltaPct}%</strong></span>
            <span>تغير المصروفات: <strong>{whatIfSummary.inputs.opExDeltaPct >= 0 ? `+${whatIfSummary.inputs.opExDeltaPct}` : whatIfSummary.inputs.opExDeltaPct}% ({whatIfSummary.inputs.fixedOpExDeltaEgp >= 0 ? `+${whatIfSummary.inputs.fixedOpExDeltaEgp}` : whatIfSummary.inputs.fixedOpExDeltaEgp} ج.م)</strong></span>
          </div>
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>البند المالي</th>
                <th className="text-left">الوضع الفعلي</th>
                <th className="text-left">نتيجة المحاكاة</th>
                <th className="text-left">الفرق المتوقع</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">صافي إيراد المبيعات</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.baseline.revenue)}</td>
                <td className="text-left font-mono-num font-bold">{formatEGP(whatIfSummary.simulated.revenue)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.deltas.revenueDelta)}</td>
              </tr>
              <tr>
                <td className="font-semibold">(-) تكلفة البضاعة المقدرة</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.baseline.cogs)}</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.simulated.cogs)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.simulated.cogs - whatIfSummary.baseline.cogs)}</td>
              </tr>
              <tr className="bg-slate-50 font-bold">
                <td>(=) مجمل الربح التجاري ({whatIfSummary.simulated.grossMarginPct}%)</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.baseline.grossProfit)}</td>
                <td className="text-left font-mono-num text-emerald-700">{formatEGP(whatIfSummary.simulated.grossProfit)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.deltas.grossProfitDelta)}</td>
              </tr>
              <tr>
                <td className="font-semibold">(-) عمولات التحصيل الإلكتروني</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.baseline.cardFees)}</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.simulated.cardFees)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.simulated.cardFees - whatIfSummary.baseline.cardFees)}</td>
              </tr>
              <tr>
                <td className="font-semibold">(-) المصروفات التشغيلية</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.baseline.operatingExpenses)}</td>
                <td className="text-left font-mono-num text-rose-700">-{formatEGP(whatIfSummary.simulated.operatingExpenses)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.deltas.operatingExpensesDelta)}</td>
              </tr>
              <tr className="bg-slate-100 font-extrabold text-sm">
                <td>(=) صافي الربح التشغيلي المتوقع ({whatIfSummary.simulated.netMarginPct}%)</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.baseline.netOperatingProfit)}</td>
                <td className="text-left font-mono-num text-emerald-700">{formatEGP(whatIfSummary.simulated.netOperatingProfit)}</td>
                <td className="text-left font-mono-num">{formatEGP(whatIfSummary.deltas.netProfitDelta)}</td>
              </tr>
              <tr>
                <td className="font-semibold">مبيعات نقطة التعادل (Break-Even)</td>
                <td className="text-left font-mono-num">{whatIfSummary.baseline.breakEvenRevenue !== null ? formatEGP(whatIfSummary.baseline.breakEvenRevenue) : '—'}</td>
                <td className="text-left font-mono-num font-bold">{whatIfSummary.simulated.breakEvenRevenue !== null ? formatEGP(whatIfSummary.simulated.breakEvenRevenue) : 'غير متاح'}</td>
                <td className="text-left font-mono-num">—</td>
              </tr>
            </tbody>
          </table>

          {whatIfSummary.partnerImpacts.length > 0 && (
            <table className="print-table text-xs">
              <thead>
                <tr>
                  <th>الشريك</th>
                  <th className="text-center">النسبة %</th>
                  <th className="text-left">الحصة الفعلية</th>
                  <th className="text-left">الحصة المتوقعة</th>
                  <th className="text-left">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {whatIfSummary.partnerImpacts.map((p) => (
                  <tr key={p.partnerId}>
                    <td className="font-semibold">{p.partnerName}</td>
                    <td className="text-center font-mono-num">{p.sharePercent}%</td>
                    <td className="text-left font-mono-num">{formatEGP(p.baselineShare)}</td>
                    <td className="text-left font-mono-num font-bold">{formatEGP(p.simulatedShare)}</td>
                    <td className="text-left font-mono-num">{formatEGP(p.deltaShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {subTab === 'equity_partners' && eq && (
        <div className="space-y-4">
          <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs flex justify-between">
            <span>إجمالي نسب الشركاء المفعلة: <strong className="font-mono-num">{eq.totalSharePercentConfigured}%</strong></span>
            <span>صافي الربح القابل للتوزيع للفترة: <strong className="font-mono-num text-emerald-700">{canViewProfits ? formatEGP(eq.netDistributableProfit) : 'مقيد'}</strong></span>
          </div>
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>اسم الشريك</th>
                <th>الصفة</th>
                <th className="text-left">رأس المال</th>
                <th className="text-center">نسبة الربح</th>
                {canViewProfits && <th className="text-left">حصة الفترة</th>}
                <th className="text-left">المسحوبات التراكمية</th>
                {canViewProfits && <th className="text-left">صافي المستحق</th>}
              </tr>
            </thead>
            <tbody>
              {eq.rows.map((r) => (
                <tr key={r.partner.id}>
                  <td className="font-semibold">{r.partner.name}</td>
                  <td>{r.partner.roleTitle}</td>
                  <td className="text-left font-mono-num">{formatEGP(r.partner.capitalContribution)}</td>
                  <td className="text-center font-mono-num font-bold">{r.partner.profitSharePercent}%</td>
                  {canViewProfits && (
                    <td className="text-left font-mono-num font-bold text-emerald-700">
                      {formatEGP(r.periodProfitShare)}
                    </td>
                  )}
                  <td className="text-left font-mono-num text-rose-700">{formatEGP(r.allTimeDrawings)}</td>
                  {canViewProfits && (
                    <td className="text-left font-mono-num font-extrabold">{formatEGP(r.netPayableBalance)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'slow_moving' && sm && (
        <div className="space-y-4">
          <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs flex justify-between">
            <span>أصناف راكدة تماماً: <strong className="font-mono-num text-rose-700">{sm.deadStockCount}</strong></span>
            <span>أصناف بطيئة: <strong className="font-mono-num text-amber-700">{sm.slowStockCount}</strong></span>
            <span>رأس المال المجمد: <strong className="font-mono-num">{canViewProfits ? formatEGP(sm.tiedUpCapital) : 'مقيد'}</strong></span>
          </div>
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>التصنيف</th>
                <th className="text-center">ABC</th>
                <th className="text-center">الرصيد</th>
                <th className="text-center">مباع 90 يوم</th>
                <th className="text-center">أيام الركود</th>
                {canViewProfits && <th className="text-left">رأس المال المجمد</th>}
                <th className="text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {sm.rows.map((row) => (
                <tr key={row.productId}>
                  <td className="font-semibold">{row.productName}</td>
                  <td>{row.category}</td>
                  <td className="text-center font-mono-num font-bold">{row.abcClass}</td>
                  <td className="text-center font-mono-num">{formatNum(row.stockQty)} {row.unit}</td>
                  <td className="text-center font-mono-num">{formatNum(row.qtySoldLast90d)}</td>
                  <td className="text-center font-mono-num">
                    {row.daysSinceLastSale === null ? 'لم يبع' : `${row.daysSinceLastSale} يوم`}
                  </td>
                  {canViewProfits && (
                    <td className="text-left font-mono-num">{formatEGP(row.stockCostValue)}</td>
                  )}
                  <td className="text-center font-semibold">
                    {row.healthTag === 'dead'
                      ? 'راكد'
                      : row.healthTag === 'slow'
                        ? 'بطيء'
                        : row.healthTag === 'fast'
                          ? 'سريع'
                          : 'متوازن'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'custom_report' && customReport && (
        <div className="space-y-3">
          <div className="text-xs text-slate-600">{customReport.subtitle}</div>
          <table className="print-table text-xs">
            <thead>
              <tr>
                {customReport.headers.map((h, i) => (
                  <th key={`${h}-${i}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customReport.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className={typeof cell === 'number' ? 'font-mono-num text-left' : ''}>
                      {typeof cell === 'number' ? formatNum(cell) : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {customReport.totalsRow && (
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  {customReport.totalsRow.map((cell, cIdx) => (
                    <td key={cIdx} className={typeof cell === 'number' ? 'font-mono-num text-left' : ''}>
                      {typeof cell === 'number' ? formatNum(cell) : String(cell)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {subTab === 'sales_profit' && (
        <table className="print-table text-xs">
          <thead>
            <tr>
              <th>الفترة الزمنية</th>
              <th className="text-center">عدد الفواتير</th>
              <th className="text-left">إجمالي المبيعات</th>
              {canViewProfits && <th className="text-left">التكلفة التاريخية</th>}
              {canViewProfits && <th className="text-left">صافي الربح</th>}
              {canViewProfits && <th className="text-center">الهامش %</th>}
            </tr>
          </thead>
          <tbody>
            {report.periodSeries.map((row) => {
              const margin = row.revenue > 0 ? ((row.profit / row.revenue) * 100).toFixed(1) : '0';
              return (
                <tr key={row.bucket}>
                  <td className="font-semibold">{row.label}</td>
                  <td className="text-center font-mono-num">{row.invoiceCount}</td>
                  <td className="text-left font-mono-num font-semibold">{formatEGP(row.revenue)}</td>
                  {canViewProfits && (
                    <td className="text-left font-mono-num">{formatEGP(row.cost)}</td>
                  )}
                  {canViewProfits && (
                    <td className="text-left font-mono-num font-bold">{formatEGP(row.profit)}</td>
                  )}
                  {canViewProfits && <td className="text-center font-mono-num">{margin}%</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td>الإجمالي</td>
              <td className="text-center font-mono-num">{report.totals.invoiceCount}</td>
              <td className="text-left font-mono-num">{formatEGP(report.totals.revenue)}</td>
              {canViewProfits && <td className="text-left font-mono-num">{formatEGP(report.totals.cost)}</td>}
              {canViewProfits && <td className="text-left font-mono-num">{formatEGP(report.totals.profit)}</td>}
              {canViewProfits && <td className="text-center font-mono-num">{report.totals.marginPercent}%</td>}
            </tr>
          </tfoot>
        </table>
      )}

      {subTab === 'product_profit' && (
        <table className="print-table text-xs">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>النشاط</th>
              <th className="text-center">الكمية المباعة</th>
              <th className="text-left">إجمالي البيع</th>
              {canViewProfits && <th className="text-left">التكلفة التاريخية</th>}
              {canViewProfits && <th className="text-left">الربح التاريخي</th>}
              {canViewProfits && <th className="text-center">الهامش</th>}
              <th className="text-center">الشرائح السعرية</th>
            </tr>
          </thead>
          <tbody>
            {report.productProfitRows.map((row) => (
              <tr key={row.productId}>
                <td className="font-semibold">{row.productName}</td>
                <td>{activityNameMap.get(row.activityId) || row.activityId}</td>
                <td className="text-center font-mono-num">{formatNum(row.qtySold)}</td>
                <td className="text-left font-mono-num font-semibold">{formatEGP(row.revenue)}</td>
                {canViewProfits && (
                  <td className="text-left font-mono-num">{formatEGP(row.historicalCost)}</td>
                )}
                {canViewProfits && (
                  <td className="text-left font-mono-num font-bold">
                    {formatEGP(row.historicalProfit)}
                  </td>
                )}
                {canViewProfits && (
                  <td className="text-center font-mono-num">{row.marginPercent}%</td>
                )}
                <td className="text-center font-mono-num">
                  {row.priceBatchCount > 1 ? `${row.priceBatchCount} أسعار` : 'سعر ثابت'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td colSpan={2}>الإجمالي ({report.productProfitRows.length} صنف)</td>
              <td className="text-center font-mono-num">
                {formatNum(report.productProfitRows.reduce((s, r) => s + r.qtySold, 0))}
              </td>
              <td className="text-left font-mono-num">
                {formatEGP(report.productProfitRows.reduce((s, r) => s + r.revenue, 0))}
              </td>
              {canViewProfits && (
                <td className="text-left font-mono-num">
                  {formatEGP(report.productProfitRows.reduce((s, r) => s + r.historicalCost, 0))}
                </td>
              )}
              {canViewProfits && (
                <td className="text-left font-mono-num">
                  {formatEGP(report.productProfitRows.reduce((s, r) => s + r.historicalProfit, 0))}
                </td>
              )}
              {canViewProfits && <td className="text-center font-mono-num">{report.totals.marginPercent}%</td>}
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      )}

      {subTab === 'inventory_health' && (
        <table className="print-table text-xs">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>النشاط</th>
              <th className="text-center">الكمية المتاحة</th>
              <th className="text-center">أدنى / أقصى</th>
              <th className="text-center">الحالة</th>
              {canViewProfits && <th className="text-left">القيمة بالتكلفة</th>}
              <th className="text-left">القيمة بسعر البيع</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvRows.map((row) => (
              <tr key={row.product.id}>
                <td className="font-semibold">{row.product.name}</td>
                <td>{activityNameMap.get(row.product.activityId) || row.product.activityId}</td>
                <td className="text-center font-mono-num font-bold">
                  {formatNum(row.product.stockQty)} {row.product.unit}
                </td>
                <td className="text-center font-mono-num">
                  {row.product.minStockAlert} / {row.product.maxStockLimit}
                </td>
                <td className="text-center font-semibold">
                  {row.status === 'out'
                    ? 'نفذ'
                    : row.status === 'low'
                      ? 'ناقص'
                      : row.status === 'overstock'
                        ? 'فوق الحد'
                        : 'متوفر'}
                </td>
                {canViewProfits && (
                  <td className="text-left font-mono-num">{formatEGP(row.stockValueAtCost)}</td>
                )}
                <td className="text-left font-mono-num font-semibold">
                  {formatEGP(row.stockValueAtSale)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td colSpan={2}>الإجمالي ({filteredInvRows.length} صنف)</td>
              <td className="text-center font-mono-num">
                {formatNum(filteredInvRows.reduce((s, r) => s + r.product.stockQty, 0))}
              </td>
              <td colSpan={2}>—</td>
              {canViewProfits && (
                <td className="text-left font-mono-num">
                  {formatEGP(filteredInvRows.reduce((s, r) => s + r.stockValueAtCost, 0))}
                </td>
              )}
              <td className="text-left font-mono-num">
                {formatEGP(filteredInvRows.reduce((s, r) => s + r.stockValueAtSale, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {subTab === 'financial_summary' && financialSummary && (
        <table className="print-table text-xs">
          <thead>
            <tr>
              <th>البند المالي / الحساب</th>
              <th className="text-left">القيمة الحالية</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-semibold">مجمل ربح المبيعات للفترة</td>
              <td className="text-left font-mono-num font-bold">{formatEGP(report.totals.profit)}</td>
            </tr>
            <tr>
              <td className="font-semibold">إجمالي المصروفات التشغيلية</td>
              <td className="text-left font-mono-num">{formatEGP(financialSummary.totalExpenses)}</td>
            </tr>
            <tr>
              <td className="font-bold">صافي الدخل بعد المصروفات</td>
              <td className="text-left font-mono-num font-extrabold">{formatEGP(financialSummary.netIncome)}</td>
            </tr>
            <tr>
              <td className="font-semibold">مديونيات العملاء المستحقة للمتجر (لنا)</td>
              <td className="text-left font-mono-num">{formatEGP(financialSummary.customerReceivables)}</td>
            </tr>
            <tr>
              <td className="font-semibold">مستحقات الموردين على المتجر (علينا)</td>
              <td className="text-left font-mono-num">{formatEGP(financialSummary.supplierPayables)}</td>
            </tr>
            <tr>
              <td className="font-bold">إجمالي السيولة المتاحة بالخزائن المسجلة</td>
              <td className="text-left font-mono-num font-bold">{formatEGP(financialSummary.treasuriesTotal)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {subTab === 'scheduled_reports' && exec && (
        <div className="space-y-4">
          <table className="print-table text-xs">
            <thead>
              <tr>
                <th>المؤشر التنفيذي المضمن بالتقارير المجدولة</th>
                <th className="text-left">القيمة</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">صافي إيراد المبيعات ({report.totals.invoiceCount} فاتورة)</td>
                <td className="text-left font-mono-num font-bold">{formatEGP(report.totals.revenue)}</td>
              </tr>
              {canViewProfits && pl && (
                <>
                  <tr>
                    <td className="font-semibold">مجمل الربح</td>
                    <td className="text-left font-mono-num">{formatEGP(pl.grossProfit)}</td>
                  </tr>
                  <tr>
                    <td className="font-bold">صافي الربح التشغيلي</td>
                    <td className="text-left font-mono-num font-bold text-emerald-700">{formatEGP(pl.netOperatingProfit)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="font-semibold">أصناف ناقصة / نافدة بالمخزون</td>
                <td className="text-left font-mono-num">
                  {exec.businessHealth.lowStockCount} ناقص / {exec.businessHealth.outOfStockCount} نافد
                </td>
              </tr>
              <tr>
                <td className="font-semibold">السيولة المتاحة بالخزائن المسجلة</td>
                <td className="text-left font-mono-num font-bold">{formatEGP(exec.businessHealth.treasuriesTotal)}</td>
              </tr>
              <tr>
                <td className="font-semibold">مديونيات العملاء / عملاء متجاوزون للحد</td>
                <td className="text-left font-mono-num">
                  {formatEGP(exec.businessHealth.customerReceivables)} ({exec.businessHealth.overLimitCustomersCount} متجاوز)
                </td>
              </tr>
              <tr>
                <td className="font-semibold">مستحقات الموردين</td>
                <td className="text-left font-mono-num">
                  {formatEGP(exec.businessHealth.supplierPayables)} ({exec.businessHealth.suppliersWithDebtCount} مورد)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-slate-300 pt-4 text-[11px] text-slate-600 print-avoid-break">
        <div>طبع بواسطة: {printedBy} · {printedAt}</div>
        <div className="flex gap-10">
          <span>توقيع المراجع: ......................</span>
          <span>اعتماد المالك: ......................</span>
        </div>
      </footer>
    </div>
  );
}
