import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AutoReorderSupplierGroup,
  BootstrapSnapshot,
  Customer,
  CustomReportConfig,
  CustomReportTabularResult,
  DashboardSummary,
  DataImportSummary,
  DocumentTemplateArtifact,
  DocumentTemplateKind,
  EquityDrawing,
  EquityPartner,
  ExpenseCategory,
  IntegrityReport,
  Invoice,
  InvoiceItem,
  InvoicePaymentAllocation,
  InvoiceReturnItem,
  InvoiceReturnRecord,
  InvoiceStatus,
  LoyaltyConfig,
  OwnerAnomalyAlert,
  PaymentGatewayConfig,
  PaymentMethod,
  PaymentTransaction,
  PermissionKey,
  PriceTier,
  PrintTemplateSettings,
  Product,
  ProductBatch,
  ProductPriceHistory,
  PromotionRuleType,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseReturnRecord,
  QuotationItem,
  RecurringExpense,
  RecurringExpenseFrequency,
  ReportsPayload,
  RolePermissionsMap,
  SalesQuotation,
  SavedCustomReportPreset,
  ScheduledReportConfig,
  ScheduledReportDigest,
  SecurityAuditLog,
  ServerRuntimeInfo,
  ShiftClosure,
  ShiftSummary,
  StaffUser,
  StockMovement,
  StoreActivityId,
  StoreExpense,
  StorePromotion,
  StoreSettings,
  Supplier,
  TreasuryAccount,
  TreasuryType,
  UserRole,
} from '../../shared/types.ts';
import { findBestPromotion } from '../../shared/promotionEngine.ts';
import {
  computeInvoiceChainHash,
  getMachineFingerprint,
  hashPin,
  issueSignedLicenseKey,
  verifyLicenseKey,
  verifyPin,
} from '../security/licenseEngine.ts';
import { ACTIVITY_SEED_PRODUCTS, STORE_ACTIVITIES } from './activities.ts';
import { AlertsAndReorderService } from './alertsAndReorderService.ts';
import { BatchAndPromotionRepository } from './batchAndPromotionRepo.ts';
import { DataExchangeRepository } from './dataExchangeRepo.ts';
import { EquityRepository } from './equityRepository.ts';
import { PartnersRepository } from './partnersRepo.ts';
import { PurchasesAndStocktakeRepository } from './purchasesAndStocktakeRepo.ts';
import { QuotationsRepository } from './quotationsRepo.ts';
import { ReportService } from './reportService.ts';
import { executePartialReturnOrExchange, type PartialReturnOrExchangeInput } from './returnsService.ts';
import { ScheduledReportsRepository } from './scheduledReportsRepo.ts';
import { SchemaManager } from './schemaManager.ts';
import { TreasuryAndExpensesRepository } from './treasuryAndExpensesRepo.ts';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'tajirpro-data')
  : path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
  : path.join(DATA_DIR, 'tajirpro.db');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const DEFAULT_PRINT_TEMPLATE: PrintTemplateSettings = {
  style: 'modern_emerald',
  defaultPaperSize: 'a4',
  accentColor: '#059669',
  customHeaderNote: '',
  showTaxNumber: true,
  showBarcode: true,
  showSha256Hash: true,
  showCashierName: true,
  showCustomerBalance: true,
  showSignatureLine: true,
  showVatSummary: false,
};

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  earnRateEgpPerPoint: 50,
  pointValueEgp: 1,
  minRedeemPoints: 10,
};

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMap = {
  owner: {
    pos_sell: true,
    invoice_return: true,
    view_profits_costs: true,
    edit_prices_stock: true,
    view_reports: true,
    manage_partners: true,
    manage_payments: true,
    manage_purchases: true,
    manage_expenses: true,
    manage_settings: true,
    manage_data_xlsx: true,
    manage_security_rbac: true,
  },
  manager: {
    pos_sell: true,
    invoice_return: true,
    view_profits_costs: true,
    edit_prices_stock: true,
    view_reports: true,
    manage_partners: true,
    manage_payments: false,
    manage_purchases: true,
    manage_expenses: true,
    manage_settings: true,
    manage_data_xlsx: false,
    manage_security_rbac: false,
  },
  cashier: {
    pos_sell: true,
    invoice_return: false,
    view_profits_costs: false,
    edit_prices_stock: false,
    view_reports: false,
    manage_partners: false,
    manage_payments: false,
    manage_purchases: false,
    manage_expenses: false,
    manage_settings: false,
    manage_data_xlsx: false,
    manage_security_rbac: false,
  },
};

export class StoreDatabase {
  private db: Database.Database;
  private failedPinAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private equityRepo: EquityRepository;
  private batchRepo: BatchAndPromotionRepository;
  private treasuryExpensesRepo: TreasuryAndExpensesRepository;
  private partnersRepo: PartnersRepository;
  private purchasesRepo: PurchasesAndStocktakeRepository;
  private dataExchangeRepo: DataExchangeRepository;
  private reportService: ReportService;
  private insightsService: AlertsAndReorderService;
  private scheduledReportsRepo: ScheduledReportsRepository;
  private quotationsRepo: QuotationsRepository;

