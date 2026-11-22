export type StoreActivityId =
  | 'grocery'
  | 'apparel'
  | 'electronics'
  | 'cosmetics'
  | 'hardware';

export type PaymentMethod =
  | 'cash'
  | 'instapay'
  | 'vodafone_cash'
  | 'card'
  | 'credit'
  | 'split';

export type TreasuryType = 'cash_drawer' | 'instapay' | 'wallet' | 'bank_pos';

export interface TreasuryAccount {
  id: string;
  name: string;
  type: TreasuryType;
  accountNumber: string;
  currentBalance: number;
  active: boolean;
  isDefault: boolean;
  notes?: string;
  updatedAt: string;
}

export interface InvoicePaymentAllocation {
  id: string;
  invoiceId: string;
  treasuryId: string | null;
  treasuryName: string;
  method: Exclude<PaymentMethod, 'split'>;
  amount: number;
  feeAmount: number;
  referenceCode: string;
}

export type UserRole = 'owner' | 'manager' | 'cashier';

export type PermissionKey =
  | 'pos_sell'
  | 'invoice_return'
  | 'view_profits_costs'
  | 'edit_prices_stock'
  | 'view_reports'
  | 'manage_partners'
  | 'manage_payments'
  | 'manage_purchases'
  | 'manage_expenses'
  | 'manage_settings'
  | 'manage_data_xlsx'
  | 'manage_security_rbac';

export type RolePermissionsMap = Record<UserRole, Record<PermissionKey, boolean>>;

export type InvoiceStatus = 'completed' | 'partial_returned' | 'returned';

export interface StoreActivityProfile {
  id: StoreActivityId;
  nameAr: string;
  subtitleAr: string;
  defaultUnits: string[];
  categories: string[];
  supportsAttributes: boolean;
  attributeLabelAr: string;
}

export type PrintTemplateStyle =
  | 'classic_bordered'
  | 'modern_emerald'
  | 'executive_slate'
  | 'compact_thermal';

export interface PrintTemplateSettings {
  style: PrintTemplateStyle;
  defaultPaperSize: 'a4' | 'thermal_80mm';
  accentColor: string;
  customHeaderNote: string;
  showTaxNumber: boolean;
  showBarcode: boolean;
  showSha256Hash: boolean;
  showCashierName: boolean;
  showCustomerBalance: boolean;
  showSignatureLine: boolean;
  showVatSummary: boolean;
}

export interface PrintPreviewOverrides {
  paperSize?: 'a4' | 'thermal_80mm';
  style?: PrintTemplateStyle;
  showTaxNumber?: boolean;
  showBarcode?: boolean;
  showSha256Hash?: boolean;
  showCashierName?: boolean;
  showCustomerBalance?: boolean;
  showSignatureLine?: boolean;
  showVatSummary?: boolean;
}

export interface LoyaltyConfig {
  enabled: boolean;
  earnRateEgpPerPoint: number;
  pointValueEgp: number;
  minRedeemPoints: number;
}

export type DocumentTemplateKind =
  | 'invoice_a4'
  | 'invoice_thermal'
  | 'sales_report'
  | 'inventory_report'
  | 'expenses_report'
  | 'partner_statement'
  | 'partner_statement_itemized';

export interface PartnerStatementLineItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  returnedQuantity?: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  netLineTotal?: number;
}

export interface PartnerItemizedSummaryRow {
  productId: string;
  productName: string;
  unit: string;
  totalQty: number;
  avgUnitPrice: number;
  totalAmount: number;
  invoiceCount: number;
}

export interface TemplateColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  widthPercent: number;
}

export interface DocumentTemplateArtifact {
  id: string;
  kind: DocumentTemplateKind;
  nameAr: string;
  paperSize: 'a4' | 'thermal_80mm';
  style: PrintTemplateStyle;
  accentColor: string;
  headerTitle: string;
  headerSubtitle: string;
  footerNote: string;
  showLogo: boolean;
  showTaxNumber: boolean;
  showBarcode: boolean;
  showSplitPayments: boolean;
  showSignatureLine: boolean;
  columns: TemplateColumnConfig[];
  sampleRows: Array<Record<string, string | number>>;
  previewPngDataUrl: string;
  xlsxFileName: string;
  pngFileName: string;
  updatedAt: string;
}

