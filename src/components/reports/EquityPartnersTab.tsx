import {
  Edit3,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  ImageDown,
  Plus,
  Power,
  Printer,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePrint } from '../../context/PrintContext';
import type {
  EquityDrawing,
  EquityPartner,
  EquityPartnerDistributionRow,
  ReportsPayload,
  StoreSettings,
  TreasuryAccount,
} from '../../shared/types';
import { exportWorkbookXlsx } from '../../utils/exportUtils';
import { formatDateTimeAr, formatEGP } from '../../utils/formatters';

interface EquityPartnersTabProps {
  report: ReportsPayload;
  equityPartners: EquityPartner[];
  equityDrawings: EquityDrawing[];
  treasuries: TreasuryAccount[];
  settings: StoreSettings;
  printedBy: string;
  canViewProfits: boolean;
  canManagePartnersConfig: boolean;
  canRecordDrawings: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (message: string) => void;
}

const DRAWING_TYPE_LABELS: Record<EquityDrawing['type'], string> = {
  draw: 'مسحوبات نقدية',
  settlement: 'تسوية أرباح',
  capital_add: 'إضافة رأس مال',
};

export function EquityPartnersTab({
  report,
  equityPartners,
  equityDrawings,
  treasuries,
  settings,
  printedBy,
  canViewProfits,
  canManagePartnersConfig,
  canRecordDrawings,
  apiFetch,
  onMutated,
}: EquityPartnersTabProps) {
  const { printDocument, openPrintPreview, exportDocumentAsPdf, exportDocumentAsPng, exporting } = usePrint();
  const eq = report.equityDistribution;
  const [statementRow, setStatementRow] = useState<EquityPartnerDistributionRow | null>(null);

  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<EquityPartner | null>(null);
  const [pName, setPName] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pRoleTitle, setPRoleTitle] = useState('شريك');
  const [pCapital, setPCapital] = useState('0');
  const [pSharePercent, setPSharePercent] = useState('0');
  const [pNotes, setPNotes] = useState('');

  const [drawingModalOpen, setDrawingModalOpen] = useState(false);
  const [dPartnerId, setDPartnerId] = useState('');
  const [dType, setDType] = useState<EquityDrawing['type']>('draw');
  const [dAmount, setDAmount] = useState('');
  const [dTreasuryId, setDTreasuryId] = useState(treasuries.find((t) => t.active)?.id || '');
  const [dNotes, setDNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreatePartner = () => {
    setEditingPartner(null);
    setPName('');
    setPPhone('');
    setPRoleTitle('شريك ممول');
    setPCapital('0');
    setPSharePercent('10');
    setPNotes('');
    setFormError(null);
    setPartnerModalOpen(true);
  };

  const openEditPartner = (partner: EquityPartner) => {
    setEditingPartner(partner);
    setPName(partner.name);
    setPPhone(partner.phone);
    setPRoleTitle(partner.roleTitle);
    setPCapital(String(partner.capitalContribution));
    setPSharePercent(String(partner.profitSharePercent));
    setPNotes(partner.notes);
    setFormError(null);
    setPartnerModalOpen(true);
  };

  const openRecordDrawing = (partnerId?: string) => {
    const firstActive = equityPartners.find((p) => p.active)?.id || equityPartners[0]?.id || '';
    setDPartnerId(partnerId || firstActive);
    setDType('draw');
    setDAmount('');
    setDTreasuryId(treasuries.find((t) => t.active && t.isDefault)?.id || treasuries.find((t) => t.active)?.id || '');
    setDNotes('');
    setFormError(null);
    setDrawingModalOpen(true);
  };

  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: pName.trim(),
        phone: pPhone.trim(),
        roleTitle: pRoleTitle.trim(),
        capitalContribution: Number(pCapital || 0),
        profitSharePercent: Number(pSharePercent || 0),
        notes: pNotes.trim(),
      };
      if (editingPartner) {
        await apiFetch(`/api/equity-partners/${editingPartner.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setPartnerModalOpen(false);
        onMutated(`تم تحديث بيانات وحصة الشريك: ${payload.name}`);
      } else {
        await apiFetch('/api/equity-partners', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setPartnerModalOpen(false);
        onMutated(`تمت إضافة الشريك: ${payload.name}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ بيانات الشريك');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (partner: EquityPartner) => {
    try {
      await apiFetch(`/api/equity-partners/${partner.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !partner.active }),
      });
      onMutated(partner.active ? `تم تعطيل الشريك: ${partner.name}` : `تم تفعيل الشريك: ${partner.name}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر تغيير حالة الشريك');
    }
  };

  const handleDeletePartner = async (partner: EquityPartner) => {
    try {
      await apiFetch(`/api/equity-partners/${partner.id}`, { method: 'DELETE' });
      onMutated(`تم حذف حساب الشريك: ${partner.name}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حذف الشريك');
    }
  };

  const handleSaveDrawing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dPartnerId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/equity-partners/${dPartnerId}/drawings`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(dAmount),
          type: dType,
          treasuryId: dTreasuryId || null,
          notes: dNotes.trim(),
        }),
      });
      setDrawingModalOpen(false);
      onMutated('تم تسجيل حركة الشريك وتحديث رصيد الخزينة بنجاح');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر تسجيل حركة الشريك');
    } finally {
      setSubmitting(false);
    }
  };

  const configuredPct = eq?.totalSharePercentConfigured ?? 0;
  const unallocatedPct = Math.max(0, Number((100 - configuredPct).toFixed(2)));
  const rows = eq?.rows || [];
  const drawingsList = eq?.drawingsInPeriod?.length ? eq.drawingsInPeriod : equityDrawings;

  const statementDrawings = useMemo(() => {
    if (!statementRow) return [];
    return equityDrawings.filter((d) => d.partnerId === statementRow.partner.id);
  }, [equityDrawings, statementRow]);

  const buildPartnerStatementPayload = (row: EquityPartnerDistributionRow) => ({
    kind: 'equity_partner_statement' as const,
    partner: row.partner,
    distributionRow: row,
    drawings: equityDrawings.filter((d) => d.partnerId === row.partner.id),
    fromDate: report.fromDate,
    toDate: report.toDate,
    settings,
    printedBy,
    canViewProfits,
  });

  const handleExportPartnerStatementXlsx = (row: EquityPartnerDistributionRow) => {
    const partnerDrawings = equityDrawings.filter((d) => d.partnerId === row.partner.id);
    const totalDraws = partnerDrawings
      .filter((d) => d.type !== 'capital_add')
      .reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalCap = partnerDrawings
      .filter((d) => d.type === 'capital_add')
      .reduce((s, d) => s + Number(d.amount || 0), 0);

    exportWorkbookXlsx(`كشف-حساب-شريك-${row.partner.name}.xlsx`, [
      {
        name: 'ملخص_حساب_الشريك',
        title: `${settings.storeName} — كشف حساب شريك: ${row.partner.name}`,
        subtitle: `الصفة: ${row.partner.roleTitle} | النسبة: ${row.partner.profitSharePercent}% | الفترة: ${report.fromDate || 'البداية'} ← ${report.toDate || 'الآن'}`,
        headers: ['البند المالي', 'القيمة'],
        rows: [
          ['اسم الشريك', row.partner.name],
          ['الصفة / الدور', row.partner.roleTitle],
          ['نسبة الأرباح المقررة %', row.partner.profitSharePercent],
          ['رأس المال المساهم (ج.م)', row.partner.capitalContribution],
          ...(canViewProfits
            ? [
                ['حصة أرباح الفترة (ج.م)', row.periodProfitShare],
                ['إجمالي الأرباح التراكمية المقدرة (ج.م)', row.allTimeProfitShareEstimate],
              ]
            : []),
          ['مسحوبات الفترة (ج.م)', row.periodDrawings],
          ['إجمالي المسحوبات التراكمية (ج.م)', row.allTimeDrawings],
          ...(canViewProfits ? [['صافي الرصيد المستحق للشريك (ج.م)', row.netPayableBalance]] : []),
        ],
      },
      {
        name: 'سجل_المسحوبات_والتسويات',
        title: `سجل حركات الشريك: ${row.partner.name}`,
        subtitle: `إجمالي الحركات: ${partnerDrawings.length}`,
        headers: ['التاريخ والوقت', 'نوع الحركة', 'الخزينة', 'المسؤول', 'الملاحظات', 'المبلغ (ج.م)'],
        rows: partnerDrawings.map((d) => [
          formatDateTimeAr(d.createdAt),
          DRAWING_TYPE_LABELS[d.type],
          d.treasuryName || '—',
          d.actorName,
          d.notes || '—',
          d.type === 'capital_add' ? d.amount : -d.amount,
        ]),
        totalsRow: [
          'الإجمالي',
          `${partnerDrawings.length} حركة`,
          '',
          '',
          `ضخ رأس مال: +${totalCap} | مسحوبات: ${totalDraws}`,
          Number((totalCap - totalDraws).toFixed(2)),
        ],
      },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Top Ownership & Distribution Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">إجمالي حصص الشركاء المفعلة</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-slate-900 dark:text-white">
            {configuredPct}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            {unallocatedPct > 0 ? `احتياطي / غير موزع: ${unallocatedPct}%` : 'مكتمل التوزيع (100%)'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">صافي الربح القابل للتوزيع (الفترة)</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {canViewProfits ? formatEGP(eq?.netDistributableProfit || 0) : 'مقيد بالصلاحية'}
          </div>
          <div className="mt-1 text-xs text-slate-500">محسوب بعد تكلفة البضاعة والمصروفات</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">مسحوبات الشركاء بالفترة</div>
          <div className="mt-1 font-mono-num text-xl font-bold text-rose-600 dark:text-rose-400">
            {formatEGP(rows.reduce((s, r) => s + r.periodDrawings, 0))}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num">
            {rows.filter((r) => r.partner.active).length} شركاء نشطين
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between gap-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">إدارة الشركاء والتسويات</div>
          <div className="flex flex-wrap gap-2">
            {canManagePartnersConfig && (
              <button
                type="button"
                onClick={openCreatePartner}
                className="flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>إضافة شريك</span>
              </button>
            )}
            {canRecordDrawings && equityPartners.length > 0 && (
              <button
                type="button"
                onClick={() => openRecordDrawing()}
                className="flex flex-1 min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span>سحب / تسوية</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {formError && !partnerModalOpen && !drawingModalOpen && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {formError}
        </div>
      )}

      {/* Partner Profit Distribution Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            جدول توزيع حصص الأرباح وأرصدة الشركاء
          </h3>
          <span className="text-xs text-slate-500">يتم جبر فروق القروش على الشريك الأخير</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs sm:text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">الشريك</th>
                <th className="px-4 py-3">رأس المال</th>
                <th className="px-4 py-3 text-center">النسبة %</th>
                {canViewProfits && <th className="px-4 py-3">حصة ربح الفترة</th>}
                <th className="px-4 py-3">مسحوبات الفترة</th>
                {canViewProfits && <th className="px-4 py-3">إجمالي الأرباح التراكمية</th>}
                <th className="px-4 py-3">إجمالي المسحوبات</th>
                {canViewProfits && <th className="px-4 py-3">صافي المستحق للشريك</th>}
                <th className="px-4 py-3">إجراءات وكشف حساب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                    لا يوجد شركاء مسجلون حالياً.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.partner.id}
                    className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${
                      !r.partner.active ? 'opacity-55' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{r.partner.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.partner.roleTitle}
                        {!r.partner.active ? ' · معطل' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-num">
                      {formatEGP(r.partner.capitalContribution)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono-num font-bold text-slate-900 dark:text-white">
                      {r.partner.profitSharePercent}%
                    </td>
                    {canViewProfits && (
                      <td className="px-4 py-3 font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(r.periodProfitShare)}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono-num text-rose-600 dark:text-rose-400">
                      {formatEGP(r.periodDrawings)}
                    </td>
                    {canViewProfits && (
                      <td className="px-4 py-3 font-mono-num text-slate-700 dark:text-slate-300">
                        {formatEGP(r.allTimeProfitShareEstimate)}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono-num text-rose-600 dark:text-rose-400">
                      {formatEGP(r.allTimeDrawings)}
                    </td>
                    {canViewProfits && (
                      <td
                        className={`px-4 py-3 font-mono-num font-extrabold ${
                          r.netPayableBalance >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatEGP(r.netPayableBalance)}
                      </td>
                    )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setStatementRow(r)}
                            title="كشف حساب شريك تفصيلي"
                            className="min-h-[36px] inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-slate-700 dark:text-sky-400 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>كشف حساب</span>
                          </button>
                          {canRecordDrawings && (
                            <button
                              type="button"
                              onClick={() => openRecordDrawing(r.partner.id)}
                              title="تسجيل سحب أو تسوية"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md border border-slate-200 text-emerald-600 hover:bg-emerald-50 dark:border-slate-700 dark:hover:bg-slate-800"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManagePartnersConfig && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditPartner(r.partner)}
                                title="تعديل بيانات الشريك"
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(r.partner)}
                                title={r.partner.active ? 'تعطيل الشريك' : 'تفعيل الشريك'}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md border border-slate-200 text-amber-600 hover:bg-amber-50 dark:border-slate-700 dark:hover:bg-slate-800"
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                              {equityPartners.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeletePartner(r.partner)}
                                  title="حذف الشريك"
                                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md border border-slate-200 text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-slate-800"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawings & Capital Ledger */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            سجل مسحوبات وتسويات الشركاء ({drawingsList.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">التاريخ</th>
                <th className="px-4 py-2.5">الشريك</th>
                <th className="px-4 py-2.5">نوع الحركة</th>
                <th className="px-4 py-2.5">الخزينة</th>
                <th className="px-4 py-2.5">المبلغ</th>
                <th className="px-4 py-2.5">المسؤول / الملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {drawingsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    لا توجد مسحوبات أو تسويات مسجلة في هذه الفترة.
                  </td>
                </tr>
              ) : (
                drawingsList.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-mono-num text-slate-500">
                      {formatDateTimeAr(d.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">
                      {d.partnerName}
                    </td>
                    <td className="px-4 py-2.5">{DRAWING_TYPE_LABELS[d.type]}</td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                      {d.treasuryName || '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 font-mono-num font-bold ${
                        d.type === 'capital_add' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {d.type === 'capital_add' ? '+' : '-'}
                      {formatEGP(d.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {d.actorName}
                      {d.notes ? ` · ${d.notes}` : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Partner Modal */}
      {partnerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {editingPartner ? `تعديل بيانات الشريك: ${editingPartner.name}` : 'إضافة شريك جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setPartnerModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleSavePartner} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">اسم الشريك</label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">الصفة / الدور</label>
                  <input
                    type="text"
                    value={pRoleTitle}
                    onChange={(e) => setPRoleTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">رقم الهاتف</label>
                  <input
                    type="text"
                    value={pPhone}
                    onChange={(e) => setPPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    نسبة الأرباح (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    required
                    value={pSharePercent}
                    onChange={(e) => setPSharePercent(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    رأس المال المساهم (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pCapital}
                    onChange={(e) => setPCapital(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">ملاحظات</label>
                <input
                  type="text"
                  value={pNotes}
                  onChange={(e) => setPNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPartnerModalOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'جاري الحفظ...' : 'حفظ الشريك'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Partner Drawing / Settlement Modal */}
      {drawingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                تسجيل حركة مالية لشريك (مسحوبات / تسوية / زيادة رأس مال)
              </h3>
              <button
                type="button"
                onClick={() => setDrawingModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveDrawing} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">الشريك</label>
                <select
                  value={dPartnerId}
                  onChange={(e) => setDPartnerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                >
                  {equityPartners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.profitSharePercent}%)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">نوع الحركة</label>
                  <select
                    value={dType}
                    onChange={(e) => setDType(e.target.value as EquityDrawing['type'])}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="draw">مسحوبات جارية (تخصم من الخزينة)</option>
                    <option value="settlement">تسوية وصرف أرباح (تخصم من الخزينة)</option>
                    <option value="capital_add">ضخ / زيادة رأس مال (تضاف للخزينة)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">المبلغ (ج.م)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={dAmount}
                    onChange={(e) => setDAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  الخزينة المرتبطة
                </label>
                <select
                  value={dTreasuryId}
                  onChange={(e) => setDTreasuryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                >
                  {treasuries
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatEGP(t.currentBalance)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">ملاحظات / مرجع</label>
                <input
                  type="text"
                  value={dNotes}
                  onChange={(e) => setDNotes(e.target.value)}
                  placeholder="مثال: تسوية أرباح شهر نوفمبر"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDrawingModalOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'جاري التنفيذ...' : 'اعتماد الحركة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Individual Equity Partner Statement Modal */}
      {statementRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  كشف حساب شريك: {statementRow.partner.name}
                </h3>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {statementRow.partner.roleTitle} · نسبة الأرباح{' '}
                  <span className="font-mono-num font-bold text-slate-700 dark:text-slate-200">
                    {statementRow.partner.profitSharePercent}%
                  </span>
                  {statementRow.partner.phone ? ` · ${statementRow.partner.phone}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openPrintPreview(buildPartnerStatementPayload(statementRow))}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>معاينة</span>
                </button>
                <button
                  type="button"
                  onClick={() => printDocument(buildPartnerStatementPayload(statementRow))}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>طباعة A4</span>
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() =>
                    exportDocumentAsPdf(
                      buildPartnerStatementPayload(statementRow),
                      `كشف-حساب-${statementRow.partner.name}.pdf`
                    )
                  }
                  className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() =>
                    exportDocumentAsPng(
                      buildPartnerStatementPayload(statementRow),
                      `كشف-حساب-${statementRow.partner.name}.png`
                    )
                  }
                  className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                >
                  <ImageDown className="h-3.5 w-3.5" />
                  <span>PNG</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportPartnerStatementXlsx(statementRow)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>XLSX</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatementRow(null)}
                  className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-slate-500">رأس المال</div>
                  <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {formatEGP(statementRow.partner.capitalContribution)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-slate-500">حصة ربح الفترة</div>
                  <div className="mt-1 font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {canViewProfits ? formatEGP(statementRow.periodProfitShare) : 'مقيد'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-slate-500">الأرباح التراكمية المقدرة</div>
                  <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                    {canViewProfits ? formatEGP(statementRow.allTimeProfitShareEstimate) : 'مقيد'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-slate-500">إجمالي المسحوبات</div>
                  <div className="mt-1 font-mono-num text-sm font-bold text-rose-600 dark:text-rose-400">
                    {formatEGP(statementRow.allTimeDrawings)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-slate-500">صافي المستحق</div>
                  <div
                    className={`mt-1 font-mono-num text-sm font-extrabold ${
                      statementRow.netPayableBalance >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {canViewProfits ? formatEGP(statementRow.netPayableBalance) : 'مقيد'}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2.5">التاريخ والوقت</th>
                        <th className="px-3 py-2.5">نوع الحركة</th>
                        <th className="px-3 py-2.5">الخزينة</th>
                        <th className="px-3 py-2.5">المسؤول</th>
                        <th className="px-3 py-2.5">ملاحظات</th>
                        <th className="px-3 py-2.5 text-left">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {statementDrawings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            لا توجد مسحوبات أو تسويات مسجلة لهذا الشريك حتى الآن.
                          </td>
                        </tr>
                      ) : (
                        statementDrawings.map((d) => (
                          <tr key={d.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2.5 font-mono-num text-slate-500">
                              {formatDateTimeAr(d.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                              {DRAWING_TYPE_LABELS[d.type]}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                              {d.treasuryName || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{d.actorName}</td>
                            <td className="px-3 py-2.5 text-slate-500">{d.notes || '—'}</td>
                            <td
                              className={`px-3 py-2.5 text-left font-mono-num font-bold ${
                                d.type === 'capital_add' ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {d.type === 'capital_add' ? '+' : '-'}
                              {formatEGP(d.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
