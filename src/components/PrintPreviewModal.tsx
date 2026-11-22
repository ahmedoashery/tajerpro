import { useMemo, useState } from 'react';
import { FileDown, ImageDown, Printer, SlidersHorizontal, X } from 'lucide-react';
import type { PrintDocumentPayload } from '../context/PrintContext';
import type { PrintTemplateSettings } from '../shared/types';
import { PrintDocuments } from './PrintDocuments';

interface PrintPreviewModalProps {
  payload: PrintDocumentPayload | null;
  onClose: () => void;
  onPrint: (adjusted: PrintDocumentPayload) => void;
  onExportPdf: (adjusted: PrintDocumentPayload, filename: string) => Promise<void>;
  onExportPng: (adjusted: PrintDocumentPayload, filename: string) => Promise<void>;
  exporting: boolean;
}

export function PrintPreviewModal({
  payload,
  onClose,
  onPrint,
  onExportPdf,
  onExportPng,
  exporting,
}: PrintPreviewModalProps) {
  const baseTpl: PrintTemplateSettings | undefined = payload?.settings?.printTemplate;
  const [paperMode, setPaperMode] = useState<'a4' | 'thermal_80mm'>(
    payload?.kind === 'invoice_thermal' ? 'thermal_80mm' : 'a4'
  );
  const [showControls, setShowControls] = useState(true);
  const [showTaxNumber, setShowTaxNumber] = useState(baseTpl?.showTaxNumber ?? true);
  const [showBarcode, setShowBarcode] = useState(baseTpl?.showBarcode ?? true);
  const [showSha256Hash, setShowSha256Hash] = useState(baseTpl?.showSha256Hash ?? true);
  const [showCashierName, setShowCashierName] = useState(baseTpl?.showCashierName ?? true);
  const [showCustomerBalance, setShowCustomerBalance] = useState(baseTpl?.showCustomerBalance ?? true);
  const [showVatSummary, setShowVatSummary] = useState(baseTpl?.showVatSummary ?? false);
  const [showSignatureLine, setShowSignatureLine] = useState(baseTpl?.showSignatureLine ?? true);

  const isInvoice = payload?.kind === 'invoice_a4' || payload?.kind === 'invoice_thermal';
  const effectivePaper: 'a4' | 'thermal_80mm' = isInvoice
    ? paperMode
    : payload?.kind === 'shift_z'
      ? 'thermal_80mm'
      : 'a4';

  const adjustedPayload = useMemo<PrintDocumentPayload | null>(() => {
    if (!payload) return null;
    const nextSettings = {
      ...payload.settings,
      printTemplate: {
        ...payload.settings.printTemplate,
        showTaxNumber,
        showBarcode,
        showSha256Hash,
        showCashierName,
        showCustomerBalance,
        showVatSummary,
        showSignatureLine,
      },
    };

    if (payload.kind === 'invoice_a4' && effectivePaper === 'thermal_80mm') {
      return {
        kind: 'invoice_thermal',
        invoice: payload.invoice,
        settings: nextSettings,
      };
    }
    if (payload.kind === 'invoice_thermal' && effectivePaper === 'a4') {
      return {
        kind: 'invoice_a4',
        invoice: payload.invoice,
        settings: nextSettings,
        activityName: nextSettings.storeName,
      };
    }
    return { ...payload, settings: nextSettings } as PrintDocumentPayload;
  }, [
    payload,
    effectivePaper,
    showTaxNumber,
    showBarcode,
    showSha256Hash,
    showCashierName,
    showCustomerBalance,
    showVatSummary,
    showSignatureLine,
  ]);

  if (!payload || !adjustedPayload) return null;

  const baseFilename =
    adjustedPayload.kind === 'invoice_a4' || adjustedPayload.kind === 'invoice_thermal'
      ? adjustedPayload.invoice.invoiceNumber
      : adjustedPayload.kind === 'purchase_a4'
        ? adjustedPayload.purchase.purchaseNumber
        : adjustedPayload.kind === 'quotation_a4'
          ? adjustedPayload.quotation.quotationNumber
          : adjustedPayload.kind === 'partner_statement_a4'
            ? `statement-${adjustedPayload.partnerName}`
            : adjustedPayload.kind === 'equity_partner_statement'
              ? `equity-partner-${adjustedPayload.partner.name}`
              : adjustedPayload.kind === 'shift_z'
                ? `shift-z-${adjustedPayload.closure.id}`
                : `tajirpro-doc-${new Date().toISOString().slice(0, 10)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-2 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-emerald-600" />
            <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              معاينة المستند التفاعلية قبل الطباعة والتصدير
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isInvoice && (
              <div className="inline-flex rounded-xl border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setPaperMode('a4')}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                    effectivePaper === 'a4'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  صفحة A4
                </button>
                <button
                  type="button"
                  onClick={() => setPaperMode('thermal_80mm')}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                    effectivePaper === 'thermal_80mm'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  حراري 80mm
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowControls((v) => !v)}
              className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              {showControls ? 'إخفاء التخصيص' : 'تخصيص العناصر'}
            </button>

            <button
              type="button"
              onClick={() => onPrint(adjustedPayload)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 text-xs font-bold text-white"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>

            <button
              type="button"
              disabled={exporting}
              onClick={() => onExportPdf(adjustedPayload, `${baseFilename}.pdf`)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" />
              PDF
            </button>

            <button
              type="button"
              disabled={exporting}
              onClick={() => onExportPng(adjustedPayload, `${baseFilename}.png`)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <ImageDown className="h-4 w-4" />
              PNG
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Optional Live Toggles */}
        {showControls && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 px-4 py-2.5 text-xs">
            {[
              { label: 'الرقم الضريبي', val: showTaxNumber, set: setShowTaxNumber },
              { label: 'باركود المستند', val: showBarcode, set: setShowBarcode },
              { label: 'اسم الكاشير', val: showCashierName, set: setShowCashierName },
              { label: 'رصيد العميل', val: showCustomerBalance, set: setShowCustomerBalance },
              { label: 'تفصيل ض.ق.م', val: showVatSummary, set: setShowVatSummary },
              { label: 'بصمة SHA-256', val: showSha256Hash, set: setShowSha256Hash },
              { label: 'سطر التوقيع', val: showSignatureLine, set: setShowSignatureLine },
            ].map((item) => (
              <label key={item.label} className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={item.val}
                  onChange={(e) => item.set(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        )}

        {/* Crisp Light Preview Sheet */}
        <div className="flex-1 overflow-auto bg-slate-200/80 dark:bg-slate-950 p-4 sm:p-8">
          <div
            dir="rtl"
            className={`mx-auto bg-white text-slate-900 shadow-xl rounded-lg overflow-hidden ${
              effectivePaper === 'thermal_80mm' ? 'max-w-[350px] p-3.5' : 'max-w-[820px] p-6 sm:p-8'
            }`}
            style={{ colorScheme: 'light' }}
          >
            <PrintDocuments payload={adjustedPayload} />
          </div>
        </div>
      </div>
    </div>
  );
}