export interface StoreSettings {
  storeName: string;
  activityId: StoreActivityId;
  phone: string;
  address: string;
  taxNumber: string;
  receiptFooter: string;
  currency: 'EGP';
  vatPercent: number;
  allowNegativeStock: boolean;
  autoPrintAfterSale: boolean;
  requireLoginOnStart: boolean;
  printTemplate: PrintTemplateSettings;
  loyaltyConfig?: LoyaltyConfig;
  dbDriver: 'sqlite' | 'mysql';
  mysqlConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    connected: boolean;
    ssl?: boolean;
    connectionLimit?: number;
  };
}

export interface ServerRuntimeInfo {
  nodeVersion: string;
  uptimeSec: number;
  port: number;
  dbDriver: 'sqlite' | 'mysql';
  sqlitePath: string;
  sqliteSizeKb: number;
  sqliteWal: boolean;
  mysqlConfig: StoreSettings['mysqlConfig'];
  connectedTerminals: number;
  productCount: number;
  invoiceCount: number;
}

export interface PaymentGatewayConfig {
  instapayIpa: string;
  instapayEnabled: boolean;
  vodafoneCashNumber: string;
  walletEnabled: boolean;
  paymobConfigured: boolean;
  paymobIntegrationId: string;
  fawryMerchantCode: string;
  fawryConfigured: boolean;
  cardFeePercent: number;
}

export type PriceTier = 'retail' | 'half_wholesale' | 'wholesale' | 'custom';

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  attributeValue: string;
  activityId: StoreActivityId;
  currentCostPrice: number;
  currentSalePrice: number;
  halfWholesalePrice: number;
  wholesalePrice: number;
  stockQty: number;
  minStockAlert: number;
  maxStockLimit: number;
  supplierId: string | null;
  updatedAt: string;
}

export interface ProductPriceHistory {
  id: string;
  productId: string;
  productName: string;
  oldCostPrice: number;
  newCostPrice: number;
  oldSalePrice: number;
  newSalePrice: number;
  changedBy: string;
  reason: string;
  changedAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId: string;
  productName: string;
  activityId: StoreActivityId;
  unit: string;
  quantity: number;
  /** Snapshotted at the exact moment of sale — immune to future cost changes */
  unitCostAtSale: number;
  /** Snapshotted at the exact moment of sale — immune to future price changes */
  unitSalePrice: number;
  priceTier?: PriceTier;
  discountAmount: number;
  lineTotal: number;
  lineProfit: number;
  returnedQuantity?: number;
}

export interface InvoiceReturnItem {
  id: string;
  returnId: string;
  invoiceItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  refundAmount: number;
  costRecovered: number;
}

