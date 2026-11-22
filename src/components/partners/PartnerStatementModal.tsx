import {
  ChevronDown,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  FileSpreadsheet,
  Image as ImageIcon,
  MessageCircle,
  Printer,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { type PartnerStatementEntry, usePrint } from '../../context/PrintContext';
import type {
  Customer,
  DocumentTemplateArtifact,
  PartnerItemizedSummaryRow,
  StoreSettings,
  Supplier,
} from '../../shared/types';
import { exportWorkbookXlsx } from '../../utils/exportUtils';
import { formatDateTimeAr, formatEGP, formatNum } from '../../utils/formatters';
import { buildWhatsAppUrl, formatPartnerStatementSummaryText } from '../../utils/whatsappShare';

export interface PartnerStatementViewData {
  partnerId: string;
  partnerType: 'customer' | 'supplier';
  partnerName: string;
  partnerPhone: string;
  currentBalance: number;
  creditLimit?: number;
  loyaltyPoints?: number;
  storeCreditBalance?: number;
  totalVolume: number;
  totalPaid: number;
  entries: PartnerStatementEntry[];
  itemizedSummary: PartnerItemizedSummaryRow[];
}

interface PartnerStatementModalProps {
  statementData: PartnerStatementViewData;
  customers: Customer[];
  suppliers: Supplier[];
  templates: DocumentTemplateArtifact[];
  settings: StoreSettings;
  currentUserName: string;
  canManagePayments: boolean;
  onClose: () => void;
  onSwitchPartner: (partnerType: 'customer' | 'supplier', partnerId: string) => void;
  onOpenSettlement: (partnerType: 'customer' | 'supplier', partnerId: string) => void;
}

export function PartnerStatementModal({
  statementData,
  customers,
  suppliers,
  templates,
  settings,
  currentUserName,
  canManagePayments,
  onClose,
  onSwitchPartner,
  onOpenSettlement,
}: PartnerStatementModalProps) {
  const { printDocument, openPrintPreview, exportDocumentAsPdf, exportDocumentAsPng, exporting } = usePrint();
  const [showMobileStatementFilters, setShowMobileStatementFilters] = useState(false);
  const [statementMode, setStatementMode] = useState<'itemized' | 'summary'>('itemized');
  const [statementTab, setStatementTab] = useState<'ledger' | 'items_summary' | 'payment_analysis'>('ledger');
  const [statementTypeFilter, setStatementTypeFilter] = useState<'all' | 'docs' | 'payments' | 'returns'>('all');
  const [statementDateFrom, setStatementDateFrom] = useState('');
  const [statementDateTo, setStatementDateTo] = useState('');
  const [statementFilterQuery, setStatementFilterQuery] = useState('');
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<Record<string, boolean>>({});

  const activeStatementTemplate = useMemo(
    () =>
      templates.find(
        (t) => t.kind === (statementMode === 'itemized' ? 'partner_statement_itemized' : 'partner_statement')
      ),
    [templates, statementMode]
  );

  const filteredStatement = useMemo(() => {
    const fromIso = statementDateFrom ? `${statementDateFrom}T00:00:00` : '';
    const toIso = statementDateTo ? `${statementDateTo}T23:59:59.999Z` : '';
    const q = statementFilterQuery.trim().toLowerCase();

    let openingBalance = 0;
    const matchedEntries: PartnerStatementEntry[] = [];
    for (const entry of statementData.entries) {
      if (fromIso && entry.date < fromIso) {
        openingBalance = Number((openingBalance + entry.debit - entry.credit).toFixed(2));
        continue;
      }
      if (toIso && entry.date > toIso) continue;
      if (statementTypeFilter === 'docs' && entry.entryType !== 'invoice' && entry.entryType !== 'purchase') {
        continue;
      }
      if (statementTypeFilter === 'payments' && entry.entryType !== 'payment') {
        continue;
      }
      if (statementTypeFilter === 'returns' && entry.entryType !== 'return') {
        continue;
      }
      if (q) {
        const hitHeader =
          entry.reference.toLowerCase().includes(q) ||
          entry.typeLabel.toLowerCase().includes(q) ||
          (entry.notes || '').toLowerCase().includes(q) ||
          (entry.treasuryBreakdown || '').toLowerCase().includes(q);
        const hitItem = entry.items?.some((it) => it.productName.toLowerCase().includes(q));
        if (!hitHeader && !hitItem) continue;
      }
      matchedEntries.push(entry);
    }

    let running = openingBalance;
    const entriesWithBalance = matchedEntries.map((e) => {
      running = Number((running + e.debit - e.credit).toFixed(2));
      return { ...e, runningBalance: running };
    });

    const agg = new Map<
      string,
      {
        productId: string;
        productName: string;
        unit: string;
        totalQty: number;
        totalAmount: number;
        docIds: Set<string>;
      }
    >();
    let totalItemQty = 0;
    for (const e of entriesWithBalance) {
      if (e.entryType === 'return' || e.entryType === 'payment' || !e.items) continue;
      if (e.invoiceStatus === 'returned') continue;
      for (const it of e.items) {
        if (q && !it.productName.toLowerCase().includes(q) && !e.reference.toLowerCase().includes(q)) {
          continue;
        }
        const activeQty = Number(Math.max(0, it.quantity - Number(it.returnedQuantity || 0)).toFixed(3));
        if (activeQty <= 0.0001) continue;
        const activeAmt =
          typeof it.netLineTotal === 'number'
            ? it.netLineTotal
            : Number((it.lineTotal * (it.quantity > 0 ? activeQty / it.quantity : 0)).toFixed(2));
        totalItemQty = Number((totalItemQty + activeQty).toFixed(3));
        const cur = agg.get(it.productId) || {
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          totalQty: 0,
          totalAmount: 0,
          docIds: new Set<string>(),
        };
        cur.totalQty = Number((cur.totalQty + activeQty).toFixed(3));
        cur.totalAmount = Number((cur.totalAmount + activeAmt).toFixed(2));
        cur.docIds.add(e.id);
        agg.set(it.productId, cur);
      }
    }

    const itemizedSummary: PartnerItemizedSummaryRow[] = Array.from(agg.values())
      .map((r) => ({
        productId: r.productId,
        productName: r.productName,
        unit: r.unit,
        totalQty: r.totalQty,
        avgUnitPrice: r.totalQty > 0 ? Number((r.totalAmount / r.totalQty).toFixed(2)) : 0,
        totalAmount: r.totalAmount,
        invoiceCount: r.docIds.size,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const periodVolume = Number(entriesWithBalance.reduce((s, e) => s + e.debit, 0).toFixed(2));
    const periodPaid = Number(entriesWithBalance.reduce((s, e) => s + e.credit, 0).toFixed(2));
    const periodReturns = Number(
      entriesWithBalance
        .filter((e) => e.entryType === 'return')
        .reduce((s, e) => s + e.credit, 0)
        .toFixed(2)
    );

    const paymentMap = new Map<string, { label: string; count: number; total: number }>();
    for (const e of entriesWithBalance) {
      if (e.credit <= 0) continue;
      const key = e.treasuryBreakdown || e.notes || 'دفعة / تسوية';
      const cur = paymentMap.get(key) || { label: key, count: 0, total: 0 };
      cur.count += 1;
      cur.total = Number((cur.total + e.credit).toFixed(2));
      paymentMap.set(key, cur);
    }
    const paymentBreakdown = Array.from(paymentMap.values()).sort((a, b) => b.total - a.total);

    return {
      openingBalance,
      entries: entriesWithBalance,
      itemizedSummary,
      totalItemQty,
      periodVolume,
      periodPaid,
      periodReturns,
      paymentBreakdown,
      closingBalance:
        entriesWithBalance.length > 0
          ? entriesWithBalance[entriesWithBalance.length - 1].runningBalance
          : statementDateFrom || statementDateTo || q || statementTypeFilter !== 'all'
            ? openingBalance
            : statementData.currentBalance,
    };
  }, [statementData, statementDateFrom, statementDateTo, statementFilterQuery, statementTypeFilter]);

  const applyStatementDatePreset = (preset: 'all' | 'today' | '7d' | 'month' | '30d') => {
    const now = new Date();
    const toLocalIso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    if (preset === 'all') {
      setStatementDateFrom('');
      setStatementDateTo('');
      return;
    }
    const todayStr = toLocalIso(now);
    if (preset === 'today') {
      setStatementDateFrom(todayStr);
      setStatementDateTo(todayStr);
      return;
    }
    if (preset === 'month') {
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setStatementDateFrom(toLocalIso(startMonth));
      setStatementDateTo(todayStr);
      return;
    }
    const days = preset === '7d' ? 6 : 29;
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    setStatementDateFrom(toLocalIso(start));
    setStatementDateTo(todayStr);
  };

  const handleExportStatementXlsx = () => {
    const periodLabel = `${statementDateFrom || 'البداية'} ← ${statementDateTo || 'الآن'}`;
    const partnerKindLabel = statementData.partnerType === 'customer' ? 'العميل' : 'المورد';
    const balanceState =
      filteredStatement.closingBalance === 0
        ? 'خالص الحساب'
        : statementData.partnerType === 'customer'
          ? filteredStatement.closingBalance > 0
            ? 'مستحق على العميل'
            : 'رصيد دائن للعميل'
          : filteredStatement.closingBalance > 0
            ? 'مستحق للمورد'
            : 'رصيد مدفوع مقدماً';

    const itemizedRows: Array<Array<string | number>> = [];
    let totalItemLinesNet = 0;
    let totalItemLinesDisc = 0;
    let totalItemLinesQty = 0;

    for (const e of filteredStatement.entries) {
      if (e.items && e.items.length > 0) {
        for (const it of e.items) {
          const retQty = Number(it.returnedQuantity || 0);
          const activeQty = Number(Math.max(0, it.quantity - retQty).toFixed(3));
          const netVal =
            typeof it.netLineTotal === 'number'
              ? it.netLineTotal
              : Number((it.lineTotal * (it.quantity > 0 ? activeQty / it.quantity : 0)).toFixed(2));
          totalItemLinesQty = Number((totalItemLinesQty + activeQty).toFixed(3));
          totalItemLinesDisc = Number((totalItemLinesDisc + it.discountAmount).toFixed(2));
          totalItemLinesNet = Number((totalItemLinesNet + netVal).toFixed(2));
          itemizedRows.push([
            formatDateTimeAr(e.date),
            e.reference,
            e.typeLabel,
            it.productName,
            it.unit,
            it.quantity,
            retQty,
            activeQty,
            it.unitPrice,
            it.discountAmount,
            netVal,
            e.debit,
          ]);
        }
      } else {
        itemizedRows.push([
          formatDateTimeAr(e.date),
          e.reference,
          e.typeLabel,
          '— دفعة مالية / تسوية —',
          '—',
          0,
          0,
          0,
          0,
          0,
          -e.credit,
          0,
        ]);
      }
    }

    const itemizedGrand = filteredStatement.itemizedSummary.reduce((s, r) => s + r.totalAmount, 0);
    const totalPaymentsSum = filteredStatement.paymentBreakdown.reduce((s, p) => s + p.total, 0);

    const ledgerRows: Array<Array<string | number>> = [];
    if (filteredStatement.openingBalance !== 0) {
      ledgerRows.push([
        '—',
        'رصيد مرحّل قبل الفترة المحددة',
        'رصيد سابق',
        0,
        0,
        filteredStatement.openingBalance,
        'رصيد افتتاحي',
      ]);
    }
    for (const e of filteredStatement.entries) {
      ledgerRows.push([
        formatDateTimeAr(e.date),
        e.typeLabel,
        e.reference,
        e.debit,
        e.credit,
        e.runningBalance,
        e.treasuryBreakdown || e.notes || '',
      ]);
    }

    exportWorkbookXlsx(`كشف-حساب-بالأصناف-${statementData.partnerName}.xlsx`, [
      {
        name: 'ملخص_الحساب',
        title: `${settings.storeName} — ملخص كشف حساب ${partnerKindLabel}: ${statementData.partnerName}`,
        subtitle: `الفترة: ${periodLabel} | الهاتف: ${statementData.partnerPhone || '—'}`,
        headers: ['البند', 'القيمة / البيان', 'ملاحظة'],
        rows: [
          [`اسم ${partnerKindLabel}`, statementData.partnerName, statementData.partnerPhone || 'بدون هاتف'],
          ['الفترة الزمنية', periodLabel, `عدد الحركات المطابقة: ${filteredStatement.entries.length}`],
          ['الرصيد السابق المرحّل', filteredStatement.openingBalance, 'قبل بداية الفترة'],
          [
            statementData.partnerType === 'customer' ? 'إجمالي فواتير الفترة' : 'إجمالي توريدات الفترة',
            filteredStatement.periodVolume,
            'مدين (+)',
          ],
          ['إجمالي السداد والتحصيل', filteredStatement.periodPaid, 'دائن (-)'],
          ['إجمالي المرتجعات المسجلة', filteredStatement.periodReturns, 'مرتجعات الفترة'],
          ['صافي الرصيد الختامي', filteredStatement.closingBalance, balanceState],
          ...(statementData.partnerType === 'customer'
            ? [
                ['الحد الائتماني المسموح', statementData.creditLimit || 0, 'ج.م'],
                ['رصيد نقاط الولاء', statementData.loyaltyPoints || 0, 'نقطة'],
                ['محفظة العميل (رصيد دائن)', statementData.storeCreditBalance || 0, 'ج.م'],
              ]
            : []),
        ],
      },
      {
        name: 'كشف_الحساب_الحركات',
        title: `${settings.storeName} — سجل حركات حساب ${statementData.partnerName}`,
        subtitle: `الفترة: ${periodLabel} | الرصيد الختامي: ${formatEGP(filteredStatement.closingBalance)} (${balanceState})`,
        headers: [
          'التاريخ',
          'نوع الحركة / البيان',
          'المرجع',
          'مدين (+)',
          'سداد / دائن (-)',
          'الرصيد التراكمي',
          'توزيع الخزائن / ملاحظات',
        ],
        rows: ledgerRows,
        totalsRow: [
          `الإجمالي (${filteredStatement.entries.length} حركة)`,
          balanceState,
          '—',
          filteredStatement.periodVolume,
          filteredStatement.periodPaid,
          filteredStatement.closingBalance,
          '',
        ],
      },
      {
        name: 'تفصيل_الأصناف_بالفواتير',
        title: `${settings.storeName} — تفصيل الأصناف لحساب ${statementData.partnerName}`,
        subtitle: `الفترة: ${periodLabel}`,
        headers: [
          'التاريخ',
          'رقم المستند',
          'الحركة',
          'الصنف',
          'الوحدة',
          'الكمية',
          'المرتجع',
          'الصافي الفعلي',
          'سعر الوحدة',
          'الخصم',
          'إجمالي الصنف',
          'إجمالي المستند',
        ],
        rows: itemizedRows,
        totalsRow: [
          'الإجمالي',
          '—',
          '—',
          '—',
          '—',
          itemizedRows.reduce((s, r) => s + Number(r[5] || 0), 0),
          itemizedRows.reduce((s, r) => s + Number(r[6] || 0), 0),
          totalItemLinesQty,
          '—',
          totalItemLinesDisc,
          totalItemLinesNet,
          filteredStatement.periodVolume,
        ],
      },
      {
        name: 'ملخص_الأصناف_الإجمالي',
        title: `${settings.storeName} — الملخص التجميعي للأصناف (${statementData.partnerName})`,
        subtitle: `الفترة: ${periodLabel} | عدد الأصناف: ${filteredStatement.itemizedSummary.length}`,
        headers: [
          'الصنف',
          'الوحدة',
          'عدد المستندات',
          'إجمالي الكمية',
          'متوسط السعر',
          'إجمالي القيمة',
          'نسبة المساهمة %',
        ],
        rows: filteredStatement.itemizedSummary.map((r) => [
          r.productName,
          r.unit,
          r.invoiceCount,
          r.totalQty,
          r.avgUnitPrice,
          r.totalAmount,
          itemizedGrand > 0 ? Number(((r.totalAmount / itemizedGrand) * 100).toFixed(1)) : 0,
        ]),
        totalsRow: [
          `الإجمالي (${filteredStatement.itemizedSummary.length} صنف)`,
          '—',
          filteredStatement.itemizedSummary.reduce((s, r) => s + r.invoiceCount, 0),
          filteredStatement.totalItemQty,
          '—',
          itemizedGrand,
          100,
        ],
      },
      {
        name: 'تحليل_السداد_والخزائن',
        title: `${settings.storeName} — تحليل طرق السداد والتحصيل (${statementData.partnerName})`,
        subtitle: `الفترة: ${periodLabel}`,
        headers: ['الوسيلة / الخزينة', 'عدد الحركات', 'إجمالي المسدد (ج.م)', 'النسبة %'],
        rows: filteredStatement.paymentBreakdown.map((pb) => [
          pb.label,
          pb.count,
          pb.total,
          totalPaymentsSum > 0 ? Number(((pb.total / totalPaymentsSum) * 100).toFixed(1)) : 0,
        ]),
        totalsRow: [
          'الإجمالي',
          filteredStatement.paymentBreakdown.reduce((s, p) => s + p.count, 0),
          totalPaymentsSum,
          100,
        ],
      },
    ]);
  };

  const buildStatementPrintPayload = () => ({
    kind: 'partner_statement_a4' as const,
    partnerType: statementData.partnerType,
    partnerName: statementData.partnerName,
    partnerPhone: statementData.partnerPhone,
    currentBalance: filteredStatement.closingBalance,
    openingBalance: filteredStatement.openingBalance,
    creditLimit: statementData.creditLimit,
    entries: filteredStatement.entries,
    statementMode,
    dateFrom: statementDateFrom || undefined,
    dateTo: statementDateTo || undefined,
    itemizedSummary: filteredStatement.itemizedSummary,
    paymentBreakdown: filteredStatement.paymentBreakdown,
    loyaltyPoints: statementData.loyaltyPoints,
    storeCreditBalance: statementData.storeCreditBalance,
    totalReturns: filteredStatement.periodReturns,
    settings,
    printedBy: currentUserName,
    template: activeStatementTemplate,
  });

  const activeFilterCount =
    (statementDateFrom ? 1 : 0) +
    (statementDateTo ? 1 : 0) +
    (statementFilterQuery ? 1 : 0) +
    (statementTypeFilter !== 'all' ? 1 : 0);

  const periodLabel = `${statementDateFrom || 'البداية'} ← ${statementDateTo || 'الآن'}`;
  const whatsappStatementUrl = buildWhatsAppUrl(
    statementData.partnerPhone || undefined,
    formatPartnerStatementSummaryText({
      partnerType: statementData.partnerType,
      partnerName: statementData.partnerName,
      storeName: settings.storeName,
      storePhone: settings.phone,
      periodLabel,
      openingBalance: filteredStatement.openingBalance,
      periodVolume: filteredStatement.periodVolume,
      periodPaid: filteredStatement.periodPaid,
      periodReturns: filteredStatement.periodReturns,
      closingBalance: filteredStatement.closingBalance,
    })
  );

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 sm:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white dark:bg-slate-900 sm:h-auto sm:max-h-[93vh] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-slate-200 dark:sm:border-slate-800 shadow-2xl">
        {/* Sticky Statement Header */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  كشف حساب {statementData.partnerType === 'customer' ? 'العميل' : 'المورد'}:{' '}
                  <span className="text-emerald-600">{statementData.partnerName}</span>
                </h3>
                <select
                  aria-label="تبديل الحساب"
                  value={statementData.partnerId}
                  onChange={(e) => {
                    if (e.target.value && e.target.value !== statementData.partnerId) {
                      onSwitchPartner(statementData.partnerType, e.target.value);
                    }
                  }}
                  className="min-h-[34px] max-w-[200px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {(statementData.partnerType === 'customer' ? customers : suppliers).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-slate-500 font-mono-num leading-relaxed">
                هاتف: {statementData.partnerPhone || '—'} · الرصيد الحالي:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {formatEGP(statementData.currentBalance)}
                </strong>
                {statementData.currentBalance === 0
                  ? ' (خالص الحساب)'
                  : statementData.partnerType === 'customer'
                    ? statementData.currentBalance > 0
                      ? ' (مستحق على العميل)'
                      : ' (رصيد دائن للعميل)'
                    : statementData.currentBalance > 0
                      ? ' (مستحق للمورد)'
                      : ' (رصيد مدفوع مقدماً)'}
                {statementData.partnerType === 'customer' && (
                  <>
                    {' · '}نقاط الولاء:{' '}
                    <strong className="text-emerald-600">{formatNum(statementData.loyaltyPoints || 0)}</strong>
                    {' · '}محفظة دائن:{' '}
                    <strong className="text-sky-600">{formatEGP(statementData.storeCreditBalance || 0)}</strong>
                  </>
                )}
              </p>

              {statementData.partnerType === 'customer' &&
                typeof statementData.creditLimit === 'number' &&
                statementData.creditLimit > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-slate-500">
                      الحد الائتماني ({formatEGP(statementData.creditLimit)}):
                    </span>
                    <div className="h-2 w-28 sm:w-36 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full transition-all ${
                          statementData.currentBalance / statementData.creditLimit >= 0.9
                            ? 'bg-rose-600'
                            : statementData.currentBalance / statementData.creditLimit >= 0.65
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, (statementData.currentBalance / statementData.creditLimit) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono-num font-bold text-slate-700 dark:text-slate-300">
                      {Math.round((Math.max(0, statementData.currentBalance) / statementData.creditLimit) * 100)}%
                    </span>
                  </div>
                )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 shrink-0"
              aria-label="إغلاق كشف الحساب"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {canManagePayments && statementData.currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenSettlement(statementData.partnerType, statementData.partnerId)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span>{statementData.partnerType === 'customer' ? 'تحصيل دفعة' : 'سداد دفعة'}</span>
                </button>
              )}

              <a
                href={whatsappStatementUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400 whitespace-nowrap"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>مشاركة ملخص واتساب</span>
              </a>

              <button
                type="button"
                onClick={() => openPrintPreview(buildStatementPrintPayload())}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap"
              >
                <Eye className="h-3.5 w-3.5 text-emerald-600" />
                <span>معاينة</span>
              </button>

              <button
                type="button"
                onClick={() => printDocument(buildStatementPrintPayload())}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700 whitespace-nowrap"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>طباعة A4</span>
              </button>

              <button
                type="button"
                disabled={exporting}
                onClick={() =>
                  exportDocumentAsPdf(
                    buildStatementPrintPayload(),
                    `كشف-حساب-بالأصناف-${statementData.partnerName}.pdf`
                  )
                }
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 disabled:opacity-50 whitespace-nowrap"
              >
                <span>PDF</span>
              </button>

              <button
                type="button"
                disabled={exporting}
                onClick={() =>
                  exportDocumentAsPng(
                    buildStatementPrintPayload(),
                    `كشف-حساب-بالأصناف-${statementData.partnerName}.png`
                  )
                }
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 disabled:opacity-50 whitespace-nowrap"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>PNG</span>
              </button>

              <button
                type="button"
                onClick={handleExportStatementXlsx}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>XLSX (5 أوراق)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowMobileStatementFilters((v) => !v)}
              className="sm:hidden inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-600" />
              <span>الفلاتر والبحث{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
          <div
            className={`${
              showMobileStatementFilters ? 'block' : 'hidden sm:block'
            } space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setStatementMode('itemized')}
                    className={`min-h-[34px] rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                      statementMode === 'itemized'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    تفصيلي بالأصناف
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatementMode('summary')}
                    className={`min-h-[34px] rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                      statementMode === 'summary'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    ملخص الحركات
                  </button>
                </div>

                {statementTab === 'ledger' && statementMode === 'itemized' && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const allCollapsed: Record<string, boolean> = {};
                        for (const e of filteredStatement.entries) {
                          if (e.items && e.items.length > 0) allCollapsed[e.id] = true;
                        }
                        setCollapsedEntryIds(allCollapsed);
                      }}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      <ChevronsDownUp className="h-3.5 w-3.5" />
                      <span>طي</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCollapsedEntryIds({})}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      <span>فتح</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={statementFilterQuery}
                  onChange={(e) => setStatementFilterQuery(e.target.value)}
                  placeholder="بحث بالصنف أو الفاتورة أو الخزينة..."
                  className="w-full sm:w-52 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <input
                    type="date"
                    value={statementDateFrom}
                    onChange={(e) => setStatementDateFrom(e.target.value)}
                    className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    type="date"
                    value={statementDateTo}
                    onChange={(e) => setStatementDateTo(e.target.value)}
                    className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500">نوع الحركة:</span>
                {(
                  [
                    ['all', 'الكل'],
                    ['docs', statementData.partnerType === 'customer' ? 'الفواتير فقط' : 'التوريدات فقط'],
                    ['payments', 'الدفعات والتحصيل'],
                    ['returns', 'المرتجعات'],
                  ] as const
                ).map(([tp, lbl]) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setStatementTypeFilter(tp)}
                    className={`min-h-[32px] rounded-md border px-2.5 py-1 font-semibold transition-colors ${
                      statementTypeFilter === tp
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500">فترة سريعة:</span>
                {(
                  [
                    ['all', 'كل السجل'],
                    ['today', 'اليوم'],
                    ['7d', '7 أيام'],
                    ['month', 'هذا الشهر'],
                    ['30d', '30 يوم'],
                  ] as const
                ).map(([pr, lbl]) => (
                  <button
                    key={pr}
                    type="button"
                    onClick={() => applyStatementDatePreset(pr)}
                    className="min-h-[32px] rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {lbl}
                  </button>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatementDateFrom('');
                      setStatementDateTo('');
                      setStatementFilterQuery('');
                      setStatementTypeFilter('all');
                    }}
                    className="min-h-[32px] rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
                  >
                    إعادة ضبط
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Summary Grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500">رصيد سابق مرحّل</div>
              <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {formatEGP(filteredStatement.openingBalance)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500">
                {statementData.partnerType === 'customer' ? 'فواتير الفترة' : 'توريدات الفترة'}
              </div>
              <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {formatEGP(filteredStatement.periodVolume)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500">المسدد / المحصل</div>
              <div className="mt-1 font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(filteredStatement.periodPaid)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500">
                {filteredStatement.periodReturns > 0 ? 'مرتجعات الفترة' : 'وحدات الأصناف'}
              </div>
              <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {filteredStatement.periodReturns > 0
                  ? formatEGP(filteredStatement.periodReturns)
                  : `${formatNum(filteredStatement.totalItemQty)} (${filteredStatement.itemizedSummary.length} صنف)`}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-slate-500">الرصيد الختامي</div>
              <div
                className={`mt-1 font-mono-num text-sm font-bold ${
                  filteredStatement.closingBalance > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {formatEGP(filteredStatement.closingBalance)}
              </div>
            </div>
          </div>

          {/* Sub-Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setStatementTab('ledger')}
              className={`min-h-[36px] flex-1 rounded-lg px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                statementTab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              سجل الحركات ({filteredStatement.entries.length})
            </button>
            <button
              type="button"
              onClick={() => setStatementTab('items_summary')}
              className={`min-h-[36px] flex-1 rounded-lg px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                statementTab === 'items_summary'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              ملخص الأصناف ({filteredStatement.itemizedSummary.length})
            </button>
            <button
              type="button"
              onClick={() => setStatementTab('payment_analysis')}
              className={`min-h-[36px] flex-1 rounded-lg px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                statementTab === 'payment_analysis'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              تحليل السداد والخزائن
            </button>
          </div>

          {statementTab === 'ledger' ? (
            <>
              <div className="md:hidden space-y-2.5">
                {filteredStatement.openingBalance !== 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/20 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">رصيد مرحّل قبل الفترة</div>
                      <div className="text-[11px] text-slate-500">رصيد افتتاحي</div>
                    </div>
                    <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatEGP(filteredStatement.openingBalance)}
                    </div>
                  </div>
                )}

                {filteredStatement.entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800">
                    لا توجد حركات مطابقة للفترة أو البحث المحدد.
                  </div>
                ) : (
                  filteredStatement.entries.map((entry) => {
                    const hasItems = statementMode === 'itemized' && Boolean(entry.items && entry.items.length > 0);
                    const isCollapsed = Boolean(collapsedEntryIds[entry.id]);
                    const showItems = hasItems && !isCollapsed;
                    return (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 dark:text-white leading-snug">
                              {entry.typeLabel}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono-num text-[11px] text-slate-500">
                              <span>{formatDateTimeAr(entry.date)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{entry.reference}</span>
                            </div>
                          </div>
                          {hasItems && (
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedEntryIds((prev) => ({
                                  ...prev,
                                  [entry.id]: !prev[entry.id],
                                }))
                              }
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 shrink-0"
                            >
                              {isCollapsed ? (
                                <ChevronLeft className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                              <span>{entry.items!.length} صنف</span>
                            </button>
                          )}
                        </div>

                        {entry.treasuryBreakdown && (
                          <div className="font-mono-num text-[11px] text-emerald-700 dark:text-emerald-400">
                            {entry.treasuryBreakdown}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 font-mono-num dark:border-slate-800 dark:bg-slate-900/60">
                          <div>
                            <div className="text-[10px] text-slate-500">مدين (+)</div>
                            <div className="font-bold text-rose-600 dark:text-rose-400">
                              {entry.debit > 0 ? formatEGP(entry.debit) : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500">سداد (-)</div>
                            <div className="font-bold text-emerald-600 dark:text-emerald-400">
                              {entry.credit > 0 ? formatEGP(entry.credit) : '—'}
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="text-[10px] text-slate-500">التراكمي</div>
                            <div className="font-extrabold text-slate-900 dark:text-white">
                              {formatEGP(entry.runningBalance)}
                            </div>
                          </div>
                        </div>

                        {showItems && (
                          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/40">
                            {entry.items!.map((it, idx) => (
                              <div
                                key={`${entry.id}-m-${it.productId}-${idx}`}
                                className="flex items-center justify-between gap-2 py-2 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                                    {it.productName}
                                  </div>
                                  <div className="font-mono-num text-[10px] text-slate-500">
                                    {formatNum(it.quantity)} {it.unit} × {formatEGP(it.unitPrice)}
                                    {Number(it.returnedQuantity || 0) > 0
                                      ? ` · مرتجع ${formatNum(it.returnedQuantity || 0)}`
                                      : ''}
                                  </div>
                                </div>
                                <div className="font-mono-num font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                                  {formatEGP(it.lineTotal)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2.5">التاريخ</th>
                        <th className="px-3 py-2.5">البيان والحركة</th>
                        <th className="px-3 py-2.5">المرجع</th>
                        <th className="px-3 py-2.5">مدين (+)</th>
                        <th className="px-3 py-2.5">سداد (-)</th>
                        <th className="px-3 py-2.5">الرصيد التراكمي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredStatement.openingBalance !== 0 && (
                        <tr className="bg-amber-50/50 dark:bg-amber-950/20 font-semibold">
                          <td className="px-3 py-2 font-mono-num text-[11px] text-slate-500">—</td>
                          <td className="px-3 py-2">رصيد مرحّل قبل تاريخ البداية</td>
                          <td className="px-3 py-2 font-mono-num">رصيد سابق</td>
                          <td className="px-3 py-2">—</td>
                          <td className="px-3 py-2">—</td>
                          <td className="px-3 py-2 font-mono-num font-bold">
                            {formatEGP(filteredStatement.openingBalance)}
                          </td>
                        </tr>
                      )}
                      {filteredStatement.entries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            لا توجد حركات مطابقة للفترة أو البحث المحدد.
                          </td>
                        </tr>
                      ) : (
                        filteredStatement.entries.map((entry) => {
                          const hasItems =
                            statementMode === 'itemized' && Boolean(entry.items && entry.items.length > 0);
                          const isCollapsed = Boolean(collapsedEntryIds[entry.id]);
                          const showItems = hasItems && !isCollapsed;
                          return (
                            <Fragment key={entry.id}>
                              <tr className={hasItems ? 'bg-slate-50/80 dark:bg-slate-950/50' : ''}>
                                <td className="px-3 py-2.5 font-mono-num text-[11px] text-slate-500 whitespace-nowrap">
                                  {formatDateTimeAr(entry.date)}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-1.5">
                                    {hasItems && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setCollapsedEntryIds((prev) => ({
                                            ...prev,
                                            [entry.id]: !prev[entry.id],
                                          }))
                                        }
                                        className="rounded p-0.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                                      >
                                        {isCollapsed ? (
                                          <ChevronLeft className="h-3.5 w-3.5" />
                                        ) : (
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    )}
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                      {entry.typeLabel}
                                    </span>
                                    {hasItems && (
                                      <span className="font-mono-num text-[10px] text-slate-400">
                                        ({entry.items!.length} صنف)
                                      </span>
                                    )}
                                  </div>
                                  {entry.treasuryBreakdown && (
                                    <div className="mt-0.5 font-mono-num text-[10px] text-emerald-700 dark:text-emerald-400">
                                      {entry.treasuryBreakdown}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 font-mono-num text-slate-600 dark:text-slate-300">
                                  {entry.reference}
                                </td>
                                <td className="px-3 py-2.5 font-mono-num text-rose-600 dark:text-rose-400">
                                  {entry.debit > 0 ? formatEGP(entry.debit) : '—'}
                                </td>
                                <td className="px-3 py-2.5 font-mono-num text-emerald-600 dark:text-emerald-400">
                                  {entry.credit > 0 ? formatEGP(entry.credit) : '—'}
                                </td>
                                <td className="px-3 py-2.5 font-mono-num font-bold">
                                  {formatEGP(entry.runningBalance)}
                                </td>
                              </tr>
                              {showItems && (
                                <tr>
                                  <td colSpan={6} className="px-4 py-2 bg-white dark:bg-slate-900/60">
                                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                                      <table className="w-full text-right text-[11px]">
                                        <thead className="bg-slate-100/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                          <tr>
                                            <th className="px-2.5 py-1.5">#</th>
                                            <th className="px-2.5 py-1.5">الصنف</th>
                                            <th className="px-2.5 py-1.5">الوحدة</th>
                                            <th className="px-2.5 py-1.5">الكمية</th>
                                            <th className="px-2.5 py-1.5">سعر الوحدة</th>
                                            <th className="px-2.5 py-1.5">الخصم</th>
                                            <th className="px-2.5 py-1.5">الإجمالي</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                                          {entry.items!.map((it, idx) => (
                                            <tr key={`${entry.id}-${it.productId}-${idx}`}>
                                              <td className="px-2.5 py-1.5 font-mono-num text-slate-400">
                                                {idx + 1}
                                              </td>
                                              <td className="px-2.5 py-1.5 font-semibold text-slate-800 dark:text-slate-100">
                                                {it.productName}
                                                {Number(it.returnedQuantity || 0) > 0 && (
                                                  <span className="mr-1.5 font-mono-num text-[10px] text-rose-600 dark:text-rose-400">
                                                    (مرتجع {formatNum(it.returnedQuantity || 0)})
                                                  </span>
                                                )}
                                              </td>
                                              <td className="px-2.5 py-1.5 text-slate-500">{it.unit}</td>
                                              <td className="px-2.5 py-1.5 font-mono-num font-bold">
                                                {formatNum(it.quantity)}
                                              </td>
                                              <td className="px-2.5 py-1.5 font-mono-num">
                                                {formatEGP(it.unitPrice)}
                                              </td>
                                              <td className="px-2.5 py-1.5 font-mono-num text-slate-500">
                                                {it.discountAmount > 0 ? formatEGP(it.discountAmount) : '—'}
                                              </td>
                                              <td className="px-2.5 py-1.5 font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                                                {formatEGP(it.lineTotal)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                    {filteredStatement.entries.length > 0 && (
                      <tfoot className="border-t border-slate-200 bg-slate-100 font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                        <tr>
                          <td colSpan={3} className="px-3 py-2.5">
                            إجمالي حركات الفترة ({filteredStatement.entries.length} حركة)
                          </td>
                          <td className="px-3 py-2.5 font-mono-num text-rose-600 dark:text-rose-400">
                            {formatEGP(filteredStatement.periodVolume)}
                          </td>
                          <td className="px-3 py-2.5 font-mono-num text-emerald-600 dark:text-emerald-400">
                            {formatEGP(filteredStatement.periodPaid)}
                          </td>
                          <td className="px-3 py-2.5 font-mono-num">
                            {formatEGP(filteredStatement.closingBalance)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          ) : statementTab === 'items_summary' ? (
            (() => {
              const grandItemsTotal = filteredStatement.itemizedSummary.reduce((s, r) => s + r.totalAmount, 0);
              return (
                <>
                  <div className="md:hidden space-y-2.5">
                    {filteredStatement.itemizedSummary.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800">
                        لا توجد أصناف مسجلة خلال الفترة المختارة.
                      </div>
                    ) : (
                      filteredStatement.itemizedSummary.map((row) => {
                        const sharePct =
                          grandItemsTotal > 0 ? Math.round((row.totalAmount / grandItemsTotal) * 100) : 0;
                        return (
                          <div
                            key={row.productId}
                            className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-slate-900 dark:text-white">{row.productName}</div>
                                <div className="text-[11px] text-slate-500 font-mono-num">
                                  {row.unit} · {row.invoiceCount} مستند · نسبة {sharePct}%
                                </div>
                              </div>
                              <div className="font-mono-num text-sm font-bold text-emerald-600">
                                {formatEGP(row.totalAmount)}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[11px] font-mono-num dark:border-slate-800">
                              <div>
                                <span className="text-slate-500">إجمالي الكمية: </span>
                                <strong>{formatNum(row.totalQty)}</strong>
                              </div>
                              <div className="text-left">
                                <span className="text-slate-500">متوسط السعر: </span>
                                <strong>{formatEGP(row.avgUnitPrice)}</strong>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
                          <tr>
                            <th className="px-3 py-2.5">الصنف</th>
                            <th className="px-3 py-2.5">الوحدة</th>
                            <th className="px-3 py-2.5">عدد المستندات</th>
                            <th className="px-3 py-2.5">إجمالي الكمية</th>
                            <th className="px-3 py-2.5">متوسط السعر</th>
                            <th className="px-3 py-2.5">إجمالي القيمة</th>
                            <th className="px-3 py-2.5">نسبة المساهمة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredStatement.itemizedSummary.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                لا توجد أصناف مسجلة خلال الفترة المختارة.
                              </td>
                            </tr>
                          ) : (
                            filteredStatement.itemizedSummary.map((row) => {
                              const sharePct =
                                grandItemsTotal > 0 ? Math.round((row.totalAmount / grandItemsTotal) * 100) : 0;
                              return (
                                <tr key={row.productId}>
                                  <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                                    {row.productName}
                                  </td>
                                  <td className="px-3 py-2.5 text-slate-500">{row.unit}</td>
                                  <td className="px-3 py-2.5 font-mono-num">{row.invoiceCount}</td>
                                  <td className="px-3 py-2.5 font-mono-num font-bold">
                                    {formatNum(row.totalQty)}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono-num">{formatEGP(row.avgUnitPrice)}</td>
                                  <td className="px-3 py-2.5 font-mono-num font-bold text-emerald-600">
                                    {formatEGP(row.totalAmount)}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                                        <div className="h-full bg-emerald-600" style={{ width: `${sharePct}%` }} />
                                      </div>
                                      <span className="font-mono-num text-[11px] text-slate-600 dark:text-slate-300">
                                        {sharePct}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                        {filteredStatement.itemizedSummary.length > 0 && (
                          <tfoot className="border-t border-slate-200 bg-slate-100 font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                            <tr>
                              <td colSpan={3} className="px-3 py-2.5">
                                الإجمالي التجميعي ({filteredStatement.itemizedSummary.length} صنف)
                              </td>
                              <td className="px-3 py-2.5 font-mono-num">
                                {formatNum(filteredStatement.totalItemQty)}
                              </td>
                              <td className="px-3 py-2.5">—</td>
                              <td className="px-3 py-2.5 font-mono-num text-emerald-600">
                                {formatEGP(grandItemsTotal)}
                              </td>
                              <td className="px-3 py-2.5 font-mono-num">100%</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </>
              );
            })()
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-slate-500">نسبة التحصيل / السداد للفترة</div>
                  <div className="mt-1 font-mono-num text-lg font-extrabold text-emerald-600">
                    {filteredStatement.periodVolume > 0
                      ? `${Math.min(
                          100,
                          Math.round((filteredStatement.periodPaid / filteredStatement.periodVolume) * 100)
                        )}%`
                      : '100%'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-slate-500">عدد حركات الدفع والتسويات</div>
                  <div className="mt-1 font-mono-num text-lg font-extrabold text-slate-900 dark:text-white">
                    {filteredStatement.entries.filter((e) => e.credit > 0).length} عملية
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-slate-500">إجمالي المسدد خلال الفترة</div>
                  <div className="mt-1 font-mono-num text-lg font-extrabold text-emerald-600">
                    {formatEGP(filteredStatement.periodPaid)}
                  </div>
                </div>
              </div>

              {filteredStatement.paymentBreakdown.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-slate-500 dark:border-slate-800">
                  لا توجد دفعات مالية مسجلة في هذه الفترة.
                </div>
              ) : (
                <>
                  <div className="md:hidden space-y-2.5">
                    {filteredStatement.paymentBreakdown.map((pb) => {
                      const pct =
                        filteredStatement.periodPaid > 0
                          ? Math.round((pb.total / filteredStatement.periodPaid) * 100)
                          : 0;
                      return (
                        <div
                          key={pb.label}
                          className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-950/60 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900 dark:text-white">{pb.label}</span>
                            <span className="font-mono-num font-bold text-emerald-600">
                              {formatEGP(pb.total)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-500">
                            <span>{pb.count} حركة</span>
                            <div className="flex-1 h-1.5 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                              <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                            </div>
                            <span>{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-300">
                        <tr>
                          <th className="px-3 py-2.5">الوسيلة / الخزينة</th>
                          <th className="px-3 py-2.5">عدد الحركات</th>
                          <th className="px-3 py-2.5">الإجمالي</th>
                          <th className="px-3 py-2.5">النسبة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredStatement.paymentBreakdown.map((pb) => {
                          const pct =
                            filteredStatement.periodPaid > 0
                              ? Math.round((pb.total / filteredStatement.periodPaid) * 100)
                              : 0;
                          return (
                            <tr key={pb.label}>
                              <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                                {pb.label}
                              </td>
                              <td className="px-3 py-2.5 font-mono-num">{pb.count}</td>
                              <td className="px-3 py-2.5 font-mono-num font-bold text-emerald-600">
                                {formatEGP(pb.total)}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800">
                                    <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="font-mono-num">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
