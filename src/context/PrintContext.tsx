import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PrintDocuments } from '../components/PrintDocuments';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import type {
  CustomReportTabularResult,
  DocumentTemplateArtifact,
  EquityDrawing,
  EquityPartner,
  EquityPartnerDistributionRow,
  Invoice,
  PartnerItemizedSummaryRow,
  PartnerStatementLineItem,
  Product,
  PurchaseOrder,
  ReportsPayload,
  ReportSubTab,
  SalesQuotation,
  ShiftClosure,
  StoreActivityProfile,
  StoreExpense,
  StoreSettings,
  WhatIfSimulationSummary,
} from '../shared/types';
import { exportElementToPdf, exportElementToPng } from '../utils/exportUtils';

export interface PartnerStatementEntry {
  id: string;
  date: string;
  entryType?: 'invoice' | 'purchase' | 'payment' | 'return';
  typeLabel: string;
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
  notes?: string;
  dueDate?: string | null;
  invoiceStatus?: string;
  treasuryBreakdown?: string;
  items?: PartnerStatementLineItem[];
}

export type PrintDocumentPayload =
  | {
      kind: 'invoice_a4';
      invoice: Invoice;
      settings: StoreSettings;
      activityName: string;
      customerBalanceDue?: number;
    }
  | {
      kind: 'invoice_thermal';
      invoice: Invoice;
      settings: StoreSettings;
    }
  | {
      kind: 'report';
      report: ReportsPayload;
      subTab: ReportSubTab;
      invStatusFilter: 'all' | 'available' | 'low' | 'overstock' | 'out';
      canViewProfits: boolean;
      settings: StoreSettings;
      activities: StoreActivityProfile[];
      printedBy: string;
      financialSummary?: {
        totalExpenses: number;
        netIncome: number;
        customerReceivables: number;
        supplierPayables: number;
        treasuriesTotal: number;
      };
      customReport?: CustomReportTabularResult;
      whatIfSummary?: WhatIfSimulationSummary;
    }
  | {
      kind: 'barcodes';
      items: Array<{ product: Product; copies: number }>;
      settings: StoreSettings;
    }
  | {
      kind: 'shift_z';
      closure: ShiftClosure;
      settings: StoreSettings;
    }
  | {
      kind: 'purchase_a4';
      purchase: PurchaseOrder;
      settings: StoreSettings;
    }
  | {
      kind: 'expenses_report';
      expenses: StoreExpense[];
      settings: StoreSettings;
      printedBy: string;
      dateFrom?: string;
      dateTo?: string;
      treasuryFilterLabel?: string;
      template?: DocumentTemplateArtifact;
    }
  | {
      kind: 'partner_statement_a4';
      partnerType: 'customer' | 'supplier';
      partnerName: string;
      partnerPhone: string;
      currentBalance: number;
      openingBalance?: number;
      creditLimit?: number;
      entries: PartnerStatementEntry[];
      statementMode?: 'summary' | 'itemized';
      dateFrom?: string;
      dateTo?: string;
      itemizedSummary?: PartnerItemizedSummaryRow[];
      paymentBreakdown?: Array<{ label: string; count: number; total: number }>;
      loyaltyPoints?: number;
      storeCreditBalance?: number;
      totalReturns?: number;
      settings: StoreSettings;
      printedBy: string;
      template?: DocumentTemplateArtifact;
    }
  | {
      kind: 'equity_partner_statement';
      partner: EquityPartner;
      distributionRow: EquityPartnerDistributionRow;
      drawings: EquityDrawing[];
      fromDate?: string;
      toDate?: string;
      settings: StoreSettings;
      printedBy: string;
      canViewProfits: boolean;
    }
  | {
      kind: 'quotation_a4';
      quotation: SalesQuotation;
      settings: StoreSettings;
      activityName: string;
    };