export interface InvoiceReturnRecord {
  id: string;
  invoiceId: string;
  createdAt: string;
  actorName: string;
  reason: string;
  returnTotal: number;
  cashRefunded: number;
  creditDebtReduced: number;
  storeCreditAdded: number;
  treasuryId: string | null;
  treasuryName: string;
  exchangeInvoiceId: string | null;
  exchangeInvoiceNumber: string | null;
  items: InvoiceReturnItem[];
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  activityId: StoreActivityId;
  createdAt: string;
  cashierName: string;
  terminalName: string;
  customerId: string | null;
  customerName: string;
  paymentMethod: PaymentMethod;
  paymentRef: string;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  totalCostAtSale: number;
  totalProfit: number;
  paidAmount: number;
  changeAmount: number;
  status: InvoiceStatus;
  returnedTotal?: number;
  dueDate?: string | null;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  storeCreditUsed?: number;
  promotionDiscount?: number;
  exchangeForInvoiceId?: string | null;
  notes: string;
  prevHash: string;
  rowHash: string;
  items: InvoiceItem[];
  allocations?: InvoicePaymentAllocation[];
  returns?: InvoiceReturnRecord[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  balanceDue: number;
  totalPurchases: number;
  creditLimit?: number;
  defaultPriceTier?: Exclude<PriceTier, 'custom'>;
  defaultDiscountPercent?: number;
  loyaltyPoints?: number;
  storeCreditBalance?: number;
  notes?: string;
  lastPurchaseAt: string | null;
}

export interface ProductBatch {
  id: string;
  productId: string;
  productName: string;
  batchCode: string;
  expiryDate: string | null;
  qty: number;
  costPrice: number;
  supplierId: string | null;
  purchaseId: string | null;
  createdAt: string;
}

export type PromotionRuleType = 'percent' | 'fixed' | 'bogo_qty';

export interface StorePromotion {
  id: string;
  name: string;
  active: boolean;
  ruleType: PromotionRuleType;
  value: number;
  minSubtotal: number;
  minQty: number;
  category: string;
  productId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface OwnerAnomalyAlert {
  id: string;
  severity: 'danger' | 'warning' | 'info';
  category: 'margin' | 'discount' | 'shift' | 'credit' | 'expiry' | 'stock';
  title: string;
  message: string;
  actionTab:
    | 'dashboard'
    | 'pos'
    | 'inventory'
    | 'purchases'
    | 'invoices'
    | 'expenses'
    | 'reports'
    | 'partners_payments';
  actionLabel: string;
  metricValue?: string;
}

export interface AutoReorderSuggestionItem {
  productId: string;
  productName: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
  maxStockLimit: number;
  velocityPerDay: number;
  daysRemaining: number | null;
  suggestedQty: number;
  unitCost: number;
  estimatedCost: number;
}

export interface AutoReorderSupplierGroup {
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  totalEstimatedCost: number;
  items: AutoReorderSuggestionItem[];
}

export interface PeriodComparisonDelta {
  previousRevenue: number;
  revenueDeltaPercent: number | null;
  previousProfit: number;
  profitDeltaPercent: number | null;
  previousExpenses: number;
  expensesDeltaPercent: number | null;
  previousInvoiceCount: number;
  invoiceCountDeltaPercent: number | null;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  category: string;
  balanceDue: number;
  notes?: string;
  lastSupplyAt: string | null;
}

export interface PaymentTransaction {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string;
  treasuryId?: string | null;
  treasuryName?: string;
  method: PaymentMethod;
  provider: string;
  amount: number;
  feeAmount: number;
  netAmount: number;
  referenceCode: string;
  status: 'settled' | 'pending' | 'refunded';
  createdAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  deltaQty: number;
  afterQty: number;
  reason: string;
  terminalName: string;
  actorName: string;
  createdAt: string;
}

export interface StaffUser {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  tokenVersion?: number;
  customPermissions?: Partial<Record<PermissionKey, boolean>>;
  effectivePermissions?: Record<PermissionKey, boolean>;
}

export interface LicensePayload {
  licenseId: string;
  storeName: string;
  tier: 'trial' | 'pro' | 'enterprise';
  machineFingerprint: string;
  maxTerminals: number;
  issuedAt: string;
  expiresAt: string;
  features: string[];
}

export interface LicenseStatus {
  valid: boolean;
  reason: string;
  machineFingerprint: string;
  payload: LicensePayload | null;
  signatureVerified: boolean;
  machineBound: boolean;
  expired: boolean;
  tamperCheckPassed: boolean;
  daysRemaining: number;
  rawKeyPreview: string;
}

export interface IntegrityReport {
  checkedAt: string;
  totalInvoicesChecked: number;
  validInvoices: number;
  brokenInvoiceIds: string[];
  licenseSignatureValid: boolean;
  chainIntact: boolean;
}

export type ReportSubTab =
  | 'executive_overview'
  | 'profit_loss'
  | 'what_if_analysis'
  | 'equity_partners'
  | 'sales_profit'
  | 'product_profit'
  | 'slow_moving'
  | 'inventory_health'
  | 'custom_report'
  | 'scheduled_reports'
  | 'financial_summary';

export interface WhatIfInputs {
  targetGrossMarginPct: number;
  salesVolumeDeltaPct: number;
  opExDeltaPct: number;
  fixedOpExDeltaEgp: number;
}

export interface WhatIfPartnerImpactRow {
  partnerId: string;
  partnerName: string;
  roleTitle: string;
  sharePercent: number;
  baselineShare: number;
  simulatedShare: number;
  deltaShare: number;
}

export interface WhatIfSimulationSummary {
  inputs: WhatIfInputs;
  baseline: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    cardFees: number;
    operatingExpenses: number;
    netOperatingProfit: number;
    netMarginPct: number;
    breakEvenRevenue: number | null;
  };
  simulated: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    cardFees: number;
    operatingExpenses: number;
    netOperatingProfit: number;
    netMarginPct: number;
    breakEvenRevenue: number | null;
  };
  deltas: {
    revenueDelta: number;
    grossProfitDelta: number;
    operatingExpensesDelta: number;
    netProfitDelta: number;
    netProfitDeltaPct: number | null;
    margin1PctImpactEgp: number;
    breakEvenMarginPct: number | null;
  };
  partnerImpacts: WhatIfPartnerImpactRow[];
}

