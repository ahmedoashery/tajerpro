import {
  Calendar,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Image as ImageIcon,
  Printer,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type {
  Customer,
  CustomReportTabularResult,
  EquityDrawing,
  EquityPartner,
  ReportsPayload,
  ReportSubTab,
  RolePermissionsMap,
  SavedCustomReportPreset,
  ScheduledReportDigest,
  StaffUser,
  StoreActivityId,
  StoreActivityProfile,
  StoreExpense,
  StoreSettings,
  Supplier,
  TreasuryAccount,
  WhatIfSimulationSummary,
} from '../shared/types';
import { exportWorkbookXlsx, type XlsxSheetInput } from '../utils/exportUtils';
import {
  downloadCsv,
  formatEGP,
  formatNum,
  getEffectivePermissions,
  PAYMENT_METHOD_LABELS,
  TREASURY_TYPE_LABELS,
} from '../utils/formatters';
import { CustomReportBuilderTab } from './reports/CustomReportBuilderTab';
import { EquityPartnersTab } from './reports/EquityPartnersTab';
import { ExecutiveOverviewTab } from './reports/ExecutiveOverviewTab';
import { ProfitLossTab } from './reports/ProfitLossTab';
import { ScheduledReportsTab } from './reports/ScheduledReportsTab';
import { SlowMovingTurnoverTab } from './reports/SlowMovingTurnoverTab';
import { WhatIfAnalysisTab } from './reports/WhatIfAnalysisTab';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';
import { SearchableSelect } from './ui/SearchableSelect';

interface ReportsViewProps {
  activities: StoreActivityProfile[];
  currentActivityId: StoreActivityId;
  settings: StoreSettings;
  currentUser: StaffUser;
  rolePermissions?: RolePermissionsMap;
  canViewProfits: boolean;
  expenses?: StoreExpense[];
  customers?: Customer[];
  suppliers?: Supplier[];
  treasuries?: TreasuryAccount[];
  equityPartners?: EquityPartner[];
  equityDrawings?: EquityDrawing[];
  customReportPresets?: SavedCustomReportPreset[];
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated?: (msg: string) => void;
  onOpenDigest?: (digest: ScheduledReportDigest) => void;
  requestedSubTab?: { tab: ReportSubTab; seq: number } | null;
}

const SUB_TABS: Array<{ id: ReportSubTab; label: string }> = [
  { id: 'executive_overview', label: 'ملخص صاحب العمل الشامل' },
  { id: 'profit_loss', label: 'الأرباح والخسائر (P&L)' },
  { id: 'what_if_analysis', label: 'محاكاة الأرباح (What-If)' },
  { id: 'equity_partners', label: 'حصص الشركاء والأرباح' },
  { id: 'sales_profit', label: 'المبيعات اليومية والشهرية' },
  { id: 'product_profit', label: 'أرباح الأصناف (بتاريخ الفاتورة)' },
  { id: 'slow_moving', label: 'الأصناف الراكدة ودوران المخزون' },
  { id: 'inventory_health', label: 'جرد وحالة المخزون' },
  { id: 'custom_report', label: 'منشئ التقارير المخصصة' },
  { id: 'financial_summary', label: 'المركز المالي والخزائن' },
  { id: 'scheduled_reports', label: 'جدولة التقارير التلقائية' },
];

export function ReportsView({
  activities,
  currentActivityId,
  settings,
  currentUser,
  rolePermissions,
  canViewProfits,
  expenses = [],
  customers = [],
  suppliers = [],
  treasuries = [],
  equityPartners = [],
  equityDrawings = [],
  customReportPresets = [],
  apiFetch,
  onMutated,
  onOpenDigest,
  requestedSubTab,
}: ReportsViewProps) {
  const { printDocument, openPrintPreview, exportDocumentAsPdf, exportDocumentAsPng, exporting } = usePrint();
  const [period, setPeriod] = useState<'daily' | 'monthly' | 'yearly'>('daily');
  const [activityFilter, setActivityFilter] = useState<StoreActivityId | 'all'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [subTab, setSubTab] = useState<ReportSubTab>('executive_overview');

  useEffect(() => {
    if (requestedSubTab?.seq) {
      setSubTab(requestedSubTab.tab);
    }
  }, [requestedSubTab]);
  const [invStatusFilter, setInvStatusFilter] = useState<'all' | 'available' | 'low' | 'overstock' | 'out'>('all');
  const [tableSearch, setTableSearch] = useState('');
  const debouncedTableSearch = useDebouncedValue(tableSearch, 200);

  const [report, setReport] = useState<ReportsPayload | null>(null);
  const [customReportResult, setCustomReportResult] = useState<CustomReportTabularResult | null>(null);
  const [whatIfSummary, setWhatIfSummary] = useState<WhatIfSimulationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectivePerms = useMemo(() => {
    if (rolePermissions) return getEffectivePermissions(currentUser, rolePermissions);
    return currentUser.effectivePermissions || null;
  }, [currentUser, rolePermissions]);

  const canManagePartnersConfig = Boolean(
    effectivePerms ? effectivePerms.manage_settings : currentUser.role === 'owner'
  );
  const canRecordDrawings = Boolean(
    effectivePerms ? effectivePerms.manage_expenses : currentUser.role !== 'cashier'
  );

  const financialSummary = useMemo(() => {
    const filteredExpenses = expenses.filter((ex) => {
      const day = ex.createdAt.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
    const totalExpenses = Number(filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(2));
    const profit = report?.totals.profit || 0;
    const netIncome =
      report?.profitLoss?.netOperatingProfit ?? Number((profit - totalExpenses).toFixed(2));
    const customerReceivables = Number(customers.reduce((s, c) => s + Number(c.balanceDue || 0), 0).toFixed(2));
    const supplierPayables = Number(suppliers.reduce((s, sup) => s + Number(sup.balanceDue || 0), 0).toFixed(2));
    const treasuriesTotal = Number(treasuries.reduce((s, t) => s + Number(t.currentBalance || 0), 0).toFixed(2));
    return {
      totalExpenses,
      netIncome,
      customerReceivables,
      supplierPayables,
      treasuriesTotal,
    };
  }, [expenses, fromDate, toDate, report?.totals.profit, report?.profitLoss?.netOperatingProfit, customers, suppliers, treasuries]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({
        period,
        activity: activityFilter,
      });
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const data = await apiFetch<ReportsPayload>(`/api/reports?${qs.toString()}`);
      setReport(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل التقارير');
    } finally {
      setLoading(false);
    }
  }, [period, activityFilter, fromDate, toDate, apiFetch]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleEquityOrPresetMutation = (msg: string) => {
    loadReports();
    onMutated?.(msg);
  };

  const activityNameMap = useMemo(
    () => new Map(activities.map((a) => [a.id, a.nameAr])),
    [activities]
  );

  const activitySelectOptions = useMemo(
    () => [
      { value: 'all', label: 'كل الأنشطة التجارية', sublabel: 'تحليل شامل للمحل' },
      {
        value: currentActivityId,
        label: `النشاط الحالي (${activityNameMap.get(currentActivityId) || currentActivityId})`,
        sublabel: 'النشاط المفعل',
      },
      ...activities
        .filter((a) => a.id !== currentActivityId)
        .map((a) => ({ value: a.id, label: a.nameAr, sublabel: a.subtitleAr })),
    ],
    [activities, currentActivityId, activityNameMap]
  );

  const handleExportCsv = () => {
    if (!report) return;
    if (subTab === 'custom_report' && customReportResult) {
      downloadCsv(
        `تقرير-مخصص-${Date.now()}.csv`,
        customReportResult.headers,
        customReportResult.rows
      );
      return;
    }
    if (subTab === 'what_if_analysis' && whatIfSummary && canViewProfits) {
      downloadCsv(
        'محاكاة-الأرباح-What-If.csv',
        ['البند المالي', 'الوضع الفعلي (ج.م)', 'نتيجة المحاكاة (ج.م)', 'الفرق (ج.م)'],
        [
          ['صافي إيراد المبيعات', whatIfSummary.baseline.revenue, whatIfSummary.simulated.revenue, whatIfSummary.deltas.revenueDelta],
          ['تكلفة البضاعة المقدرة', -whatIfSummary.baseline.cogs, -whatIfSummary.simulated.cogs, Number((whatIfSummary.simulated.cogs - whatIfSummary.baseline.cogs).toFixed(2))],
          ['مجمل الربح التجاري', whatIfSummary.baseline.grossProfit, whatIfSummary.simulated.grossProfit, whatIfSummary.deltas.grossProfitDelta],
          ['عمولات التحصيل الإلكتروني', -whatIfSummary.baseline.cardFees, -whatIfSummary.simulated.cardFees, Number((whatIfSummary.simulated.cardFees - whatIfSummary.baseline.cardFees).toFixed(2))],
          ['المصروفات التشغيلية', -whatIfSummary.baseline.operatingExpenses, -whatIfSummary.simulated.operatingExpenses, whatIfSummary.deltas.operatingExpensesDelta],
          ['صافي الربح التشغيلي', whatIfSummary.baseline.netOperatingProfit, whatIfSummary.simulated.netOperatingProfit, whatIfSummary.deltas.netProfitDelta],
          ['نقطة التعادل للمبيعات', whatIfSummary.baseline.breakEvenRevenue ?? 'غير متاح', whatIfSummary.simulated.breakEvenRevenue ?? 'غير متاح', '—'],
        ]
      );
      return;
    }
    if (subTab === 'profit_loss' && report.profitLoss) {
      const pl = report.profitLoss;
      downloadCsv(
        `قائمة-الأرباح-والخسائر.csv`,
        ['البند المحاسبي', 'القيمة (ج.م)'],
        [
          ['إجمالي المبيعات قبل المرتجعات', pl.grossSalesBeforeReturns],
          ['مرتجعات المبيعات', -pl.returnsTotal],
          ['الخصومات الممنوحة', pl.discountsTotal],
          ['صافي إيراد المبيعات', pl.netSalesRevenue],
          ...(canViewProfits
            ? [
                ['تكلفة البضاعة المباعة (COGS)', -pl.historicalCogs],
                ['مجمل الربح', pl.grossProfit],
                ['عمولات البطاقات وبوابات الدفع', -pl.cardFeesTotal],
                ['المصروفات التشغيلية', -pl.operatingExpensesTotal],
                ['صافي الربح التشغيلي', pl.netOperatingProfit],
              ]
            : []),
        ]
      );
      return;
    }
    if (subTab === 'equity_partners' && report.equityDistribution) {
      downloadCsv(
        'تقرير-حصص-الشركاء.csv',
        ['الشريك', 'الصفة', 'رأس المال', 'نسبة الربح %', ...(canViewProfits ? ['حصة الفترة'] : []), 'المسحوبات التراكمية', ...(canViewProfits ? ['صافي المستحق'] : [])],
        report.equityDistribution.rows.map((r) => [
          r.partner.name,
          r.partner.roleTitle,
          r.partner.capitalContribution,
          r.partner.profitSharePercent,
          ...(canViewProfits ? [r.periodProfitShare] : []),
          r.allTimeDrawings,
          ...(canViewProfits ? [r.netPayableBalance] : []),
        ])
      );
      return;
    }
    if (subTab === 'slow_moving' && report.slowMovingReport) {
      downloadCsv(
        'تقرير-الأصناف-الراكدة-ABC.csv',
        ['الصنف', 'التصنيف', 'ABC', 'المتاح', 'المباع 90 يوم', 'أيام منذ آخر بيع', 'الحالة'],
        report.slowMovingReport.rows.map((r) => [
          r.productName,
          r.category,
          r.abcClass,
          r.stockQty,
          r.qtySoldLast90d,
          r.daysSinceLastSale ?? 'لم يبع',
          r.healthTag,
        ])
      );
      return;
    }
    if (subTab === 'sales_profit' || subTab === 'executive_overview') {
      downloadCsv(
        `تقرير-المبيعات-${period}.csv`,
        ['الفترة', 'عدد الفواتير', 'إجمالي المبيعات (ج.م)', ...(canViewProfits ? ['التكلفة التاريخية (ج.م)', 'صافي الربح (ج.م)'] : [])],
        report.periodSeries.map((r) => [
          r.label,
          r.invoiceCount,
          r.revenue,
          ...(canViewProfits ? [r.cost, r.profit] : []),
        ])
      );
    } else if (subTab === 'product_profit') {
      downloadCsv(
        `تقرير-أرباح-الأصناف.csv`,
        ['الصنف', 'النشاط', 'الكمية المباعة', 'إجمالي البيع', ...(canViewProfits ? ['التكلفة وقت الفواتير', 'صافي الربح التاريخي', 'هامش الربح %'] : []), 'عدد الشرائح السعرية'],
        report.productProfitRows.map((p) => [
          p.productName,
          activityNameMap.get(p.activityId) || p.activityId,
          p.qtySold,
          p.revenue,
          ...(canViewProfits ? [p.historicalCost, p.historicalProfit, `${p.marginPercent}%`] : []),
          p.priceBatchCount,
        ])
      );
    } else if (subTab === 'financial_summary') {
      downloadCsv(
        'التقرير-المالي-الشامل.csv',
        ['البند المالي', 'القيمة (ج.م)'],
        [
          ['مجمل ربح المبيعات للفترة', canViewProfits ? report.totals.profit : 0],
          ['إجمالي المصروفات التشغيلية', financialSummary.totalExpenses],
          ['صافي الدخل بعد المصروفات', canViewProfits ? financialSummary.netIncome : 0],
          ['مستحقات العملاء (لنا)', financialSummary.customerReceivables],
          ['مستحقات الموردين (علينا)', financialSummary.supplierPayables],
          ['إجمالي أرصدة الخزائن المسجلة', financialSummary.treasuriesTotal],
        ]
      );
    } else {
      downloadCsv(
        `تقرير-حالة-المخزون.csv`,
        ['الصنف', 'النشاط', 'الكمية المتاحة', 'الحد الأدنى', 'الحد الأقصى', 'الحالة', 'قيمة المخزون بالتكلفة', 'القيمة بسعر البيع'],
        report.inventoryReport.rows.map((r) => [
          r.product.name,
          activityNameMap.get(r.product.activityId) || r.product.activityId,
          r.product.stockQty,
          r.product.minStockAlert,
          r.product.maxStockLimit,
          r.status === 'out'
            ? 'نفذ'
            : r.status === 'low'
              ? 'ناقص'
              : r.status === 'overstock'
                ? 'فوق الحد'
                : 'متوفر',
          canViewProfits ? r.stockValueAtCost : 0,
          r.stockValueAtSale,
        ])
      );
    }
  };

  const handleExportXlsx = () => {
    if (!report) return;
    if (subTab === 'custom_report' && customReportResult) {
      exportWorkbookXlsx(`${customReportResult.title}.xlsx`, [
        {
          name: 'التقرير_المخصص',
          title: `${settings.storeName} — ${customReportResult.title}`,
          subtitle: customReportResult.subtitle,
          headers: customReportResult.headers,
          rows: customReportResult.rows,
          totalsRow: customReportResult.totalsRow,
        },
      ]);
      return;
    }

    const periodSubtitle = `الفترة: ${fromDate || 'البداية'} ← ${toDate || 'اليوم'} | النشاط: ${
      activityFilter === 'all' ? 'كل الأنشطة' : activityNameMap.get(activityFilter) || activityFilter
    }`;

    const sheets: XlsxSheetInput[] = [];

    if (subTab === 'what_if_analysis' && whatIfSummary && canViewProfits) {
      sheets.push({
        name: 'محاكاة_الأرباح_WhatIf',
        title: `${settings.storeName} — محاكاة الأرباح والتكاليف الافتراضية (What-If)`,
        subtitle: `${periodSubtitle} | هامش محاكى: ${whatIfSummary.inputs.targetGrossMarginPct}% | تغير مبيعات: ${whatIfSummary.inputs.salesVolumeDeltaPct}% | تغير مصروفات: ${whatIfSummary.inputs.opExDeltaPct}%`,
        headers: ['البند المالي', 'الوضع الفعلي (ج.م)', 'نتيجة المحاكاة (ج.م)', 'الفرق (ج.م)'],
        rows: [
          ['صافي إيراد المبيعات', whatIfSummary.baseline.revenue, whatIfSummary.simulated.revenue, whatIfSummary.deltas.revenueDelta],
          ['(-) تكلفة البضاعة المقدرة', -whatIfSummary.baseline.cogs, -whatIfSummary.simulated.cogs, Number((whatIfSummary.simulated.cogs - whatIfSummary.baseline.cogs).toFixed(2))],
          ['(=) مجمل الربح التجاري', whatIfSummary.baseline.grossProfit, whatIfSummary.simulated.grossProfit, whatIfSummary.deltas.grossProfitDelta],
          ['(-) عمولات التحصيل الإلكتروني', -whatIfSummary.baseline.cardFees, -whatIfSummary.simulated.cardFees, Number((whatIfSummary.simulated.cardFees - whatIfSummary.baseline.cardFees).toFixed(2))],
          ['(-) المصروفات التشغيلية', -whatIfSummary.baseline.operatingExpenses, -whatIfSummary.simulated.operatingExpenses, whatIfSummary.deltas.operatingExpensesDelta],
          ['(=) صافي الربح التشغيلي', whatIfSummary.baseline.netOperatingProfit, whatIfSummary.simulated.netOperatingProfit, whatIfSummary.deltas.netProfitDelta],
          ['مبيعات نقطة التعادل', whatIfSummary.baseline.breakEvenRevenue ?? 'غير متاح', whatIfSummary.simulated.breakEvenRevenue ?? 'غير متاح', '—'],
        ],
      });
      if (whatIfSummary.partnerImpacts.length > 0) {
        sheets.push({
          name: 'تأثير_حصص_الشركاء',
          title: `${settings.storeName} — تأثير المحاكاة على حصص الشركاء`,
          subtitle: periodSubtitle,
          headers: ['الشريك', 'الصفة', 'النسبة %', 'الحصة الفعلية (ج.م)', 'الحصة المتوقعة (ج.م)', 'الفرق (ج.م)'],
          rows: whatIfSummary.partnerImpacts.map((p) => [
            p.partnerName,
            p.roleTitle,
            p.sharePercent,
            p.baselineShare,
            p.simulatedShare,
            p.deltaShare,
          ]),
        });
      }
    }

    if (report.profitLoss) {
      const pl = report.profitLoss;
      sheets.push({
        name: 'الأرباح_والخسائر_PL',
        title: `${settings.storeName} — قائمة الأرباح والخسائر التفصيلية`,
        subtitle: periodSubtitle,
        headers: ['البند المحاسبي', 'القيمة (ج.م)', 'ملاحظة'],
        rows: [
          ['إجمالي المبيعات قبل المرتجعات', pl.grossSalesBeforeReturns, 'مبيعات خام'],
          ['(-) مرتجعات المبيعات', -pl.returnsTotal, `${report.totals.returnedCount} فاتورة`],
          ['(-) الخصومات الممنوحة', pl.discountsTotal, 'خصم فواتير'],
          ['(=) صافي إيراد المبيعات', pl.netSalesRevenue, '100%'],
          ...(canViewProfits
            ? [
                ['(-) تكلفة البضاعة المباعة (COGS)', -pl.historicalCogs, 'بتكلفة وقت البيع'],
                ['(=) مجمل الربح التجاري', pl.grossProfit, `${pl.grossMarginPercent}%`],
                ['(-) عمولات البطاقات وبوابات الدفع', -pl.cardFeesTotal, 'رسوم التحصيل'],
                ['(-) المصروفات التشغيلية', -pl.operatingExpensesTotal, 'بدون مسحوبات الشركاء'],
                ['(=) صافي الربح التشغيلي القابل للتوزيع', pl.netOperatingProfit, `${pl.netOperatingMarginPercent}%`],
              ]
            : []),
        ],
      });
    }

    if (report.equityDistribution) {
      const eqRows = report.equityDistribution.rows;
      sheets.push({
        name: 'حصص_الشركاء',
        title: `${settings.storeName} — توزيع أرباح الشركاء والمسحوبات`,
        subtitle: periodSubtitle,
        headers: [
          'الشريك',
          'الصفة',
          'رأس المال المساهم',
          'النسبة %',
          ...(canViewProfits ? ['حصة ربح الفترة'] : []),
          'مسحوبات الفترة',
          'إجمالي المسحوبات التراكمية',
          ...(canViewProfits ? ['صافي المستحق للشريك'] : []),
        ],
        rows: eqRows.map((r) => [
          r.partner.name,
          r.partner.roleTitle,
          r.partner.capitalContribution,
          r.partner.profitSharePercent,
          ...(canViewProfits ? [r.periodProfitShare] : []),
          r.periodDrawings,
          r.allTimeDrawings,
          ...(canViewProfits ? [r.netPayableBalance] : []),
        ]),
        totalsRow: [
          'الإجمالي',
          `${eqRows.length} شريك`,
          Number(eqRows.reduce((s, r) => s + Number(r.partner.capitalContribution || 0), 0).toFixed(2)),
          Number(eqRows.reduce((s, r) => s + Number(r.partner.profitSharePercent || 0), 0).toFixed(2)),
          ...(canViewProfits
            ? [Number(eqRows.reduce((s, r) => s + Number(r.periodProfitShare || 0), 0).toFixed(2))]
            : []),
          Number(eqRows.reduce((s, r) => s + Number(r.periodDrawings || 0), 0).toFixed(2)),
          Number(eqRows.reduce((s, r) => s + Number(r.allTimeDrawings || 0), 0).toFixed(2)),
          ...(canViewProfits
            ? [Number(eqRows.reduce((s, r) => s + Number(r.netPayableBalance || 0), 0).toFixed(2))]
            : []),
        ],
      });
    }

    if (report.executiveSummary) {
      const pmRows = report.executiveSummary.byPaymentMethod;
      sheets.push({
        name: 'طرق_الدفع_والتحصيل',
        title: `${settings.storeName} — توزيع المبيعات حسب طرق الدفع`,
        subtitle: periodSubtitle,
        headers: ['طريقة الدفع', 'عدد العمليات', 'إجمالي التحصيل (ج.م)', 'النسبة %'],
        rows: pmRows.map((pm) => [
          PAYMENT_METHOD_LABELS[pm.method] || pm.method,
          pm.count,
          pm.total,
          pm.percent,
        ]),
        totalsRow: [
          'الإجمالي',
          pmRows.reduce((s, pm) => s + Number(pm.count || 0), 0),
          Number(pmRows.reduce((s, pm) => s + Number(pm.total || 0), 0).toFixed(2)),
          Number(pmRows.reduce((s, pm) => s + Number(pm.percent || 0), 0).toFixed(1)),
        ],
      });
    }

    sheets.push({
      name: 'المبيعات_والأرباح',
      title: `${settings.storeName} — المبيعات والأرباح حسب الفترة`,
      subtitle: periodSubtitle,
      headers: ['الفترة', 'عدد الفواتير', 'إجمالي المبيعات', ...(canViewProfits ? ['التكلفة التاريخية', 'صافي الربح'] : [])],
      rows: report.periodSeries.map((r) => [
        r.label,
        r.invoiceCount,
        r.revenue,
        ...(canViewProfits ? [r.cost, r.profit] : []),
      ]),
      totalsRow: [
        'الإجمالي',
        report.totals.invoiceCount,
        report.totals.revenue,
        ...(canViewProfits ? [report.totals.cost, report.totals.profit] : []),
      ],
    });

    const prodRows = report.productProfitRows;
    const sumProdRev = Number(prodRows.reduce((s, p) => s + Number(p.revenue || 0), 0).toFixed(2));
    const sumProdCost = Number(prodRows.reduce((s, p) => s + Number(p.historicalCost || 0), 0).toFixed(2));
    const sumProdProfit = Number(prodRows.reduce((s, p) => s + Number(p.historicalProfit || 0), 0).toFixed(2));
    sheets.push({
      name: 'أرباح_الأصناف',
      title: `${settings.storeName} — تقرير أرباح الأصناف التفصيلي`,
      subtitle: periodSubtitle,
      headers: [
        'الصنف',
        'النشاط',
        'الكمية المباعة',
        'إجمالي البيع',
        ...(canViewProfits ? ['التكلفة التاريخية', 'الربح التاريخي', 'الهامش %'] : []),
      ],
      rows: prodRows.map((p) => [
        p.productName,
        activityNameMap.get(p.activityId) || p.activityId,
        p.qtySold,
        p.revenue,
        ...(canViewProfits ? [p.historicalCost, p.historicalProfit, p.marginPercent] : []),
      ]),
      totalsRow: [
        'الإجمالي',
        `${prodRows.length} صنف`,
        Number(prodRows.reduce((s, p) => s + Number(p.qtySold || 0), 0).toFixed(2)),
        sumProdRev,
        ...(canViewProfits
          ? [
              sumProdCost,
              sumProdProfit,
              sumProdRev > 0 ? Number(((sumProdProfit / sumProdRev) * 100).toFixed(1)) : 0,
            ]
          : []),
      ],
    });

    if (report.slowMovingReport) {
      const smRows = report.slowMovingReport.rows;
      sheets.push({
        name: 'الأصناف_الراكدة_ABC',
        title: `${settings.storeName} — تحليل دوران المخزون والأصناف الراكدة`,
        subtitle: periodSubtitle,
        headers: ['الصنف', 'القسم', 'تصنيف ABC', 'المتاح', 'مباع 90 يوم', 'معدل الدوران', 'أيام الركود', ...(canViewProfits ? ['رأس المال المجمد'] : []), 'الحالة'],
        rows: smRows.map((r) => [
          r.productName,
          r.category,
          r.abcClass,
          r.stockQty,
          r.qtySoldLast90d,
          r.turnoverRate,
          r.daysSinceLastSale ?? 'لم يبع',
          ...(canViewProfits ? [r.stockCostValue] : []),
          r.healthTag === 'dead' ? 'راكد' : r.healthTag === 'slow' ? 'بطيء' : r.healthTag === 'fast' ? 'سريع' : 'متوازن',
        ]),
        totalsRow: [
          'الإجمالي',
          `${smRows.length} صنف`,
          '',
          Number(smRows.reduce((s, r) => s + Number(r.stockQty || 0), 0).toFixed(2)),
          Number(smRows.reduce((s, r) => s + Number(r.qtySoldLast90d || 0), 0).toFixed(2)),
          '',
          '',
          ...(canViewProfits
            ? [Number(smRows.reduce((s, r) => s + Number(r.stockCostValue || 0), 0).toFixed(2))]
            : []),
          '',
        ],
      });
    }

    const invRows = report.inventoryReport.rows;
    sheets.push({
      name: 'جرد_المخزون',
      title: `${settings.storeName} — حالة وتقييم المخزون`,
      subtitle: periodSubtitle,
      headers: ['الصنف', 'النشاط', 'الكمية المتاحة', 'الحالة', ...(canViewProfits ? ['القيمة بالتكلفة'] : []), 'القيمة بسعر البيع'],
      rows: invRows.map((r) => [
        r.product.name,
        activityNameMap.get(r.product.activityId) || r.product.activityId,
        r.product.stockQty,
        r.status === 'out' ? 'نفذ' : r.status === 'low' ? 'ناقص' : r.status === 'overstock' ? 'فوق الحد' : 'متوفر',
        ...(canViewProfits ? [r.stockValueAtCost] : []),
        r.stockValueAtSale,
      ]),
      totalsRow: [
        'الإجمالي',
        `${invRows.length} صنف`,
        Number(invRows.reduce((s, r) => s + Number(r.product.stockQty || 0), 0).toFixed(2)),
        '',
        ...(canViewProfits
          ? [Number(invRows.reduce((s, r) => s + Number(r.stockValueAtCost || 0), 0).toFixed(2))]
          : []),
        Number(invRows.reduce((s, r) => s + Number(r.stockValueAtSale || 0), 0).toFixed(2)),
      ],
    });

    sheets.push({
      name: 'الملخص_المالي',
      title: `${settings.storeName} — الملخص المالي وأرصدة الخزائن`,
      subtitle: periodSubtitle,
      headers: ['البند', 'القيمة (ج.م)'],
      rows: [
        ['إجمالي المبيعات', report.totals.revenue],
        ['مجمل الربح', canViewProfits ? report.totals.profit : 0],
        ['المصروفات التشغيلية', financialSummary.totalExpenses],
        ['صافي الدخل', canViewProfits ? financialSummary.netIncome : 0],
        ['مديونيات العملاء', financialSummary.customerReceivables],
        ['مستحقات الموردين', financialSummary.supplierPayables],
        ['سيولة الخزائن المسجلة', financialSummary.treasuriesTotal],
      ],
    });

    exportWorkbookXlsx(`تقارير-تاجر-برو-${period}.xlsx`, sheets);
  };

  const buildReportPrintPayload = () =>
    report
      ? ({
          kind: 'report',
          report,
          subTab,
          invStatusFilter,
          canViewProfits,
          settings,
          activities,
          printedBy: currentUser.name,
          financialSummary,
          customReport: customReportResult || undefined,
          whatIfSummary: whatIfSummary || undefined,
        } as const)
      : null;

  const maxBucketRev = Math.max(100, ...(report?.periodSeries.map((b) => b.revenue) || [100]));

  type ProfitRow = ReportsPayload['productProfitRows'][number];
  type InvHealthRow = ReportsPayload['inventoryReport']['rows'][number];

  const baseProfitRows = useMemo(() => {
    const rows = report?.productProfitRows || [];
    const q = debouncedTableSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        (activityNameMap.get(r.activityId) || '').toLowerCase().includes(q)
    );
  }, [report?.productProfitRows, debouncedTableSearch, activityNameMap]);

  const profitColumns: ExcelColumnDef<ProfitRow>[] = useMemo(
    () => [
      { key: 'productName', label: 'الصنف', getValue: (r) => r.productName },
      {
        key: 'activityId',
        label: 'النشاط',
        getValue: (r) => activityNameMap.get(r.activityId) || r.activityId,
      },
      {
        key: 'qtySold',
        label: 'الكمية المباعة',
        getValue: (r) => formatNum(r.qtySold),
        getSortValue: (r) => r.qtySold,
      },
      {
        key: 'revenue',
        label: 'إجمالي البيع',
        getValue: (r) => formatEGP(r.revenue),
        getSortValue: (r) => r.revenue,
      },
      {
        key: 'priceBatchCount',
        label: 'الشرائح السعرية',
        getValue: (r) => (r.priceBatchCount > 1 ? `${r.priceBatchCount} أسعار` : 'سعر واحد'),
        getSortValue: (r) => r.priceBatchCount,
      },
    ],
    [activityNameMap]
  );

  const profitExcel = useExcelTableFilter(baseProfitRows, profitColumns);
  const profitScroll = useInfiniteScroll(profitExcel.filteredRows, {
    batchSize: 15,
    resetKey: `profit-${debouncedTableSearch}-${profitExcel.activeFilterKeys.join(',')}-${profitExcel.sortState.columnKey}-${profitExcel.sortState.direction}`,
  });

  const baseInvRows = useMemo(() => {
    const rows = (report?.inventoryReport.rows || []).filter(
      (r) => invStatusFilter === 'all' || r.status === invStatusFilter
    );
    const q = debouncedTableSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.product.name.toLowerCase().includes(q) ||
        r.product.barcode.toLowerCase().includes(q) ||
        (activityNameMap.get(r.product.activityId) || '').toLowerCase().includes(q)
    );
  }, [report?.inventoryReport.rows, invStatusFilter, debouncedTableSearch, activityNameMap]);

  const invStatusLabel = (st: InvHealthRow['status']) =>
    st === 'out' ? 'نفذ' : st === 'low' ? 'ناقص' : st === 'overstock' ? 'فوق الحد' : 'متوفر';

  const invColumns: ExcelColumnDef<InvHealthRow>[] = useMemo(
    () => [
      { key: 'productName', label: 'الصنف', getValue: (r) => r.product.name },
      {
        key: 'activityId',
        label: 'النشاط',
        getValue: (r) => activityNameMap.get(r.product.activityId) || r.product.activityId,
      },
      {
        key: 'stockQty',
        label: 'المتاح حالياً',
        getValue: (r) => `${formatNum(r.product.stockQty)} ${r.product.unit}`,
        getSortValue: (r) => r.product.stockQty,
      },
      { key: 'status', label: 'حالة المخزون', getValue: (r) => invStatusLabel(r.status) },
      {
        key: 'stockValueAtSale',
        label: 'القيمة بسعر البيع',
        getValue: (r) => formatEGP(r.stockValueAtSale),
        getSortValue: (r) => r.stockValueAtSale,
      },
    ],
    [activityNameMap]
  );

  const invExcel = useExcelTableFilter(baseInvRows, invColumns);
  const invScroll = useInfiniteScroll(invExcel.filteredRows, {
    batchSize: 15,
    resetKey: `inv-${invStatusFilter}-${debouncedTableSearch}-${invExcel.activeFilterKeys.join(',')}-${invExcel.sortState.columnKey}-${invExcel.sortState.direction}`,
  });

  return (
    <div className="space-y-5">
      {/* Filter & Export Header */}
      <section className="no-print rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  ['daily', 'يومي'],
                  ['monthly', 'شهري'],
                  ['yearly', 'سنوي'],
                ] as const
              ).map(([pId, pLabel]) => (
                <button
                  key={pId}
                  type="button"
                  onClick={() => setPeriod(pId)}
                  className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    period === pId
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  {pLabel}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[230px]">
              <Filter className="h-4 w-4 text-slate-400 shrink-0" />
              <div className="flex-1">
                <SearchableSelect
                  value={activityFilter}
                  onChange={(val) => setActivityFilter(val as StoreActivityId | 'all')}
                  options={activitySelectOptions}
                  searchPlaceholder="ابحث في الأنشطة..."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
              <Calendar className="h-4 w-4 text-slate-400 hidden sm:inline" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="من تاريخ"
                className="flex-1 sm:flex-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <span className="text-slate-400">إلى</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="إلى تاريخ"
                className="flex-1 sm:flex-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              {(
                [
                  ['today', 'اليوم'],
                  ['7d', '7 أيام'],
                  ['month', 'هذا الشهر'],
                  ['prev_month', 'الشهر الماضي'],
                ] as const
              ).map(([preset, lbl]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const fmt = (d: Date) =>
                      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                        d.getDate()
                      ).padStart(2, '0')}`;
                    if (preset === 'today') {
                      const t = fmt(now);
                      setFromDate(t);
                      setToDate(t);
                    } else if (preset === '7d') {
                      const s = new Date(now);
                      s.setDate(now.getDate() - 6);
                      setFromDate(fmt(s));
                      setToDate(fmt(now));
                    } else if (preset === 'month') {
                      setFromDate(fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
                      setToDate(fmt(now));
                    } else {
                      const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
                      setFromDate(fmt(firstPrev));
                      setToDate(fmt(lastPrev));
                    }
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {lbl}
                </button>
              ))}
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                >
                  الكل
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadReports}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const payload = buildReportPrintPayload();
                if (payload) openPrintPreview(payload);
              }}
              disabled={!report || (subTab === 'custom_report' && !customReportResult)}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>معاينة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const payload = buildReportPrintPayload();
                if (payload) printDocument(payload);
              }}
              disabled={!report || (subTab === 'custom_report' && !customReportResult)}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>طباعة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const payload = buildReportPrintPayload();
                if (payload) exportDocumentAsPdf(payload, `تقرير-${subTab}-${period}.pdf`);
              }}
              disabled={!report || exporting || (subTab === 'custom_report' && !customReportResult)}
              className="flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              <span>{exporting ? '...' : 'PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const payload = buildReportPrintPayload();
                if (payload) exportDocumentAsPng(payload, `تقرير-${subTab}-${period}.png`);
              }}
              disabled={!report || exporting || (subTab === 'custom_report' && !customReportResult)}
              className="flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>PNG</span>
            </button>
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={!report}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>XLSX</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!report}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Sub-Report Tabs — horizontally scrollable on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-slate-100 pt-3 dark:border-slate-800">
          {SUB_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                subTab === id
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      {loading && !report && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          جاري إعداد التقارير وتحليل البيانات المالية...
        </div>
      )}

      {report && (
        <>
          {/* Shared Period Summary KPI Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">إجمالي المبيعات في الفترة</div>
                {report.periodComparison && report.periodComparison.revenueDeltaPercent !== null && (
                  <span
                    className={`font-mono-num text-[11px] font-bold ${
                      report.periodComparison.revenueDeltaPercent >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {report.periodComparison.revenueDeltaPercent >= 0 ? '+' : ''}
                    {report.periodComparison.revenueDeltaPercent}% عن السابقة
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {formatEGP(report.totals.revenue)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                <span className="font-mono-num">{report.totals.invoiceCount}</span> فاتورة مباعة
                {report.periodComparison && report.periodComparison.invoiceCountDeltaPercent !== null && (
                  <span
                    className={`font-mono-num mr-1 ${
                      report.periodComparison.invoiceCountDeltaPercent >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    ({report.periodComparison.invoiceCountDeltaPercent >= 0 ? '+' : ''}
                    {report.periodComparison.invoiceCountDeltaPercent}%)
                  </span>
                )}{' '}
                · <span className="font-mono-num">{report.totals.returnedCount}</span> مرتجع
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">تكلفة البضاعة المباعة (وقت الفاتورة)</div>
              <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
                {canViewProfits ? formatEGP(report.totals.cost) : 'مقيد حسب الصلاحية'}
              </div>
              <div className="mt-1 text-xs text-slate-500">محسوبة بتكلفة كل فاتورة يوم صدورها</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">مجمل الربح المحقق</div>
                {canViewProfits &&
                  report.periodComparison &&
                  report.periodComparison.profitDeltaPercent !== null && (
                    <span
                      className={`font-mono-num text-[11px] font-bold ${
                        report.periodComparison.profitDeltaPercent >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {report.periodComparison.profitDeltaPercent >= 0 ? '+' : ''}
                      {report.periodComparison.profitDeltaPercent}% عن السابقة
                    </span>
                  )}
              </div>
              <div className="mt-1 font-mono-num text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {canViewProfits ? formatEGP(report.totals.profit) : 'مقيد حسب الصلاحية'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                هامش الربح الإجمالي:{' '}
                <span className="font-mono-num">{canViewProfits ? `${report.totals.marginPercent}%` : '—'}</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">ملخص صحة المخزون</div>
              <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white space-x-2 space-x-reverse">
                <span className="text-emerald-600">{report.inventoryReport.counts.available} متوفر</span>
                <span>·</span>
                <span className="text-amber-600">{report.inventoryReport.counts.low} ناقص</span>
                <span>·</span>
                <span className="text-sky-600">{report.inventoryReport.counts.overstock} فوق الحد</span>
              </div>
              <div className="mt-1 text-xs text-rose-600 font-mono-num">
                {report.inventoryReport.counts.out} أصناف نفذت بالكامل
              </div>
            </div>
          </div>

          {subTab === 'executive_overview' && (
            <ExecutiveOverviewTab
              report={report}
              activities={activities}
              canViewProfits={canViewProfits}
            />
          )}

          {subTab === 'profit_loss' && (
            <ProfitLossTab report={report} canViewProfits={canViewProfits} />
          )}

          {subTab === 'what_if_analysis' && (
            <WhatIfAnalysisTab
              report={report}
              canViewProfits={canViewProfits}
              onSimulationChange={setWhatIfSummary}
            />
          )}

          {subTab === 'equity_partners' && (
            <EquityPartnersTab
              report={report}
              equityPartners={equityPartners}
              equityDrawings={equityDrawings}
              treasuries={treasuries}
              settings={settings}
              printedBy={currentUser.name}
              canViewProfits={canViewProfits}
              canManagePartnersConfig={canManagePartnersConfig}
              canRecordDrawings={canRecordDrawings}
              apiFetch={apiFetch}
              onMutated={handleEquityOrPresetMutation}
            />
          )}

          {subTab === 'slow_moving' && (
            <SlowMovingTurnoverTab
              report={report}
              activities={activities}
              canViewProfits={canViewProfits}
            />
          )}

          {subTab === 'custom_report' && (
            <CustomReportBuilderTab
              presets={customReportPresets}
              dateFrom={fromDate}
              dateTo={toDate}
              activityFilter={activityFilter}
              canViewProfits={canViewProfits}
              apiFetch={apiFetch}
              onResultChange={setCustomReportResult}
              onPresetsUpdated={handleEquityOrPresetMutation}
            />
          )}

          {subTab === 'scheduled_reports' && (
            <ScheduledReportsTab
              activities={activities}
              canManageSettings={canManagePartnersConfig}
              canViewProfits={canViewProfits}
              apiFetch={apiFetch}
              onOpenDigest={(digest) => onOpenDigest?.(digest)}
              onMutated={handleEquityOrPresetMutation}
            />
          )}

          {subTab === 'sales_profit' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-4">
                  مقارنة المبيعات والأرباح ({period === 'daily' ? 'يوم بيوم' : period === 'monthly' ? 'شهر بشهر' : 'سنة بسنة'})
                </h3>
                {report.periodSeries.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500">
                    لا توجد فواتير مطابقة لنطاق التاريخ أو النشاط المختار.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {report.periodSeries.map((row) => {
                      const revPct = Math.max(4, Math.round((row.revenue / maxBucketRev) * 100));
                      const profPct =
                        row.revenue > 0 ? Math.max(2, Math.round((row.profit / maxBucketRev) * 100)) : 0;
                      return (
                        <div key={row.bucket} className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {row.label} ({row.invoiceCount} فاتورة)
                            </span>
                            <span className="font-mono-num text-slate-600 dark:text-slate-300">
                              مبيعات: <strong>{formatEGP(row.revenue)}</strong>
                              {canViewProfits && (
                                <>
                                  {' · '}ربح:{' '}
                                  <strong className="text-emerald-600 dark:text-emerald-400">
                                    {formatEGP(row.profit)}
                                  </strong>
                                </>
                              )}
                            </span>
                          </div>
                          <div className="h-3 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800 flex">
                            <div
                              className="h-full bg-slate-400 dark:bg-slate-600"
                              style={{ width: `${revPct}%` }}
                            />
                          </div>
                          {canViewProfits && (
                            <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800 flex">
                              <div
                                className="h-full bg-emerald-600 dark:bg-emerald-500"
                                style={{ width: `${profPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {subTab === 'product_profit' && (
            <div className="space-y-3">
              <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="بحث فوري في أرباح الأصناف..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      onClick={() => setTableSearch('')}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  يحسب الربح بتاريخ الفاتورة دون تأثر بتغييرات الأسعار اللاحقة
                </div>
              </div>

              <ActiveExcelFiltersBar
                columns={profitColumns}
                activeFilterKeys={profitExcel.activeFilterKeys}
                sortState={profitExcel.sortState}
                totalBefore={baseProfitRows.length}
                totalAfter={profitExcel.filteredRows.length}
                onClearOne={(k) => profitExcel.applyColumnFilter(k, null)}
                onClearAll={profitExcel.clearAllFilters}
              />

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="productName"
                            label="الصنف"
                            options={profitExcel.getColumnOptions('productName')}
                            activeFilterValues={profitExcel.columnFilters['productName']}
                            sortDirection={
                              profitExcel.sortState.columnKey === 'productName'
                                ? profitExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => profitExcel.applyColumnFilter('productName', v)}
                            onSort={(d) => profitExcel.setColumnSort('productName', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="activityId"
                            label="النشاط"
                            options={profitExcel.getColumnOptions('activityId')}
                            activeFilterValues={profitExcel.columnFilters['activityId']}
                            sortDirection={
                              profitExcel.sortState.columnKey === 'activityId'
                                ? profitExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => profitExcel.applyColumnFilter('activityId', v)}
                            onSort={(d) => profitExcel.setColumnSort('activityId', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="qtySold"
                            label="الكمية المباعة"
                            options={profitExcel.getColumnOptions('qtySold')}
                            activeFilterValues={profitExcel.columnFilters['qtySold']}
                            sortDirection={
                              profitExcel.sortState.columnKey === 'qtySold'
                                ? profitExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => profitExcel.applyColumnFilter('qtySold', v)}
                            onSort={(d) => profitExcel.setColumnSort('qtySold', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="revenue"
                            label="إجمالي البيع"
                            options={profitExcel.getColumnOptions('revenue')}
                            activeFilterValues={profitExcel.columnFilters['revenue']}
                            sortDirection={
                              profitExcel.sortState.columnKey === 'revenue'
                                ? profitExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => profitExcel.applyColumnFilter('revenue', v)}
                            onSort={(d) => profitExcel.setColumnSort('revenue', d)}
                          />
                        </th>
                        {canViewProfits && <th className="px-4 py-3">التكلفة التاريخية</th>}
                        {canViewProfits && <th className="px-4 py-3">صافي الربح التاريخي</th>}
                        {canViewProfits && <th className="px-4 py-3">الهامش</th>}
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="priceBatchCount"
                            label="الشرائح السعرية"
                            options={profitExcel.getColumnOptions('priceBatchCount')}
                            activeFilterValues={profitExcel.columnFilters['priceBatchCount']}
                            sortDirection={
                              profitExcel.sortState.columnKey === 'priceBatchCount'
                                ? profitExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => profitExcel.applyColumnFilter('priceBatchCount', v)}
                            onSort={(d) => profitExcel.setColumnSort('priceBatchCount', d)}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {profitScroll.visibleItems.map((row) => (
                        <tr key={row.productId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                            {row.productName}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {activityNameMap.get(row.activityId) || row.activityId}
                          </td>
                          <td className="px-4 py-3 font-mono-num">{formatNum(row.qtySold)}</td>
                          <td className="px-4 py-3 font-mono-num font-semibold">{formatEGP(row.revenue)}</td>
                          {canViewProfits && (
                            <td className="px-4 py-3 font-mono-num text-slate-600 dark:text-slate-400">
                              {formatEGP(row.historicalCost)}
                            </td>
                          )}
                          {canViewProfits && (
                            <td className="px-4 py-3 font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                              +{formatEGP(row.historicalProfit)}
                            </td>
                          )}
                          {canViewProfits && (
                            <td className="px-4 py-3 font-mono-num text-xs">{row.marginPercent}%</td>
                          )}
                          <td className="px-4 py-3 text-xs">
                            {row.priceBatchCount > 1 ? (
                              <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono-num">
                                {row.priceBatchCount} أسعار مختلفة تاريخياً
                              </span>
                            ) : (
                              <span className="text-slate-500 font-mono-num">سعر واحد ثابت</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <InfiniteTableFooter
                  visibleCount={profitScroll.visibleCount}
                  totalCount={profitScroll.totalCount}
                  hasMore={profitScroll.hasMore}
                  onLoadMore={profitScroll.loadMore}
                  sentinelRef={profitScroll.sentinelRef}
                />
              </div>
            </div>
          )}

          {subTab === 'inventory_health' && (
            <div className="space-y-4">
              <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['all', `الكل (${report.inventoryReport.rows.length})`],
                      ['available', `متوفر (${report.inventoryReport.counts.available})`],
                      ['low', `ناقص (${report.inventoryReport.counts.low})`],
                      ['overstock', `فوق الحد (${report.inventoryReport.counts.overstock})`],
                      ['out', `نفذ (${report.inventoryReport.counts.out})`],
                    ] as const
                  ).map(([stId, stLabel]) => (
                    <button
                      key={stId}
                      type="button"
                      onClick={() => setInvStatusFilter(stId)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        invStatusFilter === stId
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {stLabel}
                    </button>
                  ))}
                </div>

                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="بحث في أصناف المخزون..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-7 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      onClick={() => setTableSearch('')}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <ActiveExcelFiltersBar
                columns={invColumns}
                activeFilterKeys={invExcel.activeFilterKeys}
                sortState={invExcel.sortState}
                totalBefore={baseInvRows.length}
                totalAfter={invExcel.filteredRows.length}
                onClearOne={(k) => invExcel.applyColumnFilter(k, null)}
                onClearAll={invExcel.clearAllFilters}
              />

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="productName"
                            label="الصنف"
                            options={invExcel.getColumnOptions('productName')}
                            activeFilterValues={invExcel.columnFilters['productName']}
                            sortDirection={
                              invExcel.sortState.columnKey === 'productName'
                                ? invExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => invExcel.applyColumnFilter('productName', v)}
                            onSort={(d) => invExcel.setColumnSort('productName', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="activityId"
                            label="النشاط"
                            options={invExcel.getColumnOptions('activityId')}
                            activeFilterValues={invExcel.columnFilters['activityId']}
                            sortDirection={
                              invExcel.sortState.columnKey === 'activityId'
                                ? invExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => invExcel.applyColumnFilter('activityId', v)}
                            onSort={(d) => invExcel.setColumnSort('activityId', d)}
                          />
                        </th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="stockQty"
                            label="المتاح حالياً"
                            options={invExcel.getColumnOptions('stockQty')}
                            activeFilterValues={invExcel.columnFilters['stockQty']}
                            sortDirection={
                              invExcel.sortState.columnKey === 'stockQty'
                                ? invExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => invExcel.applyColumnFilter('stockQty', v)}
                            onSort={(d) => invExcel.setColumnSort('stockQty', d)}
                          />
                        </th>
                        <th className="px-4 py-3">الحد الأدنى / الأقصى</th>
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="status"
                            label="حالة المخزون"
                            options={invExcel.getColumnOptions('status')}
                            activeFilterValues={invExcel.columnFilters['status']}
                            sortDirection={
                              invExcel.sortState.columnKey === 'status'
                                ? invExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => invExcel.applyColumnFilter('status', v)}
                            onSort={(d) => invExcel.setColumnSort('status', d)}
                          />
                        </th>
                        {canViewProfits && <th className="px-4 py-3">قيمة البضاعة بالتكلفة</th>}
                        <th className="px-4 py-3">
                          <ExcelColumnHeader
                            columnKey="stockValueAtSale"
                            label="القيمة بسعر البيع"
                            options={invExcel.getColumnOptions('stockValueAtSale')}
                            activeFilterValues={invExcel.columnFilters['stockValueAtSale']}
                            sortDirection={
                              invExcel.sortState.columnKey === 'stockValueAtSale'
                                ? invExcel.sortState.direction
                                : null
                            }
                            onApplyFilter={(v) => invExcel.applyColumnFilter('stockValueAtSale', v)}
                            onSort={(d) => invExcel.setColumnSort('stockValueAtSale', d)}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {invScroll.visibleItems.map((row) => (
                        <tr key={row.product.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                            {row.product.name}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {activityNameMap.get(row.product.activityId) || row.product.activityId}
                          </td>
                          <td className="px-4 py-3 font-mono-num font-bold">
                            {formatNum(row.product.stockQty)} {row.product.unit}
                          </td>
                          <td className="px-4 py-3 font-mono-num text-xs text-slate-500">
                            أدنى {row.product.minStockAlert} / أقصى {row.product.maxStockLimit}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            {row.status === 'out' && <span className="text-rose-600">نفذ</span>}
                            {row.status === 'low' && <span className="text-amber-600">ناقص</span>}
                            {row.status === 'overstock' && <span className="text-sky-600">فوق الحد</span>}
                            {row.status === 'available' && <span className="text-emerald-600">متوفر</span>}
                          </td>
                          {canViewProfits && (
                            <td className="px-4 py-3 font-mono-num">{formatEGP(row.stockValueAtCost)}</td>
                          )}
                          <td className="px-4 py-3 font-mono-num font-semibold text-slate-900 dark:text-white">
                            {formatEGP(row.stockValueAtSale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <InfiniteTableFooter
                  visibleCount={invScroll.visibleCount}
                  totalCount={invScroll.totalCount}
                  hasMore={invScroll.hasMore}
                  onLoadMore={invScroll.loadMore}
                  sentinelRef={invScroll.sentinelRef}
                />
              </div>
            </div>
          )}

          {subTab === 'financial_summary' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  ملخص قائمة الدخل والمركز المالي
                </h3>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-600 dark:text-slate-300">إجمالي مبيعات الفترة</span>
                    <span className="font-mono-num font-bold">{formatEGP(report.totals.revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-600 dark:text-slate-300">مجمل ربح المبيعات</span>
                    <span className="font-mono-num font-bold text-emerald-600">
                      {canViewProfits ? formatEGP(report.totals.profit) : 'مقيد بالصلاحية'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-600 dark:text-slate-300">(-) المصروفات التشغيلية بالفترة</span>
                    <span className="font-mono-num font-bold text-rose-600">
                      {formatEGP(financialSummary.totalExpenses)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 text-sm font-bold">
                    <span>صافي الدخل التشغيلي</span>
                    <span
                      className={`font-mono-num ${
                        financialSummary.netIncome >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {canViewProfits ? formatEGP(financialSummary.netIncome) : 'مقيد بالصلاحية'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-600 dark:text-slate-300">ذمم العملاء (مستحقات لنا)</span>
                    <span className="font-mono-num font-semibold text-amber-600">
                      {formatEGP(financialSummary.customerReceivables)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-slate-600 dark:text-slate-300">مستحقات الموردين (التزامات علينا)</span>
                    <span className="font-mono-num font-semibold text-rose-600">
                      {formatEGP(financialSummary.supplierPayables)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    أرصدة الخزائن والحسابات المسجلة
                  </h3>
                  <span className="font-mono-num text-sm font-bold text-emerald-600">
                    {formatEGP(financialSummary.treasuriesTotal)}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {treasuries.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{t.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {TREASURY_TYPE_LABELS[t.type]}
                          {t.accountNumber ? ` · ${t.accountNumber}` : ''}
                        </div>
                      </div>
                      <div className="font-mono-num font-bold text-slate-900 dark:text-white">
                        {formatEGP(t.currentBalance)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