interface PrintContextValue {
  printDocument: (payload: PrintDocumentPayload) => void;
  openPrintPreview: (payload: PrintDocumentPayload) => void;
  exportDocumentAsPdf: (payload: PrintDocumentPayload, filename: string) => Promise<void>;
  exportDocumentAsPng: (payload: PrintDocumentPayload, filename: string) => Promise<void>;
  exporting: boolean;
}

const PrintContext = createContext<PrintContextValue>({
  printDocument: () => {},
  openPrintPreview: () => {},
  exportDocumentAsPdf: async () => {},
  exportDocumentAsPng: async () => {},
  exporting: false,
});

function waitFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const [activePayload, setActivePayload] = useState<PrintDocumentPayload | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PrintDocumentPayload | null>(null);
  const [capturePayload, setCapturePayload] = useState<PrintDocumentPayload | null>(null);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);

  const cleanupPrint = useCallback(() => {
    document.body.classList.remove('has-print-document');
    setActivePayload(null);
  }, []);

  useEffect(() => {
    window.addEventListener('afterprint', cleanupPrint);
    return () => {
      window.removeEventListener('afterprint', cleanupPrint);
      document.body.classList.remove('has-print-document');
    };
  }, [cleanupPrint]);

  const printDocument = useCallback((payload: PrintDocumentPayload) => {
    document.body.classList.add('has-print-document');
    setActivePayload(payload);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => {
          document.body.classList.remove('has-print-document');
        }, 1200);
      });
    });
  }, []);

  const exportDocumentAsPdf = useCallback(async (payload: PrintDocumentPayload, filename: string) => {
    setExporting(true);
    setCapturePayload(payload);
    try {
      await waitFrames();
      if (!captureRef.current) return;
      await exportElementToPdf(captureRef.current, filename, 'portrait', payload.settings?.storeName);
    } finally {
      setCapturePayload(null);
      setExporting(false);
    }
  }, []);

  const exportDocumentAsPng = useCallback(async (payload: PrintDocumentPayload, filename: string) => {
    setExporting(true);
    setCapturePayload(payload);
    try {
      await waitFrames();
      if (!captureRef.current) return;
      await exportElementToPng(captureRef.current, filename);
    } finally {
      setCapturePayload(null);
      setExporting(false);
    }
  }, []);

  const openPrintPreview = useCallback((payload: PrintDocumentPayload) => {
    setPreviewPayload(payload);
  }, []);

  return (
    <PrintContext.Provider
      value={{ printDocument, openPrintPreview, exportDocumentAsPdf, exportDocumentAsPng, exporting }}
    >
      {children}
      <PrintPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
        onPrint={(adjusted) => {
          setPreviewPayload(null);
          printDocument(adjusted);
        }}
        onExportPdf={exportDocumentAsPdf}
        onExportPng={exportDocumentAsPng}
        exporting={exporting}
      />
      <div id="print-portal-root" dir="rtl">
        {activePayload && <PrintDocuments payload={activePayload} />}
      </div>

      {/* Offscreen pure light-mode container used strictly for crisp PNG / PDF capture */}
      {capturePayload && (
        <div
          aria-hidden="true"
          dir="rtl"
          style={{
            position: 'fixed',
            left: '-10000px',
            top: 0,
            zIndex: -1,
            pointerEvents: 'none',
            backgroundColor: '#ffffff',
            color: '#0f172a',
            colorScheme: 'light',
          }}
        >
          <div
            ref={captureRef}
            style={{
              backgroundColor: '#ffffff',
              color: '#0f172a',
              colorScheme: 'light',
              width: capturePayload.kind === 'invoice_thermal' || capturePayload.kind === 'shift_z' ? '340px' : '794px',
              padding: capturePayload.kind === 'invoice_thermal' || capturePayload.kind === 'shift_z' ? '14px' : '28px',
            }}
          >
            <PrintDocuments payload={capturePayload} />
          </div>
        </div>
      )}
    </PrintContext.Provider>
  );
}

export function usePrint() {
  return useContext(PrintContext);
}