  constructor() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    new SchemaManager(this.db).initialize();
    this.scheduledReportsRepo = new ScheduledReportsRepository(this.db);
    this.quotationsRepo = new QuotationsRepository(this.db, {
      getProductById: (id) => this.getProductById(id),
      getCustomerById: (id) => {
        const c = this.db
          .prepare('SELECT id, name, phone FROM customers WHERE id = ?')
          .get(id) as { id: string; name: string; phone: string } | undefined;
        return c || null;
      },
      getActivityId: () => this.getSettings().activityId,
    });
    this.equityRepo = new EquityRepository(this.db);
    this.batchRepo = new BatchAndPromotionRepository(this.db);
    this.treasuryExpensesRepo = new TreasuryAndExpensesRepository(this.db);
    this.partnersRepo = new PartnersRepository(this.db, {
      getInvoices: () => this.getInvoices(),
      getPurchaseOrders: () => this.getPurchaseOrders(),
      getTreasuries: () => this.treasuryExpensesRepo.getTreasuries(),
    });
    this.purchasesRepo = new PurchasesAndStocktakeRepository(this.db, {
      getSettings: () => this.getSettings(),
      getProductById: (id) => this.getProductById(id),
      getSuppliers: () => this.partnersRepo.getSuppliers(),
      getTreasuries: () => this.treasuryExpensesRepo.getTreasuries(),
      getMovementById: (id) => this.getMovementById(id),
      nextYearlySequenceNumber: (table, col, prefix) =>
        this.nextYearlySequenceNumber(
          table as 'invoices' | 'purchase_orders',
          col as 'invoice_number' | 'purchase_number',
          prefix as 'INV' | 'PUR'
        ),
      batchRepo: this.batchRepo,
    });
    this.dataExchangeRepo = new DataExchangeRepository(this.db, {
      getSettings: () => this.getSettings(),
      updateStoreSettings: (patch) =>
        this.updateStoreSettings(patch as Parameters<StoreDatabase['updateStoreSettings']>[0]),
      getAllProducts: () => this.getAllProducts(),
      createProduct: (input) =>
        this.createProduct(input as Parameters<StoreDatabase['createProduct']>[0]),
      updateProductPriceOrInfo: (productId, patch) =>
        this.updateProductPriceOrInfo(
          productId,
          patch as Parameters<StoreDatabase['updateProductPriceOrInfo']>[1]
        ),
      getCustomers: () => this.partnersRepo.getCustomers(),
      addCustomer: (input) => this.partnersRepo.addCustomer(input),
      updateCustomer: (id, patch) =>
        this.partnersRepo.updateCustomer(
          id,
          patch as Parameters<PartnersRepository['updateCustomer']>[1]
        ),
      getSuppliers: () => this.partnersRepo.getSuppliers(),
      addSupplier: (input) => this.partnersRepo.addSupplier(input),
      updateSupplier: (id, patch) =>
        this.partnersRepo.updateSupplier(
          id,
          patch as Parameters<PartnersRepository['updateSupplier']>[1]
        ),
      getTreasuries: () => this.treasuryExpensesRepo.getTreasuries(),
      createExpense: (input) => this.treasuryExpensesRepo.createExpense(input),
      getBatches: () => this.getBatches(),
      getPromotions: () => this.getPromotions(),
      getPriceHistory: () => this.getPriceHistory(),
      getInvoices: () => this.getInvoices(),
      getPurchaseOrders: () => this.purchasesRepo.getPurchaseOrders(),
      getExpenses: () => this.treasuryExpensesRepo.getExpenses(),
      getTransactions: () => this.getTransactions(),
      getMovements: (limit) => this.getMovements(limit),
      getEquityPartners: () => this.getEquityPartners(),
      getEquityDrawings: () => this.getEquityDrawings(),
      getCustomReportPresets: () => this.getCustomReportPresets(),
      getAuditLogs: (limit) => this.getAuditLogs(limit),
      logAudit: (input) => this.logAudit(input),
    });
    this.reportService = new ReportService({
      getInvoices: () => this.getInvoices(),
      getAllProducts: () => this.getAllProducts(),
      getExpenses: () => this.getExpenses(),
      getPurchases: () => this.getPurchaseOrders(),
      getTransactions: () => this.getTransactions(null),
      getCustomers: () => this.getCustomers(),
      getSuppliers: () => this.getSuppliers(),
      getTreasuries: () => this.getTreasuries(),
      getEquityPartners: () => this.equityRepo.listPartners(),
      getEquityDrawings: () => this.equityRepo.listDrawings(undefined, null),
    });
    this.insightsService = new AlertsAndReorderService({
      getInvoices: () => this.getInvoices(),
      getProducts: () => this.getProducts(),
      getAllProducts: () => this.getAllProducts(),
      getCustomers: () => this.getCustomers(),
      getSuppliers: () => this.getSuppliers(),
      getExpiringBatches: (d) => this.batchRepo.getExpiringSoonBatches(d),
      getLastShiftClosure: () => this.getShiftSummary().lastClosure,
    });
    this.seedIfEmpty();
    this.ensureDefaultTreasuries();
    this.ensureDefaultTemplates();
    this.ensureMultiActivityDemoInvoices();
    this.ensureDemoPurchasesAndExpenses();
    this.equityRepo.ensureDefaultPartners();
    this.batchRepo.ensureDefaultBatchesAndPromotions();
  }

  private nextYearlySequenceNumber(
    table: 'invoices' | 'purchase_orders',
    column: 'invoice_number' | 'purchase_number',
    prefix: 'INV' | 'PUR'
  ): string {
    const year = new Date().getFullYear();
    const likePattern = `${prefix}-${year}-%`;
    const rows = this.db
      .prepare(`SELECT ${column} AS num FROM ${table} WHERE ${column} LIKE ?`)
      .all(likePattern) as Array<{ num: string }>;
    let maxSeq = 1000;
    const prefixLen = `${prefix}-${year}-`.length;
    for (const r of rows) {
      const parsed = Number.parseInt(String(r.num || '').slice(prefixLen), 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
    return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
  }

  private resolveNormalizedAllocations(inv: Invoice): Array<{
    method: Exclude<PaymentMethod, 'split'>;
    amount: number;
    feeAmount: number;
  }> {
    if (inv.allocations && inv.allocations.length > 0) {
      return inv.allocations.map((a) => ({
        method: a.method,
        amount: Number(a.amount || 0),
        feeAmount: Number(a.feeAmount || 0),
      }));
    }
    if (inv.paymentMethod !== 'split') {
      return [{ method: inv.paymentMethod, amount: inv.grandTotal, feeAmount: 0 }];
    }
    return [];
  }

  private ensureDefaultTreasuries(): void {
    const cnt = this.db.prepare('SELECT COUNT(*) as c FROM treasuries').get() as { c: number };
    if (Number(cnt?.c || 0) > 0) return;

    const payCfg = this.getPaymentConfig();
    const now = new Date().toISOString();
    const ins = this.db.prepare(
      `INSERT INTO treasuries (id, name, type, account_number, current_balance, active, is_default, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    );
    ins.run('trs-cash-main', 'خزينة الدرج النقدي الرئيسي', 'cash_drawer', 'DRAWER-01', 12500, 1, 'الخزينة الافتراضية للنقدية بالمحل', now);
    ins.run('trs-cash-safe', 'خزينة الإدارة الاحتياطية', 'cash_drawer', 'SAFE-02', 35000, 0, 'توريد الفائض اليومي والمصروفات الكبرى', now);
    ins.run('trs-instapay-1', 'حساب إنستا باي الرئيسي (CIB / QNB)', 'instapay', payCfg.instapayIpa || 'albaraka.store@instapay', 18400, 1, 'تحويلات IPA البنكية الفورية', now);
    ins.run('trs-wallet-1', 'محفظة فودافون كاش المحل', 'wallet', payCfg.vodafoneCashNumber || '01009876543', 6250, 1, 'تحصيل المحافظ الإلكترونية', now);
    ins.run('trs-bankpos-1', 'ماكينة الفيزا والبطاقات (Paymob)', 'bank_pos', payCfg.paymobIntegrationId || '4491208', 9800, 1, 'مبيعات بطاقات الائتمان وميزة', now);
  }

  private buildDefaultTemplatesSeed(): Array<Omit<DocumentTemplateArtifact, 'previewPngDataUrl' | 'updatedAt'>> {
    return [
      {
        id: 'tpl-invoice-a4',
        kind: 'invoice_a4',
        nameAr: 'نموذج فاتورة مبيعات ضريبية (A4)',
        paperSize: 'a4',
        style: 'modern_emerald',
        accentColor: '#059669',
        headerTitle: 'فاتورة مبيعات إلكترونية معتمدة',
        headerSubtitle: 'نسخة العميل — توثيق سلسلة التجزئة SHA-256',
        footerNote: 'شكراً لتعاملكم معنا — البضاعة المباعة ترد وتستبدل خلال 14 يوماً',
        showLogo: true,
        showTaxNumber: true,
        showBarcode: true,
        showSplitPayments: true,
        showSignatureLine: true,
        columns: [
          { key: 'index', label: '#', visible: true, order: 1, widthPercent: 6 },
          { key: 'productName', label: 'الصنف / البيان', visible: true, order: 2, widthPercent: 38 },
          { key: 'unit', label: 'الوحدة', visible: true, order: 3, widthPercent: 12 },
          { key: 'quantity', label: 'الكمية', visible: true, order: 4, widthPercent: 12 },
          { key: 'unitPrice', label: 'سعر الوحدة', visible: true, order: 5, widthPercent: 16 },
          { key: 'lineTotal', label: 'الإجمالي', visible: true, order: 6, widthPercent: 16 },
        ],
        sampleRows: [
          { index: 1, productName: 'أرز مصري الضحى فاخر 1 كجم', unit: 'كيس', quantity: 5, unitPrice: 42, lineTotal: 210 },
          { index: 2, productName: 'زيت عباد شمس كريستال 1 لتر', unit: 'زجاجة', quantity: 2, unitPrice: 92, lineTotal: 184 },
        ],
        xlsxFileName: 'template_invoice_a4.xlsx',
        pngFileName: 'template_invoice_a4_preview.png',
      },
      {
        id: 'tpl-invoice-thermal',
        kind: 'invoice_thermal',
        nameAr: 'نموذج إيصال كاشير حراري (80mm)',
        paperSize: 'thermal_80mm',
        style: 'compact_thermal',
        accentColor: '#0f172a',
        headerTitle: 'إيصال مبيعات فوري',
        headerSubtitle: 'نقطة البيع الرئيسية',
        footerNote: 'يسعدنا خدمتكم دائماً — يرجى الاحتفاظ بالإيصال',
        showLogo: true,
        showTaxNumber: true,
        showBarcode: true,
        showSplitPayments: true,
        showSignatureLine: false,
        columns: [
          { key: 'productName', label: 'الصنف', visible: true, order: 1, widthPercent: 52 },
          { key: 'quantity', label: 'الكمية', visible: true, order: 2, widthPercent: 18 },
          { key: 'lineTotal', label: 'القيمة', visible: true, order: 3, widthPercent: 30 },
        ],
        sampleRows: [
          { productName: 'لبن جهينة كامل الدسم', quantity: '3 × 42', lineTotal: 126 },
          { productName: 'جبنة عبور لاند 500جم', quantity: '2 × 48', lineTotal: 96 },
        ],
        xlsxFileName: 'template_receipt_80mm.xlsx',
        pngFileName: 'template_receipt_80mm_preview.png',
      },
      {
        id: 'tpl-sales-report',
        kind: 'sales_report',
        nameAr: 'نموذج تقرير المبيعات وصافي الأرباح',
        paperSize: 'a4',
        style: 'executive_slate',
        accentColor: '#0284c7',
        headerTitle: 'التقرير التحليلي للمبيعات والأرباح التاريخية',
        headerSubtitle: 'حساب التكلفة وقت الفاتورة بدقة مالية كاملة',
        footerNote: 'تقرير إداري معتمد — تاجر برو ERP',
        showLogo: true,
        showTaxNumber: true,
        showBarcode: false,
        showSplitPayments: true,
        showSignatureLine: true,
        columns: [
          { key: 'productName', label: 'اسم الصنف', visible: true, order: 1, widthPercent: 32 },
          { key: 'qtySold', label: 'الكمية المباعة', visible: true, order: 2, widthPercent: 16 },
          { key: 'revenue', label: 'إجمالي المبيعات', visible: true, order: 3, widthPercent: 18 },
          { key: 'cost', label: 'التكلفة التاريخية', visible: true, order: 4, widthPercent: 18 },
          { key: 'profit', label: 'صافي الربح', visible: true, order: 5, widthPercent: 16 },
        ],
        sampleRows: [
          { productName: 'لبن جهينة 1 لتر', qtySold: 42, revenue: 1764, cost: 1470, profit: 294 },
          { productName: 'أرز الضحى 1 كجم', qtySold: 65, revenue: 2730, cost: 2210, profit: 520 },
        ],
        xlsxFileName: 'template_sales_profit_report.xlsx',
        pngFileName: 'template_sales_profit_preview.png',
      },
      {
        id: 'tpl-inventory-report',
        kind: 'inventory_report',
        nameAr: 'نموذج تقرير جرد المخزون والنواقص',
        paperSize: 'a4',
        style: 'classic_bordered',
        accentColor: '#d97706',
        headerTitle: 'تقرير تقييم المخزون وحالة النواقص',
        headerSubtitle: 'جرد فعلي بالكميات وتقييم بسعر التكلفة والبيع',
        footerNote: 'يرجى مراجعة الأصناف التي بلغت حد الطلب قبل نفاد الرصيد',
        showLogo: true,
        showTaxNumber: false,
        showBarcode: true,
        showSplitPayments: false,
        showSignatureLine: true,
        columns: [
          { key: 'sku', label: 'الكود / SKU', visible: true, order: 1, widthPercent: 16 },
          { key: 'name', label: 'اسم الصنف', visible: true, order: 2, widthPercent: 34 },
          { key: 'stockQty', label: 'الرصيد الحالي', visible: true, order: 3, widthPercent: 16 },
          { key: 'costValue', label: 'قيمة التكلفة', visible: true, order: 4, widthPercent: 17 },
          { key: 'status', label: 'حالة المخزون', visible: true, order: 5, widthPercent: 17 },
        ],
        sampleRows: [
          { sku: 'GRC-001', name: 'لبن جهينة 1 لتر', stockQty: 48, costValue: 1680, status: 'متوفر' },
          { sku: 'GRC-008', name: 'عصير بيتي مانجو', stockQty: 4, costValue: 96, status: 'ناقص (حد الطلب)' },
        ],
        xlsxFileName: 'template_inventory_report.xlsx',
        pngFileName: 'template_inventory_preview.png',
      },
      {
        id: 'tpl-expenses-report',
        kind: 'expenses_report',
        nameAr: 'نموذج تقرير المصروفات التشغيلية',
        paperSize: 'a4',
        style: 'modern_emerald',
        accentColor: '#e11d48',
        headerTitle: 'بيان المصروفات التشغيلية وسحوبات الخزائن',
        headerSubtitle: 'متابعة كافة بنود الصرف الإدارية والتشغيلية',
        footerNote: 'معتمد للمراجعة الدورية — قسم الحسابات',
        showLogo: true,
        showTaxNumber: false,
        showBarcode: false,
        showSplitPayments: true,
        showSignatureLine: true,
        columns: [
          { key: 'title', label: 'بيان المصروف', visible: true, order: 1, widthPercent: 36 },
          { key: 'category', label: 'التصنيف', visible: true, order: 2, widthPercent: 20 },
          { key: 'source', label: 'الخزينة / جهة الصرف', visible: true, order: 3, widthPercent: 24 },
          { key: 'amount', label: 'المبلغ', visible: true, order: 4, widthPercent: 20 },
        ],
        sampleRows: [
          { title: 'فاتورة كهرباء المحل', category: 'مرافق وكهرباء', source: 'خزينة الدرج الرئيسي', amount: 420 },
          { title: 'مقدم إيجار الشهر', category: 'إيجار', source: 'حساب إنستا باي', amount: 4500 },
        ],
        xlsxFileName: 'template_expenses_report.xlsx',
        pngFileName: 'template_expenses_preview.png',
      },
      {
        id: 'tpl-partner-statement',
        kind: 'partner_statement',
        nameAr: 'نموذج كشف حساب عميل / مورد (A4)',
        paperSize: 'a4',
        style: 'executive_slate',
        accentColor: '#4f46e5',
        headerTitle: 'كشف حساب تفصيلي بالمعاملات والأرصدة',
        headerSubtitle: 'بيان زمني بالفواتير والدفعات والرصيد الختامي',
        footerNote: 'يرجى مطابقة الرصيد وإخطار الإدارة بأي ملاحظات خلال 7 أيام',
        showLogo: true,
        showTaxNumber: true,
        showBarcode: false,
        showSplitPayments: true,
        showSignatureLine: true,
        columns: [
          { key: 'date', label: 'التاريخ', visible: true, order: 1, widthPercent: 18 },
          { key: 'reference', label: 'المرجع', visible: true, order: 2, widthPercent: 18 },
          { key: 'description', label: 'البيان التفصيلي', visible: true, order: 3, widthPercent: 34 },
          { key: 'debit', label: 'مدين (+)', visible: true, order: 4, widthPercent: 15 },
          { key: 'credit', label: 'دائن (-)', visible: true, order: 5, widthPercent: 15 },
        ],
        sampleRows: [
          { date: '2026-11-15', reference: 'INV-2026-1005', description: 'فاتورة مبيعات آجل', debit: 872, credit: 0 },
          { date: '2026-11-16', reference: 'IPA-44012', description: 'سداد دفعة عبر إنستا باي', debit: 0, credit: 400 },
        ],
        xlsxFileName: 'template_partner_statement.xlsx',
        pngFileName: 'template_partner_statement_preview.png',
      },
      {
        id: 'tpl-partner-itemized-statement',
        kind: 'partner_statement_itemized',
        nameAr: 'نموذج كشف حساب عميل / مورد بالأصناف (A4)',
        paperSize: 'a4',
        style: 'modern_emerald',
        accentColor: '#0f766e',
        headerTitle: 'كشف حساب تفصيلي بالأصناف والكميات والأسعار',
        headerSubtitle: 'بيان الفواتير والتوريدات ومشتملات كل مستند والرصيد التراكمي',
        footerNote: 'كشف حساب تفصيلي معتمد بالأصناف — يرجى مراجعة الكميات والأسعار وإخطار الإدارة خلال 7 أيام',
        showLogo: true,
        showTaxNumber: true,
        showBarcode: false,
        showSplitPayments: true,
        showSignatureLine: true,
        columns: [
          { key: 'date', label: 'التاريخ', visible: true, order: 1, widthPercent: 14 },
          { key: 'reference', label: 'المستند', visible: true, order: 2, widthPercent: 14 },
          { key: 'productName', label: 'الصنف / البيان', visible: true, order: 3, widthPercent: 28 },
          { key: 'unit', label: 'الوحدة', visible: true, order: 4, widthPercent: 10 },
          { key: 'qty', label: 'الكمية', visible: true, order: 5, widthPercent: 10 },
          { key: 'unitPrice', label: 'السعر', visible: true, order: 6, widthPercent: 12 },
          { key: 'lineTotal', label: 'الإجمالي', visible: true, order: 7, widthPercent: 12 },
        ],
        sampleRows: [
          {
            date: '2026-11-15',
            reference: 'INV-2026-1005',
            productName: 'أرز مصري ممتاز 5 كجم',
            unit: 'شكارة',
            qty: 4,
            unitPrice: 185,
            lineTotal: 740,
          },
          {
            date: '2026-11-15',
            reference: 'INV-2026-1005',
            productName: 'زيت عباد شمس 2.2 لتر',
            unit: 'زجاجة',
            qty: 1,
            unitPrice: 132,
            lineTotal: 132,
          },
          {
            date: '2026-11-16',
            reference: 'IPA-44012',
            productName: 'سداد دفعة نقدي / إنستا باي',
            unit: '—',
            qty: '—',
            unitPrice: '—',
            lineTotal: -400,
          },
        ],
        xlsxFileName: 'template_partner_itemized_statement.xlsx',
        pngFileName: 'template_partner_itemized_statement_preview.png',
      },
    ];
  }

  private ensureDefaultTemplates(): void {
    const now = new Date().toISOString();
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO document_templates (
        id, kind, name_ar, paper_size, style, accent_color, header_title, header_subtitle, footer_note,
        show_logo, show_tax_number, show_barcode, show_split_payments, show_signature_line,
        columns_json, sample_rows_json, preview_png_data_url, xlsx_file_name, png_file_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
    );
    for (const tpl of this.buildDefaultTemplatesSeed()) {
      ins.run(
        tpl.id,
        tpl.kind,
        tpl.nameAr,
        tpl.paperSize,
        tpl.style,
        tpl.accentColor,
        tpl.headerTitle,
        tpl.headerSubtitle,
        tpl.footerNote,
        tpl.showLogo ? 1 : 0,
        tpl.showTaxNumber ? 1 : 0,
        tpl.showBarcode ? 1 : 0,
        tpl.showSplitPayments ? 1 : 0,
        tpl.showSignatureLine ? 1 : 0,
        JSON.stringify(tpl.columns),
        JSON.stringify(tpl.sampleRows),
        tpl.xlsxFileName,
        tpl.pngFileName,
        now
      );
    }
  }

  public getTemplates(): DocumentTemplateArtifact[] {
    const rows = this.db.prepare('SELECT * FROM document_templates ORDER BY id ASC').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind) as DocumentTemplateKind,
      nameAr: String(r.name_ar),
      paperSize: String(r.paper_size) as 'a4' | 'thermal_80mm',
      style: String(r.style) as DocumentTemplateArtifact['style'],
      accentColor: String(r.accent_color),
      headerTitle: String(r.header_title),
      headerSubtitle: String(r.header_subtitle),
      footerNote: String(r.footer_note),
      showLogo: Boolean(r.show_logo),
      showTaxNumber: Boolean(r.show_tax_number),
      showBarcode: Boolean(r.show_barcode),
      showSplitPayments: Boolean(r.show_split_payments),
      showSignatureLine: Boolean(r.show_signature_line),
      columns: JSON.parse(String(r.columns_json || '[]')),
      sampleRows: JSON.parse(String(r.sample_rows_json || '[]')),
      previewPngDataUrl: String(r.preview_png_data_url || ''),
      xlsxFileName: String(r.xlsx_file_name),
      pngFileName: String(r.png_file_name),
      updatedAt: String(r.updated_at),
    }));
  }

  public saveTemplate(
    id: string,
    patch: Partial<DocumentTemplateArtifact>
  ): DocumentTemplateArtifact {
    const existing = this.getTemplates().find((t) => t.id === id);
    if (!existing) throw new Error('نموذج الطباعة غير موجود.');
    const now = new Date().toISOString();
    const merged: DocumentTemplateArtifact = {
      ...existing,
      ...patch,
      id: existing.id,
      columns: Array.isArray(patch.columns) ? patch.columns : existing.columns,
      sampleRows: Array.isArray(patch.sampleRows) ? patch.sampleRows : existing.sampleRows,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE document_templates SET
          name_ar = ?, paper_size = ?, style = ?, accent_color = ?, header_title = ?, header_subtitle = ?, footer_note = ?,
          show_logo = ?, show_tax_number = ?, show_barcode = ?, show_split_payments = ?, show_signature_line = ?,
          columns_json = ?, sample_rows_json = ?, preview_png_data_url = ?, xlsx_file_name = ?, png_file_name = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.nameAr,
        merged.paperSize,
        merged.style,
        merged.accentColor,
        merged.headerTitle,
        merged.headerSubtitle,
        merged.footerNote,
        merged.showLogo ? 1 : 0,
        merged.showTaxNumber ? 1 : 0,
        merged.showBarcode ? 1 : 0,
        merged.showSplitPayments ? 1 : 0,
        merged.showSignatureLine ? 1 : 0,
        JSON.stringify(merged.columns),
        JSON.stringify(merged.sampleRows),
        merged.previewPngDataUrl,
        merged.xlsxFileName,
        merged.pngFileName,
        now,
        id
      );
    return this.getTemplates().find((t) => t.id === id)!;
  }

  private seedIfEmpty(): void {
    const existing = this.db.prepare('SELECT id FROM store_settings WHERE id = 1').get();
    if (existing) return;

    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
    const daysAgo = (d: number, hourOffset = 14) => {
      const dt = new Date(now.getTime() - d * 24 * 3600 * 1000);
      dt.setHours(hourOffset, 20, 0, 0);
      return dt.toISOString();
    };

    const defaultStoreName = 'أسواق البركة الحديثة';
    const trialLicense = issueSignedLicenseKey({
      storeName: defaultStoreName,
      tier: 'pro',
      durationDays: 30,
      maxTerminals: 5,
    });

    const defaultPaymentConfig: PaymentGatewayConfig = {
      instapayIpa: process.env.INSTAPAY_DEFAULT_IPA || 'albaraka.store@instapay',
      instapayEnabled: true,
      vodafoneCashNumber: process.env.VODAFONE_CASH_MERCHANT_NUMBER || '01009876543',
      walletEnabled: true,
      paymobConfigured: true,
      paymobIntegrationId: process.env.PAYMOB_INTEGRATION_ID || '4491208',
      fawryMerchantCode: process.env.FAWRY_MERCHANT_CODE || '77000018291',
      fawryConfigured: true,
      cardFeePercent: 1.5,
    };

    const defaultMysqlConfig = {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE || 'tajirpro_pos_demo',
      user: process.env.MYSQL_USER || 'tajirpro_demo',
      connected: false,
    };

    const runSeed = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO store_settings (id, store_name, activity_id, phone, address, tax_number, receipt_footer, license_key, payment_config_json, mysql_config_json, role_permissions_json)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          defaultStoreName,
          'grocery',
          '01012345678',
          'شارع فيصل الرئيسي، الجيزة',
          '310-482-991',
          'شكراً لتعاملكم معنا — البضاعة المباعة ترد وتستبدل خلال 14 يوماً',
          trialLicense,
          JSON.stringify(defaultPaymentConfig),
          JSON.stringify(defaultMysqlConfig),
          JSON.stringify(DEFAULT_ROLE_PERMISSIONS)
        );

      const insertStaff = this.db.prepare(
        `INSERT INTO staff_users (id, name, role, pin_hash, active, last_login_at) VALUES (?, ?, ?, ?, 1, ?)`
      );
      insertStaff.run('usr-owner', 'أحمد العشري (المالك)', 'owner', hashPin('1234'), hoursAgo(1));
      insertStaff.run('usr-manager', 'محمود حسن (مدير الفرع)', 'manager', hashPin('2222'), hoursAgo(5));
      insertStaff.run('usr-cashier', 'سارة إبراهيم (كاشير)', 'cashier', hashPin('1111'), hoursAgo(2));

      const insertSupplier = this.db.prepare(
        `INSERT INTO suppliers (id, name, phone, category, balance_due, last_supply_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      insertSupplier.run('sup-1', 'شركة النيل لتوزيع الأغذية', '01122334455', 'ألبان ومواد غذائية', 4200, daysAgo(1, 10));
      insertSupplier.run('sup-2', 'مؤسسة الدلتا للتجارة والتوريدات', '01288776655', 'زيوت ومنظفات', 1850, daysAgo(3, 11));

      const insertCustomer = this.db.prepare(
        `INSERT INTO customers (id, name, phone, balance_due, total_purchases, last_purchase_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      insertCustomer.run('cust-1', 'الحاج مصطفى عبد الرحمن', '01066554433', 380, 2450, daysAgo(1, 18));
      insertCustomer.run('cust-2', 'مطبخ الهنا للمأكولات', '01144556677', 920, 6840, hoursAgo(3));
      insertCustomer.run('cust-3', 'أستاذة نهى عادل', '01233445566', 0, 1290, daysAgo(2, 16));

      const insertProduct = this.db.prepare(
        `INSERT INTO products (id, sku, barcode, name, category, unit, attribute_value, activity_id, current_cost_price, current_sale_price, half_wholesale_price, wholesale_price, stock_qty, min_stock_alert, max_stock_limit, supplier_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const actId of Object.keys(ACTIVITY_SEED_PRODUCTS) as StoreActivityId[]) {
        const list = ACTIVITY_SEED_PRODUCTS[actId];
        list.forEach((p, idx) => {
          const id = `prd-${actId}-${idx + 1}`;
          const maxLimit = Math.max(p.minStockAlert * 4, Math.round(p.stockQty * 0.9));
          const halfWholesale = Number(Math.max(p.costPrice, p.salePrice * 0.94).toFixed(2));
          const wholesale = Number(Math.max(p.costPrice, p.salePrice * 0.88).toFixed(2));
          insertProduct.run(
            id,
            p.sku,
            p.barcode,
            p.name,
            p.category,
            p.unit,
            p.attributeValue,
            actId,
            p.costPrice,
            p.salePrice,
            halfWholesale,
            wholesale,
            p.stockQty,
            p.minStockAlert,
            // Intentionally make item #7 overstock (80 > max 50) and item #2 near/above max so overstock report shows real rows
            idx === 6 ? 50 : maxLimit + 15,
            idx % 2 === 0 ? 'sup-1' : 'sup-2',
            hoursAgo(2)
          );
        });
      }

      this.db
        .prepare(
          `INSERT INTO product_price_history (id, product_id, product_name, old_cost_price, new_cost_price, old_sale_price, new_sale_price, changed_by, reason, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'ph-seed-1',
          'prd-grocery-3',
          'زيت عباد شمس كريستال',
          65,
          78,
          78,
          92,
          'أحمد العشري (المالك)',
          'تحديث سعر التوريد من شركة الدلتا',
          daysAgo(1, 9)
        );

      this.db
        .prepare(
          `INSERT INTO product_price_history (id, product_id, product_name, old_cost_price, new_cost_price, old_sale_price, new_sale_price, changed_by, reason, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'ph-seed-2',
          'prd-grocery-1',
          'لبن جهينة كامل الدسم',
          35,
          39,
          42,
          46,
          'أحمد العشري (المالك)',
          'تعديل تسعير منتجات الألبان الجديد',
          daysAgo(2, 10)
        );

      let prevHash = GENESIS_HASH;
      const seedInvoice = (spec: {
        id: string;
        invoiceNumber: string;
        activityId: StoreActivityId;
        createdAt: string;
        cashierName: string;
        customerId: string | null;
        customerName: string;
        paymentMethod: PaymentMethod;
        paymentRef: string;
        items: Array<{
          productId: string;
          productName: string;
          unit: string;
          qty: number;
          costAtSale: number;
          salePrice: number;
          discount?: number;
        }>;
      }) => {
        let subtotal = 0;
        let totalCost = 0;
        let discountTotal = 0;

        const computedItems = spec.items.map((it, i) => {
          const disc = it.discount || 0;
          const gross = it.salePrice * it.qty;
          const lineTotal = Number((gross - disc).toFixed(2));
          const lineCost = Number((it.costAtSale * it.qty).toFixed(2));
          const lineProfit = Number((lineTotal - lineCost).toFixed(2));
          subtotal += gross;
          discountTotal += disc;
          totalCost += lineCost;
          return {
            id: `${spec.id}-item-${i + 1}`,
            ...it,
            discount: disc,
            lineTotal,
            lineProfit,
          };
        });

        const grandTotal = Number((subtotal - discountTotal).toFixed(2));
        const totalProfit = Number((grandTotal - totalCost).toFixed(2));
        const rowHash = computeInvoiceChainHash({
          id: spec.id,
          invoiceNumber: spec.invoiceNumber,
          createdAt: spec.createdAt,
          grandTotal,
          totalCostAtSale: totalCost,
          totalProfit,
          status: 'completed',
          prevHash,
        });

        this.db
          .prepare(
            `INSERT INTO invoices (id, invoice_number, activity_id, created_at, cashier_name, terminal_name, customer_id, customer_name, payment_method, payment_ref, subtotal, discount_total, grand_total, total_cost_at_sale, total_profit, paid_amount, change_amount, status, notes, prev_hash, row_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', '', ?, ?)`
          )
          .run(
            spec.id,
            spec.invoiceNumber,
            spec.activityId,
            spec.createdAt,
            spec.cashierName,
            'كاشير 1 - الرئيسي',
            spec.customerId,
            spec.customerName,
            spec.paymentMethod,
            spec.paymentRef,
            subtotal,
            discountTotal,
            grandTotal,
            totalCost,
            totalProfit,
            spec.paymentMethod === 'credit' ? 0 : grandTotal,
            0,
            prevHash,
            rowHash
          );

        const insItem = this.db.prepare(
          `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, activity_id, unit, quantity, unit_cost_at_sale, unit_sale_price, discount_amount, line_total, line_profit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const it of computedItems) {
          insItem.run(
            it.id,
            spec.id,
            it.productId,
            it.productName,
            spec.activityId,
            it.unit,
            it.qty,
            it.costAtSale,
            it.salePrice,
            it.discount,
            it.lineTotal,
            it.lineProfit
          );
        }

        const fee = spec.paymentMethod === 'card' ? Number((grandTotal * 0.015).toFixed(2)) : 0;
        const providerMap: Record<PaymentMethod, string> = {
          cash: 'درج النقدية',
          instapay: 'شبكة إنستا باي (InstaPay)',
          vodafone_cash: 'فودافون كاش',
          card: 'ماكينة الدفع (Paymob / Visa)',
          credit: 'حساب عميل آجل',
          split: 'دفع مقسّم (خزائن متعددة)',
        };
        this.db
          .prepare(
            `INSERT INTO payment_transactions (id, invoice_id, invoice_number, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `tx-${spec.id}`,
            spec.id,
            spec.invoiceNumber,
            spec.paymentMethod,
            providerMap[spec.paymentMethod],
            grandTotal,
            fee,
            Number((grandTotal - fee).toFixed(2)),
            spec.paymentRef,
            spec.paymentMethod === 'credit' ? 'pending' : 'settled',
            spec.createdAt
          );

        prevHash = rowHash;
      };

      // Seed historical invoices across recent days & months for daily/monthly/yearly reporting
      seedInvoice({
        id: 'inv-1000',
        invoiceNumber: 'INV-2026-1000',
        activityId: 'grocery',
        createdAt: daysAgo(35, 16),
        cashierName: 'أحمد العشري (المالك)',
        customerId: null,
        customerName: 'عميل نقدي سريع',
        paymentMethod: 'cash',
        paymentRef: '',
        items: [
          {
            productId: 'prd-grocery-3',
            productName: 'زيت عباد شمس كريستال',
            unit: 'لتر',
            qty: 5,
            costAtSale: 65,
            salePrice: 78,
          },
          {
            productId: 'prd-grocery-2',
            productName: 'أرز مصري الضحى فاخر',
            unit: 'كيلو',
            qty: 15,
            costAtSale: 32,
            salePrice: 40,
          },
        ],
      });

      seedInvoice({
        id: 'inv-1001',
        invoiceNumber: 'INV-2026-1001',
        activityId: 'grocery',
        createdAt: daysAgo(3, 15),
        cashierName: 'أحمد العشري (المالك)',
        customerId: 'cust-3',
        customerName: 'أستاذة نهى عادل',
        paymentMethod: 'cash',
        paymentRef: '',
        items: [
          {
            productId: 'prd-grocery-3',
            productName: 'زيت عباد شمس كريستال',
            unit: 'لتر',
            qty: 3,
            costAtSale: 65,
            salePrice: 78,
          },
          {
            productId: 'prd-grocery-1',
            productName: 'لبن جهينة كامل الدسم',
            unit: 'لتر',
            qty: 4,
            costAtSale: 35,
            salePrice: 42,
          },
        ],
      });

      seedInvoice({
        id: 'inv-1002',
        invoiceNumber: 'INV-2026-1002',
        activityId: 'grocery',
        createdAt: daysAgo(2, 19),
        cashierName: 'سارة إبراهيم (كاشير)',
        customerId: null,
        customerName: 'عميل نقدي سريع',
        paymentMethod: 'instapay',
        paymentRef: 'IPA-9928410',
        items: [
          {
            productId: 'prd-grocery-6',
            productName: 'مسحوق غسيل أريال أوتوماتيك',
            unit: 'علبة',
            qty: 2,
            costAtSale: 165,
            salePrice: 198,
          },
          {
            productId: 'prd-grocery-5',
            productName: 'شاي العروسة ناعم',
            unit: 'علبة',
            qty: 3,
            costAtSale: 52,
            salePrice: 64,
          },
        ],
      });

      seedInvoice({
        id: 'inv-1003',
        invoiceNumber: 'INV-2026-1003',
        activityId: 'grocery',
        createdAt: daysAgo(1, 17),
        cashierName: 'سارة إبراهيم (كاشير)',
        customerId: 'cust-1',
        customerName: 'الحاج مصطفى عبد الرحمن',
        paymentMethod: 'vodafone_cash',
        paymentRef: 'VFC-7741209',
        items: [
          {
            productId: 'prd-grocery-2',
            productName: 'أرز مصري الضحى فاخر',
            unit: 'كيلو',
            qty: 10,
            costAtSale: 34,
            salePrice: 42,
          },
          {
            productId: 'prd-grocery-3',
            productName: 'زيت عباد شمس كريستال',
            unit: 'لتر',
            qty: 2,
            costAtSale: 78,
            salePrice: 92,
          },
        ],
      });

      seedInvoice({
        id: 'inv-1004',
        invoiceNumber: 'INV-2026-1004',
        activityId: 'grocery',
        createdAt: hoursAgo(4),
        cashierName: 'أحمد العشري (المالك)',
        customerId: null,
        customerName: 'عميل نقدي سريع',
        paymentMethod: 'card',
        paymentRef: 'PMB-440192',
        items: [
          {
            productId: 'prd-grocery-1',
            productName: 'لبن جهينة كامل الدسم',
            unit: 'لتر',
            qty: 6,
            costAtSale: 39,
            salePrice: 46,
          },
          {
            productId: 'prd-grocery-4',
            productName: 'جبنة عبور لاند فيتا',
            unit: 'علبة',
            qty: 4,
            costAtSale: 41,
            salePrice: 50,
          },
          {
            productId: 'prd-grocery-7',
            productName: 'مكرونة الملكة خواتم',
            unit: 'قطعة',
            qty: 5,
            costAtSale: 13.5,
            salePrice: 18,
          },
        ],
      });

      seedInvoice({
        id: 'inv-1005',
        invoiceNumber: 'INV-2026-1005',
        activityId: 'grocery',
        createdAt: hoursAgo(2),
        cashierName: 'محمود حسن (مدير الفرع)',
        customerId: 'cust-2',
        customerName: 'مطبخ الهنا للمأكولات',
        paymentMethod: 'credit',
        paymentRef: 'آجل - استحقاق 7 أيام',
        items: [
          {
            productId: 'prd-grocery-2',
            productName: 'أرز مصري الضحى فاخر',
            unit: 'كيلو',
            qty: 12,
            costAtSale: 34,
            salePrice: 42,
          },
          {
            productId: 'prd-grocery-3',
            productName: 'زيت عباد شمس كريستال',
            unit: 'لتر',
            qty: 4,
            costAtSale: 78,
            salePrice: 92,
          },
        ],
      });

      const insMove = this.db.prepare(
        `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insMove.run('mv-1', 'prd-grocery-1', 'لبن جهينة كامل الدسم', -6, 48, 'فاتورة بيع INV-2026-1004', 'كاشير 1 - الرئيسي', 'أحمد العشري (المالك)', hoursAgo(4));
      insMove.run('mv-2', 'prd-grocery-2', 'أرز مصري الضحى فاخر', -12, 65, 'فاتورة بيع INV-2026-1005', 'كاشير 1 - الرئيسي', 'محمود حسن (مدير الفرع)', hoursAgo(2));
      insMove.run('mv-3', 'prd-grocery-3', 'زيت عباد شمس كريستال', -4, 24, 'فاتورة بيع INV-2026-1005', 'كاشير 1 - الرئيسي', 'محمود حسن (مدير الفرع)', hoursAgo(2));
      insMove.run('mv-4', 'prd-grocery-8', 'عصير بيتي تروبيكانا مانجو', -6, 4, 'مبيعات سريعة — تنبيه نواقص', 'كاشير 1 - الرئيسي', 'سارة إبراهيم (كاشير)', hoursAgo(1));
    });

    runSeed();
  }

  public getSettings(): StoreSettings {
    const row = this.db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    const mysqlConfig = JSON.parse(String(row.mysql_config_json || '{}'));
    let parsedPrint: Partial<PrintTemplateSettings> = {};
    try {
      parsedPrint = JSON.parse(String(row.print_template_json || '{}'));
    } catch {
      parsedPrint = {};
    }
    let parsedLoyalty: Partial<LoyaltyConfig> = {};
    try {
      parsedLoyalty = JSON.parse(String(row.loyalty_config_json || '{}'));
    } catch {
      parsedLoyalty = {};
    }
    const storedDriver = mysqlConfig.dbDriver === 'mysql' ? 'mysql' : mysqlConfig.dbDriver === 'sqlite' ? 'sqlite' : null;
    const dbDriver: 'sqlite' | 'mysql' = storedDriver || (process.env.DB_DRIVER === 'mysql' ? 'mysql' : 'sqlite');
    return {
      storeName: String(row.store_name),
      activityId: String(row.activity_id) as StoreActivityId,
      phone: String(row.phone),
      address: String(row.address),
      taxNumber: String(row.tax_number || ''),
      receiptFooter: String(row.receipt_footer),
      currency: 'EGP',
      vatPercent: Number(row.vat_percent || 0),
      allowNegativeStock: Boolean(row.allow_negative_stock),
      autoPrintAfterSale: Boolean(row.auto_print_after_sale),
      requireLoginOnStart: row.require_login_on_start === undefined ? true : Boolean(row.require_login_on_start),
      printTemplate: {
        ...DEFAULT_PRINT_TEMPLATE,
        ...parsedPrint,
      },
      loyaltyConfig: {
        ...DEFAULT_LOYALTY_CONFIG,
        ...parsedLoyalty,
      },
      dbDriver,
      mysqlConfig: {
        host: String(mysqlConfig.host || '127.0.0.1'),
        port: Number(mysqlConfig.port || 3306),
        database: String(mysqlConfig.database || 'tajirpro_pos'),
        user: String(mysqlConfig.user || 'tajirpro_user'),
        connected: Boolean(mysqlConfig.connected),
        ssl: Boolean(mysqlConfig.ssl),
        connectionLimit: Number(mysqlConfig.connectionLimit || 10),
      },
    };
  }

  public getRolePermissions(): RolePermissionsMap {
    const row = this.db.prepare('SELECT role_permissions_json FROM store_settings WHERE id = 1').get() as {
      role_permissions_json?: string;
    };
    try {
      const parsed = JSON.parse(row?.role_permissions_json || '{}') as Partial<RolePermissionsMap>;
      return {
        owner: { ...DEFAULT_ROLE_PERMISSIONS.owner, ...(parsed.owner || {}), manage_security_rbac: true },
        manager: { ...DEFAULT_ROLE_PERMISSIONS.manager, ...(parsed.manager || {}) },
        cashier: { ...DEFAULT_ROLE_PERMISSIONS.cashier, ...(parsed.cashier || {}) },
      };
    } catch {
      return DEFAULT_ROLE_PERMISSIONS;
    }
  }

  public updateRolePermissions(role: UserRole, permissions: Partial<Record<PermissionKey, boolean>>): RolePermissionsMap {
    const current = this.getRolePermissions();
    const updated: RolePermissionsMap = {
      ...current,
      [role]: {
        ...current[role],
        ...permissions,
      },
    };
    // Owner always keeps security/RBAC access to prevent accidental lockout
    updated.owner.manage_security_rbac = true;
    this.db
      .prepare('UPDATE store_settings SET role_permissions_json = ? WHERE id = 1')
      .run(JSON.stringify(updated));
    return updated;
  }

  private computeUserEffectivePermissions(
    userId: string,
    role: UserRole,
    customPermissionsJson?: string | null
  ): {
    customPermissions: Partial<Record<PermissionKey, boolean>>;
    effectivePermissions: Record<PermissionKey, boolean>;
  } {
    const roleMap = this.getRolePermissions();
    const base: Record<PermissionKey, boolean> = {
      ...(roleMap[role] || roleMap.cashier),
    };
    let customPermissions: Partial<Record<PermissionKey, boolean>> = {};
    if (customPermissionsJson) {
      try {
        const parsed = JSON.parse(customPermissionsJson) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'boolean' && k in base) {
            customPermissions[k as PermissionKey] = v;
            base[k as PermissionKey] = v;
          }
        }
      } catch {
        customPermissions = {};
      }
    }
    if (userId === 'usr-owner') {
      base.manage_security_rbac = true;
    }
    return { customPermissions, effectivePermissions: base };
  }

  public hasPermission(userId: string | undefined, perm: PermissionKey): boolean {
    if (!userId) return false;
    const row = this.db
      .prepare('SELECT id, role, active, custom_permissions_json FROM staff_users WHERE id = ?')
      .get(userId) as
      | { id: string; role: UserRole; active: number; custom_permissions_json?: string }
      | undefined;
    if (!row || !row.active) return false;
    const { effectivePermissions } = this.computeUserEffectivePermissions(
      row.id,
      row.role,
      row.custom_permissions_json
    );
    return Boolean(effectivePermissions[perm]);
  }

  public getPaymentConfig(): PaymentGatewayConfig {
    const row = this.db.prepare('SELECT payment_config_json FROM store_settings WHERE id = 1').get() as {
      payment_config_json: string;
    };
    return JSON.parse(row.payment_config_json) as PaymentGatewayConfig;
  }

  public updatePaymentConfig(config: Partial<PaymentGatewayConfig>): PaymentGatewayConfig {
    const current = this.getPaymentConfig();
    const merged: PaymentGatewayConfig = { ...current, ...config };
    this.db
      .prepare('UPDATE store_settings SET payment_config_json = ? WHERE id = 1')
      .run(JSON.stringify(merged));
    return merged;
  }

  public updateStoreSettings(patch: {
    storeName?: string;
    activityId?: StoreActivityId;
    phone?: string;
    address?: string;
    taxNumber?: string;
    receiptFooter?: string;
    vatPercent?: number;
    allowNegativeStock?: boolean;
    autoPrintAfterSale?: boolean;
    requireLoginOnStart?: boolean;
    printTemplate?: Partial<PrintTemplateSettings>;
    loyaltyConfig?: Partial<LoyaltyConfig>;
    dbDriver?: 'sqlite' | 'mysql';
    mysqlConfig?: StoreSettings['mysqlConfig'];
  }): StoreSettings {
    const current = this.getSettings();
    const nextName = patch.storeName?.trim() || current.storeName;
    const nextActivity = patch.activityId || current.activityId;
    const nextPhone = patch.phone?.trim() ?? current.phone;
    const nextAddress = patch.address?.trim() ?? current.address;
    const nextTax = patch.taxNumber?.trim() ?? current.taxNumber;
    const nextFooter = patch.receiptFooter?.trim() ?? current.receiptFooter;
    const nextVat = patch.vatPercent !== undefined ? Math.max(0, Math.min(30, Number(patch.vatPercent))) : current.vatPercent;
    const nextAllowNeg = patch.allowNegativeStock !== undefined ? Boolean(patch.allowNegativeStock) : current.allowNegativeStock;
    const nextAutoPrint = patch.autoPrintAfterSale !== undefined ? Boolean(patch.autoPrintAfterSale) : current.autoPrintAfterSale;
    const nextReqLogin = patch.requireLoginOnStart !== undefined ? Boolean(patch.requireLoginOnStart) : current.requireLoginOnStart;
    const nextPrintTemplate: PrintTemplateSettings = {
      ...current.printTemplate,
      ...(patch.printTemplate || {}),
    };
    const nextLoyalty: LoyaltyConfig = {
      ...(current.loyaltyConfig || DEFAULT_LOYALTY_CONFIG),
      ...(patch.loyaltyConfig || {}),
    };
    const nextDriver = patch.dbDriver || current.dbDriver;
    const nextMysql = {
      ...current.mysqlConfig,
      ...(patch.mysqlConfig || {}),
      dbDriver: nextDriver,
    };

    this.db
      .prepare(
        `UPDATE store_settings SET
          store_name = ?, activity_id = ?, phone = ?, address = ?, tax_number = ?, receipt_footer = ?,
          vat_percent = ?, allow_negative_stock = ?, auto_print_after_sale = ?, require_login_on_start = ?,
          print_template_json = ?, loyalty_config_json = ?, mysql_config_json = ?
         WHERE id = 1`
      )
      .run(
        nextName,
        nextActivity,
        nextPhone,
        nextAddress,
        nextTax,
        nextFooter,
        nextVat,
        nextAllowNeg ? 1 : 0,
        nextAutoPrint ? 1 : 0,
        nextReqLogin ? 1 : 0,
        JSON.stringify(nextPrintTemplate),
        JSON.stringify(nextLoyalty),
        JSON.stringify(nextMysql)
      );

    return this.getSettings();
  }

  public verifyAnyOwnerPin(pin: string, rateKey = 'global'): boolean {
    const key = `admin-pin:${rateKey}`;
    const now = Date.now();
    const lockState = this.failedPinAttempts.get(key);
    if (lockState && lockState.lockedUntil > now) {
      return false;
    }
    const owners = this.db
      .prepare(`SELECT id, pin_hash FROM staff_users WHERE role = 'owner' AND active = 1`)
      .all() as Array<{ id: string; pin_hash: string }>;
    const ok = owners.some((o) => verifyPin(pin, o.pin_hash));
    if (!ok) {
      const nextCount = (lockState?.count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? now + 60000 : 0;
      this.failedPinAttempts.set(key, { count: nextCount >= 5 ? 0 : nextCount, lockedUntil });
      this.logAudit({
        actorUserId: 'admin-pin',
        actorName: 'محاولة رمز المالك',
        action: lockedUntil > 0 ? 'حظر مؤقت لمحاولات رمز المالك (x-admin-pin)' : 'فشل التحقق من رمز المالك',
        category: 'security',
        target: rateKey,
        details: `المحاولة رقم ${nextCount}`,
      });
      return false;
    }
    this.failedPinAttempts.delete(key);
    return true;
  }

  public verifyOverridePin(
    pin: string,
    rateKey = 'pos-override'
  ): {
    authorized: boolean;
    authorizerId?: string;
    authorizerName?: string;
    authorizerRole?: UserRole;
    reason?: string;
  } {
    const key = `override-pin:${rateKey}`;
    const now = Date.now();
    const lockState = this.failedPinAttempts.get(key);
    if (lockState && lockState.lockedUntil > now) {
      const waitSec = Math.ceil((lockState.lockedUntil - now) / 1000);
      return {
        authorized: false,
        reason: `تم حظر محاولات الاعتماد مؤقتاً. انتظر ${waitSec} ثانية.`,
      };
    }

    const cleanPin = String(pin || '').trim();
    if (!cleanPin) {
      return { authorized: false, reason: 'يرجى إدخال رمز PIN للاعتماد.' };
    }

    const supervisors = this.db
      .prepare(`SELECT id, name, role, pin_hash FROM staff_users WHERE role IN ('owner', 'manager') AND active = 1`)
      .all() as Array<{ id: string; name: string; role: UserRole; pin_hash: string }>;

    const matched = supervisors.find((s) => verifyPin(cleanPin, s.pin_hash));
    if (!matched) {
      const nextCount = (lockState?.count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? now + 60000 : 0;
      this.failedPinAttempts.set(key, { count: nextCount >= 5 ? 0 : nextCount, lockedUntil });
      this.logAudit({
        actorUserId: 'override-pin',
        actorName: 'محاولة اعتماد مشرف/مالك',
        action: lockedUntil > 0 ? 'حظر مؤقت لمحاولات اعتماد الخصم' : 'فشل التحقق من رمز اعتماد المشرف',
        category: 'security',
        target: rateKey,
        details: `المحاولة رقم ${nextCount}`,
      });
      return { authorized: false, reason: 'رمز PIN غير صحيح أو لا يملك صلاحية المالك/المدير.' };
    }

    this.failedPinAttempts.delete(key);
    this.logAudit({
      actorUserId: matched.id,
      actorName: matched.name,
      action: 'اعتماد تجاوز صلاحية خصم/عملية من الكاشير',
      category: 'security',
      target: rateKey,
    });
    return {
      authorized: true,
      authorizerId: matched.id,
      authorizerName: matched.name,
      authorizerRole: matched.role,
    };
  }

  public getServerRuntimeInfo(connectedTerminals: number): ServerRuntimeInfo {
    const settings = this.getSettings();
    let sqliteSizeKb = 0;
    try {
      sqliteSizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);
    } catch {
      sqliteSizeKb = 0;
    }
    const walRow = this.db.pragma('journal_mode', { simple: true });
    const prodCountRow = this.db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
    const invCountRow = this.db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number };

    return {
      nodeVersion: process.version,
      uptimeSec: Math.floor(process.uptime()),
      port: Number(process.env.PORT || 3000),
      dbDriver: settings.dbDriver,
      sqlitePath: path.relative(process.cwd(), DB_PATH) || DB_PATH,
      sqliteSizeKb,
      sqliteWal: String(walRow).toLowerCase() === 'wal',
      mysqlConfig: settings.mysqlConfig,
      connectedTerminals,
      productCount: Number(prodCountRow?.c || 0),
      invoiceCount: Number(invCountRow?.c || 0),
    };
  }

  public getLicenseStatus() {
    const row = this.db.prepare('SELECT license_key FROM store_settings WHERE id = 1').get() as {
      license_key: string;
    };
    const integrity = this.verifyLedgerIntegrity();
    return verifyLicenseKey(row.license_key, integrity.chainIntact);
  }

  public activateLicenseKey(licenseKey: string) {
    const integrity = this.verifyLedgerIntegrity();
    const status = verifyLicenseKey(licenseKey, integrity.chainIntact);
    if (!status.signatureVerified || !status.machineBound || status.expired) {
      return { ok: false, status };
    }
    this.db.prepare('UPDATE store_settings SET license_key = ? WHERE id = 1').run(licenseKey.trim());
    return { ok: true, status: this.getLicenseStatus() };
  }

  public issueTestSignedLicense(params: {
    tier: 'pro' | 'enterprise';
    durationDays: number;
    maxTerminals: number;
  }): string {
    const settings = this.getSettings();
    return issueSignedLicenseKey({
      storeName: settings.storeName,
      tier: params.tier,
      durationDays: params.durationDays,
      maxTerminals: params.maxTerminals,
      machineFingerprint: getMachineFingerprint(),
    });
  }

  public verifyLedgerIntegrity(): IntegrityReport {
    const rows = this.db
      .prepare(
        `SELECT id, invoice_number, created_at, grand_total, total_cost_at_sale, total_profit, status, prev_hash, row_hash
         FROM invoices ORDER BY created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      invoice_number: string;
      created_at: string;
      grand_total: number;
      total_cost_at_sale: number;
      total_profit: number;
      status: string;
      prev_hash: string;
      row_hash: string;
    }>;

    let expectedPrev = GENESIS_HASH;
    const brokenInvoiceIds: string[] = [];

    for (const r of rows) {
      const expectedHash = computeInvoiceChainHash({
        id: r.id,
        invoiceNumber: r.invoice_number,
        createdAt: r.created_at,
        grandTotal: r.grand_total,
        totalCostAtSale: r.total_cost_at_sale,
        totalProfit: r.total_profit,
        status: r.status,
        prevHash: r.prev_hash,
      });

      if (r.prev_hash !== expectedPrev || r.row_hash !== expectedHash) {
        brokenInvoiceIds.push(r.id);
      }
      expectedPrev = r.row_hash;
    }

    const licenseRow = this.db.prepare('SELECT license_key FROM store_settings WHERE id = 1').get() as {
      license_key: string;
    };
    const licCheck = verifyLicenseKey(licenseRow.license_key, brokenInvoiceIds.length === 0);

    return {
      checkedAt: new Date().toISOString(),
      totalInvoicesChecked: rows.length,
      validInvoices: rows.length - brokenInvoiceIds.length,
      brokenInvoiceIds,
      licenseSignatureValid: licCheck.signatureVerified && licCheck.machineBound,
      chainIntact: brokenInvoiceIds.length === 0,
    };
  }

  private mapProductRow(r: Record<string, unknown>): Product {
    const sale = Number(r.current_sale_price);
    const halfRaw = Number(r.half_wholesale_price || 0);
    const wholeRaw = Number(r.wholesale_price || 0);
    return {
      id: String(r.id),
      sku: String(r.sku),
      barcode: String(r.barcode),
      name: String(r.name),
      category: String(r.category),
      unit: String(r.unit),
      attributeValue: String(r.attribute_value || ''),
      activityId: String(r.activity_id) as StoreActivityId,
      currentCostPrice: Number(r.current_cost_price),
      currentSalePrice: sale,
      halfWholesalePrice: halfRaw > 0 ? halfRaw : sale,
      wholesalePrice: wholeRaw > 0 ? wholeRaw : sale,
      stockQty: Number(r.stock_qty),
      minStockAlert: Number(r.min_stock_alert),
      maxStockLimit: Number(r.max_stock_limit || 60),
      supplierId: r.supplier_id ? String(r.supplier_id) : null,
      updatedAt: String(r.updated_at),
    };
  }

  public getProducts(activityId?: StoreActivityId): Product[] {
    const activeActivity = activityId || this.getSettings().activityId;
    const rows = this.db
      .prepare(`SELECT * FROM products WHERE activity_id = ? ORDER BY name ASC`)
      .all(activeActivity) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapProductRow(r));
  }

  public getAllProducts(): Product[] {
    const rows = this.db.prepare(`SELECT * FROM products ORDER BY activity_id ASC, name ASC`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => this.mapProductRow(r));
  }

  public getProductById(id: string): Product | null {
    const r = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return this.mapProductRow(r);
  }

  public createProduct(input: {
    name: string;
    sku?: string;
    barcode?: string;
    category: string;
    unit: string;
    attributeValue?: string;
    currentCostPrice: number;
    currentSalePrice: number;
    halfWholesalePrice?: number;
    wholesalePrice?: number;
    stockQty: number;
    minStockAlert: number;
    maxStockLimit?: number;
    supplierId?: string | null;
    actorName: string;
    terminalName: string;
  }): { product: Product; movement: StockMovement } {
    const settings = this.getSettings();
    const id = `prd-${settings.activityId}-${crypto.randomBytes(3).toString('hex')}`;
    const sku = input.sku?.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const barcode = input.barcode?.trim() || `622${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    const now = new Date().toISOString();
    const maxStock = input.maxStockLimit ? Number(input.maxStockLimit) : Math.max(50, Number(input.stockQty) * 2);
    const costPrice = Number(input.currentCostPrice);
    const salePrice = Number(input.currentSalePrice);
    const halfPrice =
      input.halfWholesalePrice !== undefined && Number(input.halfWholesalePrice) > 0
        ? Number(Number(input.halfWholesalePrice).toFixed(2))
        : Number(Math.max(costPrice, salePrice * 0.94).toFixed(2));
    const wholesalePrice =
      input.wholesalePrice !== undefined && Number(input.wholesalePrice) > 0
        ? Number(Number(input.wholesalePrice).toFixed(2))
        : Number(Math.max(costPrice, salePrice * 0.88).toFixed(2));
    const terminalName = (input.terminalName || 'إدارة المخزون').trim();
    const actorName = (input.actorName || 'صاحب المحل').trim();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO products (id, sku, barcode, name, category, unit, attribute_value, activity_id, current_cost_price, current_sale_price, half_wholesale_price, wholesale_price, stock_qty, min_stock_alert, max_stock_limit, supplier_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sku,
          barcode,
          input.name.trim(),
          input.category,
          input.unit,
          input.attributeValue?.trim() || '',
          settings.activityId,
          costPrice,
          salePrice,
          halfPrice,
          wholesalePrice,
          Number(input.stockQty),
          Number(input.minStockAlert),
          maxStock,
          input.supplierId || null,
          now
        );

      const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
      this.db
        .prepare(
          `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          moveId,
          id,
          input.name.trim(),
          Number(input.stockQty),
          Number(input.stockQty),
          'رصيد افتتاحي لصنف جديد',
          terminalName,
          actorName,
          now
        );

      return moveId;
    });

    const moveId = tx();
    return { product: this.getProductById(id)!, movement: this.getMovementById(moveId)! };
  }

  public updateProductPriceOrInfo(
    productId: string,
    patch: {
      name?: string;
      category?: string;
      unit?: string;
      attributeValue?: string;
      barcode?: string;
      currentCostPrice?: number;
      currentSalePrice?: number;
      halfWholesalePrice?: number;
      wholesalePrice?: number;
      minStockAlert?: number;
      maxStockLimit?: number;
      reason?: string;
      actorName: string;
    }
  ): { product: Product; historyEntry: ProductPriceHistory | null } {
    const existing = this.getProductById(productId);
    if (!existing) throw new Error('الصنف غير موجود');

    const now = new Date().toISOString();
    const newCost = patch.currentCostPrice !== undefined ? Number(patch.currentCostPrice) : existing.currentCostPrice;
    const newSale = patch.currentSalePrice !== undefined ? Number(patch.currentSalePrice) : existing.currentSalePrice;
    const newHalf =
      patch.halfWholesalePrice !== undefined && Number(patch.halfWholesalePrice) > 0
        ? Number(Number(patch.halfWholesalePrice).toFixed(2))
        : existing.halfWholesalePrice;
    const newWhole =
      patch.wholesalePrice !== undefined && Number(patch.wholesalePrice) > 0
        ? Number(Number(patch.wholesalePrice).toFixed(2))
        : existing.wholesalePrice;
    const priceChanged = newCost !== existing.currentCostPrice || newSale !== existing.currentSalePrice;

    let historyEntry: ProductPriceHistory | null = null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE products
           SET name = ?, category = ?, unit = ?, attribute_value = ?, barcode = ?, current_cost_price = ?, current_sale_price = ?, half_wholesale_price = ?, wholesale_price = ?, min_stock_alert = ?, max_stock_limit = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          patch.name?.trim() || existing.name,
          patch.category || existing.category,
          patch.unit || existing.unit,
          patch.attributeValue !== undefined ? patch.attributeValue : existing.attributeValue,
          patch.barcode?.trim() || existing.barcode,
          newCost,
          newSale,
          newHalf,
          newWhole,
          patch.minStockAlert !== undefined ? Number(patch.minStockAlert) : existing.minStockAlert,
          patch.maxStockLimit !== undefined ? Number(patch.maxStockLimit) : existing.maxStockLimit,
          now,
          productId
        );

      if (priceChanged) {
        const histId = `ph-${crypto.randomBytes(4).toString('hex')}`;
        const reason = patch.reason?.trim() || 'تحديث سعر الصنف (يسري على الفواتير الجديدة فقط)';
        this.db
          .prepare(
            `INSERT INTO product_price_history (id, product_id, product_name, old_cost_price, new_cost_price, old_sale_price, new_sale_price, changed_by, reason, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            histId,
            productId,
            patch.name?.trim() || existing.name,
            existing.currentCostPrice,
            newCost,
            existing.currentSalePrice,
            newSale,
            patch.actorName,
            reason,
            now
          );

        historyEntry = {
          id: histId,
          productId,
          productName: patch.name?.trim() || existing.name,
          oldCostPrice: existing.currentCostPrice,
          newCostPrice: newCost,
          oldSalePrice: existing.currentSalePrice,
          newSalePrice: newSale,
          changedBy: patch.actorName,
          reason,
          changedAt: now,
        };
      }
    });

    tx();
    return { product: this.getProductById(productId)!, historyEntry };
  }

  public deleteProduct(productId: string): void {
    const existing = this.getProductById(productId);
    if (!existing) throw new Error('الصنف غير موجود.');
    const usedInInv = this.db
      .prepare('SELECT COUNT(*) as c FROM invoice_items WHERE product_id = ?')
      .get(productId) as { c: number };
    if (usedInInv.c > 0) {
      throw new Error('لا يمكن حذف صنف مرتبط بفواتير مبيعات سابقة حفاظاً على دقة حساب الأرباح التاريخية. يمكنك تصفير كميته بدلاً من ذلك.');
    }
    this.db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  }

  public bulkAdjustPrices(input: {
    productIds?: string[];
    category?: string;
    mode: 'percent' | 'fixed';
    target: 'sale' | 'cost' | 'both';
    value: number;
    reason?: string;
    actorName: string;
  }): { updatedCount: number; products: Product[] } {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value === 0) {
      throw new Error('قيمة التعديل يجب أن تكون رقماً غير صفري.');
    }
    const all = this.getAllProducts();
    const settings = this.getSettings();
    const candidates = all.filter((p) => {
      if (input.productIds && input.productIds.length > 0) {
        return input.productIds.includes(p.id);
      }
      if (p.activityId !== settings.activityId) return false;
      if (input.category && input.category !== 'all' && p.category !== input.category) return false;
      return true;
    });

    const calcNext = (cur: number) => {
      const next = input.mode === 'percent' ? cur * (1 + value / 100) : cur + value;
      return Math.max(0.5, Number(next.toFixed(2)));
    };

    const updated: Product[] = [];
    const tx = this.db.transaction(() => {
      for (const p of candidates) {
        const nextCost = input.target === 'cost' || input.target === 'both' ? calcNext(p.currentCostPrice) : p.currentCostPrice;
        const nextSale = input.target === 'sale' || input.target === 'both' ? calcNext(p.currentSalePrice) : p.currentSalePrice;
        const saleUpdated = input.target === 'sale' || input.target === 'both';
        const nextHalf = saleUpdated ? calcNext(p.halfWholesalePrice || p.currentSalePrice) : p.halfWholesalePrice;
        const nextWhole = saleUpdated ? calcNext(p.wholesalePrice || p.currentSalePrice) : p.wholesalePrice;
        if (nextCost !== p.currentCostPrice || nextSale !== p.currentSalePrice) {
          const res = this.updateProductPriceOrInfo(p.id, {
            currentCostPrice: nextCost,
            currentSalePrice: nextSale,
            halfWholesalePrice: nextHalf,
            wholesalePrice: nextWhole,
            reason: input.reason?.trim() || `تعديل أسعار جماعي (${input.mode === 'percent' ? `${value}%` : `${value} ج.م`})`,
            actorName: input.actorName || 'صاحب المحل',
          });
          updated.push(res.product);
        }
      }
    });
    tx();
    return { updatedCount: updated.length, products: updated };
  }

  public adjustStock(input: {
    productId: string;
    deltaQty: number;
    reason: string;
    actorName: string;
    terminalName: string;
    newCostPrice?: number;
  }): { product: Product; movement: StockMovement } {
    const existing = this.getProductById(input.productId);
    if (!existing) throw new Error('الصنف غير موجود');

    const nextQty = Number((existing.stockQty + Number(input.deltaQty)).toFixed(3));
    if (nextQty < 0) {
      throw new Error(`الكمية المتاحة (${existing.stockQty}) لا تكفي للخصم المطلوب.`);
    }

    const now = new Date().toISOString();
    const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
    const terminalName = (input.terminalName || 'لوحة المخزون').trim();
    const actorName = (input.actorName || 'صاحب المحل').trim();

    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
        .run(nextQty, now, input.productId);

      this.db
        .prepare(
          `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          moveId,
          input.productId,
          existing.name,
          Number(input.deltaQty),
          nextQty,
          input.reason,
          terminalName,
          actorName,
          now
        );
    });

    tx();

    if (input.newCostPrice !== undefined && input.newCostPrice !== existing.currentCostPrice) {
      this.updateProductPriceOrInfo(input.productId, {
        currentCostPrice: input.newCostPrice,
        reason: `تحديث سعر التكلفة عند التوريد: ${input.reason}`,
        actorName: input.actorName,
      });
    }

    return {
      product: this.getProductById(input.productId)!,
      movement: this.getMovementById(moveId)!,
    };
  }

  public createSaleInvoice(input: {
    items: Array<{
      productId: string;
      quantity: number;
      discountAmount?: number;
      priceTier?: PriceTier;
      unitSalePrice?: number;
    }>;
    customerId?: string | null;
    paymentMethod: PaymentMethod;
    treasuryId?: string | null;
    allocations?: Array<{
      treasuryId?: string | null;
      method: Exclude<PaymentMethod, 'split'>;
      amount: number;
      referenceCode?: string;
    }>;
    paymentRef?: string;
    invoiceDiscount?: number;
    paidAmount?: number;
    cashierName?: string;
    terminalName?: string;
    notes?: string;
    dueDate?: string | null;
    applyPromotion?: boolean;
    redeemLoyaltyPoints?: number;
    useStoreCredit?: boolean;
    exchangeForInvoiceId?: string | null;
    quotationId?: string | null;
  }): { invoice: Invoice; updatedProducts: Product[]; movements: StockMovement[] } {
    if (!input.items || input.items.length === 0) {
      throw new Error('الفاتورة لا تحتوي على أي أصناف.');
    }

    if (input.quotationId) {
      const q = this.quotationsRepo.getQuotationById(input.quotationId);
      if (!q) throw new Error('عرض السعر المرتبط غير موجود.');
      if (q.status === 'converted') {
        throw new Error('تم تحويل عرض السعر هذا إلى فاتورة مبيعات بالفعل.');
      }
      if (q.status === 'cancelled') {
        throw new Error('لا يمكن تحويل عرض سعر ملغي إلى فاتورة مبيعات.');
      }
    }

    const license = this.getLicenseStatus();
    if (!license.valid) {
      throw new Error(`تعذر إصدار الفاتورة: ${license.reason}`);
    }

    const settings = this.getSettings();
    const loyaltyCfg = settings.loyaltyConfig || DEFAULT_LOYALTY_CONFIG;
    const paymentCfg = this.getPaymentConfig();
    const now = new Date().toISOString();
    const invId = `inv-${crypto.randomBytes(4).toString('hex')}`;
    const invoiceNumber = this.nextYearlySequenceNumber('invoices', 'invoice_number', 'INV');
    const terminalName = (input.terminalName || 'نقطة بيع 1').trim();
    const cashierName = (input.cashierName || 'الكاشير').trim();

    const lastHashRow = this.db
      .prepare('SELECT row_hash FROM invoices ORDER BY created_at DESC, id DESC LIMIT 1')
      .get() as { row_hash: string } | undefined;
    const prevHash = lastHashRow?.row_hash || GENESIS_HASH;

    const updatedProducts: Product[] = [];
    const movements: StockMovement[] = [];
    const allTreasuries = this.getTreasuries();
    const defaultTreasuryForMethod = (m: Exclude<PaymentMethod, 'split'>): TreasuryAccount | null => {
      const typeMap: Record<string, TreasuryType> = {
        cash: 'cash_drawer',
        instapay: 'instapay',
        vodafone_cash: 'wallet',
        card: 'bank_pos',
      };
      const tType = typeMap[m];
      if (!tType) return null;
      return (
        allTreasuries.find((t) => t.active && t.type === tType && t.isDefault) ||
        allTreasuries.find((t) => t.active && t.type === tType) ||
        null
      );
    };

    const tx = this.db.transaction(() => {
      let customerName = 'عميل نقدي سريع';
      let customerRow:
        | {
            id: string;
            name: string;
            balance_due: number;
            credit_limit: number;
            loyalty_points: number;
            store_credit_balance: number;
          }
        | undefined;
      if (input.customerId) {
        customerRow = this.db
          .prepare('SELECT id, name, balance_due, credit_limit, loyalty_points, store_credit_balance FROM customers WHERE id = ?')
          .get(input.customerId) as
          | {
              id: string;
              name: string;
              balance_due: number;
              credit_limit: number;
              loyalty_points: number;
              store_credit_balance: number;
            }
          | undefined;
        if (customerRow) customerName = customerRow.name;
      }

      let subtotal = 0;
      let itemDiscounts = 0;
      let totalCostAtSale = 0;
      const resolvedItems: Array<InvoiceItem & { category: string }> = [];

      for (const reqItem of input.items) {
        const qty = Number(reqItem.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر.');

        const prod = this.getProductById(reqItem.productId);
        if (!prod) throw new Error('أحد الأصناف غير موجود.');
        if (!settings.allowNegativeStock && prod.stockQty < qty) {
          throw new Error(`الكمية المتاحة من "${prod.name}" هي (${prod.stockQty} ${prod.unit}) فقط.`);
        }

        const requestedTier: PriceTier =
          reqItem.priceTier === 'wholesale' ||
          reqItem.priceTier === 'half_wholesale' ||
          reqItem.priceTier === 'custom'
            ? reqItem.priceTier
            : 'retail';

        let resolvedUnitPrice = prod.currentSalePrice;
        let resolvedTier: PriceTier = requestedTier;

        if (reqItem.unitSalePrice !== undefined && reqItem.unitSalePrice !== null) {
          const overrideNum = Number(reqItem.unitSalePrice);
          if (!Number.isFinite(overrideNum) || overrideNum < 0) {
            throw new Error(`سعر البيع للصنف "${prod.name}" غير صالح.`);
          }
          resolvedUnitPrice = Number(overrideNum.toFixed(2));
          if (resolvedTier === 'retail' && Math.abs(resolvedUnitPrice - prod.currentSalePrice) > 0.01) {
            resolvedTier = 'custom';
          }
        } else if (requestedTier === 'wholesale') {
          resolvedUnitPrice = prod.wholesalePrice > 0 ? prod.wholesalePrice : prod.currentSalePrice;
        } else if (requestedTier === 'half_wholesale') {
          resolvedUnitPrice = prod.halfWholesalePrice > 0 ? prod.halfWholesalePrice : prod.currentSalePrice;
        } else {
          resolvedUnitPrice = prod.currentSalePrice;
        }

        const nextStock = Number((prod.stockQty - qty).toFixed(3));
        this.db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(nextStock, now, prod.id);
        this.batchRepo.consumeFefoBatches(prod.id, qty);

        const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
        this.db
          .prepare(
            `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(moveId, prod.id, prod.name, -qty, nextStock, `فاتورة بيع ${invoiceNumber}`, terminalName, cashierName, now);

        const disc = Math.max(0, Number(reqItem.discountAmount || 0));
        const gross = Number((resolvedUnitPrice * qty).toFixed(2));
        const cappedDisc = Math.min(gross, disc);
        const lineTotal = Number(Math.max(0, gross - cappedDisc).toFixed(2));
        const lineCost = Number((prod.currentCostPrice * qty).toFixed(2));
        const lineProfit = Number((lineTotal - lineCost).toFixed(2));

        subtotal += gross;
        itemDiscounts += cappedDisc;
        totalCostAtSale += lineCost;

        resolvedItems.push({
          id: `item-${crypto.randomBytes(4).toString('hex')}`,
          invoiceId: invId,
          productId: prod.id,
          productName: prod.name,
          category: prod.category,
          activityId: prod.activityId,
          unit: prod.unit,
          quantity: qty,
          returnedQuantity: 0,
          unitCostAtSale: prod.currentCostPrice,
          unitSalePrice: resolvedUnitPrice,
          priceTier: resolvedTier,
          discountAmount: cappedDisc,
          lineTotal,
          lineProfit,
        });

        updatedProducts.push({ ...prod, stockQty: nextStock, updatedAt: now });
        movements.push({
          id: moveId,
          productId: prod.id,
          productName: prod.name,
          deltaQty: -qty,
          afterQty: nextStock,
          reason: `فاتورة بيع ${invoiceNumber}`,
          terminalName,
          actorName: cashierName,
          createdAt: now,
        });
      }

      const afterItemDiscTotal = Number(Math.max(0, subtotal - itemDiscounts).toFixed(2));

      // Automatic Store Promotion Discount (if requested)
      let promotionDiscount = 0;
      if (input.applyPromotion) {
        const promoEval = findBestPromotion(
          this.batchRepo.listPromotions(),
          resolvedItems.map((it) => ({
            productId: it.productId,
            category: it.category,
            quantity: it.quantity,
            unitPrice: it.unitSalePrice,
            lineTotal: it.lineTotal,
          })),
          now
        );
        promotionDiscount = Math.min(afterItemDiscTotal, promoEval.discountAmount);
      }

      const afterPromo = Number(Math.max(0, afterItemDiscTotal - promotionDiscount).toFixed(2));
      // Clamp manual invoice-level discount so grandTotal never drops below 0 or inflates discount metrics
      const invDiscount = Number(Math.min(afterPromo, Math.max(0, Number(input.invoiceDiscount || 0))).toFixed(2));
      const afterManualInvDisc = Number(Math.max(0, afterPromo - invDiscount).toFixed(2));

      // Loyalty Points Redemption as invoice discount
      let loyaltyPointsRedeemed = 0;
      let loyaltyDiscount = 0;
      const reqRedeemPoints = Number(input.redeemLoyaltyPoints || 0);
      if (reqRedeemPoints > 0 && customerRow && loyaltyCfg.enabled) {
        const availPoints = Number(customerRow.loyalty_points || 0);
        if (reqRedeemPoints > availPoints) {
          throw new Error(`نقاط الولاء المطلوبة (${reqRedeemPoints}) أكبر من رصيد العميل (${availPoints}).`);
        }
        if (reqRedeemPoints < loyaltyCfg.minRedeemPoints) {
          throw new Error(`الحد الأدنى لاستبدال النقاط هو ${loyaltyCfg.minRedeemPoints} نقطة.`);
        }
        const pointVal = Math.max(0.01, Number(loyaltyCfg.pointValueEgp || 1));
        const maxRedeemableEgp = afterManualInvDisc;
        const requestedEgp = Number((reqRedeemPoints * pointVal).toFixed(2));
        loyaltyDiscount = Number(Math.min(maxRedeemableEgp, requestedEgp).toFixed(2));
        loyaltyPointsRedeemed = Number(Math.min(availPoints, Math.ceil(loyaltyDiscount / pointVal)).toFixed(2));
      }

      const discountTotal = Number((itemDiscounts + promotionDiscount + invDiscount + loyaltyDiscount).toFixed(2));
      const grandTotal = Number(Math.max(0, subtotal - discountTotal).toFixed(2));
      const totalProfit = Number((grandTotal - totalCostAtSale).toFixed(2));

      // Optional Store Credit tender settlement
      let storeCreditUsed = 0;
      if (input.useStoreCredit && customerRow && Number(customerRow.store_credit_balance || 0) > 0 && grandTotal > 0) {
        storeCreditUsed = Number(Math.min(grandTotal, Number(customerRow.store_credit_balance || 0)).toFixed(2));
      }
      const remainingToSettle = Number(Math.max(0, grandTotal - storeCreditUsed).toFixed(2));

      // Build normalized allocations (either explicit split allocations or single method/treasury)
      const rawAllocations =
        remainingToSettle <= 0.001
          ? []
          : Array.isArray(input.allocations) && input.allocations.length > 0
            ? input.allocations.filter((a) => Number(a.amount) > 0)
            : [
                {
                  treasuryId: input.treasuryId || null,
                  method: (input.paymentMethod === 'split' ? 'cash' : input.paymentMethod) as Exclude<PaymentMethod, 'split'>,
                  amount: remainingToSettle,
                  referenceCode: input.paymentRef || '',
                },
              ];

      if (remainingToSettle > 0.001 && rawAllocations.length === 0) {
        throw new Error('يجب تحديد خزينة وطريقة سداد صالحة لقيمة الفاتورة.');
      }

      const allocSum = Number(rawAllocations.reduce((s, a) => s + Number(a.amount || 0), 0).toFixed(2));
      if (Math.abs(allocSum - remainingToSettle) > 0.05) {
        throw new Error(
          `مجموع توزيع الخزائن (${allocSum.toFixed(2)} ج.م) لا يساوي المتبقي المطلوب تحصيله (${remainingToSettle.toFixed(2)} ج.م).`
        );
      }

      const resolvedAllocations: InvoicePaymentAllocation[] = rawAllocations.map((a) => {
        const method = a.method;
        const tr =
          method === 'credit'
            ? null
            : (a.treasuryId ? allTreasuries.find((t) => t.id === a.treasuryId) : null) ||
              defaultTreasuryForMethod(method);
        const amt = Number(Number(a.amount).toFixed(2));
        const fee = method === 'card' ? Number(((amt * paymentCfg.cardFeePercent) / 100).toFixed(2)) : 0;
        return {
          id: `alloc-${crypto.randomBytes(4).toString('hex')}`,
          invoiceId: invId,
          treasuryId: tr?.id || null,
          treasuryName:
            method === 'credit'
              ? 'حساب عميل آجل'
              : tr?.name ||
                (method === 'cash'
                  ? 'درج النقدية'
                  : method === 'instapay'
                    ? 'إنستا باي'
                    : method === 'vodafone_cash'
                      ? 'محفظة إلكترونية'
                      : 'ماكينة فيزا'),
          method,
          amount: amt,
          feeAmount: fee,
          referenceCode: (a.referenceCode || '').trim(),
        };
      });

      const creditPortion = Number(
        resolvedAllocations
          .filter((a) => a.method === 'credit')
          .reduce((s, a) => s + a.amount, 0)
          .toFixed(2)
      );
      if (creditPortion > 0 && !input.customerId) {
        throw new Error('يجب اختيار عميل مسجل لترحيل الجزء الآجل على حسابه.');
      }

      const effectiveMethod: PaymentMethod =
        resolvedAllocations.length > 1 || input.paymentMethod === 'split'
          ? 'split'
          : resolvedAllocations[0]?.method || input.paymentMethod;

      const settledSum = Number((remainingToSettle - creditPortion).toFixed(2));
      const paidAmount =
        effectiveMethod === 'cash' && input.paidAmount !== undefined
          ? Number(input.paidAmount)
          : settledSum;
      const changeAmount =
        effectiveMethod === 'cash' ? Number(Math.max(0, paidAmount - remainingToSettle).toFixed(2)) : 0;

      const combinedRef =
        resolvedAllocations
          .map((a) => a.referenceCode)
          .filter(Boolean)
          .join(' | ') ||
        input.paymentRef?.trim() ||
        '';

      const dueDate =
        creditPortion > 0
          ? input.dueDate && String(input.dueDate).trim()
            ? String(input.dueDate).trim().slice(0, 10)
            : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
          : null;

      const loyaltyPointsEarned =
        customerRow && loyaltyCfg.enabled && grandTotal > 0
          ? Math.floor(grandTotal / Math.max(1, Number(loyaltyCfg.earnRateEgpPerPoint || 50)))
          : 0;

      const rowHash = computeInvoiceChainHash({
        id: invId,
        invoiceNumber,
        createdAt: now,
        grandTotal,
        totalCostAtSale,
        totalProfit,
        status: 'completed',
        prevHash,
      });

      this.db
        .prepare(
          `INSERT INTO invoices (
            id, invoice_number, activity_id, created_at, cashier_name, terminal_name, customer_id, customer_name,
            payment_method, payment_ref, subtotal, discount_total, grand_total, total_cost_at_sale, total_profit,
            paid_amount, change_amount, status, returned_total, due_date, loyalty_points_earned, loyalty_points_redeemed,
            store_credit_used, promotion_discount, exchange_for_invoice_id, notes, prev_hash, row_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          invId,
          invoiceNumber,
          settings.activityId,
          now,
          cashierName,
          terminalName,
          input.customerId || null,
          customerName,
          effectiveMethod,
          combinedRef,
          Number(subtotal.toFixed(2)),
          discountTotal,
          grandTotal,
          Number(totalCostAtSale.toFixed(2)),
          totalProfit,
          paidAmount,
          changeAmount,
          dueDate,
          loyaltyPointsEarned,
          loyaltyPointsRedeemed,
          storeCreditUsed,
          promotionDiscount,
          input.exchangeForInvoiceId || null,
          input.notes?.trim() || '',
          prevHash,
          rowHash
        );

      const insItem = this.db.prepare(
        `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, activity_id, unit, quantity, returned_quantity, unit_cost_at_sale, unit_sale_price, price_tier, discount_amount, line_total, line_profit)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of resolvedItems) {
        insItem.run(
          item.id,
          invId,
          item.productId,
          item.productName,
          item.activityId,
          item.unit,
          item.quantity,
          item.unitCostAtSale,
          item.unitSalePrice,
          item.priceTier || 'retail',
          item.discountAmount,
          item.lineTotal,
          item.lineProfit
        );
      }

      if (input.customerId && customerRow) {
        if (
          creditPortion > 0 &&
          Number(customerRow.credit_limit) > 0 &&
          Number(customerRow.balance_due) + creditPortion > Number(customerRow.credit_limit)
        ) {
          throw new Error(
            `تجاوز الحد الائتماني المسموح للعميل (${Number(customerRow.credit_limit).toFixed(2)} ج.م). الرصيد المتبقي بعد الفاتورة سيتخطى الحد.`
          );
        }
        const nextPoints = Number(
          Math.max(0, Number(customerRow.loyalty_points || 0) - loyaltyPointsRedeemed + loyaltyPointsEarned).toFixed(2)
        );
        const nextStoreCredit = Number(
          Math.max(0, Number(customerRow.store_credit_balance || 0) - storeCreditUsed).toFixed(2)
        );
        this.db
          .prepare(
            `UPDATE customers
             SET total_purchases = ROUND(total_purchases + ?, 2),
                 balance_due = ROUND(balance_due + ?, 2),
                 loyalty_points = ?,
                 store_credit_balance = ?,
                 last_purchase_at = ?
             WHERE id = ?`
          )
          .run(grandTotal, creditPortion, nextPoints, nextStoreCredit, now, input.customerId);
      }

      const insAlloc = this.db.prepare(
        `INSERT INTO invoice_payment_allocations (id, invoice_id, treasury_id, treasury_name, method, amount, fee_amount, reference_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insTx = this.db.prepare(
        `INSERT INTO payment_transactions (id, invoice_id, invoice_number, treasury_id, treasury_name, method, provider, amount, fee_amount, net_amount, reference_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const updTreasury = this.db.prepare(
        `UPDATE treasuries SET current_balance = ROUND(current_balance + ?, 2), updated_at = ? WHERE id = ?`
      );

      for (const alloc of resolvedAllocations) {
        insAlloc.run(
          alloc.id,
          invId,
          alloc.treasuryId,
          alloc.treasuryName,
          alloc.method,
          alloc.amount,
          alloc.feeAmount,
          alloc.referenceCode
        );
        const netAmt = Number((alloc.amount - alloc.feeAmount).toFixed(2));
        insTx.run(
          `tx-${crypto.randomBytes(4).toString('hex')}`,
          invId,
          invoiceNumber,
          alloc.treasuryId,
          alloc.treasuryName,
          alloc.method,
          alloc.treasuryName,
          alloc.amount,
          alloc.feeAmount,
          netAmt,
          alloc.referenceCode,
          alloc.method === 'credit' ? 'pending' : 'settled',
          now
        );
        if (alloc.treasuryId && alloc.method !== 'credit') {
          updTreasury.run(netAmt, now, alloc.treasuryId);
        }
      }

      if (input.quotationId) {
        this.quotationsRepo.markConverted(input.quotationId, invId);
      }
    });

    tx();

    return {
      invoice: this.getInvoiceById(invId)!,
      updatedProducts,
      movements,
    };
  }

  public returnInvoice(invoiceId: string, actorName: string, terminalName: string): {
    invoice: Invoice;
    updatedProducts: Product[];
    movements: StockMovement[];
  } {
    const existing = this.getInvoiceById(invoiceId);
    if (!existing) throw new Error('الفاتورة غير موجودة.');
    if (existing.status === 'returned') throw new Error('تم عمل مرتجع لهذه الفاتورة بالفعل.');

    const safeActor = (actorName || 'صاحب المحل').trim();
    const safeTerminal = (terminalName || 'إدارة الفواتير').trim();
    const now = new Date().toISOString();
    const updatedProducts: Product[] = [];
    const movements: StockMovement[] = [];
    const allTreasuries = this.getTreasuries();

    const defaultTreasuryForMethod = (m: Exclude<PaymentMethod, 'split'>): TreasuryAccount | null => {
      const typeMap: Record<string, TreasuryType> = {
        cash: 'cash_drawer',
        instapay: 'instapay',
        vodafone_cash: 'wallet',
        card: 'bank_pos',
      };
      const tType = typeMap[m];
      if (!tType) return null;
      return (
        allTreasuries.find((t) => t.active && t.type === tType && t.isDefault) ||
        allTreasuries.find((t) => t.active && t.type === tType) ||
        null
      );
    };

    const tx = this.db.transaction(() => {
      for (const item of existing.items) {
        const remainingQty = Number(Math.max(0, item.quantity - Number(item.returnedQuantity || 0)).toFixed(3));
        if (remainingQty <= 0.0001) continue;
        const prod = this.getProductById(item.productId);
        if (prod) {
          const nextStock = Number((prod.stockQty + remainingQty).toFixed(3));
          this.db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(nextStock, now, prod.id);
          this.batchRepo.restoreBatchQty(prod.id, remainingQty);
          const moveId = `mv-${crypto.randomBytes(4).toString('hex')}`;
          this.db
            .prepare(
              `INSERT INTO stock_movements (id, product_id, product_name, delta_qty, after_qty, reason, terminal_name, actor_name, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              moveId,
              prod.id,
              prod.name,
              remainingQty,
              nextStock,
              `مرتجع فاتورة ${existing.invoiceNumber}`,
              safeTerminal,
              safeActor,
              now
            );
          updatedProducts.push({ ...prod, stockQty: nextStock, updatedAt: now });
          movements.push(this.getMovementById(moveId)!);
        }
        this.db.prepare('UPDATE invoice_items SET returned_quantity = ? WHERE id = ?').run(item.quantity, item.id);
      }

      const originalTotal = Number((existing.grandTotal + Number(existing.returnedTotal || 0)).toFixed(2));
      const scale = originalTotal > 0 ? existing.grandTotal / originalTotal : 1;

      const normalizedAllocs =
        existing.allocations && existing.allocations.length > 0
          ? existing.allocations.map((a) => ({
              treasuryId: a.treasuryId,
              method: a.method,
              netRefund: Number(((a.amount - a.feeAmount) * scale).toFixed(2)),
              grossRefund: Number((a.amount * scale).toFixed(2)),
            }))
          : this.resolveNormalizedAllocations(existing).map((a) => ({
              treasuryId: null as string | null,
              method: a.method,
              netRefund: Number(((a.amount - a.feeAmount) * scale).toFixed(2)),
              grossRefund: Number((a.amount * scale).toFixed(2)),
            }));

      const creditPortion = Number(
        normalizedAllocs
          .filter((a) => a.method === 'credit')
          .reduce((s, a) => s + a.grossRefund, 0)
          .toFixed(2)
      );

      let cashDrawerRefunded = 0;
      const updTr = this.db.prepare(
        'UPDATE treasuries SET current_balance = ROUND(current_balance - ?, 2), updated_at = ? WHERE id = ?'
      );

      for (const alloc of normalizedAllocs) {
        if (alloc.method === 'credit') continue;
        const tr =
          (alloc.treasuryId ? allTreasuries.find((t) => t.id === alloc.treasuryId) : null) ||
          defaultTreasuryForMethod(alloc.method);
        if (tr) {
          updTr.run(alloc.netRefund, now, tr.id);
          if (tr.type === 'cash_drawer' || alloc.method === 'cash') {
            cashDrawerRefunded = Number((cashDrawerRefunded + alloc.grossRefund).toFixed(2));
          }
        } else if (alloc.method === 'cash') {
          cashDrawerRefunded = Number((cashDrawerRefunded + alloc.grossRefund).toFixed(2));
        }
      }

      if (existing.customerId) {
        const custRow = this.db
          .prepare('SELECT balance_due, total_purchases, store_credit_balance, loyalty_points FROM customers WHERE id = ?')
          .get(existing.customerId) as
          | {
              balance_due: number;
              total_purchases: number;
              store_credit_balance: number;
              loyalty_points: number;
            }
          | undefined;
        if (custRow) {
          const nextDue = Number(Math.max(0, Number(custRow.balance_due) - creditPortion).toFixed(2));
          const nextPurchases = Number(Math.max(0, Number(custRow.total_purchases) - existing.grandTotal).toFixed(2));
          const pointsDeduct = Number((Number(existing.loyaltyPointsEarned || 0) * scale).toFixed(2));
          const nextPoints = Number(Math.max(0, Number(custRow.loyalty_points || 0) - pointsDeduct).toFixed(2));
          const storeCreditRestored = Number(
            (Number(custRow.store_credit_balance || 0) + Number(existing.storeCreditUsed || 0) * scale).toFixed(2)
          );
          this.db
            .prepare(
              `UPDATE customers
               SET balance_due = ?, total_purchases = ?, loyalty_points = ?, store_credit_balance = ?
               WHERE id = ?`
            )
            .run(nextDue, nextPurchases, nextPoints, storeCreditRestored, existing.customerId);
        }
      }

      const retId = `ret-${crypto.randomBytes(4).toString('hex')}`;
      this.db
        .prepare(
          `INSERT INTO invoice_returns (
            id, invoice_id, created_at, actor_name, reason, return_total, cash_refunded,
            credit_debt_reduced, store_credit_added, treasury_id, treasury_name,
            exchange_invoice_id, exchange_invoice_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'مرتجع فاتورة كامل', NULL, NULL)`
        )
        .run(
          retId,
          invoiceId,
          now,
          safeActor,
          `مرتجع كامل ${existing.invoiceNumber}`,
          existing.grandTotal,
          cashDrawerRefunded,
          creditPortion,
          Number((Number(existing.storeCreditUsed || 0) * scale).toFixed(2))
        );

      this.db.prepare("UPDATE invoices SET status = 'returned' WHERE id = ?").run(invoiceId);
      this.recomputeChainFromAuthorizedMutation();

      this.db.prepare("UPDATE payment_transactions SET status = 'refunded' WHERE invoice_id = ?").run(invoiceId);
    });

    tx();

    return {
      invoice: this.getInvoiceById(invoiceId)!,
      updatedProducts,
      movements,
    };
  }

  public partialReturnOrExchange(input: PartialReturnOrExchangeInput) {
    return executePartialReturnOrExchange(
      {
        db: this.db,
        batchRepo: this.batchRepo,
        getInvoiceById: (id) => this.getInvoiceById(id),
        getProductById: (id) => this.getProductById(id),
        getMovementById: (id) => this.getMovementById(id),
        getTreasuries: () => this.getTreasuries(),
        recomputeChain: () => this.recomputeChainFromAuthorizedMutation(),
        createSaleInvoice: (args) => this.createSaleInvoice(args),
      },
      input
    );
  }

  private recomputeChainFromAuthorizedMutation(): void {
    const rows = this.db
      .prepare(
        `SELECT id, invoice_number, created_at, grand_total, total_cost_at_sale, total_profit, status
         FROM invoices ORDER BY created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      invoice_number: string;
      created_at: string;
      grand_total: number;
      total_cost_at_sale: number;
      total_profit: number;
      status: string;
    }>;

    let prev = GENESIS_HASH;
    const upd = this.db.prepare('UPDATE invoices SET prev_hash = ?, row_hash = ? WHERE id = ?');
    for (const r of rows) {
      const nextHash = computeInvoiceChainHash({
        id: r.id,
        invoiceNumber: r.invoice_number,
        createdAt: r.created_at,
        grandTotal: r.grand_total,
        totalCostAtSale: r.total_cost_at_sale,
        totalProfit: r.total_profit,
        status: r.status,
        prevHash: prev,
      });
      upd.run(prev, nextHash, r.id);
      prev = nextHash;
    }
  }

  private mapReturnRecordsByInvoice(): Map<string, InvoiceReturnRecord[]> {
    const retRows = this.db
      .prepare('SELECT * FROM invoice_returns ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    const itemRows = this.db.prepare('SELECT * FROM invoice_return_items').all() as Array<Record<string, unknown>>;

    const itemsByRet = new Map<string, InvoiceReturnItem[]>();
    for (const ir of itemRows) {
      const rid = String(ir.return_id);
      const list = itemsByRet.get(rid) || [];
      list.push({
        id: String(ir.id),
        returnId: rid,
        invoiceItemId: String(ir.invoice_item_id),
        productId: String(ir.product_id),
        productName: String(ir.product_name),
        quantity: Number(ir.quantity),
        refundAmount: Number(ir.refund_amount),
        costRecovered: Number(ir.cost_recovered),
      });
      itemsByRet.set(rid, list);
    }

    const byInv = new Map<string, InvoiceReturnRecord[]>();
    for (const rr of retRows) {
      const invId = String(rr.invoice_id);
      const list = byInv.get(invId) || [];
      list.push({
        id: String(rr.id),
        invoiceId: invId,
        createdAt: String(rr.created_at),
        actorName: String(rr.actor_name),
        reason: String(rr.reason || ''),
        returnTotal: Number(rr.return_total || 0),
        cashRefunded: Number(rr.cash_refunded || 0),
        creditDebtReduced: Number(rr.credit_debt_reduced || 0),
        storeCreditAdded: Number(rr.store_credit_added || 0),
        treasuryId: rr.treasury_id ? String(rr.treasury_id) : null,
        treasuryName: String(rr.treasury_name || ''),
        exchangeInvoiceId: rr.exchange_invoice_id ? String(rr.exchange_invoice_id) : null,
        exchangeInvoiceNumber: rr.exchange_invoice_number ? String(rr.exchange_invoice_number) : null,
        items: itemsByRet.get(String(rr.id)) || [],
      });
      byInv.set(invId, list);
    }
    return byInv;
  }

  public getInvoices(): Invoice[] {
    const rows = this.db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >;

    const itemRows = this.db.prepare('SELECT * FROM invoice_items').all() as Array<Record<string, unknown>>;
    const itemsByInv = new Map<string, InvoiceItem[]>();
    for (const r of itemRows) {
      const invId = String(r.invoice_id);
      const list = itemsByInv.get(invId) || [];
      list.push({
        id: String(r.id),
        invoiceId: invId,
        productId: String(r.product_id),
        productName: String(r.product_name),
        activityId: (String(r.activity_id || 'grocery') as StoreActivityId),
        unit: String(r.unit),
        quantity: Number(r.quantity),
        returnedQuantity: Number(r.returned_quantity || 0),
        unitCostAtSale: Number(r.unit_cost_at_sale),
        unitSalePrice: Number(r.unit_sale_price),
        priceTier: (String(r.price_tier || 'retail') as PriceTier),
        discountAmount: Number(r.discount_amount),
        lineTotal: Number(r.line_total),
        lineProfit: Number(r.line_profit),
      });
      itemsByInv.set(invId, list);
    }

    const allocRows = this.db.prepare('SELECT * FROM invoice_payment_allocations').all() as Array<
      Record<string, unknown>
    >;
    const allocsByInv = new Map<string, InvoicePaymentAllocation[]>();
    for (const r of allocRows) {
      const invId = String(r.invoice_id);
      const list = allocsByInv.get(invId) || [];
      list.push({
        id: String(r.id),
        invoiceId: invId,
        treasuryId: r.treasury_id ? String(r.treasury_id) : null,
        treasuryName: String(r.treasury_name),
        method: String(r.method) as Exclude<PaymentMethod, 'split'>,
        amount: Number(r.amount),
        feeAmount: Number(r.fee_amount),
        referenceCode: String(r.reference_code || ''),
      });
      allocsByInv.set(invId, list);
    }

    const returnsByInv = this.mapReturnRecordsByInvoice();

    return rows.map((r) => ({
      id: String(r.id),
      invoiceNumber: String(r.invoice_number),
      activityId: (String(r.activity_id || 'grocery') as StoreActivityId),
      createdAt: String(r.created_at),
      cashierName: String(r.cashier_name),
      terminalName: String(r.terminal_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      customerName: String(r.customer_name),
      paymentMethod: String(r.payment_method) as PaymentMethod,
      paymentRef: String(r.payment_ref || ''),
      subtotal: Number(r.subtotal),
      discountTotal: Number(r.discount_total),
      grandTotal: Number(r.grand_total),
      totalCostAtSale: Number(r.total_cost_at_sale),
      totalProfit: Number(r.total_profit),
      paidAmount: Number(r.paid_amount),
      changeAmount: Number(r.change_amount),
      status: String(r.status) as InvoiceStatus,
      returnedTotal: Number(r.returned_total || 0),
      dueDate: r.due_date ? String(r.due_date) : null,
      loyaltyPointsEarned: Number(r.loyalty_points_earned || 0),
      loyaltyPointsRedeemed: Number(r.loyalty_points_redeemed || 0),
      storeCreditUsed: Number(r.store_credit_used || 0),
      promotionDiscount: Number(r.promotion_discount || 0),
      exchangeForInvoiceId: r.exchange_for_invoice_id ? String(r.exchange_for_invoice_id) : null,
      notes: String(r.notes || ''),
      prevHash: String(r.prev_hash),
      rowHash: String(r.row_hash),
      items: itemsByInv.get(String(r.id)) || [],
      allocations: allocsByInv.get(String(r.id)) || [],
      returns: returnsByInv.get(String(r.id)) || [],
    }));
  }

  public getInvoiceById(id: string): Invoice | null {
    const r = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;

    const itemRows = this.db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
      .all(id) as Array<Record<string, unknown>>;
    const allocRows = this.db
      .prepare('SELECT * FROM invoice_payment_allocations WHERE invoice_id = ?')
      .all(id) as Array<Record<string, unknown>>;
    const returnsByInv = this.mapReturnRecordsByInvoice();

    return {
      id: String(r.id),
      invoiceNumber: String(r.invoice_number),
      activityId: String(r.activity_id || 'grocery') as StoreActivityId,
      createdAt: String(r.created_at),
      cashierName: String(r.cashier_name),
      terminalName: String(r.terminal_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      customerName: String(r.customer_name),
      paymentMethod: String(r.payment_method) as PaymentMethod,
      paymentRef: String(r.payment_ref || ''),
      subtotal: Number(r.subtotal),
      discountTotal: Number(r.discount_total),
      grandTotal: Number(r.grand_total),
      totalCostAtSale: Number(r.total_cost_at_sale),
      totalProfit: Number(r.total_profit),
      paidAmount: Number(r.paid_amount),
      changeAmount: Number(r.change_amount),
      status: String(r.status) as InvoiceStatus,
      returnedTotal: Number(r.returned_total || 0),
      dueDate: r.due_date ? String(r.due_date) : null,
      loyaltyPointsEarned: Number(r.loyalty_points_earned || 0),
      loyaltyPointsRedeemed: Number(r.loyalty_points_redeemed || 0),
      storeCreditUsed: Number(r.store_credit_used || 0),
      promotionDiscount: Number(r.promotion_discount || 0),
      exchangeForInvoiceId: r.exchange_for_invoice_id ? String(r.exchange_for_invoice_id) : null,
      notes: String(r.notes || ''),
      prevHash: String(r.prev_hash),
      rowHash: String(r.row_hash),
      items: itemRows.map((it) => ({
        id: String(it.id),
        invoiceId: id,
        productId: String(it.product_id),
        productName: String(it.product_name),
        activityId: String(it.activity_id || 'grocery') as StoreActivityId,
        unit: String(it.unit),
        quantity: Number(it.quantity),
        returnedQuantity: Number(it.returned_quantity || 0),
        unitCostAtSale: Number(it.unit_cost_at_sale),
        unitSalePrice: Number(it.unit_sale_price),
        priceTier: String(it.price_tier || 'retail') as PriceTier,
        discountAmount: Number(it.discount_amount),
        lineTotal: Number(it.line_total),
        lineProfit: Number(it.line_profit),
      })),
      allocations: allocRows.map((al) => ({
        id: String(al.id),
        invoiceId: id,
        treasuryId: al.treasury_id ? String(al.treasury_id) : null,
        treasuryName: String(al.treasury_name),
        method: String(al.method) as Exclude<PaymentMethod, 'split'>,
        amount: Number(al.amount),
        feeAmount: Number(al.fee_amount),
        referenceCode: String(al.reference_code || ''),
      })),
      returns: returnsByInv.get(id) || [],
    };
  }

  public getReportsData(params: {
    period: 'daily' | 'monthly' | 'yearly';
    activityFilter: StoreActivityId | 'all';
    fromDate?: string;
    toDate?: string;
  }): ReportsPayload {
    return this.reportService.buildReportsPayload(params);
  }

  public getEquityPartners(): EquityPartner[] {
    return this.equityRepo.listPartners();
  }

  public getEquityDrawings(partnerId?: string): EquityDrawing[] {
    return this.equityRepo.listDrawings(partnerId);
  }

  public createEquityPartner(input: {
    name: string;
    phone?: string;
    roleTitle?: string;
    capitalContribution?: number;
    profitSharePercent: number;
    notes?: string;
  }): EquityPartner {
    return this.equityRepo.createPartner(input);
  }

  public updateEquityPartner(
    id: string,
    patch: {
      name?: string;
      phone?: string;
      roleTitle?: string;
      capitalContribution?: number;
      profitSharePercent?: number;
      active?: boolean;
      notes?: string;
    }
  ): EquityPartner {
    return this.equityRepo.updatePartner(id, patch);
  }

  public deleteEquityPartner(id: string): void {
    this.equityRepo.deletePartner(id);
  }

  public recordEquityDrawing(input: {
    partnerId: string;
    amount: number;
    type?: 'draw' | 'settlement' | 'capital_add';
    treasuryId?: string | null;
    notes?: string;
    actorName: string;
  }): EquityDrawing {
    return this.equityRepo.recordDrawing(input);
  }

  public getCustomReportPresets(): SavedCustomReportPreset[] {
    return this.equityRepo.listCustomPresets();
  }

  public saveCustomReportPreset(config: CustomReportConfig, actorName: string): SavedCustomReportPreset {
    return this.equityRepo.saveCustomPreset(config, actorName);
  }

  public deleteCustomReportPreset(id: string): void {
    this.equityRepo.deleteCustomPreset(id);
  }

  public runCustomReportQuery(config: CustomReportConfig): CustomReportTabularResult {
    return this.reportService.runCustomReportQuery(config);
  }

  public getPriceHistory(): ProductPriceHistory[] {
    const rows = this.db
      .prepare('SELECT * FROM product_price_history ORDER BY changed_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      oldCostPrice: Number(r.old_cost_price),
      newCostPrice: Number(r.new_cost_price),
      oldSalePrice: Number(r.old_sale_price),
      newSalePrice: Number(r.new_sale_price),
      changedBy: String(r.changed_by),
      reason: String(r.reason),
      changedAt: String(r.changed_at),
    }));
  }

  public getCustomers(): Customer[] {
    return this.partnersRepo.getCustomers();
  }

  public addCustomer(input: {
    name: string;
    phone: string;
    creditLimit?: number;
    defaultPriceTier?: Exclude<PriceTier, 'custom'>;
    defaultDiscountPercent?: number;
    notes?: string;
  }): Customer {
    return this.partnersRepo.addCustomer(input);
  }

  public updateCustomer(
    id: string,
    patch: {
      name?: string;
      phone?: string;
      creditLimit?: number;
      defaultPriceTier?: Exclude<PriceTier, 'custom'>;
      defaultDiscountPercent?: number;
      notes?: string;
      loyaltyPoints?: number;
      storeCreditBalance?: number;
    }
  ): Customer {
    return this.partnersRepo.updateCustomer(id, patch);
  }

  public deleteCustomer(id: string): void {
    this.partnersRepo.deleteCustomer(id);
  }

  public getCustomerStatement(customerId: string) {
    return this.partnersRepo.getCustomerStatement(customerId);
  }

  public collectCustomerPayment(input: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    referenceCode?: string;
    treasuryId?: string | null;
  }): Customer {
    return this.partnersRepo.collectCustomerPayment(input);
  }

  public getTreasuries(): TreasuryAccount[] {
    return this.treasuryExpensesRepo.getTreasuries();
  }

  public createTreasury(input: {
    name: string;
    type: TreasuryType;
    accountNumber?: string;
    currentBalance?: number;
    isDefault?: boolean;
    notes?: string;
  }): TreasuryAccount {
    return this.treasuryExpensesRepo.createTreasury(input);
  }

  public updateTreasury(
    id: string,
    patch: {
      name?: string;
      type?: TreasuryType;
      accountNumber?: string;
      currentBalance?: number;
      active?: boolean;
      isDefault?: boolean;
      notes?: string;
    }
  ): TreasuryAccount {
    return this.treasuryExpensesRepo.updateTreasury(id, patch);
  }

  public deleteTreasury(id: string): void {
    this.treasuryExpensesRepo.deleteTreasury(id);
  }

  public transferBetweenTreasuries(input: {
    fromTreasuryId: string;
    toTreasuryId: string;
    amount: number;
    actorName: string;
    notes?: string;
    referenceCode?: string;
  }): { fromTreasury: TreasuryAccount; toTreasury: TreasuryAccount } {
    return this.treasuryExpensesRepo.transferBetweenTreasuries(input);
  }

  public getSuppliers(): Supplier[] {
    return this.partnersRepo.getSuppliers();
  }

  public addSupplier(input: { name: string; phone: string; category: string; notes?: string }): Supplier {
    return this.partnersRepo.addSupplier(input);
  }

  public updateSupplier(
    id: string,
    patch: { name?: string; phone?: string; category?: string; notes?: string }
  ): Supplier {
    return this.partnersRepo.updateSupplier(id, patch);
  }

  public deleteSupplier(id: string): void {
    this.partnersRepo.deleteSupplier(id);
  }

  public paySupplierDebt(
    supplierId: string,
    amount: number,
    method: PaymentMethod = 'cash',
    referenceCode = '',
    treasuryId?: string | null
  ): Supplier {
    return this.partnersRepo.paySupplierDebt(supplierId, amount, method, referenceCode, treasuryId);
  }

  public getSupplierStatement(supplierId: string) {
    return this.partnersRepo.getSupplierStatement(supplierId);
  }

  public getTransactions(limit: number | null = 80): PaymentTransaction[] {
    const sql =
      limit && limit > 0
        ? `SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT ${Math.floor(limit)}`
        : 'SELECT * FROM payment_transactions ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      invoiceId: r.invoice_id ? String(r.invoice_id) : null,
      invoiceNumber: String(r.invoice_number),
      treasuryId: r.treasury_id ? String(r.treasury_id) : null,
      treasuryName: String(r.treasury_name || ''),
      method: String(r.method) as PaymentMethod,
      provider: String(r.provider),
      amount: Number(r.amount),
      feeAmount: Number(r.fee_amount),
      netAmount: Number(r.net_amount),
      referenceCode: String(r.reference_code || ''),
      status: String(r.status) as 'settled' | 'pending' | 'refunded',
      createdAt: String(r.created_at),
    }));
  }

  public getMovements(limit = 50): StockMovement[] {
    const rows = this.db
      .prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      deltaQty: Number(r.delta_qty),
      afterQty: Number(r.after_qty),
      reason: String(r.reason),
      terminalName: String(r.terminal_name),
      actorName: String(r.actor_name),
      createdAt: String(r.created_at),
    }));
  }

  private getMovementById(id: string): StockMovement | null {
    const r = this.db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      deltaQty: Number(r.delta_qty),
      afterQty: Number(r.after_qty),
      reason: String(r.reason),
      terminalName: String(r.terminal_name),
      actorName: String(r.actor_name),
      createdAt: String(r.created_at),
    };
  }

  private mapStaffRow(r: Record<string, unknown>): StaffUser {
    const id = String(r.id);
    const role = String(r.role) as UserRole;
    const { customPermissions, effectivePermissions } = this.computeUserEffectivePermissions(
      id,
      role,
      r.custom_permissions_json ? String(r.custom_permissions_json) : '{}'
    );
    return {
      id,
      name: String(r.name),
      role,
      active: Boolean(r.active),
      lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
      tokenVersion: Number(r.token_version || 1),
      customPermissions,
      effectivePermissions,
    };
  }

  public getStaffUsers(): StaffUser[] {
    const rows = this.db
      .prepare('SELECT id, name, role, active, last_login_at, token_version, custom_permissions_json FROM staff_users')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapStaffRow(r));
  }

  private countActiveOwners(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM staff_users WHERE role = 'owner' AND active = 1`)
      .get() as { c: number };
    return Number(row?.c || 0);
  }

  public createStaffUser(input: {
    name: string;
    role: UserRole;
    pin: string;
    actorUserId?: string;
    actorRole?: UserRole;
  }): StaffUser {
    const name = (input.name || '').trim();
    const pin = (input.pin || '').trim();
    if (!name) throw new Error('اسم الموظف مطلوب.');
    if (!['owner', 'manager', 'cashier'].includes(input.role)) {
      throw new Error('الدور الوظيفي غير صالح.');
    }
    if (input.role === 'owner' && input.actorRole && input.actorRole !== 'owner') {
      throw new Error('فقط مالك المحل يمكنه إنشاء حساب بصلاحية مالك.');
    }
    if (!/^\d{4,8}$/.test(pin)) throw new Error('الرمز السري يجب أن يكون 4 إلى 8 أرقام.');
    const duplicate = this.getStaffUsers().find(
      (u) => u.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      throw new Error('يوجد موظف مسجل بنفس الاسم بالفعل.');
    }
    const id = `usr-${crypto.randomBytes(3).toString('hex')}`;
    this.db
      .prepare(
        `INSERT INTO staff_users (id, name, role, pin_hash, active, last_login_at, token_version, custom_permissions_json)
         VALUES (?, ?, ?, ?, 1, NULL, 1, '{}')`
      )
      .run(id, name, input.role, hashPin(pin));
    return this.getStaffUsers().find((u) => u.id === id)!;
  }

  public toggleStaffActive(userId: string, active: boolean, actorUserId?: string): StaffUser {
    return this.updateStaffUser(userId, { active }, { actorUserId });
  }

  public updateStaffUser(
    userId: string,
    patch: {
      name?: string;
      role?: UserRole;
      active?: boolean;
      newPin?: string;
      customPermissions?: Partial<Record<PermissionKey, boolean | null>>;
    },
    actorContext?: { actorUserId?: string; actorRole?: UserRole }
  ): StaffUser {
    const existing = this.getStaffUsers().find((u) => u.id === userId);
    if (!existing) throw new Error('الموظف غير موجود.');

    if (actorContext?.actorRole && actorContext.actorRole !== 'owner') {
      if (existing.role === 'owner' || patch.role === 'owner') {
        throw new Error('لا يملك هذا الحساب صلاحية تعديل أو ترقية حسابات المالكين.');
      }
    }

    if (actorContext?.actorUserId && actorContext.actorUserId === userId && patch.active === false) {
      throw new Error('لا يمكنك تعطيل حسابك الشخصي أثناء الجلسة النشطة.');
    }

    if (userId === 'usr-owner') {
      if (patch.active === false) throw new Error('لا يمكن تعطيل حساب مالك المحل الرئيسي.');
      if (patch.role && patch.role !== 'owner') throw new Error('لا يمكن تغيير صلاحية المالك الرئيسي.');
    }

    const activeOwners = this.countActiveOwners();
    const isCurrentlyActiveOwner = existing.role === 'owner' && existing.active;
    const willBeInactiveOrDemoted =
      patch.active === false || (patch.role !== undefined && patch.role !== 'owner');
    if (isCurrentlyActiveOwner && willBeInactiveOrDemoted && activeOwners <= 1) {
      throw new Error('لا يمكن تعطيل أو تخفيض رتبة المالك النشط الوحيد في النظام.');
    }

    let nextCustomJson: string | undefined;
    let permChanged = false;
    if (patch.customPermissions !== undefined) {
      const merged: Partial<Record<PermissionKey, boolean>> = { ...(existing.customPermissions || {}) };
      for (const [k, v] of Object.entries(patch.customPermissions)) {
        if (v === null || v === undefined) {
          delete merged[k as PermissionKey];
        } else {
          merged[k as PermissionKey] = Boolean(v);
        }
      }
      if (userId === 'usr-owner') {
        merged.manage_security_rbac = true;
      }
      nextCustomJson = JSON.stringify(merged);
      permChanged = true;
    }

    const tx = this.db.transaction(() => {
      const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
      if (!nextName) throw new Error('اسم الموظف لا يمكن أن يكون فارغاً.');
      const dup = this.getStaffUsers().find(
        (u) => u.id !== userId && u.name.trim().toLowerCase() === nextName.toLowerCase()
      );
      if (dup) throw new Error('يوجد موظف آخر مسجل بنفس الاسم.');

      let pinChanged = false;
      if (patch.newPin !== undefined && patch.newPin.trim() !== '') {
        this.updateStaffPin(userId, patch.newPin.trim());
        pinChanged = true;
      }

      const nextRole = patch.role || existing.role;
      const nextActive = patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active ? 1 : 0;

      const shouldBumpVersion =
        pinChanged ||
        permChanged ||
        nextRole !== existing.role ||
        Boolean(nextActive) !== existing.active;

      this.db
        .prepare(
          `UPDATE staff_users
           SET name = ?, role = ?, active = ?,
               custom_permissions_json = COALESCE(?, custom_permissions_json),
               token_version = token_version + ?
           WHERE id = ?`
        )
        .run(nextName, nextRole, nextActive, nextCustomJson ?? null, shouldBumpVersion ? 1 : 0, userId);
    });
    tx();

    return this.getStaffUsers().find((u) => u.id === userId)!;
  }

  public revokeUserSessions(userId: string): StaffUser {
    const existing = this.getStaffUsers().find((u) => u.id === userId);
    if (!existing) throw new Error('الموظف غير موجود.');
    this.db.prepare('UPDATE staff_users SET token_version = token_version + 1 WHERE id = ?').run(userId);
    return this.getStaffUsers().find((u) => u.id === userId)!;
  }

  public deleteStaffUser(userId: string, actorUserId?: string, actorRole?: UserRole): void {
    const existing = this.getStaffUsers().find((u) => u.id === userId);
    if (!existing) throw new Error('الموظف غير موجود.');
    if (userId === 'usr-owner') {
      throw new Error('لا يمكن حذف حساب مالك المحل الرئيسي.');
    }
    if (actorUserId && actorUserId === userId) {
      throw new Error('لا يمكنك حذف حسابك الشخصي أثناء استخدامه.');
    }
    if (existing.role === 'owner') {
      if (actorRole && actorRole !== 'owner') {
        throw new Error('فقط مالك المحل يمكنه حذف حساب مالك آخر.');
      }
      if (existing.active && this.countActiveOwners() <= 1) {
        throw new Error('لا يمكن حذف المالك النشط الوحيد في النظام.');
      }
    }
    this.db.prepare('DELETE FROM staff_users WHERE id = ?').run(userId);
  }

  public verifyStaffPin(userId: string, pin: string): StaffUser | null {
    const row = this.db
      .prepare(
        `SELECT id, name, role, pin_hash, active, last_login_at, token_version, custom_permissions_json
         FROM staff_users WHERE id = ? AND active = 1`
      )
      .get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (!verifyPin(pin.trim(), String(row.pin_hash))) return null;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE staff_users SET last_login_at = ? WHERE id = ?').run(now, userId);
    return this.mapStaffRow({ ...row, last_login_at: now });
  }

  public updateStaffPin(userId: string, newPin: string): void {
    const clean = (newPin || '').trim();
    if (!/^\d{4,8}$/.test(clean)) {
      throw new Error('الرمز السري يجب أن يتكون من 4 إلى 8 أرقام.');
    }
    this.db
      .prepare('UPDATE staff_users SET pin_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(hashPin(clean), userId);
  }

  private getAuthSecret(): string {
    const row = this.db.prepare('SELECT auth_secret FROM store_settings WHERE id = 1').get() as
      | { auth_secret?: string }
      | undefined;
    if (row?.auth_secret && row.auth_secret.length >= 32) {
      return row.auth_secret;
    }
    const secret = crypto.randomBytes(32).toString('hex');
    this.db.prepare('UPDATE store_settings SET auth_secret = ? WHERE id = 1').run(secret);
    return secret;
  }

  public logAudit(input: {
    actorUserId?: string;
    actorName: string;
    action: string;
    category: SecurityAuditLog['category'];
    target?: string;
    details?: string;
  }): SecurityAuditLog {
    const entry: SecurityAuditLog = {
      id: `aud-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      actorUserId: input.actorUserId || 'system',
      actorName: input.actorName || 'النظام',
      action: input.action,
      category: input.category,
      target: input.target || '',
      details: input.details || '',
    };
    this.db
      .prepare(
        `INSERT INTO security_audit_logs (id, timestamp, actor_user_id, actor_name, action, category, target, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.actorUserId,
        entry.actorName,
        entry.action,
        entry.category,
        entry.target,
        entry.details
      );
    return entry;
  }

  public getAuditLogs(limit = 60): SecurityAuditLog[] {
    const rows = this.db
      .prepare('SELECT * FROM security_audit_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      timestamp: String(r.timestamp),
      actorUserId: String(r.actor_user_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      category: String(r.category) as SecurityAuditLog['category'],
      target: String(r.target || ''),
      details: String(r.details || ''),
    }));
  }

  public authenticateWithPin(
    userId: string,
    pin: string,
    rateKey = 'local'
  ): { ok: true; user: StaffUser; token: string } | { ok: false; error: string; lockedRemainingSec?: number } {
    const cleanUserId = (userId || '').trim();
    const attemptKey = `${rateKey}:${cleanUserId || 'unknown'}`;
    const now = Date.now();
    const lockState = this.failedPinAttempts.get(attemptKey);
    if (lockState && lockState.lockedUntil > now) {
      const rem = Math.ceil((lockState.lockedUntil - now) / 1000);
      return {
        ok: false,
        lockedRemainingSec: rem,
        error: `تم إيقاف المحاولات مؤقتاً لهذا الحساب لمدة ${rem} ثانية بسبب تكرار الرمز الخاطئ.`,
      };
    }

    const user = this.verifyStaffPin(cleanUserId, pin);
    if (!user) {
      const nextCount = (lockState?.count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? now + 60000 : 0;
      this.failedPinAttempts.set(attemptKey, { count: nextCount >= 5 ? 0 : nextCount, lockedUntil });
      this.logAudit({
        actorUserId: cleanUserId || 'unknown',
        actorName: cleanUserId || 'unknown',
        action: lockedUntil > 0 ? 'حظر مؤقت بعد 5 محاولات PIN خاطئة' : 'محاولة دخول برمز PIN غير صحيح',
        category: 'security',
        target: cleanUserId || 'unknown',
        details: `المحاولة رقم ${nextCount}`,
      });
      return {
        ok: false,
        lockedRemainingSec: lockedUntil > 0 ? 60 : undefined,
        error:
          lockedUntil > 0
            ? 'تم تجاوز الحد المسموح للمحاولات (5 مرات). تم قفل الحساب لمدة 60 ثانية.'
            : 'الرمز السري (PIN) غير صحيح أو الحساب معطل.',
      };
    }

    this.failedPinAttempts.delete(attemptKey);
    const payload = {
      uid: user.id,
      role: user.role,
      tv: user.tokenVersion || 1,
      iat: now,
      exp: now + 7 * 24 * 3600 * 1000,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = crypto
      .createHmac('sha256', this.getAuthSecret())
      .update(payloadB64)
      .digest('base64url');
    const token = `${payloadB64}.${sigB64}`;

    this.logAudit({
      actorUserId: user.id,
      actorName: user.name,
      action: 'تسجيل دخول معتمد للنظام',
      category: 'auth',
      target: user.role,
      details: 'تم إصدار جلسة موقعة HMAC-SHA256',
    });

    return { ok: true, user, token };
  }

  public verifyAuthToken(token: string): StaffUser | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [payloadB64, sigB64] = parts;
      const expectedSig = crypto
        .createHmac('sha256', this.getAuthSecret())
        .update(payloadB64)
        .digest('base64url');
      if (sigB64.length !== expectedSig.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) return null;
      const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        uid: string;
        tv?: number;
        exp: number;
      };
      if (!decoded.uid || Date.now() > Number(decoded.exp || 0)) return null;
      const user = this.getStaffUsers().find((u) => u.id === decoded.uid && u.active);
      if (!user) return null;
      if (Number(decoded.tv || 1) !== Number(user.tokenVersion || 1)) {
        return null;
      }
      return user;
    } catch {
      return null;
    }
  }

  public getBatches(productId?: string): ProductBatch[] {
    return this.batchRepo.listBatches(productId);
  }

  public createBatch(input: {
    productId: string;
    batchCode: string;
    expiryDate?: string | null;
    qty: number;
    costPrice?: number;
    supplierId?: string | null;
    purchaseId?: string | null;
    syncProductStock?: boolean;
  }): ProductBatch {
    return this.batchRepo.createBatch(input);
  }

  public deleteBatch(id: string): void {
    this.batchRepo.deleteBatch(id);
  }

  public getPromotions(): StorePromotion[] {
    return this.batchRepo.listPromotions();
  }

  public createPromotion(input: {
    name: string;
    ruleType: PromotionRuleType;
    value: number;
    minSubtotal?: number;
    minQty?: number;
    category?: string;
    productId?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    active?: boolean;
  }): StorePromotion {
    return this.batchRepo.createPromotion(input);
  }

  public updatePromotion(
    id: string,
    patch: Partial<Omit<StorePromotion, 'id' | 'createdAt'>>
  ): StorePromotion {
    return this.batchRepo.updatePromotion(id, patch);
  }

  public deletePromotion(id: string): void {
    this.batchRepo.deletePromotion(id);
  }

  public getOwnerAlerts(): OwnerAnomalyAlert[] {
    return this.insightsService.getOwnerAlerts();
  }

  public getAutoReorderSuggestions(): AutoReorderSupplierGroup[] {
    return this.insightsService.getAutoReorderSuggestions();
  }

  public listScheduledReports(): ScheduledReportConfig[] {
    return this.scheduledReportsRepo.listSchedules();
  }

  public getScheduledReportById(id: string): ScheduledReportConfig | null {
    return this.scheduledReportsRepo.getScheduleById(id);
  }

  public createScheduledReport(
    input: Parameters<ScheduledReportsRepository['createSchedule']>[0]
  ): ScheduledReportConfig {
    return this.scheduledReportsRepo.createSchedule(input);
  }

  public updateScheduledReport(
    id: string,
    patch: Parameters<ScheduledReportsRepository['updateSchedule']>[1]
  ): ScheduledReportConfig {
    return this.scheduledReportsRepo.updateSchedule(id, patch);
  }

  public deleteScheduledReport(id: string): void {
    this.scheduledReportsRepo.deleteSchedule(id);
  }

  public markScheduledReportExecuted(
    id: string,
    lastRunAt: string,
    periodKey?: string
  ): ScheduledReportConfig | null {
    return this.scheduledReportsRepo.markScheduleExecuted(id, lastRunAt, periodKey);
  }

  public listReportDigests(limit = 50): ScheduledReportDigest[] {
    return this.scheduledReportsRepo.listDigests(limit);
  }

  public createReportDigest(
    input: Parameters<ScheduledReportsRepository['createDigest']>[0]
  ): ScheduledReportDigest {
    return this.scheduledReportsRepo.createDigest(input);
  }

  public markReportDigestRead(digestId: string, userId: string): ScheduledReportDigest | null {
    return this.scheduledReportsRepo.markDigestRead(digestId, userId);
  }

  public markAllReportDigestsRead(userId: string): void {
    this.scheduledReportsRepo.markAllDigestsRead(userId);
  }

  public listQuotations(limit = 100): SalesQuotation[] {
    return this.quotationsRepo.listQuotations(limit);
  }

  public getQuotationById(id: string): SalesQuotation | null {
    return this.quotationsRepo.getQuotationById(id);
  }

  public createQuotation(
    input: Parameters<QuotationsRepository['createQuotation']>[0]
  ): SalesQuotation {
    return this.quotationsRepo.createQuotation(input);
  }

  public updateQuotationStatus(id: string, status: 'active' | 'cancelled'): SalesQuotation {
    return this.quotationsRepo.updateStatus(id, status);
  }

  public deleteQuotation(id: string): void {
    this.quotationsRepo.deleteQuotation(id);
  }

  private getCashFlowMetricsSince(sinceIso: string): {
    cashCollections: number;
    cashReturns: number;
    cashExpenses: number;
    cashSupplierPayouts: number;
    cashEquityDrawings: number;
    returnedInvIdsWithRecords: Set<string>;
  } {
    const colRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(pt.amount), 0) AS total
         FROM payment_transactions pt
         LEFT JOIN treasuries tr ON tr.id = pt.treasury_id
         WHERE pt.created_at >= ? AND pt.status = 'settled' AND pt.invoice_id IS NULL
           AND pt.invoice_number LIKE 'تحصيل آجل - %'
           AND (tr.type = 'cash_drawer' OR (pt.treasury_id IS NULL AND pt.method = 'cash'))`
      )
      .get(sinceIso) as { total: number };

    const retRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(cash_refunded), 0) AS total
         FROM invoice_returns
         WHERE created_at >= ?`
      )
      .get(sinceIso) as { total: number };

    const expRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM store_expenses
         WHERE payment_source = 'cash_drawer' AND created_at >= ?`
      )
      .get(sinceIso) as { total: number };

    const supRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(pt.amount), 0) AS total
         FROM payment_transactions pt
         LEFT JOIN treasuries tr ON tr.id = pt.treasury_id
         WHERE pt.created_at >= ? AND pt.status = 'settled' AND pt.invoice_id IS NULL
           AND (pt.invoice_number LIKE 'سداد مورد - %' OR pt.invoice_number LIKE 'PUR-%')
           AND (tr.type = 'cash_drawer' OR (pt.treasury_id IS NULL AND pt.method = 'cash'))`
      )
      .get(sinceIso) as { total: number };

    const eqRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(ed.amount), 0) AS total
         FROM equity_drawings ed
         LEFT JOIN treasuries tr ON tr.id = ed.treasury_id
         WHERE ed.created_at >= ? AND ed.type IN ('draw', 'settlement') AND tr.type = 'cash_drawer'`
      )
      .get(sinceIso) as { total: number };

    const retIdRows = this.db
      .prepare('SELECT DISTINCT invoice_id FROM invoice_returns')
      .all() as Array<{ invoice_id: string }>;

    return {
      cashCollections: Number((colRow?.total || 0).toFixed(2)),
      cashReturns: Number((retRow?.total || 0).toFixed(2)),
      cashExpenses: Number((expRow?.total || 0).toFixed(2)),
      cashSupplierPayouts: Number((supRow?.total || 0).toFixed(2)),
      cashEquityDrawings: Number((eqRow?.total || 0).toFixed(2)),
      returnedInvIdsWithRecords: new Set(retIdRows.map((r) => String(r.invoice_id))),
    };
  }

  public getDashboardSummary(): DashboardSummary {
    const settings = this.getSettings();
    const products = this.getProducts(settings.activityId);
    const allInvoices = this.getInvoices();
    const activeInvoices = allInvoices.filter(
      (inv) => inv.status === 'completed' || inv.status === 'partial_returned'
    );

    const todayKey = new Date().toISOString().slice(0, 10);
    const todayStartIso = `${todayKey}T00:00:00.000Z`;
    const todayActiveInvoices = activeInvoices.filter((inv) => inv.createdAt.slice(0, 10) === todayKey);

    const todayRevenue = Number(todayActiveInvoices.reduce((s, inv) => s + inv.grandTotal, 0).toFixed(2));
    const todayProfit = Number(todayActiveInvoices.reduce((s, inv) => s + inv.totalProfit, 0).toFixed(2));

    const cashMetrics = this.getCashFlowMetricsSince(todayStartIso);

    let cashSalesToday = 0;
    let electronicSalesToday = 0;
    let creditSalesToday = 0;

    for (const inv of allInvoices) {
      if (inv.createdAt.slice(0, 10) !== todayKey) continue;
      const includeCashOrig =
        inv.status === 'completed' ||
        inv.status === 'partial_returned' ||
        (inv.status === 'returned' && cashMetrics.returnedInvIdsWithRecords.has(inv.id));

      if (includeCashOrig) {
        for (const al of this.resolveNormalizedAllocations(inv)) {
          if (al.method === 'cash') cashSalesToday += al.amount;
        }
      }

      if (inv.status === 'completed' || inv.status === 'partial_returned') {
        const origTotal = inv.grandTotal + Number(inv.returnedTotal || 0);
        const scale = origTotal > 0 ? inv.grandTotal / origTotal : 1;
        for (const al of this.resolveNormalizedAllocations(inv)) {
          if (al.method === 'credit') creditSalesToday += al.amount * scale;
          else if (al.method !== 'cash') electronicSalesToday += al.amount * scale;
        }
      }
    }

    const monthPrefix = todayKey.slice(0, 7);
    const allExpenses = this.getExpenses();
    const operatingExpenses = allExpenses.filter((e) => e.category !== 'owner_draw');
    const todayExpenses = Number(
      operatingExpenses
        .filter((e) => e.createdAt.slice(0, 10) === todayKey)
        .reduce((s, e) => s + e.amount, 0)
        .toFixed(2)
    );
    const monthExpenses = Number(
      operatingExpenses
        .filter((e) => e.createdAt.slice(0, 7) === monthPrefix)
        .reduce((s, e) => s + e.amount, 0)
        .toFixed(2)
    );
    const todayNetAfterExpenses = Number((todayProfit - todayExpenses).toFixed(2));

    const cashDrawerBalance = Number(
      (
        cashSalesToday +
        cashMetrics.cashCollections -
        cashMetrics.cashReturns -
        cashMetrics.cashExpenses -
        cashMetrics.cashSupplierPayouts -
        cashMetrics.cashEquityDrawings
      ).toFixed(2)
    );
    electronicSalesToday = Number(electronicSalesToday.toFixed(2));
    creditSalesToday = Number(creditSalesToday.toFixed(2));

    const inventoryCapitalCost = Number(
      products.reduce((s, p) => s + p.currentCostPrice * p.stockQty, 0).toFixed(2)
    );
    const inventoryRetailValue = Number(
      products.reduce((s, p) => s + p.currentSalePrice * p.stockQty, 0).toFixed(2)
    );
    const lowStockCount = products.filter((p) => p.stockQty > 0 && p.stockQty <= p.minStockAlert).length;
    const outOfStockCount = products.filter((p) => p.stockQty <= 0).length;

    const expiringBatchesCount = this.batchRepo.getExpiringSoonBatches(30).length;
    const customers = this.getCustomers();
    const overdueCreditCount = activeInvoices.filter((inv) => {
      if (!inv.dueDate || inv.dueDate >= todayKey) return false;
      const hasCredit =
        inv.paymentMethod === 'credit' ||
        Boolean(inv.allocations?.some((a) => a.method === 'credit' && a.amount > 0));
      if (!hasCredit) return false;
      const cust = inv.customerId ? customers.find((c) => c.id === inv.customerId) : undefined;
      return cust ? cust.balanceDue > 0 : true;
    }).length;

    // Period-over-period comparison: today vs yesterday
    const yesterdayKey = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const yesterdayInvs = activeInvoices.filter((inv) => inv.createdAt.slice(0, 10) === yesterdayKey);
    const prevRev = Number(yesterdayInvs.reduce((s, i) => s + i.grandTotal, 0).toFixed(2));
    const prevProf = Number(yesterdayInvs.reduce((s, i) => s + i.totalProfit, 0).toFixed(2));
    const prevExp = Number(
      operatingExpenses
        .filter((e) => e.createdAt.slice(0, 10) === yesterdayKey)
        .reduce((s, e) => s + e.amount, 0)
        .toFixed(2)
    );
    const prevCnt = yesterdayInvs.length;
    const pctDelta = (cur: number, prev: number): number | null => {
      if (Math.abs(prev) < 0.01) return Math.abs(cur) < 0.01 ? null : 100;
      return Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
    };

    const productMap = new Map<
      string,
      { productId: string; name: string; qtySold: number; revenue: number; profit: number }
    >();
    for (const inv of activeInvoices) {
      const origTotal = inv.grandTotal + Number(inv.returnedTotal || 0);
      const scale = origTotal > 0 ? inv.grandTotal / origTotal : 1;
      for (const item of inv.items) {
        const activeQty = Number(Math.max(0, item.quantity - Number(item.returnedQuantity || 0)).toFixed(3));
        if (activeQty <= 0.0001) continue;
        const qtyRatio = item.quantity > 0 ? activeQty / item.quantity : 0;
        const itemRev = Number((item.lineTotal * qtyRatio * scale).toFixed(2));
        const itemCost = Number((item.unitCostAtSale * activeQty).toFixed(2));
        const itemProfit = Number((itemRev - itemCost).toFixed(2));

        const cur = productMap.get(item.productId) || {
          productId: item.productId,
          name: item.productName,
          qtySold: 0,
          revenue: 0,
          profit: 0,
        };
        cur.qtySold = Number((cur.qtySold + activeQty).toFixed(3));
        cur.revenue = Number((cur.revenue + itemRev).toFixed(2));
        cur.profit = Number((cur.profit + itemProfit).toFixed(2));
        productMap.set(item.productId, cur);
      }
    }
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    const methods: Exclude<PaymentMethod, 'split'>[] = ['cash', 'instapay', 'vodafone_cash', 'card', 'credit'];
    const methodTotals = new Map<PaymentMethod, { total: number; count: number }>(
      methods.map((m) => [m, { total: 0, count: 0 }])
    );
    for (const inv of activeInvoices) {
      const seenInInv = new Set<PaymentMethod>();
      const origTotal = inv.grandTotal + Number(inv.returnedTotal || 0);
      const scale = origTotal > 0 ? inv.grandTotal / origTotal : 1;
      for (const al of this.resolveNormalizedAllocations(inv)) {
        const bucket = methodTotals.get(al.method);
        if (bucket) {
          bucket.total = Number((bucket.total + al.amount * scale).toFixed(2));
          if (!seenInInv.has(al.method)) {
            bucket.count += 1;
            seenInInv.add(al.method);
          }
        }
      }
    }
    const paymentBreakdown = methods.map((m) => ({
      method: m as PaymentMethod,
      total: methodTotals.get(m)?.total || 0,
      count: methodTotals.get(m)?.count || 0,
    }));

    const dailySeries: DashboardSummary['dailySeries'] = [];
    const arDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(Date.now() - d * 24 * 3600 * 1000);
      const key = dt.toISOString().slice(0, 10);
      const dayInvs = activeInvoices.filter((inv) => inv.createdAt.slice(0, 10) === key);
      dailySeries.push({
        date: key,
        label: d === 0 ? 'اليوم' : arDays[dt.getDay()],
        revenue: Number(dayInvs.reduce((s, i) => s + i.grandTotal, 0).toFixed(2)),
        profit: Number(dayInvs.reduce((s, i) => s + i.totalProfit, 0).toFixed(2)),
      });
    }

    return {
      todayRevenue,
      todayProfit,
      todayExpenses,
      todayNetAfterExpenses,
      monthExpenses,
      todayInvoiceCount: todayActiveInvoices.length,
      cashDrawerBalance,
      electronicSalesToday,
      creditSalesToday,
      inventoryCapitalCost,
      inventoryRetailValue,
      lowStockCount,
      outOfStockCount,
      expiringBatchesCount,
      overdueCreditCount,
      periodComparison: {
        previousRevenue: prevRev,
        revenueDeltaPercent: pctDelta(todayRevenue, prevRev),
        previousProfit: prevProf,
        profitDeltaPercent: pctDelta(todayProfit, prevProf),
        previousExpenses: prevExp,
        expensesDeltaPercent: pctDelta(todayExpenses, prevExp),
        previousInvoiceCount: prevCnt,
        invoiceCountDeltaPercent: pctDelta(todayActiveInvoices.length, prevCnt),
      },
      ownerAlerts: this.getOwnerAlerts(),
      topProducts,
      paymentBreakdown,
      dailySeries,
    };
  }

  public getPurchaseOrders(): PurchaseOrder[] {
    return this.purchasesRepo.getPurchaseOrders();
  }

  public getPurchaseOrderById(id: string): PurchaseOrder | null {
    return this.purchasesRepo.getPurchaseOrderById(id);
  }

  public createPurchaseOrder(
    input: Parameters<PurchasesAndStocktakeRepository['createPurchaseOrder']>[0]
  ): {
    purchase: PurchaseOrder;
    updatedProducts: Product[];
    movements: StockMovement[];
  } {
    return this.purchasesRepo.createPurchaseOrder(input);
  }

  public createPurchaseReturn(
    input: Parameters<PurchasesAndStocktakeRepository['createPurchaseReturn']>[0]
  ): {
    purchase: PurchaseOrder;
    returnRecord: PurchaseReturnRecord;
    updatedProducts: Product[];
    movements: StockMovement[];
  } {
    return this.purchasesRepo.createPurchaseReturn(input);
  }

  public applyStocktake(
    input: Parameters<PurchasesAndStocktakeRepository['applyStocktake']>[0]
  ): { adjustedCount: number; updatedProducts: Product[]; movements: StockMovement[] } {
    return this.purchasesRepo.applyStocktake(input);
  }

  public getExpenses(): StoreExpense[] {
    return this.treasuryExpensesRepo.getExpenses();
  }

  public getExpenseById(id: string): StoreExpense | null {
    return this.treasuryExpensesRepo.getExpenseById(id);
  }

  public createExpense(input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasuryId?: string | null;
    receiptRef?: string;
    createdAt?: string;
    actorName: string;
    notes?: string;
  }): StoreExpense {
    return this.treasuryExpensesRepo.createExpense(input);
  }

  public updateExpense(
    id: string,
    patch: {
      title?: string;
      category?: ExpenseCategory;
      amount?: number;
      paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
      treasuryId?: string | null;
      receiptRef?: string;
      createdAt?: string;
      notes?: string;
    }
  ): StoreExpense {
    return this.treasuryExpensesRepo.updateExpense(id, patch);
  }

  public deleteExpense(id: string): void {
    this.treasuryExpensesRepo.deleteExpense(id);
  }

  public getRecurringExpenses(): RecurringExpense[] {
    return this.treasuryExpensesRepo.getRecurringExpenses();
  }

  public createRecurringExpense(input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentSource?: 'cash_drawer' | 'bank_instapay' | 'wallet';
    treasuryId?: string | null;
    frequency?: RecurringExpenseFrequency;
    nextDueDate?: string;
    notes?: string;
  }): RecurringExpense {
    return this.treasuryExpensesRepo.createRecurringExpense(input);
  }

  public updateRecurringExpense(
    id: string,
    patch: Parameters<TreasuryAndExpensesRepository['updateRecurringExpense']>[1]
  ): RecurringExpense {
    return this.treasuryExpensesRepo.updateRecurringExpense(id, patch);
  }

  public deleteRecurringExpense(id: string): void {
    this.treasuryExpensesRepo.deleteRecurringExpense(id);
  }

  public executeRecurringExpense(
    id: string,
    actorName: string,
    overrideAmount?: number,
    overrideTreasuryId?: string | null
  ): { expense: StoreExpense; recurring: RecurringExpense } {
    return this.treasuryExpensesRepo.executeRecurringExpense(
      id,
      actorName,
      overrideAmount,
      overrideTreasuryId
    );
  }

  public getBootstrapSnapshot(
    connectedTerminals: number,
    authenticatedUser?: StaffUser | null
  ): BootstrapSnapshot {
    const settings = this.getSettings();
    const staff = this.getStaffUsers();
    const isLocked = Boolean(settings.requireLoginOnStart && !authenticatedUser);
    const activePublicStaff = staff
      .filter((u) => u.active)
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        active: u.active,
        lastLoginAt: u.lastLoginAt,
      }));

    if (isLocked) {
      return {
        settings: {
          ...settings,
          mysqlConfig: {
            ...settings.mysqlConfig,
          },
        },
        paymentConfig: {
          instapayIpa: '',
          instapayEnabled: false,
          vodafoneCashNumber: '',
          walletEnabled: false,
          paymobConfigured: false,
          paymobIntegrationId: '',
          fawryMerchantCode: '',
          fawryConfigured: false,
          cardFeePercent: 0,
        },
        treasuries: [],
        templates: [],
        activities: STORE_ACTIVITIES,
        products: [],
        allProducts: [],
        priceHistory: [],
        invoices: [],
        purchases: [],
        expenses: [],
        recurringExpenses: [],
        customers: [],
        suppliers: [],
        transactions: [],
        movements: [],
        staff: activePublicStaff,
        rolePermissions: this.getRolePermissions(),
        currentUser: activePublicStaff[0] || staff[0],
        license: this.getLicenseStatus(),
        dashboard: {
          todayRevenue: 0,
          todayProfit: 0,
          todayExpenses: 0,
          todayNetAfterExpenses: 0,
          monthExpenses: 0,
          todayInvoiceCount: 0,
          cashDrawerBalance: 0,
          electronicSalesToday: 0,
          creditSalesToday: 0,
          inventoryCapitalCost: 0,
          inventoryRetailValue: 0,
          lowStockCount: 0,
          outOfStockCount: 0,
          topProducts: [],
          paymentBreakdown: [],
          dailySeries: [],
        },
        auditLogs: [],
        equityPartners: [],
        equityDrawings: [],
        customReportPresets: [],
        batches: [],
        promotions: [],
        ownerAlerts: [],
        reorderSuggestions: [],
        connectedTerminals,
        locked: true,
        authenticated: false,
      };
    }

    const resolvedCurrent =
      (authenticatedUser ? staff.find((s) => s.id === authenticatedUser.id && s.active) : undefined) ||
      staff.find((s) => s.active) ||
      staff[0];

    const perms = this.computeUserEffectivePermissions(
      resolvedCurrent.id,
      resolvedCurrent.role,
      JSON.stringify(resolvedCurrent.customPermissions || {})
    ).effectivePermissions;

    return {
      settings,
      paymentConfig: this.getPaymentConfig(),
      treasuries: this.getTreasuries(),
      templates: this.getTemplates(),
      activities: STORE_ACTIVITIES,
      products: this.getProducts(settings.activityId),
      allProducts: this.getAllProducts(),
      priceHistory: this.getPriceHistory(),
      invoices: this.getInvoices(),
      purchases: this.getPurchaseOrders(),
      expenses: this.getExpenses(),
      recurringExpenses: perms.manage_expenses || perms.view_reports ? this.getRecurringExpenses() : [],
      customers: this.getCustomers(),
      suppliers: this.getSuppliers(),
      transactions: this.getTransactions(),
      movements: this.getMovements(),
      staff,
      rolePermissions: this.getRolePermissions(),
      currentUser: resolvedCurrent,
      license: this.getLicenseStatus(),
      dashboard: this.getDashboardSummary(),
      auditLogs: perms.manage_security_rbac ? this.getAuditLogs(100) : [],
      equityPartners: perms.view_reports ? this.getEquityPartners() : [],
      equityDrawings: perms.view_reports ? this.getEquityDrawings() : [],
      customReportPresets: perms.view_reports ? this.getCustomReportPresets() : [],
      scheduledReports: perms.view_reports ? this.listScheduledReports() : [],
      reportDigests: perms.view_reports ? this.listReportDigests(40) : [],
      quotations: perms.pos_sell || perms.view_reports ? this.listQuotations(80) : [],
      emailTransportConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim()),
      batches: this.getBatches(),
      promotions: this.getPromotions(),
      ownerAlerts:
        perms.view_reports || perms.edit_prices_stock || perms.manage_purchases
          ? this.getOwnerAlerts()
          : [],
      reorderSuggestions:
        perms.manage_purchases || perms.edit_prices_stock ? this.getAutoReorderSuggestions() : [],
      connectedTerminals,
      locked: false,
      authenticated: Boolean(authenticatedUser),
    };
  }

  public exportBackupJson() {
    return this.dataExchangeRepo.exportBackupJson();
  }

  public importProductsBatch(
    rows: Array<Record<string, unknown>>,
    actorName = 'استيراد Excel'
  ): DataImportSummary {
    return this.dataExchangeRepo.importProductsBatch(rows, actorName);
  }

  public importCustomersBatch(rows: Array<Record<string, unknown>>): DataImportSummary {
    return this.dataExchangeRepo.importCustomersBatch(rows);
  }

  public importSuppliersBatch(rows: Array<Record<string, unknown>>): DataImportSummary {
    return this.dataExchangeRepo.importSuppliersBatch(rows);
  }

  public importExpensesBatch(
    rows: Array<Record<string, unknown>>,
    actorName = 'استيراد Excel'
  ): DataImportSummary {
    return this.dataExchangeRepo.importExpensesBatch(rows, actorName);
  }

  public restoreBackupJson(backup: Record<string, unknown>, actorName = 'صاحب المحل'): Record<string, number> {
    return this.dataExchangeRepo.restoreBackupJson(backup, actorName);
  }

  private ensureMultiActivityDemoInvoices(): void {
    const existingApparel = this.db.prepare("SELECT id FROM invoices WHERE activity_id = 'apparel' LIMIT 1").get();
    if (existingApparel) return;

    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();

    const lastRow = this.db
      .prepare('SELECT row_hash FROM invoices ORDER BY created_at DESC, id DESC LIMIT 1')
      .get() as { row_hash: string } | undefined;
    let prevHash = lastRow?.row_hash || GENESIS_HASH;

    const demoSpecs: Array<{
      id: string;
      invoiceNumber: string;
      activityId: StoreActivityId;
      createdAt: string;
      paymentMethod: PaymentMethod;
      paymentRef: string;
      productId: string;
      productName: string;
      unit: string;
      qty: number;
      cost: number;
      sale: number;
    }> = [
      {
        id: 'inv-demo-apparel-1',
        invoiceNumber: 'INV-2026-2001',
        activityId: 'apparel',
        createdAt: hoursAgo(6),
        paymentMethod: 'instapay',
        paymentRef: 'IPA-5512098',
        productId: 'prd-apparel-1',
        productName: 'تيشيرت قطن مصري بولو',
        unit: 'قطعة',
        qty: 2,
        cost: 220,
        sale: 340,
      },
      {
        id: 'inv-demo-elec-1',
        invoiceNumber: 'INV-2026-3001',
        activityId: 'electronics',
        createdAt: hoursAgo(5),
        paymentMethod: 'card',
        paymentRef: 'PMB-883412',
        productId: 'prd-electronics-1',
        productName: 'شاحن أنكر السريع 20 وات PD',
        unit: 'قطعة',
        qty: 2,
        cost: 360,
        sale: 490,
      },
      {
        id: 'inv-demo-cos-1',
        invoiceNumber: 'INV-2026-4001',
        activityId: 'cosmetics',
        createdAt: hoursAgo(4),
        paymentMethod: 'vodafone_cash',
        paymentRef: 'VFC-6619044',
        productId: 'prd-cosmetics-1',
        productName: 'غسول لاروش بوزيه للبشرة الدهنية',
        unit: 'عبوة',
        qty: 1,
        cost: 440,
        sale: 545,
      },
      {
        id: 'inv-demo-hrd-1',
        invoiceNumber: 'INV-2026-5001',
        activityId: 'hardware',
        createdAt: hoursAgo(3),
        paymentMethod: 'cash',
        paymentRef: '',
        productId: 'prd-hardware-1',
        productName: 'لمبة فينوس ليد موفرة 18 وات',
        unit: 'قطعة',
        qty: 5,
        cost: 58,
        sale: 80,
      },
    ];

    const tx = this.db.transaction(() => {
      for (const spec of demoSpecs) {
        const lineTotal = spec.sale * spec.qty;
        const totalCost = spec.cost * spec.qty;
        const totalProfit = lineTotal - totalCost;
        const rowHash = computeInvoiceChainHash({
          id: spec.id,
          invoiceNumber: spec.invoiceNumber,
          createdAt: spec.createdAt,
          grandTotal: lineTotal,
          totalCostAtSale: totalCost,
          totalProfit,
          status: 'completed',
          prevHash,
        });

        this.db
          .prepare(
            `INSERT OR IGNORE INTO invoices (id, invoice_number, activity_id, created_at, cashier_name, terminal_name, customer_id, customer_name, payment_method, payment_ref, subtotal, discount_total, grand_total, total_cost_at_sale, total_profit, paid_amount, change_amount, status, notes, prev_hash, row_hash)
             VALUES (?, ?, ?, ?, 'أحمد العشري (المالك)', 'كاشير التجربة', NULL, 'عميل تجريبي', ?, ?, ?, 0, ?, ?, ?, ?, 0, 'completed', 'فاتورة تجريبية مؤقتة', ?, ?)`
          )
          .run(
            spec.id,
            spec.invoiceNumber,
            spec.activityId,
            spec.createdAt,
            spec.paymentMethod,
            spec.paymentRef,
            lineTotal,
            lineTotal,
            totalCost,
            totalProfit,
            lineTotal,
            prevHash,
            rowHash
          );

        this.db
          .prepare(
            `INSERT OR IGNORE INTO invoice_items (id, invoice_id, product_id, product_name, activity_id, unit, quantity, unit_cost_at_sale, unit_sale_price, discount_amount, line_total, line_profit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          )
          .run(
            `${spec.id}-it-1`,
            spec.id,
            spec.productId,
            spec.productName,
            spec.activityId,
            spec.unit,
            spec.qty,
            spec.cost,
            spec.sale,
            lineTotal,
            totalProfit
          );

        prevHash = rowHash;
      }
      this.recomputeChainFromAuthorizedMutation();
    });

    tx();
  }

  private mapShiftClosureRow(r: Record<string, unknown>): ShiftClosure {
    return {
      id: String(r.id),
      closedAt: String(r.closed_at),
      periodStartAt: String(r.period_start_at),
      cashierId: String(r.cashier_id),
      cashierName: String(r.cashier_name),
      openingFloat: Number(r.opening_float),
      cashSales: Number(r.cash_sales),
      cashCollections: Number(r.cash_collections || 0),
      cashReturns: Number(r.cash_returns || 0),
      cashExpenses: Number(r.cash_expenses || 0),
      cashSupplierPayouts: Number(r.cash_supplier_payouts || 0),
      cashEquityDrawings: Number(r.cash_equity_drawings || 0),
      expectedCash: Number(r.expected_cash),
      actualCash: Number(r.actual_cash),
      variance: Number(r.variance),
      instapayTotal: Number(r.instapay_total),
      walletTotal: Number(r.wallet_total),
      cardTotal: Number(r.card_total),
      creditTotal: Number(r.credit_total),
      invoiceCount: Number(r.invoice_count),
      returnedCount: Number(r.returned_count),
      notes: String(r.notes || ''),
    };
  }

  public getShiftSummary(): ShiftSummary {
    const recentRows = this.db
      .prepare('SELECT * FROM shift_closures ORDER BY closed_at DESC LIMIT 10')
      .all() as Array<Record<string, unknown>>;
    const recentClosures = recentRows.map((r) => this.mapShiftClosureRow(r));
    const lastClosure = recentClosures[0] || null;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const periodStartAt = lastClosure ? lastClosure.closedAt : todayStart.toISOString();

    const invoices = this.getInvoices().filter((inv) => inv.createdAt >= periodStartAt);
    const activeInShift = invoices.filter(
      (inv) => inv.status === 'completed' || inv.status === 'partial_returned'
    );
    const returnedCount = invoices.filter(
      (inv) => inv.status === 'returned' || inv.status === 'partial_returned'
    ).length;

    const cashMetrics = this.getCashFlowMetricsSince(periodStartAt);

    let cashSales = 0;
    let instapayTotal = 0;
    let walletTotal = 0;
    let cardTotal = 0;
    let creditTotal = 0;

    for (const inv of invoices) {
      const includeCashOrig =
        inv.status === 'completed' ||
        inv.status === 'partial_returned' ||
        (inv.status === 'returned' && cashMetrics.returnedInvIdsWithRecords.has(inv.id));

      if (includeCashOrig) {
        for (const al of this.resolveNormalizedAllocations(inv)) {
          if (al.method === 'cash') cashSales += al.amount;
        }
      }

      if (inv.status === 'completed' || inv.status === 'partial_returned') {
        const origTotal = inv.grandTotal + Number(inv.returnedTotal || 0);
        const scale = origTotal > 0 ? inv.grandTotal / origTotal : 1;
        for (const al of this.resolveNormalizedAllocations(inv)) {
          if (al.method === 'instapay') instapayTotal += al.amount * scale;
          else if (al.method === 'vodafone_cash') walletTotal += al.amount * scale;
          else if (al.method === 'card') cardTotal += al.amount * scale;
          else if (al.method === 'credit') creditTotal += al.amount * scale;
        }
      }
    }

    cashSales = Number(cashSales.toFixed(2));
    instapayTotal = Number(instapayTotal.toFixed(2));
    walletTotal = Number(walletTotal.toFixed(2));
    cardTotal = Number(cardTotal.toFixed(2));
    creditTotal = Number(creditTotal.toFixed(2));
    const totalRevenue = Number(activeInShift.reduce((s, i) => s + i.grandTotal, 0).toFixed(2));

    return {
      periodStartAt,
      cashSales,
      cashCollections: cashMetrics.cashCollections,
      cashReturns: cashMetrics.cashReturns,
      cashExpenses: cashMetrics.cashExpenses,
      cashSupplierPayouts: cashMetrics.cashSupplierPayouts,
      cashEquityDrawings: cashMetrics.cashEquityDrawings,
      instapayTotal,
      walletTotal,
      cardTotal,
      creditTotal,
      totalRevenue,
      invoiceCount: activeInShift.length,
      returnedCount,
      lastClosure,
      recentClosures,
    };
  }

  public closeShift(input: {
    cashierId: string;
    cashierName: string;
    openingFloat: number;
    actualCash: number;
    notes?: string;
  }): ShiftClosure {
    const summary = this.getShiftSummary();
    const openingFloat = Math.max(0, Number(input.openingFloat || 0));
    const actualCash = Math.max(0, Number(input.actualCash || 0));
    const cashCollections = Number(summary.cashCollections || 0);
    const cashReturns = Number(summary.cashReturns || 0);
    const cashExpenses = Number(summary.cashExpenses || 0);
    const cashSupplierPayouts = Number(summary.cashSupplierPayouts || 0);
    const cashEquityDrawings = Number(summary.cashEquityDrawings || 0);
    const expectedCash = Number(
      (
        openingFloat +
        summary.cashSales +
        cashCollections -
        cashReturns -
        cashExpenses -
        cashSupplierPayouts -
        cashEquityDrawings
      ).toFixed(2)
    );
    const variance = Number((actualCash - expectedCash).toFixed(2));
    const id = `shf-${crypto.randomBytes(4).toString('hex')}`;
    const closedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO shift_closures (
          id, closed_at, period_start_at, cashier_id, cashier_name,
          opening_float, cash_sales, cash_collections, cash_returns, cash_expenses, cash_supplier_payouts, cash_equity_drawings,
          expected_cash, actual_cash, variance,
          instapay_total, wallet_total, card_total, credit_total,
          invoice_count, returned_count, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        closedAt,
        summary.periodStartAt,
        input.cashierId,
        input.cashierName,
        openingFloat,
        summary.cashSales,
        cashCollections,
        cashReturns,
        cashExpenses,
        cashSupplierPayouts,
        cashEquityDrawings,
        expectedCash,
        actualCash,
        variance,
        summary.instapayTotal,
        summary.walletTotal,
        summary.cardTotal,
        summary.creditTotal,
        summary.invoiceCount,
        summary.returnedCount,
        (input.notes || '').trim()
      );

    const row = this.db.prepare('SELECT * FROM shift_closures WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapShiftClosureRow(row);
  }

  private ensureDemoPurchasesAndExpenses(): void {
    const existingPur = this.db.prepare('SELECT id FROM purchase_orders LIMIT 1').get();
    const existingExp = this.db.prepare('SELECT id FROM store_expenses LIMIT 1').get();
    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();

    if (!existingPur) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO purchase_orders (
            id, purchase_number, supplier_id, supplier_name, activity_id, created_at, actor_name,
            supplier_invoice_ref, grand_total, paid_amount, remaining_debt, payment_source, treasury_id, treasury_name, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'pur-demo-1',
          'PUR-2026-1001',
          'sup-1',
          'شركة النيل لتوزيع المواد الغذائية',
          'grocery',
          hoursAgo(28),
          'أحمد العشري (المالك)',
          'SUP-INV-9081',
          4650,
          3000,
          1650,
          'cash',
          'trs-cash-main',
          'خزينة الدرج النقدي الرئيسي',
          'توريد أرز وزيت وسكر — سداد جزئي والباقي آجل'
        );

      this.db
        .prepare(
          `INSERT OR IGNORE INTO purchase_items (id, purchase_id, product_id, product_name, unit, quantity, unit_cost, new_sale_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('pi-demo-1', 'pur-demo-1', 'prd-grocery-1', 'أرز مصري الضحى 1 كجم', 'كيس', 50, 31, 38, 1550);

      this.db
        .prepare(
          `INSERT OR IGNORE INTO purchase_items (id, purchase_id, product_id, product_name, unit, quantity, unit_cost, new_sale_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('pi-demo-2', 'pur-demo-1', 'prd-grocery-2', 'زيت خليط عافية 800 مل', 'زجاجة', 50, 62, 75, 3100);
    }

    if (!existingExp) {
      const demoExpenses: Array<
        [string, string, ExpenseCategory, number, string, string, string, string, string, string]
      > = [
        [
          'exp-demo-1',
          'فاتورة كهرباء المحل والتبريد',
          'utilities',
          420,
          'cash_drawer',
          'trs-cash-main',
          'خزينة الدرج النقدي الرئيسي',
          'ELC-8841',
          'سداد نقدي من الدرج',
          hoursAgo(2),
        ],
        [
          'exp-demo-2',
          'نقل ومشال بضاعة التوريد الصباحي',
          'shipping',
          150,
          'cash_drawer',
          'trs-cash-main',
          'خزينة الدرج النقدي الرئيسي',
          'SHP-209',
          'سيارة نقل داخلية',
          hoursAgo(5),
        ],
        [
          'exp-demo-3',
          'مقدم إيجار شهر نوفمبر للمحل',
          'rent',
          4500,
          'bank_instapay',
          'trs-instapay-1',
          'حساب إنستا باي الرئيسي (CIB / QNB)',
          'IPA-44109',
          'تحويل إنستا باي للمالك',
          hoursAgo(72),
        ],
        [
          'exp-demo-4',
          'أكياس تغليف وبكر ريسيت كاشير',
          'misc',
          185,
          'cash_drawer',
          'trs-cash-main',
          'خزينة الدرج النقدي الرئيسي',
          '',
          'مستلزمات بيع وتغليف',
          hoursAgo(26),
        ],
      ];

      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO store_expenses (id, title, category, amount, payment_source, treasury_id, treasury_name, receipt_ref, actor_name, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'أحمد العشري (المالك)', ?, ?)`
      );
      for (const [id, title, cat, amount, source, trId, trName, ref, notes, createdAt] of demoExpenses) {
        stmt.run(id, title, cat, amount, source, trId, trName, ref, notes, createdAt);
      }
    }
  }

  public resetDemoData(): void {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM invoice_return_items;
        DELETE FROM invoice_returns;
        DELETE FROM store_promotions;
        DELETE FROM product_batches;
        DELETE FROM custom_report_presets;
        DELETE FROM equity_drawings;
        DELETE FROM equity_partners;
        DELETE FROM security_audit_logs;
        DELETE FROM document_templates;
        DELETE FROM invoice_payment_allocations;
        DELETE FROM treasuries;
        DELETE FROM store_expenses;
        DELETE FROM purchase_items;
        DELETE FROM purchase_orders;
        DELETE FROM shift_closures;
        DELETE FROM invoice_items;
        DELETE FROM invoices;
        DELETE FROM payment_transactions;
        DELETE FROM stock_movements;
        DELETE FROM product_price_history;
        DELETE FROM products;
        DELETE FROM customers;
        DELETE FROM suppliers;
        DELETE FROM staff_users;
        DELETE FROM store_settings;
      `);
    });
    tx();
    this.seedIfEmpty();
    this.ensureDefaultTreasuries();
    this.ensureDefaultTemplates();
    this.ensureMultiActivityDemoInvoices();
    this.ensureDemoPurchasesAndExpenses();
    this.equityRepo.ensureDefaultPartners();
    this.batchRepo.ensureDefaultBatchesAndPromotions();
  }

  public close(): void {
    this.db.close();
  }
}
