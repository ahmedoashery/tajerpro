import {
  Calendar,
  Edit3,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Plus,
  Printer,
  Search,
  Table as TableIcon,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePrint } from '../context/PrintContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type {
  DashboardSummary,
  DocumentTemplateArtifact,
  ExpenseCategory,
  RecurringExpense,
  StaffUser,
  StoreExpense,
  StoreSettings,
  TreasuryAccount,
} from '../shared/types';
import { exportWorkbookXlsx } from '../utils/exportUtils';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SOURCE_LABELS,
  formatDateTimeAr,
  formatEGP,
  TREASURY_TYPE_LABELS,
} from '../utils/formatters';
import { ExpenseEditModal } from './expenses/ExpenseEditModal';
import { RecurringExpensesPanel } from './expenses/RecurringExpensesPanel';
import {
  ActiveExcelFiltersBar,
  type ExcelColumnDef,
  ExcelColumnHeader,
  InfiniteTableFooter,
  useExcelTableFilter,
} from './ui/ExcelColumnFilter';
import { SearchableSelect } from './ui/SearchableSelect';

interface ExpensesViewProps {
  expenses: StoreExpense[];
  recurringExpenses?: RecurringExpense[];
  treasuries?: TreasuryAccount[];
  templates?: DocumentTemplateArtifact[];
  dashboard: DashboardSummary;
  settings: StoreSettings;
  currentUser: StaffUser;
  canManageExpenses: boolean;
  canViewProfits: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
}

const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

const EXPENSE_PRESETS: Array<{ title: string; category: ExpenseCategory }> = [
  { title: 'فاتورة كهرباء ومرافق', category: 'utilities' },
  { title: 'إيجار المحل', category: 'rent' },
  { title: 'رواتب ويوميات', category: 'salaries' },
  { title: 'نقل ومشال بضاعة', category: 'shipping' },
  { title: 'أكياس وتغليف ومستلزمات', category: 'misc' },
  { title: 'صيانة وإصلاحات', category: 'maintenance' },
  { title: 'ضرائب ورسوم حكومية', category: 'taxes' },
  { title: 'مسحوبات المالك', category: 'owner_draw' },
];

type PeriodPreset = 'all' | 'today' | '7days' | 'month';

function sourceFromTreasury(t?: TreasuryAccount): 'cash_drawer' | 'bank_instapay' | 'wallet' {
  if (!t) return 'cash_drawer';
  if (t.type === 'instapay' || t.type === 'bank_pos') return 'bank_instapay';
  if (t.type === 'wallet') return 'wallet';
  return 'cash_drawer';
}

