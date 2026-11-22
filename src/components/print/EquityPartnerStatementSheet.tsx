import type { PrintDocumentPayload } from '../../context/PrintContext';
import type { EquityDrawing } from '../../shared/types';
import { formatDateTimeAr, formatEGP } from '../../utils/formatters';

type EquityPartnerStatementPayload = Extract<PrintDocumentPayload, { kind: 'equity_partner_statement' }>;

const DRAWING_TYPE_LABELS: Record<EquityDrawing['type'], string> = {
  draw: 'مسحوبات نقدية',
  settlement: 'تسوية أرباح',
  capital_add: 'ضخ رأس مال',
};

export function EquityPartnerStatementSheet({
  payload,
  printedAt,
}: {
  payload: EquityPartnerStatementPayload;
  printedAt: string;
}) {
  const {
    partner,
    distributionRow,
    drawings,
    fromDate,
    toDate,
    settings,
    printedBy,
    canViewProfits,
  } = payload;

  const accent = settings.printTemplate?.accentColor || '#059669';
  const showTax = settings.printTemplate?.showTaxNumber ?? true;
  const showSig = settings.printTemplate?.showSignatureLine ?? true;

  const totalDrawsOnly = drawings
    .filter((d) => d.type !== 'capital_add')
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalCapitalAdded = drawings
    .filter((d) => d.type === 'capital_add')
    .reduce((s, d) => s + Number(d.amount || 0), 0);

  return (
    <div className="print-a4-sheet space-y-5" dir="rtl">
      <header className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: accent }}>
        <div className="space-y-1">
          <div className="font-display text-2xl font-bold text-slate-900">{settings.storeName}</div>
          <div className="text-xs text-slate-600">
            {settings.address} · هاتف: <span className="font-mono-num">{settings.phone}</span>
          </div>
          {showTax && settings.taxNumber && (
            <div className="font-mono-num text-[11px] text-slate-500">
              الرقم الضريبي: {settings.taxNumber}
            </div>
          )}
        </div>
        <div className="text-left space-y-1">
          <div className="font-display text-lg font-bold text-slate-900">
            كشف حساب شريك تفصيلي (الأرباح والمسحوبات)
          </div>
          <div className="text-xs text-slate-600">تاريخ الإصدار: {printedAt}</div>
          <div className="font-mono-num text-[11px] text-slate-600">
            الفترة: {fromDate || 'البداية'} ← {toDate || 'الآن'}
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-xs space-y-3 print-avoid-break">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
          <div>
            <span className="text-slate-500">اسم الشريك: </span>
            <strong className="text-sm font-bold text-slate-900">{partner.name}</strong>
            <span className="mr-3 text-slate-600">الصفة: {partner.roleTitle}</span>
            {partner.phone && (
              <span className="mr-3 font-mono-num text-slate-600">هاتف: {partner.phone}</span>
            )}
          </div>
          <div className="flex items-center gap-4 font-mono-num text-[11px] text-slate-700">
            <span>
              نسبة الأرباح: <strong className="text-slate-900">{partner.profitSharePercent}%</strong>
            </span>
            <span>
              الحالة: <strong>{partner.active ? 'شريك نشط' : 'حساب معطل'}</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2.5">
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">رأس المال المساهم</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-slate-900">
              {formatEGP(partner.capitalContribution)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">حصة ربح الفترة</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-emerald-700">
              {canViewProfits ? formatEGP(distributionRow.periodProfitShare) : 'مقيد'}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">الأرباح التراكمية المقدرة</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-slate-900">
              {canViewProfits ? formatEGP(distributionRow.allTimeProfitShareEstimate) : 'مقيد'}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">إجمالي المسحوبات التراكمية</div>
            <div className="mt-0.5 font-mono-num text-xs font-bold text-rose-700">
              {formatEGP(distributionRow.allTimeDrawings)}
            </div>
          </div>
          <div className="rounded border border-slate-300 bg-white p-2">
            <div className="text-[10px] text-slate-600">صافي الرصيد المستحق للشريك</div>
            <div className="mt-0.5 font-mono-num text-sm font-extrabold text-slate-900">
              {canViewProfits ? formatEGP(distributionRow.netPayableBalance) : 'مقيد'}
            </div>
          </div>
        </div>
      </section>

      <table className="print-table text-xs">
        <thead>
          <tr>
            <th>#</th>
            <th>التاريخ والوقت</th>
            <th>نوع الحركة</th>
            <th>الخزينة المرتبطة</th>
            <th>المسؤول عن القيد</th>
            <th>ملاحظات</th>
            <th className="text-left">المبلغ (ج.م)</th>
          </tr>
        </thead>
        <tbody>
          {drawings.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-4 text-slate-500">
                لا توجد حركات مسحوبات أو تسويات مسجلة لهذا الشريك.
              </td>
            </tr>
          ) : (
            drawings.map((d, idx) => (
              <tr key={d.id}>
                <td className="font-mono-num">{idx + 1}</td>
                <td className="font-mono-num whitespace-nowrap">{formatDateTimeAr(d.createdAt)}</td>
                <td className="font-semibold">{DRAWING_TYPE_LABELS[d.type]}</td>
                <td>{d.treasuryName || '—'}</td>
                <td>{d.actorName}</td>
                <td>{d.notes || '—'}</td>
                <td
                  className={`text-left font-mono-num font-bold ${
                    d.type === 'capital_add' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {d.type === 'capital_add' ? '+' : '-'}
                  {formatEGP(d.amount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold text-slate-900">
            <td colSpan={4}>إجمالي الحركات ({drawings.length} حركة)</td>
            <td colSpan={2} className="font-mono-num text-[11px]">
              سحب/تسوية: {formatEGP(totalDrawsOnly)}
              {totalCapitalAdded > 0 ? ` · ضخ رأس مال: +${formatEGP(totalCapitalAdded)}` : ''}
            </td>
            <td className="text-left font-mono-num">
              {canViewProfits ? formatEGP(distributionRow.netPayableBalance) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>

      <footer className="flex items-center justify-between border-t border-slate-300 pt-4 text-[11px] text-slate-600 print-avoid-break">
        <div>
          طبع بواسطة: {printedBy} · {settings.receiptFooter}
        </div>
        {showSig && (
          <div className="flex gap-8">
            <span>توقيع الشريك: ..........................</span>
            <span>اعتماد الإدارة: ..........................</span>
          </div>
        )}
      </footer>
    </div>
  );
}