export interface EquityPartner {
  id: string;
  name: string;
  phone: string;
  roleTitle: string;
  capitalContribution: number;
  profitSharePercent: number;
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface EquityDrawing {
  id: string;
  partnerId: string;
  partnerName: string;
  amount: number;
  treasuryId: string | null;
  treasuryName: string;
  type: 'draw' | 'settlement' | 'capital_add';
  notes: string;
  actorName: string;
  createdAt: string;
}

export interface EquityPartnerDistributionRow {
  partner: EquityPartner;
  periodProfitShare: number;
  periodDrawings: number;
  allTimeProfitShareEstimate: number;
  allTimeDrawings: number;
  netPayableBalance: number;
}

export interface ProfitLossReport {
  grossSalesBeforeReturns: number;
  returnsTotal: number;
  discountsTotal: number;
  netSalesRevenue: number;
  historicalCogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  cardFeesTotal: number;
  operatingExpensesTotal: number;
  ownerDrawingsInExpenses: number;
  netOperatingProfit: number;
  netOperatingMarginPercent: number;
  expensesByCategory: Array<{ category: ExpenseCategory; total: number; count: number; percent: number }>;
  purchasesTotalInPeriod: number;
  cashCollectedInPeriod: number;
}

export interface SlowMovingProductRow {
  productId: string;
  productName: string;
  category: string;
  activityId: StoreActivityId;
  unit: string;
  stockQty: number;
  stockCostValue: number;
  stockRetailValue: number;
  qtySoldLast90d: number;
  revenueLast90d: number;
  lastSoldAt: string | null;
  daysSinceLastSale: number | null;
  turnoverRate: number;
  abcClass: 'A' | 'B' | 'C';
  healthTag: 'fast' | 'normal' | 'slow' | 'dead';
}

export type CustomReportDataSource =
  | 'sales_invoices'
  | 'product_profits'
  | 'inventory_stock'
  | 'expenses'
  | 'customers_ar'
  | 'suppliers_ap'
  | 'purchases'
  | 'equity_partners';

export interface CustomReportFilterRule {
  field: string;
  operator: 'contains' | 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}

export interface CustomReportConfig {
  id?: string;
  name: string;
  source: CustomReportDataSource;
  columns: string[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  groupBy?: string;
  dateFrom?: string;
  dateTo?: string;
  activityFilter?: StoreActivityId | 'all';
  filters?: CustomReportFilterRule[];
}

export interface SavedCustomReportPreset {
  id: string;
  name: string;
  config: CustomReportConfig;
  createdBy: string;
  updatedAt: string;
}

export interface CustomReportTabularResult {
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  totalsRow?: Array<string | number>;
}

export interface ReportsPayload {
  period: 'daily' | 'monthly' | 'yearly';
  activityFilter: StoreActivityId | 'all';
  fromDate: string;
  toDate: string;
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    marginPercent: number;
    invoiceCount: number;
    returnedCount: number;
  };
  periodSeries: Array<{
    bucket: string;
    label: string;
    revenue: number;
    cost: number;
    profit: number;
    invoiceCount: number;
  }>;
  productProfitRows: Array<{
    productId: string;
    productName: string;
    activityId: StoreActivityId;
    qtySold: number;
    revenue: number;
    historicalCost: number;
    historicalProfit: number;
    marginPercent: number;
    priceBatchCount: number;
    latestSalePrice: number;
    latestCostPrice: number;
  }>;
  inventoryReport: {
    counts: {
      available: number;
      low: number;
      overstock: number;
      out: number;
    };
    rows: Array<{
      product: Product;
      status: 'available' | 'low' | 'overstock' | 'out';
      stockValueAtCost: number;
      stockValueAtSale: number;
    }>;
  };
  profitLoss?: ProfitLossReport;
  periodComparison?: PeriodComparisonDelta;
  slowMovingReport?: {
    deadStockCount: number;
    slowStockCount: number;
    tiedUpCapital: number;
    rows: SlowMovingProductRow[];
  };
  equityDistribution?: {
    totalSharePercentConfigured: number;
    netDistributableProfit: number;
    rows: EquityPartnerDistributionRow[];
    drawingsInPeriod: EquityDrawing[];
  };
  peakTimeAnalytics?: PeakTimeAnalytics;
  executiveSummary?: {
    grossSalesBeforeReturns: number;
    returnsTotal: number;
    avgInvoiceValue: number;
    totalDiscountGiven: number;
    operatingExpensesTotal: number;
    netIncomeAfterExpenses: number;
    netMarginPercent: number;
    expensesByCategory: Array<{ category: ExpenseCategory; total: number; count: number }>;
    byPaymentMethod: Array<{ method: PaymentMethod; total: number; count: number; percent: number }>;
    byActivity: Array<{
      activityId: StoreActivityId;
      revenue: number;
      cost: number;
      profit: number;
      invoiceCount: number;
      percent: number;
    }>;
    byCashier: Array<{
      cashierName: string;
      revenue: number;
      profit: number;
      invoiceCount: number;
      avgBasket: number;
    }>;
    topCustomers: Array<{
      customerId: string;
      customerName: string;
      totalSpent: number;
      invoiceCount: number;
    }>;
    businessHealth: {
      customerReceivables: number;
      supplierPayables: number;
      treasuriesTotal: number;
      inventoryCostValue: number;
      inventoryRetailValue: number;
      lowStockCount: number;
      outOfStockCount: number;
      overLimitCustomersCount: number;
      suppliersWithDebtCount: number;
    };
  };
}

export interface PeakHourBucket {
  hour: number;
  label: string;
  invoiceCount: number;
  revenue: number;
}

export interface PeakDayBucket {
  dayIndex: number;
  dayNameAr: string;
  invoiceCount: number;
  revenue: number;
}

export interface PeakTimeAnalytics {
  byHour: PeakHourBucket[];
  byDayOfWeek: PeakDayBucket[];
  peakHourLabel: string;
  peakDayLabel: string;
}

export interface DashboardSummary {
  todayRevenue: number;
  todayProfit: number;
  todayExpenses: number;
  todayNetAfterExpenses: number;
  monthExpenses: number;
  todayInvoiceCount: number;
  cashDrawerBalance: number;
  electronicSalesToday: number;
  creditSalesToday: number;
  inventoryCapitalCost: number;
  inventoryRetailValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringBatchesCount?: number;
  overdueCreditCount?: number;
  periodComparison?: PeriodComparisonDelta;
  ownerAlerts?: OwnerAnomalyAlert[];
  topProducts: Array<{
    productId: string;
    name: string;
    qtySold: number;
    revenue: number;
    profit: number;
  }>;
  paymentBreakdown: Array<{
    method: PaymentMethod;
    total: number;
    count: number;
  }>;
  dailySeries: Array<{
    date: string;
    label: string;
    revenue: number;
    profit: number;
  }>;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  returnedQuantity?: number;
  unitCost: number;
  newSalePrice?: number;
  batchCode?: string;
  expiryDate?: string | null;
  lineTotal: number;
}

export interface PurchaseReturnItem {
  id: string;
  returnId: string;
  purchaseItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  refundAmount: number;
}

export interface PurchaseReturnRecord {
  id: string;
  purchaseId: string;
  createdAt: string;
  actorName: string;
  reason: string;
  returnTotal: number;
  debtReduced: number;
  cashRefunded: number;
  treasuryId: string | null;
  treasuryName: string;
  items: PurchaseReturnItem[];
}

export interface PurchaseOrder {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  activityId: StoreActivityId;
  createdAt: string;
  actorName: string;
  supplierInvoiceRef: string;
  grandTotal: number;
  returnedTotal?: number;
  paidAmount: number;
  remainingDebt: number;
  paymentSource: 'cash' | 'bank_transfer' | 'credit';
  treasuryId?: string | null;
  treasuryName?: string;
  notes: string;
  items: PurchaseOrderItem[];
  returns?: PurchaseReturnRecord[];
}

export type RecurringExpenseFrequency = 'daily' | 'weekly' | 'monthly';

export interface RecurringExpense {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentSource: 'cash_drawer' | 'bank_instapay' | 'wallet';
  treasuryId: string | null;
  treasuryName: string;
  frequency: RecurringExpenseFrequency;
  nextDueDate: string;
  lastPaidAt: string | null;
  active: boolean;
  notes: string;
  createdAt: string;
}

export interface OfflineQueuedInvoice {
  localId: string;
  queuedAt: string;
  customerName: string;
  estimatedTotal: number;
  payload: Record<string, unknown>;
  lastError?: string;
}

export type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'salaries'
  | 'shipping'
  | 'maintenance'
  | 'taxes'
  | 'owner_draw'
  | 'misc';

export interface StoreExpense {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentSource: 'cash_drawer' | 'bank_instapay' | 'wallet';
  treasuryId?: string | null;
  treasuryName?: string;
  receiptRef?: string;
  actorName: string;
  notes: string;
  createdAt: string;
}

export interface SecurityAuditLog {
  id: string;
  timestamp: string;
  actorUserId: string;
  actorName: string;
  action: string;
  category: 'auth' | 'security' | 'settings' | 'data' | 'rbac';
  target: string;
  details: string;
}

export interface DataImportSummary {
  entity: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface BootstrapSnapshot {
  settings: StoreSettings;
  paymentConfig: PaymentGatewayConfig;
  treasuries: TreasuryAccount[];
  templates: DocumentTemplateArtifact[];
  activities: StoreActivityProfile[];
  products: Product[];
  allProducts: Product[];
  priceHistory: ProductPriceHistory[];
  invoices: Invoice[];
  purchases: PurchaseOrder[];
  expenses: StoreExpense[];
  customers: Customer[];
  suppliers: Supplier[];
  transactions: PaymentTransaction[];
  movements: StockMovement[];
  staff: StaffUser[];
  rolePermissions: RolePermissionsMap;
  currentUser: StaffUser;
  license: LicenseStatus;
  dashboard: DashboardSummary;
  auditLogs: SecurityAuditLog[];
  equityPartners?: EquityPartner[];
  equityDrawings?: EquityDrawing[];
  customReportPresets?: SavedCustomReportPreset[];
  scheduledReports?: ScheduledReportConfig[];
  reportDigests?: ScheduledReportDigest[];
  quotations?: SalesQuotation[];
  emailTransportConfigured?: boolean;
  batches?: ProductBatch[];
  promotions?: StorePromotion[];
  recurringExpenses?: RecurringExpense[];
  ownerAlerts?: OwnerAnomalyAlert[];
  reorderSuggestions?: AutoReorderSupplierGroup[];
  connectedTerminals: number;
  locked?: boolean;
  authenticated?: boolean;
}

export type RealtimeEvent =
  | {
      type: 'connected';
      connectedTerminals: number;
      serverTime: string;
    }
  | {
      type: 'presence:updated';
      connectedTerminals: number;
    }
  | {
      type: 'stock:updated';
      product: Product;
      movement: StockMovement;
    }
  | {
      type: 'invoice:created';
      invoice: Invoice;
      dashboard: DashboardSummary;
    }
  | {
      type: 'invoice:returned';
      invoice: Invoice;
      dashboard: DashboardSummary;
    }
  | {
      type: 'price:changed';
      product: Product;
      historyEntry: ProductPriceHistory;
    }
  | {
      type: 'digest:created';
      digest: ScheduledReportDigest;
    }
  | {
      type: 'state:refresh';
      reason: string;
    };

export type ScheduledReportFrequency = 'daily' | 'weekly';
export type ScheduledReportChannel = 'in_app' | 'email' | 'both';
export type ScheduledReportEmailStatus =
  | 'sent'
  | 'failed'
  | 'skipped_not_configured'
  | 'not_requested';

export interface ScheduledReportConfig {
  id: string;
  name: string;
  active: boolean;
  frequency: ScheduledReportFrequency;
  dayOfWeek: number; // 0 (Sunday) .. 6 (Saturday)
  sendTime: string; // HH:mm
  channel: ScheduledReportChannel;
  recipientEmails: string[];
  activityFilter: StoreActivityId | 'all';
  includeProfits: boolean;
  includeAlerts: boolean;
  lastRunAt: string | null;
  lastRunPeriodKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledReportDigestSummary {
  profitsIncluded: boolean;
  revenue: number;
  grossProfit: number;
  grossMarginPercent: number;
  operatingExpenses: number;
  cardFees: number;
  netOperatingProfit: number;
  netMarginPercent: number;
  invoiceCount: number;
  returnedCount: number;
  avgInvoiceValue: number;
  revenueDeltaPercent: number | null;
  treasuriesTotal: number;
  customerReceivables: number;
  supplierPayables: number;
  lowStockCount: number;
  outOfStockCount: number;
  alerts: OwnerAnomalyAlert[];
}

export interface ScheduledReportDigest {
  id: string;
  scheduleId: string;
  scheduleName: string;
  frequency: ScheduledReportFrequency;
  periodKey: string;
  fromDate: string;
  toDate: string;
  title: string;
  summary: ScheduledReportDigestSummary;
  channel: ScheduledReportChannel;
  inAppDelivered: boolean;
  emailStatus: ScheduledReportEmailStatus;
  emailError: string;
  recipientEmails: string[];
  readByUserIds: string[];
  isManualRun: boolean;
  createdAt: string;
}

export interface StoreNotification {
  id: string;
  severity: 'low_stock' | 'out_of_stock';
  productId: string;
  productName: string;
  currentQty: number;
  minStockAlert: number;
  unit: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface ShiftClosure {
  id: string;
  closedAt: string;
  periodStartAt: string;
  cashierId: string;
  cashierName: string;
  openingFloat: number;
  cashSales: number;
  cashCollections?: number;
  cashReturns?: number;
  cashExpenses?: number;
  cashSupplierPayouts?: number;
  cashEquityDrawings?: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  instapayTotal: number;
  walletTotal: number;
  cardTotal: number;
  creditTotal: number;
  invoiceCount: number;
  returnedCount: number;
  notes: string;
}

export interface ShiftSummary {
  periodStartAt: string;
  cashSales: number;
  cashCollections?: number;
  cashReturns?: number;
  cashExpenses?: number;
  cashSupplierPayouts?: number;
  cashEquityDrawings?: number;
  instapayTotal: number;
  walletTotal: number;
  cardTotal: number;
  creditTotal: number;
  totalRevenue: number;
  invoiceCount: number;
  returnedCount: number;
  lastClosure: ShiftClosure | null;
  recentClosures: ShiftClosure[];
}

export type QuotationStatus = 'active' | 'converted' | 'expired' | 'cancelled';

export interface QuotationItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  priceTier: PriceTier;
  quantity: number;
  unitSalePrice: number;
  discountAmount: number;
  lineTotal: number;
}

export interface SalesQuotation {
  id: string;
  quotationNumber: string;
  activityId: StoreActivityId;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  status: QuotationStatus;
  items: QuotationItem[];
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  validUntil: string;
  notes: string;
  createdBy: string;
  convertedInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}