export function ExpensesView({
  expenses,
  recurringExpenses = [],
  treasuries = [],
  templates = [],
  dashboard,
  settings,
  currentUser,
  canManageExpenses,
  canViewProfits,
  apiFetch,
  onMutated,
}: ExpensesViewProps) {
  const { printDocument, exportDocumentAsPdf, exportDocumentAsPng, exporting } = usePrint();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);

  // Period & Treasury Filters
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterTreasuryId, setFilterTreasuryId] = useState<string>('all');
  const [chartTab, setChartTab] = useState<'category' | 'treasury'>('category');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const activeTreasuries = useMemo(() => treasuries.filter((t) => t.active), [treasuries]);
  const expensesTemplate = useMemo(
    () => templates.find((t) => t.id === 'tpl-expenses-report' || t.kind === 'expenses_report'),
    [templates]
  );

  // Create Form State
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('misc');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayStr);
  const [receiptRef, setReceiptRef] = useState('');
  const [treasuryId, setTreasuryId] = useState<string>('');
  const [paymentSource, setPaymentSource] = useState<'cash_drawer' | 'bank_instapay' | 'wallet'>('cash_drawer');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Inline 2-step delete & Edit Modal
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<StoreExpense | null>(null);

  useEffect(() => {
    if (activeTreasuries.length > 0 && !activeTreasuries.some((t) => t.id === treasuryId)) {
      const def = activeTreasuries.find((t) => t.type === 'cash_drawer' && t.isDefault) || activeTreasuries[0];
      setTreasuryId(def.id);
      setPaymentSource(sourceFromTreasury(def));
    }
  }, [activeTreasuries, treasuryId]);

  const applyPeriodPreset = (preset: PeriodPreset) => {
    setPeriodPreset(preset);
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'today') {
      setDateFrom(todayIso);
      setDateTo(todayIso);
    } else if (preset === '7days') {
      const weekAgo = new Date(Date.now() - 6 * 86400 * 1000).toISOString().slice(0, 10);
      setDateFrom(weekAgo);
      setDateTo(todayIso);
    } else if (preset === 'month') {
      setDateFrom(`${todayIso.slice(0, 7)}-01`);
      setDateTo(todayIso);
    }
  };

  const preSearched = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return expenses.filter((ex) => {
      const day = ex.createdAt.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (filterTreasuryId !== 'all' && ex.treasuryId !== filterTreasuryId) return false;
      if (!q) return true;
      return (
        ex.title.toLowerCase().includes(q) ||
        EXPENSE_CATEGORY_LABELS[ex.category].toLowerCase().includes(q) ||
        (ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource]).toLowerCase().includes(q) ||
        (ex.receiptRef || '').toLowerCase().includes(q) ||
        ex.actorName.toLowerCase().includes(q) ||
        ex.notes.toLowerCase().includes(q)
      );
    });
  }, [expenses, debouncedSearch, dateFrom, dateTo, filterTreasuryId]);

  const excelColumns: ExcelColumnDef<StoreExpense>[] = useMemo(
    () => [
      { key: 'title', label: 'البيان', getValue: (e) => e.title },
      { key: 'category', label: 'التصنيف', getValue: (e) => EXPENSE_CATEGORY_LABELS[e.category] },
      {
        key: 'source',
        label: 'الخزينة / الصرف',
        getValue: (e) => e.treasuryName || EXPENSE_SOURCE_LABELS[e.paymentSource],
      },
      { key: 'actor', label: 'المسؤول', getValue: (e) => e.actorName },
      {
        key: 'amount',
        label: 'المبلغ',
        getValue: (e) => formatEGP(e.amount),
        getSortValue: (e) => e.amount,
      },
      { key: 'date', label: 'التاريخ', getValue: (e) => e.createdAt.slice(0, 10) },
    ],
    []
  );

  const excel = useExcelTableFilter(preSearched, excelColumns);

  const {
    visibleItems: visibleExpenses,
    visibleCount,
    hasMore,
    totalCount,
    loadMore,
    sentinelRef,
  } = useInfiniteScroll(excel.filteredRows, {
    batchSize: 20,
    resetKey: `${debouncedSearch}-${dateFrom}-${dateTo}-${filterTreasuryId}-${excel.activeFilterKeys.join(',')}-${excel.sortState.columnKey}`,
  });

  const filteredTotal = useMemo(
    () => Number(excel.filteredRows.reduce((s, e) => s + e.amount, 0).toFixed(2)),
    [excel.filteredRows]
  );

  const categoryTotals = useMemo(() => {
    const map = new Map<ExpenseCategory, { total: number; count: number }>();
    for (const ex of excel.filteredRows) {
      const cur = map.get(ex.category) || { total: 0, count: 0 };
      cur.total += ex.amount;
      cur.count += 1;
      map.set(ex.category, cur);
    }
    return Array.from(map.entries())
      .map(([cat, info]) => ({
        category: cat,
        label: EXPENSE_CATEGORY_LABELS[cat],
        total: Number(info.total.toFixed(2)),
        count: info.count,
      }))
      .sort((a, b) => b.total - a.total);
  }, [excel.filteredRows]);

  const treasuryTotals = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const ex of excel.filteredRows) {
      const key = ex.treasuryId || ex.paymentSource;
      const name = ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource];
      const cur = map.get(key) || { name, total: 0, count: 0 };
      cur.total += ex.amount;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([key, info]) => ({ key, ...info, total: Number(info.total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total);
  }, [excel.filteredRows]);

  const selectedTreasuryObj = useMemo(
    () => activeTreasuries.find((t) => t.id === treasuryId) || null,
    [activeTreasuries, treasuryId]
  );
  const amountNum = Number(amount || 0);
  const projectedBalance =
    selectedTreasuryObj && Number.isFinite(amountNum) && amountNum > 0
      ? Number((selectedTreasuryObj.currentBalance - amountNum).toFixed(2))
      : null;

  const filterTreasuryLabel =
    filterTreasuryId === 'all'
      ? undefined
      : treasuries.find((t) => t.id === filterTreasuryId)?.name;

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageExpenses) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrMsg('يرجى إدخال مبلغ صحيح أكبر من صفر.');
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          category,
          amount: numericAmount,
          paymentSource,
          treasuryId: treasuryId || null,
          receiptRef: receiptRef.trim(),
          createdAt: expenseDate || undefined,
          actorName: currentUser.name,
          notes: notes.trim(),
        }),
      });
      setTitle('');
      setAmount('');
      setReceiptRef('');
      setNotes('');
      setExpenseDate(todayStr);
      onMutated('تم تسجيل بند المصروف وتحديث صافي الربح والخزينة');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تسجيل المصروف');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (ex: StoreExpense) => {
    setErrMsg(null);
    setEditTarget(ex);
  };

  const handleDeleteExpense = async (id: string) => {
    setDeletingId(id);
    setErrMsg(null);
    try {
      await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      onMutated('تم حذف المصروف وإرجاع المبلغ إلى رصيد الخزينة');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف المصروف');
    } finally {
      setDeletingId(null);
    }
  };

  const totalTreasuriesLiquidity = useMemo(
    () => Number(activeTreasuries.reduce((s, t) => s + t.currentBalance, 0).toFixed(2)),
    [activeTreasuries]
  );

  const printPayload = useMemo(
    () => ({
      kind: 'expenses_report' as const,
      expenses: excel.filteredRows,
      settings,
      printedBy: currentUser.name,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      treasuryFilterLabel: filterTreasuryLabel,
      template: expensesTemplate,
    }),
    [excel.filteredRows, settings, currentUser.name, dateFrom, dateTo, filterTreasuryLabel, expensesTemplate]
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" />
            <span>المصروفات التشغيلية وحركة الخزينة</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            إدارة بنود المصاريف اليومية وربطها المباشر بالخزائن مع تسوية فورية عند التعديل أو الإلغاء
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => printDocument(printPayload)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Printer className="h-4 w-4 text-emerald-600" />
            <span>طباعة A4</span>
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => exportDocumentAsPdf(printPayload, 'تقرير-المصروفات.pdf')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <span>PDF</span>
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => exportDocumentAsPng(printPayload, 'تقرير-المصروفات.png')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>PNG</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const rows = excel.filteredRows;
              const sumAmount = Number(rows.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(2));
              const totalCount = categoryTotals.reduce((s, c) => s + c.count, 0);
              const sumCat = Number(categoryTotals.reduce((s, c) => s + c.total, 0).toFixed(2));
              const sumTr = Number(treasuryTotals.reduce((s, t) => s + t.total, 0).toFixed(2));
              const subtitleText = `الفترة: ${dateFrom || 'البداية'} ← ${dateTo || 'اليوم'} | الخزينة: ${
                filterTreasuryLabel || 'كل الخزائن'
              } | عدد الحركات: ${rows.length}`;

              exportWorkbookXlsx('سجل-المصروفات.xlsx', [
                {
                  name: 'المصروفات',
                  title: `${settings.storeName} — سجل المصروفات التشغيلية`,
                  subtitle: subtitleText,
                  headers: [
                    'البيان',
                    'التصنيف',
                    'الخزينة / جهة الصرف',
                    'رقم الإيصال',
                    'المبلغ',
                    'المسؤول',
                    'التاريخ',
                    'ملاحظات',
                  ],
                  rows: rows.map((e) => [
                    e.title,
                    EXPENSE_CATEGORY_LABELS[e.category],
                    e.treasuryName || EXPENSE_SOURCE_LABELS[e.paymentSource],
                    e.receiptRef || '',
                    e.amount,
                    e.actorName,
                    formatDateTimeAr(e.createdAt),
                    e.notes || '',
                  ]),
                  totalsRow: ['الإجمالي', `${rows.length} حركة`, '', '', sumAmount, '', '', ''],
                },
                {
                  name: 'ملخص البنود',
                  title: `${settings.storeName} — ملخص المصروفات حسب البند`,
                  subtitle: subtitleText,
                  headers: ['البند', 'عدد الحركات', 'الإجمالي (ج.م)', 'النسبة %'],
                  rows: categoryTotals.map((c) => [
                    c.label,
                    c.count,
                    c.total,
                    sumCat > 0 ? Number(((c.total / sumCat) * 100).toFixed(1)) : 0,
                  ]),
                  totalsRow: ['الإجمالي', totalCount, sumCat, sumCat > 0 ? 100 : 0],
                },
                {
                  name: 'ملخص_الخزائن',
                  title: `${settings.storeName} — المصروفات حسب الخزينة وجهات الصرف`,
                  subtitle: subtitleText,
                  headers: ['الخزينة / جهة الصرف', 'عدد الحركات', 'الإجمالي (ج.م)', 'النسبة %'],
                  rows: treasuryTotals.map((t) => [
                    t.name,
                    t.count,
                    t.total,
                    sumTr > 0 ? Number(((t.total / sumTr) * 100).toFixed(1)) : 0,
                  ]),
                  totalsRow: ['الإجمالي', rows.length, sumTr, sumTr > 0 ? 100 : 0],
                },
              ]);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">مصروفات اليوم</div>
          <div className="mt-1 font-mono-num text-2xl font-bold text-rose-600 dark:text-rose-400">
            {formatEGP(dashboard.todayExpenses)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            إجمالي الشهر: <span className="font-mono-num">{formatEGP(dashboard.monthExpenses)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">صافي ربح اليوم بعد المصروفات</div>
          <div
            className={`mt-1 font-mono-num text-2xl font-bold ${
              dashboard.todayNetAfterExpenses >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {canViewProfits ? formatEGP(dashboard.todayNetAfterExpenses) : 'مقيد بالصلاحية'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {canViewProfits ? `مجمل الربح: ${formatEGP(dashboard.todayProfit)}` : 'خاص بالمدير والمالك'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">إجمالي السيولة بالخزائن النشطة</div>
          <div className="mt-1 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {formatEGP(totalTreasuriesLiquidity)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            موزعة على <span className="font-mono-num">{activeTreasuries.length}</span> خزائن وحسابات
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">إجمالي السجل المعروض</div>
          <div className="mt-1 font-mono-num text-2xl font-bold text-slate-900 dark:text-white">
            {formatEGP(filteredTotal)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            عدد البنود: <span className="font-mono-num">{excel.filteredRows.length}</span> حركة
          </div>
        </div>
      </div>

      {/* Live Treasuries Quick Filter Strip */}
      {activeTreasuries.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              أرصدة الخزائن المتاحة (اضغط لتصفية مصروفات خزينة محددة):
            </span>
            {filterTreasuryId !== 'all' && (
              <button
                type="button"
                onClick={() => setFilterTreasuryId('all')}
                className="text-[11px] font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
              >
                عرض كل الخزائن
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {activeTreasuries.map((t) => {
              const selected = filterTreasuryId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilterTreasuryId(selected ? 'all' : t.id)}
                  className={`rounded-lg border px-3 py-2 text-right transition-colors ${
                    selected
                      ? 'border-emerald-600 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-500/10'
                      : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    {t.name}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400">{TREASURY_TYPE_LABELS[t.type]}</span>
                    <span
                      className={`font-mono-num text-xs font-bold ${
                        t.currentBalance < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {formatEGP(t.currentBalance)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scheduled Recurring Expenses Panel */}
      <RecurringExpensesPanel
        recurringExpenses={recurringExpenses}
        activeTreasuries={activeTreasuries}
        currentUser={currentUser}
        canManageExpenses={canManageExpenses}
        apiFetch={apiFetch}
        onMutated={onMutated}
      />

      {/* Add Expense + Category / Treasury Analytics */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {canManageExpenses && (
          <form
            onSubmit={handleAddExpense}
            className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="h-4 w-4 text-emerald-600" />
                <span>تسجيل مصروف أو سحب نقدي جديد</span>
              </h2>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_PRESETS.map((preset) => (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => {
                    setTitle(preset.title);
                    setCategory(preset.category);
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-emerald-500"
                >
                  {preset.title}
                </button>
              ))}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">بيان المصروف</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: فاتورة إنترنت المحل / مشال بضاعة"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium mb-1">التصنيف</label>
                  <SearchableSelect
                    value={category}
                    onChange={(v) => setCategory(v as ExpenseCategory)}
                    options={EXPENSE_CATEGORIES.map((c) => ({
                      value: c,
                      label: EXPENSE_CATEGORY_LABELS[c],
                    }))}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">المبلغ (ج.م)</label>
                  <input
                    required
                    type="number"
                    min={0.5}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium mb-1">تاريخ المصروف</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">رقم الإيصال / المرجع</label>
                  <input
                    value={receiptRef}
                    onChange={(e) => setReceiptRef(e.target.value)}
                    placeholder="اختياري: ELC-901"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              {activeTreasuries.length > 0 ? (
                <div>
                  <label className="block font-medium mb-1">الخزينة المصروف منها</label>
                  <SearchableSelect
                    value={treasuryId}
                    onChange={(v) => {
                      setTreasuryId(v);
                      const t = activeTreasuries.find((item) => item.id === v);
                      if (t) setPaymentSource(sourceFromTreasury(t));
                    }}
                    options={activeTreasuries.map((t) => ({
                      value: t.id,
                      label: t.name,
                      sublabel: `${TREASURY_TYPE_LABELS[t.type]} · المتاح: ${formatEGP(t.currentBalance)}`,
                    }))}
                  />
                  {projectedBalance !== null && (
                    <div
                      className={`mt-1.5 flex items-center justify-between text-[11px] font-mono-num ${
                        projectedBalance < 0
                          ? 'font-semibold text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span>رصيد الخزينة بعد الصرف:</span>
                      <span>
                        {formatEGP(projectedBalance)}
                        {projectedBalance < 0 ? ' (سحب على المكشوف)' : ''}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block font-medium mb-1">جهة الصرف</label>
                  <SearchableSelect
                    value={paymentSource}
                    onChange={(v) =>
                      setPaymentSource(v as 'cash_drawer' | 'bank_instapay' | 'wallet')
                    }
                    options={[
                      { value: 'cash_drawer', label: EXPENSE_SOURCE_LABELS.cash_drawer },
                      { value: 'bank_instapay', label: EXPENSE_SOURCE_LABELS.bank_instapay },
                      { value: 'wallet', label: EXPENSE_SOURCE_LABELS.wallet },
                    ]}
                  />
                </div>
              )}

              <div>
                <label className="block font-medium mb-1">ملاحظات إضافية (اختياري)</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="تفاصيل إضافية أو اسم المستلم..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {errMsg && <div className="text-rose-600 font-medium">{errMsg}</div>}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'جاري التسجيل...' : 'حفظ وتسجيل المصروف'}
              </button>
            </div>
          </form>
        )}

        <div
          className={`${canManageExpenses ? 'lg:col-span-7' : 'lg:col-span-12'} rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-600" />
              <span>التحليل البياني للمصروفات</span>
            </h2>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setChartTab('category')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  chartTab === 'category'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                حسب البند
              </button>
              <button
                type="button"
                onClick={() => setChartTab('treasury')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  chartTab === 'treasury'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                حسب الخزينة
              </button>
            </div>
          </div>

          {chartTab === 'category' ? (
            categoryTotals.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                لا توجد مصروفات مسجلة في النطاق المحدد.
              </div>
            ) : (
              <div className="space-y-3">
                {categoryTotals.map((row) => {
                  const pct = filteredTotal > 0 ? Math.round((row.total / filteredTotal) * 100) : 0;
                  return (
                    <div key={row.category} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {row.label}{' '}
                          <span className="font-mono-num text-[11px] font-normal text-slate-400">
                            ({row.count})
                          </span>
                        </span>
                        <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                          {formatEGP(row.total)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{ width: `${Math.max(3, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : treasuryTotals.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              لا توجد مصروفات مسجلة في النطاق المحدد.
            </div>
          ) : (
            <div className="space-y-3">
              {treasuryTotals.map((row) => {
                const pct = filteredTotal > 0 ? Math.round((row.total / filteredTotal) * 100) : 0;
                return (
                  <div key={row.key} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {row.name}{' '}
                        <span className="font-mono-num text-[11px] font-normal text-slate-400">
                          ({row.count})
                        </span>
                      </span>
                      <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                        {formatEGP(row.total)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filter & Expenses Ledger Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-100 p-3.5 dark:border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالبيان، الإيصال، الخزينة، أو المسؤول..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                  <span>جدول</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                    viewMode === 'cards'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>بطاقات</span>
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    ['all', 'الكل'],
                    ['today', 'اليوم'],
                    ['7days', '7 أيام'],
                    ['month', 'هذا الشهر'],
                  ] as const
                ).map(([pid, label]) => (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => applyPeriodPreset(pid)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                      periodPreset === pid
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPeriodPreset('all');
                    setDateFrom(e.target.value);
                  }}
                  aria-label="من تاريخ"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono-num text-[11px] dark:border-slate-700 dark:bg-slate-950"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPeriodPreset('all');
                    setDateTo(e.target.value);
                  }}
                  aria-label="إلى تاريخ"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono-num text-[11px] dark:border-slate-700 dark:bg-slate-950"
                />
                {(dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => applyPeriodPreset('all')}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                    title="مسح التواريخ"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <ActiveExcelFiltersBar
            columns={excelColumns}
            activeFilterKeys={excel.activeFilterKeys}
            sortState={excel.sortState}
            totalBefore={preSearched.length}
            totalAfter={excel.filteredRows.length}
            onClearOne={(colId) => excel.applyColumnFilter(colId, null)}
            onClearAll={excel.clearAllFilters}
          />
        </div>

        {viewMode === 'cards' ? (
          <div className="p-3.5">
            {visibleExpenses.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                لا توجد مصروفات مطابقة للتصفية الحالية.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleExpenses.map((ex) => (
                  <div
                    key={ex.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 dark:border-slate-800 dark:bg-slate-950/40 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                          {ex.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {EXPENSE_CATEGORY_LABELS[ex.category]} ·{' '}
                          {ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource]}
                        </div>
                      </div>
                      <div className="font-mono-num text-sm font-bold text-rose-600 dark:text-rose-400 shrink-0">
                        {formatEGP(ex.amount)}
                      </div>
                    </div>

                    {(ex.receiptRef || ex.notes) && (
                      <div className="text-[11px] text-slate-500">
                        {ex.receiptRef ? `مرجع: ${ex.receiptRef}` : ''}
                        {ex.receiptRef && ex.notes ? ' · ' : ''}
                        {ex.notes}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-[11px] text-slate-500 dark:border-slate-800">
                      <span className="font-mono-num">
                        {formatDateTimeAr(ex.createdAt)} · {ex.actorName}
                      </span>
                      {canManageExpenses && (
                        confirmDeleteId === ex.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingId === ex.id}
                              onClick={() => handleDeleteExpense(ex.id)}
                              className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {deletingId === ex.id ? '...' : 'تأكيد'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(ex)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>تعديل</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(ex.id)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded border border-rose-200 bg-white px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-slate-900"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="title"
                    label="البيان"
                    options={excel.getColumnOptions('title')}
                    activeFilterValues={excel.columnFilters.title}
                    sortDirection={excel.sortState.columnKey === 'title' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('title', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('title', vals)}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="category"
                    label="التصنيف"
                    options={excel.getColumnOptions('category')}
                    activeFilterValues={excel.columnFilters.category}
                    sortDirection={excel.sortState.columnKey === 'category' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('category', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('category', vals)}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="source"
                    label="الخزينة / الصرف"
                    options={excel.getColumnOptions('source')}
                    activeFilterValues={excel.columnFilters.source}
                    sortDirection={excel.sortState.columnKey === 'source' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('source', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('source', vals)}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="actor"
                    label="المسؤول"
                    options={excel.getColumnOptions('actor')}
                    activeFilterValues={excel.columnFilters.actor}
                    sortDirection={excel.sortState.columnKey === 'actor' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('actor', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('actor', vals)}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="amount"
                    label="المبلغ"
                    options={excel.getColumnOptions('amount')}
                    activeFilterValues={excel.columnFilters.amount}
                    sortDirection={excel.sortState.columnKey === 'amount' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('amount', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('amount', vals)}
                  />
                </th>
                <th className="px-3 py-2.5">
                  <ExcelColumnHeader
                    columnKey="date"
                    label="التاريخ"
                    options={excel.getColumnOptions('date')}
                    activeFilterValues={excel.columnFilters.date}
                    sortDirection={excel.sortState.columnKey === 'date' ? excel.sortState.direction : null}
                    onSort={(dir) => excel.setColumnSort('date', dir)}
                    onApplyFilter={(vals) => excel.applyColumnFilter('date', vals)}
                  />
                </th>
                {canManageExpenses && <th className="px-3 py-2.5">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleExpenses.length === 0 ? (
                <tr>
                  <td colSpan={canManageExpenses ? 7 : 6} className="px-4 py-10 text-center text-slate-500">
                    لا توجد مصروفات مطابقة للتصفية الحالية.
                  </td>
                </tr>
              ) : (
                visibleExpenses.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{ex.title}</div>
                      {(ex.receiptRef || ex.notes) && (
                        <div className="text-[11px] text-slate-400">
                          {ex.receiptRef ? (
                            <span className="font-mono-num text-slate-500 dark:text-slate-300">
                              مرجع: {ex.receiptRef}
                            </span>
                          ) : null}
                          {ex.receiptRef && ex.notes ? ' · ' : ''}
                          {ex.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                      {EXPENSE_CATEGORY_LABELS[ex.category]}
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                      {ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource]}
                    </td>
                    <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{ex.actorName}</td>
                    <td className="px-3 py-3 font-mono-num font-bold text-rose-600 dark:text-rose-400">
                      {formatEGP(ex.amount)}
                    </td>
                    <td className="px-3 py-3 font-mono-num text-[11px] text-slate-500">
                      {formatDateTimeAr(ex.createdAt)}
                    </td>
                    {canManageExpenses && (
                      <td className="px-3 py-3">
                        {confirmDeleteId === ex.id ? (
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={deletingId === ex.id}
                              onClick={() => handleDeleteExpense(ex.id)}
                              className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              {deletingId === ex.id ? '...' : 'تأكيد'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(ex)}
                              title="تعديل المصروف"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(ex.id)}
                              title="حذف المصروف"
                              className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
        <InfiniteTableFooter
          visibleCount={visibleCount}
          totalCount={totalCount}
          hasMore={hasMore}
          onLoadMore={loadMore}
          sentinelRef={sentinelRef}
        />
      </div>

      {editTarget && (
        <ExpenseEditModal
          expense={editTarget}
          activeTreasuries={activeTreasuries}
          apiFetch={apiFetch}
          onClose={() => setEditTarget(null)}
          onSaved={(msg) => {
            setEditTarget(null);
            onMutated(msg);
          }}
        />
      )}
    </div>
  );
}
