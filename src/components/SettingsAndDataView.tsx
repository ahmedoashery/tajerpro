import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  Edit3,
  FileJson,
  FileSpreadsheet,
  Image as ImageIcon,
  KeyRound,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sliders,
  Store,
  Trash2,
  Upload,
  Vault,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Customer,
  DataImportSummary,
  DocumentTemplateArtifact,
  LicenseStatus,
  PaymentGatewayConfig,
  PrintTemplateStyle,
  Product,
  ServerRuntimeInfo,
  StaffUser,
  StoreActivityId,
  StoreActivityProfile,
  StoreExpense,
  StoreSettings,
  Supplier,
  TreasuryAccount,
  TreasuryType,
} from '../shared/types';
import {
  downloadDataUrl,
  exportTemplateAsXlsx,
  exportWorkbookXlsx,
  parseTemplateFromXlsxFile,
  parseXlsxFile,
  renderElementToPngDataUrl,
} from '../utils/exportUtils';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SOURCE_LABELS,
  formatDateTimeAr,
  formatEGP,
  formatNum,
  TREASURY_TYPE_LABELS,
} from '../utils/formatters';
import { TemplateSheetPreview } from './PrintDocuments';
import type { ServerConfigTab } from './ServerConfigModal';
import { SearchableSelect } from './ui/SearchableSelect';

type SettingsTabId =
  | 'store_activity'
  | 'pos_policies'
  | 'treasuries'
  | 'templates'
  | 'payments'
  | 'data_xlsx'
  | 'server_license';

type ImportEntity = 'products' | 'customers' | 'suppliers' | 'expenses';

interface SettingsAndDataViewProps {
  settings: StoreSettings;
  activities: StoreActivityProfile[];
  activeActivity: StoreActivityProfile;
  treasuries: TreasuryAccount[];
  templates: DocumentTemplateArtifact[];
  paymentConfig: PaymentGatewayConfig;
  license: LicenseStatus;
  serverUrl: string;
  products: Product[];
  allProducts: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  expenses: StoreExpense[];
  currentUser: StaffUser;
  canManageSettings: boolean;
  canManagePayments: boolean;
  canManageDataXlsx: boolean;
  canViewProfits: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onMutated: (msg: string) => void;
  onOpenServerConfig: (tab?: ServerConfigTab) => void;
  requestedSubTab?: { tab: SettingsTabId; seq: number } | null;
}

const PRINT_STYLES: Array<{ value: PrintTemplateStyle; label: string }> = [
  { value: 'modern_emerald', label: 'مودرن زمردي (افتراضي)' },
  { value: 'classic_bordered', label: 'كلاسيكي مؤطر رسمي' },
  { value: 'executive_slate', label: 'تنفيذي داكن فخم' },
  { value: 'compact_thermal', label: 'حراري مضغوط للكاشير' },
];

const TREASURY_TYPES: TreasuryType[] = ['cash_drawer', 'instapay', 'wallet', 'bank_pos'];

export function SettingsAndDataView({
  settings,
  activities,
  activeActivity,
  treasuries,
  templates,
  paymentConfig,
  license,
  serverUrl,
  products,
  allProducts,
  customers,
  suppliers,
  expenses,
  canManageSettings,
  canManagePayments,
  canManageDataXlsx,
  canViewProfits,
  apiFetch,
  onMutated,
  onOpenServerConfig,
  requestedSubTab,
}: SettingsAndDataViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('store_activity');

  useEffect(() => {
    if (requestedSubTab?.seq) {
      setActiveTab(requestedSubTab.tab);
    }
  }, [requestedSubTab]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Tab 1 & Tab 2: Store & Policies Draft
  const [storeDraft, setStoreDraft] = useState({
    storeName: settings.storeName,
    activityId: settings.activityId as StoreActivityId,
    phone: settings.phone,
    address: settings.address,
    taxNumber: settings.taxNumber,
    vatPercent: String(settings.vatPercent),
    receiptFooter: settings.receiptFooter,
    allowNegativeStock: settings.allowNegativeStock,
    autoPrintAfterSale: settings.autoPrintAfterSale,
    requireLoginOnStart: settings.requireLoginOnStart,
    printTemplate: { ...settings.printTemplate },
    loyaltyConfig: {
      enabled: settings.loyaltyConfig?.enabled ?? true,
      earnRateEgpPerPoint: settings.loyaltyConfig?.earnRateEgpPerPoint ?? 50,
      pointValueEgp: settings.loyaltyConfig?.pointValueEgp ?? 1,
      minRedeemPoints: settings.loyaltyConfig?.minRedeemPoints ?? 10,
    },
  });

  useEffect(() => {
    setStoreDraft({
      storeName: settings.storeName,
      activityId: settings.activityId,
      phone: settings.phone,
      address: settings.address,
      taxNumber: settings.taxNumber,
      vatPercent: String(settings.vatPercent),
      receiptFooter: settings.receiptFooter,
      allowNegativeStock: settings.allowNegativeStock,
      autoPrintAfterSale: settings.autoPrintAfterSale,
      requireLoginOnStart: settings.requireLoginOnStart,
      printTemplate: { ...settings.printTemplate },
      loyaltyConfig: {
        enabled: settings.loyaltyConfig?.enabled ?? true,
        earnRateEgpPerPoint: settings.loyaltyConfig?.earnRateEgpPerPoint ?? 50,
        pointValueEgp: settings.loyaltyConfig?.pointValueEgp ?? 1,
        minRedeemPoints: settings.loyaltyConfig?.minRedeemPoints ?? 10,
      },
    });
  }, [settings]);

  // Tab 3: Treasuries State
  const [showTreasuryModal, setShowTreasuryModal] = useState(false);
  const [editingTreasury, setEditingTreasury] = useState<TreasuryAccount | null>(null);
  const [treasuryForm, setTreasuryForm] = useState({
    name: '',
    type: 'cash_drawer' as TreasuryType,
    accountNumber: '',
    currentBalance: '0',
    isDefault: false,
    active: true,
    notes: '',
  });
  const [confirmDeleteTreasuryId, setConfirmDeleteTreasuryId] = useState<string | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromTreasuryId: '',
    toTreasuryId: '',
    amount: '',
    notes: '',
  });

  // Tab 4: Paired XLSX + PNG Template Studio
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [templateDraft, setTemplateDraft] = useState<DocumentTemplateArtifact | null>(
    templates[0] ? structuredClone(templates[0]) : null
  );
  const [templateViewMode, setTemplateViewMode] = useState<'live' | 'png'>('live');
  const [templateBusy, setTemplateBusy] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const templateUploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!templates.length) return;
    const match = templates.find((t) => t.id === selectedTemplateId) || templates[0];
    setSelectedTemplateId(match.id);
    setTemplateDraft(structuredClone(match));
  }, [templates, selectedTemplateId]);

  // Tab 5: Payment Gateway Draft
  const [payDraft, setPayDraft] = useState<PaymentGatewayConfig>({ ...paymentConfig });
  useEffect(() => {
    setPayDraft({ ...paymentConfig });
  }, [paymentConfig]);

  // Tab 6: XLSX Data Hub + JSON Backup/Restore
  const [importEntity, setImportEntity] = useState<ImportEntity>('products');
  const [parsedSheets, setParsedSheets] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [parsedSheetNames, setParsedSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [importSummary, setImportSummary] = useState<DataImportSummary | null>(null);
  const [importingXlsx, setImportingXlsx] = useState(false);
  const [confirmRestorePayload, setConfirmRestorePayload] = useState<{
    fileName: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const [restoringJson, setRestoringJson] = useState(false);

  // Tab 7: Runtime Server Info
  const [runtimeInfo, setRuntimeInfo] = useState<ServerRuntimeInfo | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

  const loadRuntime = useCallback(async () => {
    setLoadingRuntime(true);
    try {
      const info = await apiFetch<ServerRuntimeInfo>('/api/server/info');
      setRuntimeInfo(info);
    } catch {
      // ignore non-critical error
    } finally {
      setLoadingRuntime(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (activeTab === 'server_license') {
      loadRuntime();
    }
  }, [activeTab, loadRuntime]);

  const totalTreasuriesLiquidity = useMemo(
    () => treasuries.filter((t) => t.active).reduce((s, t) => s + t.currentBalance, 0),
    [treasuries]
  );

  // Handlers: Store & Policies Save
  const handleSaveStoreSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canManageSettings) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          storeName: storeDraft.storeName.trim(),
          activityId: storeDraft.activityId,
          phone: storeDraft.phone.trim(),
          address: storeDraft.address.trim(),
          taxNumber: storeDraft.taxNumber.trim(),
          vatPercent: Number(storeDraft.vatPercent) || 0,
          receiptFooter: storeDraft.receiptFooter.trim(),
          allowNegativeStock: storeDraft.allowNegativeStock,
          autoPrintAfterSale: storeDraft.autoPrintAfterSale,
          requireLoginOnStart: storeDraft.requireLoginOnStart,
          printTemplate: storeDraft.printTemplate,
          loyaltyConfig: {
            enabled: Boolean(storeDraft.loyaltyConfig.enabled),
            earnRateEgpPerPoint: Math.max(1, Number(storeDraft.loyaltyConfig.earnRateEgpPerPoint || 50)),
            pointValueEgp: Math.max(0.01, Number(storeDraft.loyaltyConfig.pointValueEgp || 1)),
            minRedeemPoints: Math.max(1, Number(storeDraft.loyaltyConfig.minRedeemPoints || 10)),
          },
        }),
      });
      onMutated('تم حفظ إعدادات المنشأة والسياسات العامة بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  // Handlers: Treasuries
  const openCreateTreasury = () => {
    setEditingTreasury(null);
    setTreasuryForm({
      name: '',
      type: 'cash_drawer',
      accountNumber: '',
      currentBalance: '0',
      isDefault: false,
      active: true,
      notes: '',
    });
    setErrMsg(null);
    setShowTreasuryModal(true);
  };

  const openEditTreasury = (t: TreasuryAccount) => {
    setEditingTreasury(t);
    setTreasuryForm({
      name: t.name,
      type: t.type,
      accountNumber: t.accountNumber,
      currentBalance: String(t.currentBalance),
      isDefault: t.isDefault,
      active: t.active,
      notes: t.notes || '',
    });
    setErrMsg(null);
    setShowTreasuryModal(true);
  };

  const handleSaveTreasury = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePayments) return;
    setSaving(true);
    setErrMsg(null);
    try {
      const payload = {
        name: treasuryForm.name.trim(),
        type: treasuryForm.type,
        accountNumber: treasuryForm.accountNumber.trim(),
        currentBalance: Number(treasuryForm.currentBalance) || 0,
        isDefault: treasuryForm.isDefault,
        active: treasuryForm.active,
        notes: treasuryForm.notes.trim(),
      };
      if (editingTreasury) {
        await apiFetch(`/api/treasuries/${editingTreasury.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onMutated(`تم تحديث بيانات الخزينة "${payload.name}"`);
      } else {
        await apiFetch('/api/treasuries', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onMutated(`تمت إضافة الخزينة الجديدة "${payload.name}"`);
      }
      setShowTreasuryModal(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ بيانات الخزينة');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTreasury = async (id: string) => {
    if (!canManagePayments) return;
    setErrMsg(null);
    try {
      await apiFetch(`/api/treasuries/${id}`, { method: 'DELETE' });
      setConfirmDeleteTreasuryId(null);
      onMutated('تم حذف الخزينة من النظام');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف الخزينة');
      setConfirmDeleteTreasuryId(null);
    }
  };

  const openTransferModal = () => {
    const actives = treasuries.filter((t) => t.active);
    setTransferForm({
      fromTreasuryId: actives[0]?.id || '',
      toTreasuryId: actives[1]?.id || actives[0]?.id || '',
      amount: '',
      notes: '',
    });
    setErrMsg(null);
    setShowTransferModal(true);
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePayments) return;
    const amt = Number(transferForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrMsg('يرجى إدخال مبلغ تحويل صحيح أكبر من صفر.');
      return;
    }
    if (!transferForm.fromTreasuryId || !transferForm.toTreasuryId || transferForm.fromTreasuryId === transferForm.toTreasuryId) {
      setErrMsg('يرجى اختيار خزينتين مختلفتين للتحويل بينهما.');
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/treasuries/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromTreasuryId: transferForm.fromTreasuryId,
          toTreasuryId: transferForm.toTreasuryId,
          amount: amt,
          notes: transferForm.notes.trim(),
        }),
      });
      setShowTransferModal(false);
      onMutated(`تم تحويل ${formatEGP(amt)} بين الخزائن وتحديث الأرصدة بنجاح`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تنفيذ التحويل بين الخزائن');
    } finally {
      setSaving(false);
    }
  };

  // Handlers: Paired XLSX + PNG Template Studio
  const captureAndSaveTemplate = async (draftToSave: DocumentTemplateArtifact, reasonMsg: string) => {
    if (!canManageSettings) return;
    setTemplateBusy(true);
    setErrMsg(null);
    try {
      setTemplateDraft(draftToSave);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      let nextPngUrl = draftToSave.previewPngDataUrl;
      if (captureRef.current) {
        nextPngUrl = await renderElementToPngDataUrl(captureRef.current);
      }
      const payload: DocumentTemplateArtifact = {
        ...draftToSave,
        previewPngDataUrl: nextPngUrl,
      };
      await apiFetch(`/api/templates/${draftToSave.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setTemplateDraft(payload);
      setTemplateViewMode('png');
      onMutated(reasonMsg);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل تحديث نموذج الطباعة وصورة المعاينة');
    } finally {
      setTemplateBusy(false);
    }
  };

  const handleUploadTemplateXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !templateDraft || !canManageSettings) return;
    setTemplateBusy(true);
    setErrMsg(null);
    try {
      const updatedFromXlsx = await parseTemplateFromXlsxFile(file, templateDraft);
      await captureAndSaveTemplate(
        updatedFromXlsx,
        `تم استيراد ملف Excel (${file.name}) وتحديث صورة المعاينة (${updatedFromXlsx.pngFileName})`
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر قراءة ملف Excel الخاص بالنموذج');
      setTemplateBusy(false);
    }
  };

  // Handlers: Payment Config
  const handleSavePaymentConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePayments) return;
    setSaving(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/payments/config', {
        method: 'POST',
        body: JSON.stringify({
          ...payDraft,
          cardFeePercent: Number(payDraft.cardFeePercent) || 0,
        }),
      });
      onMutated('تم حفظ إعدادات بوابات الدفع الإلكتروني بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الدفع');
    } finally {
      setSaving(false);
    }
  };

  // Handlers: Full System XLSX Export / Import & JSON Backup
  const handleExportAllSystemXlsx = () => {
    exportWorkbookXlsx(`tajirpro-all-data-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: 'البضاعة والمخزون',
        headers: [
          'id',
          'الباركود',
          'الكود',
          'الاسم',
          'القسم',
          'الوحدة',
          'المقاس / الصفة',
          ...(canViewProfits ? ['سعر التكلفة'] : []),
          'سعر البيع',
          'الكمية',
          'حد الطلب',
          'الحد الأقصى',
          'النشاط',
        ],
        rows: allProducts.map((p) => [
          p.id,
          p.barcode,
          p.sku,
          p.name,
          p.category,
          p.unit,
          p.attributeValue,
          ...(canViewProfits ? [p.currentCostPrice] : []),
          p.currentSalePrice,
          p.stockQty,
          p.minStockAlert,
          p.maxStockLimit,
          p.activityId,
        ]),
      },
      {
        name: 'العملاء',
        headers: ['الاسم', 'رقم الهاتف', 'المديونية الحالية', 'إجمالي المشتريات', 'الحد الائتماني', 'ملاحظات'],
        rows: customers.map((c) => [
          c.name,
          c.phone,
          c.balanceDue,
          c.totalPurchases,
          c.creditLimit || 0,
          c.notes || '',
        ]),
      },
      {
        name: 'الموردين',
        headers: ['الاسم', 'رقم الهاتف', 'النشاط / التخصص', 'المستحقات الآجلة', 'ملاحظات'],
        rows: suppliers.map((s) => [s.name, s.phone, s.category, s.balanceDue, s.notes || '']),
      },
      {
        name: 'المصروفات',
        headers: ['البيان', 'الفئة', 'المبلغ', 'جهة الصرف', 'الموظف', 'ملاحظات', 'التاريخ'],
        rows: expenses.map((ex) => [
          ex.title,
          EXPENSE_CATEGORY_LABELS[ex.category] || ex.category,
          ex.amount,
          ex.treasuryName || EXPENSE_SOURCE_LABELS[ex.paymentSource],
          ex.actorName,
          ex.notes,
          formatDateTimeAr(ex.createdAt),
        ]),
      },
      {
        name: 'الخزائن المسجلة',
        headers: ['اسم الخزينة', 'النوع', 'رقم الحساب / المحفظة', 'الرصيد الحالي', 'افتراضية', 'نشطة'],
        rows: treasuries.map((t) => [
          t.name,
          TREASURY_TYPE_LABELS[t.type],
          t.accountNumber,
          t.currentBalance,
          t.isDefault ? 'نعم' : 'لا',
          t.active ? 'نعم' : 'لا',
        ]),
      },
    ]);
    onMutated('تم تصدير قاعدة بيانات النظام بالكامل في ملف Excel واحد متعدد الأوراق');
  };

  const handleDownloadEntityXlsx = (entity: ImportEntity, templateOnly: boolean) => {
    if (entity === 'products') {
      exportWorkbookXlsx(templateOnly ? 'template-products-import.xlsx' : 'export-products.xlsx', [
        {
          name: 'البضاعة',
          headers: [
            'الباركود',
            'الكود',
            'الاسم',
            'القسم',
            'الوحدة',
            'المقاس / الصفة',
            'سعر التكلفة',
            'سعر البيع',
            'الكمية',
            'حد الطلب',
            'الحد الأقصى',
            'النشاط',
          ],
          rows: templateOnly
            ? [
                [
                  '622100009901',
                  'NEW-01',
                  'صنف تجريبي جديد',
                  activeActivity.categories[0] || 'عام',
                  activeActivity.defaultUnits[0] || 'قطعة',
                  '',
                  100,
                  135,
                  25,
                  5,
                  100,
                  settings.activityId,
                ],
              ]
            : products.map((p) => [
                p.barcode,
                p.sku,
                p.name,
                p.category,
                p.unit,
                p.attributeValue,
                canViewProfits ? p.currentCostPrice : 0,
                p.currentSalePrice,
                p.stockQty,
                p.minStockAlert,
                p.maxStockLimit,
                p.activityId,
              ]),
        },
      ]);
    } else if (entity === 'customers') {
      exportWorkbookXlsx(templateOnly ? 'template-customers-import.xlsx' : 'export-customers.xlsx', [
        {
          name: 'العملاء',
          headers: ['الاسم', 'رقم الهاتف', 'الحد الائتماني', 'ملاحظات'],
          rows: templateOnly
            ? [['شركة النور للتجارة', '01099887766', 10000, 'عميل جملة']]
            : customers.map((c) => [c.name, c.phone, c.creditLimit || 0, c.notes || '']),
        },
      ]);
    } else if (entity === 'suppliers') {
      exportWorkbookXlsx(templateOnly ? 'template-suppliers-import.xlsx' : 'export-suppliers.xlsx', [
        {
          name: 'الموردين',
          headers: ['الاسم', 'رقم الهاتف', 'النشاط / التخصص', 'ملاحظات'],
          rows: templateOnly
            ? [['مؤسسة السلام للتوريدات', '01122334455', 'توريد عام', 'توريد أسبوعي']]
            : suppliers.map((s) => [s.name, s.phone, s.category, s.notes || '']),
        },
      ]);
    } else {
      exportWorkbookXlsx(templateOnly ? 'template-expenses-import.xlsx' : 'export-expenses.xlsx', [
        {
          name: 'المصروفات',
          headers: ['البيان', 'الفئة', 'المبلغ', 'جهة الصرف', 'ملاحظات'],
          rows: templateOnly
            ? [['فاتورة إنترنت الشهرية', 'utilities', 450, 'cash_drawer', 'سداد نقدي']]
            : expenses.map((ex) => [ex.title, ex.category, ex.amount, ex.paymentSource, ex.notes]),
        },
      ]);
    }
    onMutated(
      templateOnly ? 'تم تنزيل قالب الاستيراد القياسي XLSX' : 'تم تصدير بيانات القسم بصيغة XLSX'
    );
  };

  const handleChooseImportXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrMsg(null);
    setImportSummary(null);
    try {
      const parsed = await parseXlsxFile(file);
      setParsedSheets(parsed.sheets);
      setParsedSheetNames(parsed.sheetNames);
      setSelectedSheetName(parsed.sheetNames[0] || '');
      setUploadedFileName(file.name);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر قراءة ملف Excel');
    }
  };

  const activeImportRows = useMemo(
    () => (selectedSheetName ? parsedSheets[selectedSheetName] || [] : []),
    [parsedSheets, selectedSheetName]
  );

  const previewKeys = useMemo(() => {
    const first = activeImportRows[0];
    return first ? Object.keys(first).slice(0, 7) : [];
  }, [activeImportRows]);

  const handleRunXlsxImport = async () => {
    if (!canManageDataXlsx || activeImportRows.length === 0) return;
    setImportingXlsx(true);
    setErrMsg(null);
    try {
      const summary = await apiFetch<DataImportSummary>(`/api/data/import/${importEntity}`, {
        method: 'POST',
        body: JSON.stringify({ rows: activeImportRows }),
      });
      setImportSummary(summary);
      onMutated(
        `اكتمل الاستيراد: أُضيف ${summary.inserted}، تم تحديث ${summary.updated}، وتخطى ${summary.skipped}`
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل استيراد بيانات Excel');
    } finally {
      setImportingXlsx(false);
    }
  };

  const handleDownloadJsonBackup = async () => {
    try {
      const data = await apiFetch('/api/database/export-backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tajirpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onMutated('تم تنزيل النسخة الاحتياطية الكاملة (JSON)');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية');
    }
  };

  const handleSelectJsonBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      setConfirmRestorePayload({ fileName: file.name, payload: json });
      setErrMsg(null);
    } catch {
      setErrMsg('ملف JSON غير صالح أو تالف.');
    }
  };

  const handleConfirmRestoreJson = async () => {
    if (!confirmRestorePayload || !canManageDataXlsx) return;
    setRestoringJson(true);
    setErrMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; restoredCounts: Record<string, number> }>(
        '/api/database/restore-json',
        {
          method: 'POST',
          body: JSON.stringify(confirmRestorePayload.payload),
        }
      );
      setConfirmRestorePayload(null);
      onMutated(
        `تمت استعادة النسخة الاحتياطية (${res.restoredCounts.products ?? 0} صنف، ${res.restoredCounts.customers ?? 0} عميل)`
      );
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر استعادة النسخة الاحتياطية');
    } finally {
      setRestoringJson(false);
    }
  };

  const tabs: Array<{ id: SettingsTabId; label: string; icon: typeof Store; badge?: string }> = [
    { id: 'store_activity', label: 'المنشأة والنشاط', icon: Store },
    { id: 'pos_policies', label: 'الكاشير والطباعة الافتراضية', icon: Sliders },
    { id: 'treasuries', label: 'الخزائن والتحصيل', icon: Vault, badge: String(treasuries.length) },
    {
      id: 'templates',
      label: 'استوديو النماذج (XLSX+PNG)',
      icon: LayoutTemplate,
      badge: String(templates.length),
    },
    { id: 'payments', label: 'بوابات الدفع', icon: CreditCard },
    { id: 'data_xlsx', label: 'إدارة البيانات Excel', icon: FileSpreadsheet },
    { id: 'server_license', label: 'السيرفر والترخيص', icon: Server },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            مركز الإعدادات والبيانات ونماذج الطباعة
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            تحكم مركزي احترافي في بيانات المنشأة، سياسات الكاشير، الخزائن، قوالب Excel + PNG، واستيراد/تصدير البيانات.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            النشاط الحالي: <strong className="text-emerald-600">{activeActivity.nameAr}</strong>
          </span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono-num font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            السيولة بالخزائن: <strong className="text-emerald-600">{formatEGP(totalTreasuriesLiquidity)}</strong>
          </span>
        </div>
      </div>

      {/* Horizontal Scrollable / Clean Rectangular Tab Strip (No Pills) */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                setErrMsg(null);
              }}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{t.label}</span>
              {t.badge && (
                <span
                  className={`font-mono-num rounded px-1.5 py-0.5 text-[10px] ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {errMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errMsg}
        </div>
      )}

      {/* TAB 1: Store & Commercial Activity */}
      {activeTab === 'store_activity' && (
        <form onSubmit={handleSaveStoreSettings} className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  البيانات الضريبية والتعريفية للمحل
                </h2>
                {!canManageSettings && (
                  <span className="text-[11px] font-semibold text-amber-600">عرض فقط — يلزم صلاحية الإعدادات</span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    اسم المتجر / المنشأة *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canManageSettings}
                    value={storeDraft.storeName}
                    onChange={(e) => setStoreDraft({ ...storeDraft, storeName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم الهاتف للتواصل
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={storeDraft.phone}
                    onChange={(e) => setStoreDraft({ ...storeDraft, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    العنوان التفصيلي (يظهر أعلى الفاتورة)
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={storeDraft.address}
                    onChange={(e) => setStoreDraft({ ...storeDraft, address: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    الرقم الضريبي / السجل التجاري
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={storeDraft.taxNumber}
                    onChange={(e) => setStoreDraft({ ...storeDraft, taxNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    نسبة ضريبة القيمة المضافة %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    disabled={!canManageSettings}
                    value={storeDraft.vatPercent}
                    onChange={(e) => setStoreDraft({ ...storeDraft, vatPercent: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رسالة تذييل الإيصال (أسفل الفاتورة)
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={storeDraft.receiptFooter}
                    onChange={(e) => setStoreDraft({ ...storeDraft, receiptFooter: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  تكييف النشاط التجاري (الكتالوج والوحدات)
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  يحدد أقسام المخزون والوحدات الافتراضية والسمات الإضافية (مقاسات / تواريخ / ضمان).
                </p>
              </div>
              <div className="space-y-2">
                {activities.map((act) => {
                  const selected = storeDraft.activityId === act.id;
                  return (
                    <button
                      key={act.id}
                      type="button"
                      disabled={!canManageSettings}
                      onClick={() => setStoreDraft({ ...storeDraft, activityId: act.id })}
                      className={`w-full rounded-lg border p-3 text-right transition-colors disabled:opacity-60 ${
                        selected
                          ? 'border-emerald-600 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-950/30'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {act.nameAr}
                        </span>
                        {selected && (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            نشط حالياً
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {act.subtitleAr}
                      </div>
                      <div className="mt-1.5 text-[10px] text-slate-400">
                        الوحدات: {act.defaultUnits.join(' · ')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {canManageSettings && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ بيانات المنشأة والنشاط'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* TAB 2: POS, Security Policies & Default Print Template Settings */}
      {activeTab === 'pos_policies' && (
        <form onSubmit={handleSaveStoreSettings} className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                سياسات التشغيل والأمان عند بدء البرنامج
              </h2>

              {[
                {
                  key: 'requireLoginOnStart' as const,
                  title: 'إلزام تسجيل الدخول برمز PIN عند فتح النظام',
                  desc: 'يمنع فتح شاشات المبيعات والتقارير تلقائياً دون مصادقة الموظف برمز PIN الخاص به.',
                },
                {
                  key: 'allowNegativeStock' as const,
                  title: 'السماح بالبيع بالسالب عند نفاد الرصيد الدفتري',
                  desc: 'يسمح للكاشير بإتمام البيع مؤقتاً حتى لو وصل رصيد الصنف إلى صفر قبل تسجيل فاتورة الشراء.',
                },
                {
                  key: 'autoPrintAfterSale' as const,
                  title: 'تجهيز إيصال الطباعة تلقائياً فور إتمام الفاتورة',
                  desc: 'يعرض نافذة الطباعة السريعة مباشرة بعد تأكيد التحصيل في شاشة الكاشير.',
                },
              ].map((policy) => (
                <label
                  key={policy.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3.5 cursor-pointer hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">{policy.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{policy.desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!canManageSettings}
                    checked={storeDraft[policy.key]}
                    onChange={(e) =>
                      setStoreDraft({ ...storeDraft, [policy.key]: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 accent-emerald-600 shrink-0"
                  />
                </label>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                إعدادات الطباعة الافتراضية للفواتير
              </h2>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    مقاس الورق الافتراضي
                  </label>
                  <select
                    disabled={!canManageSettings}
                    value={storeDraft.printTemplate.defaultPaperSize}
                    onChange={(e) =>
                      setStoreDraft({
                        ...storeDraft,
                        printTemplate: {
                          ...storeDraft.printTemplate,
                          defaultPaperSize: e.target.value as 'a4' | 'thermal_80mm',
                        },
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="thermal_80mm">إيصال حراري 80mm</option>
                    <option value="a4">مستند رسمي A4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    نمط القالب العام
                  </label>
                  <select
                    disabled={!canManageSettings}
                    value={storeDraft.printTemplate.style}
                    onChange={(e) =>
                      setStoreDraft({
                        ...storeDraft,
                        printTemplate: {
                          ...storeDraft.printTemplate,
                          style: e.target.value as PrintTemplateStyle,
                        },
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    {PRINT_STYLES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    لون التمييز في الفواتير
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      disabled={!canManageSettings}
                      value={storeDraft.printTemplate.accentColor}
                      onChange={(e) =>
                        setStoreDraft({
                          ...storeDraft,
                          printTemplate: {
                            ...storeDraft.printTemplate,
                            accentColor: e.target.value,
                          },
                        })
                      }
                      className="h-9 w-12 rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700"
                    />
                    <span className="font-mono-num text-xs text-slate-500" dir="ltr">
                      {storeDraft.printTemplate.accentColor}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    ملاحظة ترويسة علوية
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={storeDraft.printTemplate.customHeaderNote}
                    onChange={(e) =>
                      setStoreDraft({
                        ...storeDraft,
                        printTemplate: {
                          ...storeDraft.printTemplate,
                          customHeaderNote: e.target.value,
                        },
                      })
                    }
                    placeholder="مثال: أهلاً بكم — خدمة التوصيل متاحة"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
                {[
                  { key: 'showTaxNumber' as const, label: 'إظهار الرقم الضريبي' },
                  { key: 'showBarcode' as const, label: 'إظهار باركود الفاتورة' },
                  { key: 'showCashierName' as const, label: 'إظهار اسم الكاشير' },
                  { key: 'showCustomerBalance' as const, label: 'إظهار رصيد العميل' },
                  { key: 'showVatSummary' as const, label: 'إظهار تفصيل ض.ق.م' },
                  { key: 'showSha256Hash' as const, label: 'ختم SHA-256 الأمني' },
                  { key: 'showSignatureLine' as const, label: 'سطر التوقيع والختم' },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs cursor-pointer dark:border-slate-800"
                  >
                    <input
                      type="checkbox"
                      disabled={!canManageSettings}
                      checked={Boolean(storeDraft.printTemplate[opt.key])}
                      onChange={(e) =>
                        setStoreDraft({
                          ...storeDraft,
                          printTemplate: {
                            ...storeDraft.printTemplate,
                            [opt.key]: e.target.checked,
                          },
                        })
                      }
                      className="accent-emerald-600"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-200">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Loyalty Program Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  برنامج نقاط الولاء للعملاء (Loyalty Points)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  يكسب العملاء المسجلون نقاطاً تلقائياً مع كل فاتورة، ويمكن استبدالها كخصم فوري في شاشة الكاشير.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canManageSettings}
                  checked={storeDraft.loyaltyConfig.enabled}
                  onChange={(e) =>
                    setStoreDraft({
                      ...storeDraft,
                      loyaltyConfig: {
                        ...storeDraft.loyaltyConfig,
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 accent-emerald-600"
                />
                <span>تفعيل برنامج نقاط الولاء</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">كل كام ج.م يمنح نقطة واحدة</label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  disabled={!canManageSettings || !storeDraft.loyaltyConfig.enabled}
                  value={storeDraft.loyaltyConfig.earnRateEgpPerPoint}
                  onChange={(e) =>
                    setStoreDraft({
                      ...storeDraft,
                      loyaltyConfig: {
                        ...storeDraft.loyaltyConfig,
                        earnRateEgpPerPoint: Math.max(1, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">قيمة النقطة عند الاستبدال (ج.م)</label>
                <input
                  type="number"
                  min={0.05}
                  step="0.05"
                  disabled={!canManageSettings || !storeDraft.loyaltyConfig.enabled}
                  value={storeDraft.loyaltyConfig.pointValueEgp}
                  onChange={(e) =>
                    setStoreDraft({
                      ...storeDraft,
                      loyaltyConfig: {
                        ...storeDraft.loyaltyConfig,
                        pointValueEgp: Math.max(0.05, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">الحد الأدنى للنقاط للاستبدال</label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  disabled={!canManageSettings || !storeDraft.loyaltyConfig.enabled}
                  value={storeDraft.loyaltyConfig.minRedeemPoints}
                  onChange={(e) =>
                    setStoreDraft({
                      ...storeDraft,
                      loyaltyConfig: {
                        ...storeDraft.loyaltyConfig,
                        minRedeemPoints: Math.max(1, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          {canManageSettings && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ سياسات التشغيل والطباعة'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* TAB 3: Treasuries & Accounts */}
      {activeTab === 'treasuries' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                الخزائن النقدية وحسابات التحصيل الإلكتروني
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                تُستخدم في شاشة الكاشير لتقسيم الفاتورة على أكثر من خزينة وفي تحصيل العملاء وسداد الموردين والمصروفات.
              </p>
            </div>
            {canManagePayments && (
              <div className="flex flex-wrap items-center gap-2">
                {treasuries.filter((t) => t.active).length >= 2 && (
                  <button
                    type="button"
                    onClick={openTransferModal}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <ArrowLeftRight className="h-4 w-4 text-sky-600" />
                    <span>تحويل بين الخزائن</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openCreateTreasury}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة خزينة / محفظة جديدة</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {treasuries.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border bg-white p-4 dark:bg-slate-900 space-y-3 ${
                  t.isDefault
                    ? 'border-emerald-500/70 dark:border-emerald-600/60'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {t.name}
                      </span>
                      {t.isDefault && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          افتراضية
                        </span>
                      )}
                      {!t.active && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">
                          معطلة
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {TREASURY_TYPE_LABELS[t.type]}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="text-[11px] text-slate-400">الرصيد الحالي</div>
                    <div className="font-mono-num text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                      {formatEGP(t.currentBalance)}
                    </div>
                  </div>
                </div>

                {t.accountNumber && (
                  <div className="rounded-lg bg-slate-50 px-3 py-1.5 font-mono-num text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    الحساب / الرقم: {t.accountNumber}
                  </div>
                )}
                {t.notes && <div className="text-[11px] text-slate-500">{t.notes}</div>}

                {canManagePayments && (
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditTreasury(t)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>تعديل</span>
                      </button>
                      {confirmDeleteTreasuryId === t.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteTreasury(t.id)}
                            className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                          >
                            تأكيد الحذف
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteTreasuryId(null)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        !t.isDefault && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteTreasuryId(t.id)}
                            className="inline-flex items-center gap-1 rounded border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:hover:bg-rose-950/30"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>حذف</span>
                          </button>
                        )
                      )}
                    </div>
                    <span className="font-mono-num text-[10px] text-slate-400">
                      {formatDateTimeAr(t.updatedAt)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: Paired XLSX + PNG Print & Export Template Studio */}
      {activeTab === 'templates' && templateDraft && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  نظام تخصيص نماذج الطباعة والتصدير (ملف Excel + معاينة PNG متزامنة)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  كل نموذج يتكون من ملف <span className="font-mono-num font-bold">.xlsx</span> لتخصيص الأعمدة والعناوين والبيانات، وملف{' '}
                  <span className="font-mono-num font-bold">.png</span> يتم توليده وتحديثه تلقائياً عند حفظ التعديلات.
                </p>
              </div>
              <input
                ref={templateUploadRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleUploadTemplateXlsx}
                className="hidden"
              />
            </div>

            {/* Template Cards */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
              {templates.map((tpl) => {
                const isSelected = tpl.id === templateDraft.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId(tpl.id);
                      setTemplateDraft(structuredClone(tpl));
                    }}
                    className={`group flex flex-col overflow-hidden rounded-xl border text-right transition-all ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-500/20 dark:border-emerald-500 dark:bg-emerald-950/20'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/40'
                    }`}
                  >
                    <div className="h-28 w-full overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 flex items-center justify-center p-1.5">
                      {tpl.previewPngDataUrl ? (
                        <img
                          src={tpl.previewPngDataUrl}
                          alt={tpl.nameAr}
                          className="h-full w-full object-contain object-top"
                        />
                      ) : (
                        <div className="w-full scale-[0.42] origin-top pointer-events-none select-none">
                          <TemplateSheetPreview template={tpl} settings={settings} compact />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5 space-y-1">
                      <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                        {tpl.nameAr}
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono-num text-slate-500">
                        <span className="truncate">{tpl.xlsxFileName}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono-num">
                        <span className="truncate text-emerald-600 dark:text-emerald-400">
                          {tpl.pngFileName}
                        </span>
                        <span className="rounded bg-slate-200/80 px-1 py-0.5 text-[9px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {tpl.previewPngDataUrl ? 'PNG محدّث' : 'معاينة حية'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Template Designer + Live/PNG Preview */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {/* Left/Start Editor Controls */}
            <div className="xl:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    {templateDraft.nameAr}
                  </h3>
                  <div className="mt-0.5 text-[11px] font-mono-num text-slate-500">
                    {templateDraft.xlsxFileName} ⇄ {templateDraft.pngFileName}
                  </div>
                </div>
              </div>

              {/* Paired XLSX Action Buttons */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => exportTemplateAsXlsx(templateDraft)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  <span>فتح / تحميل ملف Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  disabled={!canManageSettings || templateBusy}
                  onClick={() => templateUploadRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Upload className="h-4 w-4 shrink-0" />
                  <span>{templateBusy ? 'جاري التحديث...' : 'رفع Excel وتحديث PNG'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    عنوان المستند الرئيسي
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={templateDraft.headerTitle}
                    onChange={(e) =>
                      setTemplateDraft({ ...templateDraft, headerTitle: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    العنوان الفرعي
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={templateDraft.headerSubtitle}
                    onChange={(e) =>
                      setTemplateDraft({ ...templateDraft, headerSubtitle: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    مقاس الورق
                  </label>
                  <select
                    disabled={!canManageSettings}
                    value={templateDraft.paperSize}
                    onChange={(e) =>
                      setTemplateDraft({
                        ...templateDraft,
                        paperSize: e.target.value as 'a4' | 'thermal_80mm',
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="a4">صفحة A4</option>
                    <option value="thermal_80mm">حراري 80mm</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    نمط التصميم واللون
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={!canManageSettings}
                      value={templateDraft.style}
                      onChange={(e) =>
                        setTemplateDraft({
                          ...templateDraft,
                          style: e.target.value as PrintTemplateStyle,
                        })
                      }
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {PRINT_STYLES.map((st) => (
                        <option key={st.value} value={st.value}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="color"
                      disabled={!canManageSettings}
                      value={templateDraft.accentColor}
                      onChange={(e) =>
                        setTemplateDraft({ ...templateDraft, accentColor: e.target.value })
                      }
                      className="h-8 w-10 rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700"
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    ملاحظة تذييل النموذج
                  </label>
                  <input
                    type="text"
                    disabled={!canManageSettings}
                    value={templateDraft.footerNote}
                    onChange={(e) =>
                      setTemplateDraft({ ...templateDraft, footerNote: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'showLogo' as const, label: 'اسم وشعار المحل' },
                  { key: 'showTaxNumber' as const, label: 'الرقم الضريبي' },
                  { key: 'showBarcode' as const, label: 'كود/باركود الفاتورة' },
                  { key: 'showSplitPayments' as const, label: 'تفصيل الخزائن المتعددة' },
                  { key: 'showSignatureLine' as const, label: 'سطر التوقيع والختم' },
                ].map((tog) => (
                  <label
                    key={tog.key}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] cursor-pointer dark:border-slate-800"
                  >
                    <input
                      type="checkbox"
                      disabled={!canManageSettings}
                      checked={Boolean(templateDraft[tog.key])}
                      onChange={(e) =>
                        setTemplateDraft({ ...templateDraft, [tog.key]: e.target.checked })
                      }
                      className="accent-emerald-600"
                    />
                    <span>{tog.label}</span>
                  </label>
                ))}
              </div>

              {/* Columns Configuration */}
              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  أعمدة وحقول الجدول ({templateDraft.columns.filter((c) => c.visible).length} ظاهر)
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {templateDraft.columns.map((col, idx) => (
                    <div
                      key={col.key}
                      className="grid grid-cols-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950/60"
                    >
                      <input
                        type="checkbox"
                        disabled={!canManageSettings}
                        checked={col.visible}
                        onChange={(e) => {
                          const next = [...templateDraft.columns];
                          next[idx] = { ...col, visible: e.target.checked };
                          setTemplateDraft({ ...templateDraft, columns: next });
                        }}
                        className="col-span-1 accent-emerald-600"
                      />
                      <input
                        type="text"
                        disabled={!canManageSettings}
                        value={col.label}
                        onChange={(e) => {
                          const next = [...templateDraft.columns];
                          next[idx] = { ...col, label: e.target.value };
                          setTemplateDraft({ ...templateDraft, columns: next });
                        }}
                        className="col-span-7 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900"
                      />
                      <div className="col-span-4 flex items-center gap-1">
                        <input
                          type="number"
                          min="5"
                          max="70"
                          disabled={!canManageSettings}
                          value={col.widthPercent}
                          onChange={(e) => {
                            const next = [...templateDraft.columns];
                            next[idx] = { ...col, widthPercent: Number(e.target.value) || 15 };
                            setTemplateDraft({ ...templateDraft, columns: next });
                          }}
                          className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 font-mono-num text-[11px] dark:border-slate-700 dark:bg-slate-900"
                        />
                        <span className="text-[10px] text-slate-400">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {canManageSettings && (
                <button
                  type="button"
                  disabled={templateBusy}
                  onClick={() =>
                    captureAndSaveTemplate(
                      templateDraft,
                      `تم حفظ تخصيص نموذج "${templateDraft.nameAr}" وتحديث صورة المعاينة PNG`
                    )
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                >
                  <ImageIcon className="h-4 w-4" />
                  <span>{templateBusy ? 'جاري التوليد والحفظ...' : 'حفظ النموذج وتحديث صورة المعاينة PNG'}</span>
                </button>
              )}
            </div>

            {/* Right/End Live & PNG Artifact Preview */}
            <div className="xl:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTemplateViewMode('live')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      templateViewMode === 'live'
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    المعاينة الحية التفاعلية
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateViewMode('png')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      templateViewMode === 'png'
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    صورة PNG المحفوظة ({templateDraft.pngFileName})
                  </button>
                </div>

                {templateDraft.previewPngDataUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadDataUrl(templateDraft.previewPngDataUrl, templateDraft.pngFileName)
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تحميل PNG</span>
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-950 overflow-auto max-h-[620px] flex justify-center">
                {templateViewMode === 'png' && templateDraft.previewPngDataUrl ? (
                  <img
                    src={templateDraft.previewPngDataUrl}
                    alt={templateDraft.pngFileName}
                    className="max-w-full rounded border border-slate-300 bg-white shadow-sm"
                  />
                ) : templateViewMode === 'png' && !templateDraft.previewPngDataUrl ? (
                  <div className="py-12 text-center space-y-2">
                    <div className="text-xs font-semibold text-slate-500">
                      لم يتم توليد صورة PNG محفوظة لهذا النموذج بعد.
                    </div>
                    {canManageSettings && (
                      <button
                        type="button"
                        onClick={() =>
                          captureAndSaveTemplate(
                            templateDraft,
                            `تم توليد وحفظ صورة المعاينة (${templateDraft.pngFileName})`
                          )
                        }
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        توليد صورة PNG الآن
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="w-full max-w-[794px] shadow-sm">
                    <TemplateSheetPreview template={templateDraft} settings={settings} />
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
                <span>
                  آخر تحديث للنموذج:{' '}
                  <strong className="font-mono-num">{formatDateTimeAr(templateDraft.updatedAt)}</strong>
                </span>
                <span>ملاحظة: عند تعديل ملف Excel ورفعه تتجدد صورة PNG تلقائياً.</span>
              </div>
            </div>
          </div>

          {/* Pure #ffffff Offscreen Render Container for Crisp PNG Generation (bypasses dark mode & Tailwind oklch) */}
          <div
            style={{
              position: 'fixed',
              left: '-99999px',
              top: 0,
              pointerEvents: 'none',
              backgroundColor: '#ffffff',
              color: '#0f172a',
            }}
          >
            <div
              ref={captureRef}
              style={{
                backgroundColor: '#ffffff',
                color: '#0f172a',
                width: templateDraft.paperSize === 'thermal_80mm' ? '340px' : '794px',
              }}
            >
              <TemplateSheetPreview template={templateDraft} settings={settings} />
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Electronic Payment Gateways */}
      {activeTab === 'payments' && (
        <form
          onSubmit={handleSavePaymentConfig}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-5"
        >
          <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              إعدادات بوابات التحصيل الإلكتروني ورسوم البطاقات
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              تُستخدم للتحقق السريع وربط المرجع في شاشة الكاشير والتحصيل الإلكتروني.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  تفعيل الدفع عبر إنستا باي (InstaPay)
                </span>
                <input
                  type="checkbox"
                  disabled={!canManagePayments}
                  checked={payDraft.instapayEnabled}
                  onChange={(e) => setPayDraft({ ...payDraft, instapayEnabled: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  عنوان الدفع الفوري (IPA)
                </label>
                <input
                  type="text"
                  disabled={!canManagePayments}
                  value={payDraft.instapayIpa}
                  onChange={(e) => setPayDraft({ ...payDraft, instapayIpa: e.target.value })}
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  تفعيل المحافظ الإلكترونية (فودافون / اتصالات كاش)
                </span>
                <input
                  type="checkbox"
                  disabled={!canManagePayments}
                  checked={payDraft.walletEnabled}
                  onChange={(e) => setPayDraft({ ...payDraft, walletEnabled: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  رقم محفظة التاجر
                </label>
                <input
                  type="text"
                  disabled={!canManagePayments}
                  value={payDraft.vodafoneCashNumber}
                  onChange={(e) =>
                    setPayDraft({ ...payDraft, vodafoneCashNumber: e.target.value })
                  }
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  ربط بوابة Paymob / ماكينات الفيزا
                </span>
                <input
                  type="checkbox"
                  disabled={!canManagePayments}
                  checked={payDraft.paymobConfigured}
                  onChange={(e) =>
                    setPayDraft({ ...payDraft, paymobConfigured: e.target.checked })
                  }
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Paymob Integration ID
                  </label>
                  <input
                    type="text"
                    disabled={!canManagePayments}
                    value={payDraft.paymobIntegrationId}
                    onChange={(e) =>
                      setPayDraft({ ...payDraft, paymobIntegrationId: e.target.value })
                    }
                    dir="ltr"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    عمولة البطاقات %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    step="0.1"
                    disabled={!canManagePayments}
                    value={payDraft.cardFeePercent}
                    onChange={(e) =>
                      setPayDraft({
                        ...payDraft,
                        cardFeePercent: Number(e.target.value) || 0,
                      })
                    }
                    dir="ltr"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  ربط بوابة فوري (Fawry)
                </span>
                <input
                  type="checkbox"
                  disabled={!canManagePayments}
                  checked={payDraft.fawryConfigured}
                  onChange={(e) => setPayDraft({ ...payDraft, fawryConfigured: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  كود تاجر فوري (Merchant Code)
                </label>
                <input
                  type="text"
                  disabled={!canManagePayments}
                  value={payDraft.fawryMerchantCode}
                  onChange={(e) =>
                    setPayDraft({ ...payDraft, fawryMerchantCode: e.target.value })
                  }
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
          </div>

          {canManagePayments && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ إعدادات الدفع الإلكتروني'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* TAB 6: Comprehensive Data Management (Excel XLSX + JSON Backup/Restore) */}
      {activeTab === 'data_xlsx' && (
        <div className="space-y-5">
          {/* Download Ready-to-Run Project & Nuxt Vercel Edition */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/20 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <Download className="h-4 w-4 text-emerald-600" />
                  <span>تنزيل المشروع للتشغيل التلقائي على جهازك أو النشر على Vercel</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  بعد فك الضغط، شغّل <code dir="ltr" className="font-mono-num font-bold">START-WINDOWS.bat</code> (لويندوز) أو{' '}
                  <code dir="ltr" className="font-mono-num font-bold">START-MAC-LINUX.command</code> (لماك ولينكس) أو{' '}
                  <code dir="ltr" className="font-mono-num font-bold">npm run auto</code> لتثبيت الحزم وفتح المتصفح تلقائياً.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/full-project.zip`}
                  download="tajirpro-full-project.zip"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Download className="h-4 w-4" />
                  <span>تنزيل المشروع الكامل للتشغيل التلقائي (ZIP)</span>
                </a>
                <a
                  href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/nuxt-project.zip`}
                  download="tajirpro-nuxt-prisma-mysql.zip"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Download className="h-4 w-4 text-emerald-600" />
                  <span>تنزيل نسخة Nuxt + Prisma + MySQL لـ Vercel (ZIP)</span>
                </a>
              </div>
            </div>
          </div>

          {/* Quick Full Workbook Export + Backup */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                <span>تصدير النظام بالكامل بصيغة Excel (.xlsx)</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ينشئ ملف Excel موحد يحتوي على أوراق عمل منفصلة للبضاعة والعملاء والموردين والمصروفات والخزائن.
              </p>
              <button
                type="button"
                onClick={handleExportAllSystemXlsx}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                <span>تصدير قاعدة البيانات الشاملة (.xlsx)</span>
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <FileJson className="h-4 w-4 text-emerald-600" />
                <span>النسخ الاحتياطي والاستعادة الكاملة (JSON)</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تنزيل نسخة احتياطية هيكلية كاملة أو استعادتها لاحقاً في حالة نقل السيرفر أو الترقية.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canManageDataXlsx}
                  onClick={handleDownloadJsonBackup}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>تنزيل نسخة JSON</span>
                </button>
                <label
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300 ${
                    !canManageDataXlsx ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>استعادة من ملف JSON</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    disabled={!canManageDataXlsx}
                    onChange={handleSelectJsonBackupFile}
                    className="hidden"
                  />
                </label>
              </div>

              {confirmRestorePayload && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-2 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="font-bold text-amber-900 dark:text-amber-200">
                    تأكيد استعادة البيانات من الملف: {confirmRestorePayload.fileName}؟
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={restoringJson}
                      onClick={handleConfirmRestoreJson}
                      className="rounded-md bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {restoringJson ? 'جاري الاستعادة...' : 'تأكيد الاستعادة الآن'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRestorePayload(null)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Per-Entity Export / Template Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                { id: 'products', title: 'البضاعة والأصناف', count: products.length },
                { id: 'customers', title: 'العملاء والآجل', count: customers.length },
                { id: 'suppliers', title: 'الموردين', count: suppliers.length },
                { id: 'expenses', title: 'المصروفات', count: expenses.length },
              ] as Array<{ id: ImportEntity; title: string; count: number }>
            ).map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{card.title}</span>
                  <span className="font-mono-num text-xs font-bold text-emerald-600">{card.count}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDownloadEntityXlsx(card.id, false)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تصدير البيانات (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadEntityXlsx(card.id, true)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>تحميل قالب استيراد فارغ</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Interactive XLSX Import Wizard */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  معالج الاستيراد الجماعي من Excel (.xlsx)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  اختر القسم ثم ارفع ملف Excel؛ يتم مطابقة الأصناف بالباركود أو الكود وتحديث الموجود وإضافة الجديد تلقائياً.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  القسم المستهدف للاستيراد
                </label>
                <SearchableSelect
                  value={importEntity}
                  onChange={(v) => {
                    setImportEntity(v as ImportEntity);
                    setImportSummary(null);
                  }}
                  options={[
                    { value: 'products', label: 'البضاعة والأصناف والمخزون' },
                    { value: 'customers', label: 'بيانات العملاء' },
                    { value: 'suppliers', label: 'بيانات الموردين' },
                    { value: 'expenses', label: 'سجلات المصروفات' },
                  ]}
                  searchPlaceholder="اختر القسم..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  اختيار ملف Excel (.xlsx / .xls)
                </label>
                <label
                  className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-500 bg-emerald-50/50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 cursor-pointer dark:bg-emerald-950/20 dark:text-emerald-300 ${
                    !canManageDataXlsx ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <Upload className="h-4 w-4 shrink-0" />
                  <span className="truncate">{uploadedFileName || 'اضغط لاختيار ملف Excel...'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={!canManageDataXlsx}
                    onChange={handleChooseImportXlsx}
                    className="hidden"
                  />
                </label>
              </div>

              {parsedSheetNames.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    ورقة العمل (Sheet)
                  </label>
                  <select
                    value={selectedSheetName}
                    onChange={(e) => setSelectedSheetName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    {parsedSheetNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {activeImportRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    تم تحليل <strong className="font-mono-num text-emerald-600">{activeImportRows.length}</strong> صف في ورقة{' '}
                    <strong>{selectedSheetName}</strong> (عرض أول 8 صفوف للمعاينة):
                  </span>
                  <button
                    type="button"
                    disabled={!canManageDataXlsx || importingXlsx}
                    onClick={handleRunXlsxImport}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {importingXlsx
                        ? 'جاري الاستيراد لقاعدة البيانات...'
                        : `استيراد واعتماد (${activeImportRows.length} صف)`}
                    </span>
                  </button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500">
                      <tr>
                        {previewKeys.map((k) => (
                          <th key={k} className="px-3 py-2 font-semibold whitespace-nowrap">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {activeImportRows.slice(0, 8).map((row, idx) => (
                        <tr key={idx}>
                          {previewKeys.map((k) => (
                            <td key={k} className="px-3 py-2 font-mono-num truncate max-w-[180px]">
                              {String(row[k] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {importSummary && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30 space-y-2">
                <div className="font-bold text-emerald-800 dark:text-emerald-300">
                  ملخص نتيجة الاستيراد ({importSummary.entity}):
                </div>
                <div className="flex flex-wrap gap-4 font-mono-num">
                  <span>إضافات جديدة: <strong>{importSummary.inserted}</strong></span>
                  <span>تحديثات مطابقة: <strong>{importSummary.updated}</strong></span>
                  <span>صفوف متخطاة: <strong>{importSummary.skipped}</strong></span>
                </div>
                {importSummary.errors.length > 0 && (
                  <ul className="list-disc pr-4 text-rose-700 dark:text-rose-300 space-y-0.5">
                    {importSummary.errors.slice(0, 6).map((errText, i) => (
                      <li key={i}>{errText}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 7: Server, Database & License Control Overview */}
      {activeTab === 'server_license' && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Server className="h-4 w-4 text-emerald-600" />
              <span>نقطة اتصال الخادم والشبكة</span>
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <div>عنوان السيرفر: <span className="font-mono-num font-bold text-slate-800 dark:text-slate-200" dir="ltr">{serverUrl || window.location.origin}</span></div>
              <div>الأجهزة المتصلة لحظياً: <strong className="font-mono-num">{runtimeInfo?.connectedTerminals ?? '—'}</strong></div>
              <div>إصدار Node.js: <strong className="font-mono-num">{runtimeInfo?.nodeVersion || '—'}</strong></div>
              <div>مدة التشغيل: <strong className="font-mono-num">{runtimeInfo ? `${formatNum(runtimeInfo.uptimeSec)} ثانية` : '—'}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => onOpenServerConfig('server')}
              className="w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              إدارة عنوان السيرفر واختبار الاتصال
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Database className="h-4 w-4 text-emerald-600" />
              <span>محرك قاعدة البيانات</span>
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <div>المحرك النشط: <strong className="font-mono-num text-emerald-600">{settings.dbDriver === 'mysql' ? 'MySQL 8.0' : 'SQLite WAL'}</strong></div>
              <div>حجم قاعدة SQLite: <strong className="font-mono-num">{runtimeInfo ? `${formatNum(runtimeInfo.sqliteSizeKb)} KB` : '—'}</strong></div>
              <div>الأصناف المسجلة: <strong className="font-mono-num">{runtimeInfo?.productCount ?? products.length}</strong></div>
              <div>الفواتير المحفوظة: <strong className="font-mono-num">{runtimeInfo?.invoiceCount ?? '—'}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => onOpenServerConfig('database')}
              className="w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              التحكم الكامل في SQLite / MySQL
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>الترخيص وبصمة الجهاز</span>
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <div>
                حالة الترخيص:{' '}
                <strong className={license.valid ? 'text-emerald-600' : 'text-rose-600'}>
                  {license.valid ? `ساري (${license.payload?.tier.toUpperCase()})` : license.reason}
                </strong>
              </div>
              <div>الأيام المتبقية: <strong className="font-mono-num">{license.daysRemaining} يوم</strong></div>
              <div>بصمة الجهاز: <span className="font-mono-num" dir="ltr">{license.machineFingerprint}</span></div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenServerConfig('license')}
                className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>تفعيل / تحديث الترخيص</span>
                </span>
              </button>
              <button
                type="button"
                onClick={loadRuntime}
                title="تحديث حالة السيرفر"
                className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingRuntime ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Activity className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>لفحص سلامة توقيع الفواتير SHA-256 أو تهيئة جداول MySQL أو استعادة البيانات التجريبية، افتح نافذة التشخيص الكاملة.</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenServerConfig('diagnostics')}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              فتح فحص السلامة والتشخيص
            </button>
          </div>

          <div className="md:col-span-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-200">
              <div className="font-bold">تنزيل الكود المصدري والتشغيل التلقائي بنقرة واحدة</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                يدعم التشغيل التلقائي عبر START-WINDOWS.bat و START-MAC-LINUX.command مع نسخة Nuxt المحدّثة الجاهزة لـ Vercel.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/full-project.zip`}
                download="tajirpro-full-project.zip"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>المشروع الكامل (ZIP)</span>
              </a>
              <a
                href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/nuxt-project.zip`}
                download="tajirpro-nuxt-prisma-mysql.zip"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-emerald-600" />
                <span>نسخة Nuxt + MySQL لـ Vercel (ZIP)</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Treasury Add / Edit Modal */}
      {showTreasuryModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveTreasury}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Vault className="h-4 w-4 text-emerald-600" />
                <span>{editingTreasury ? 'تعديل بيانات الخزينة' : 'إضافة خزينة / محفظة جديدة'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowTreasuryModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                اسم الخزينة أو الحساب *
              </label>
              <input
                type="text"
                required
                value={treasuryForm.name}
                onChange={(e) => setTreasuryForm({ ...treasuryForm, name: e.target.value })}
                placeholder="مثال: خزينة الكاشير الرئيسية / إنستا باي / فودافون كاش"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  نوع الخزينة
                </label>
                <select
                  value={treasuryForm.type}
                  onChange={(e) =>
                    setTreasuryForm({ ...treasuryForm, type: e.target.value as TreasuryType })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {TREASURY_TYPES.map((tp) => (
                    <option key={tp} value={tp}>
                      {TREASURY_TYPE_LABELS[tp]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  الرصيد الافتتاحي / الحالي (ج.م)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={treasuryForm.currentBalance}
                  onChange={(e) =>
                    setTreasuryForm({ ...treasuryForm, currentBalance: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رقم المحفظة / IPA / الحساب البنكي
              </label>
              <input
                type="text"
                value={treasuryForm.accountNumber}
                onChange={(e) =>
                  setTreasuryForm({ ...treasuryForm, accountNumber: e.target.value })
                }
                dir="ltr"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                ملاحظات
              </label>
              <input
                type="text"
                value={treasuryForm.notes}
                onChange={(e) => setTreasuryForm({ ...treasuryForm, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={treasuryForm.isDefault}
                  onChange={(e) =>
                    setTreasuryForm({ ...treasuryForm, isDefault: e.target.checked })
                  }
                  className="accent-emerald-600"
                />
                <span>خزينة افتراضية لهذا النوع</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={treasuryForm.active}
                  onChange={(e) => setTreasuryForm({ ...treasuryForm, active: e.target.checked })}
                  className="accent-emerald-600"
                />
                <span>نشطة وتظهر في الدفع</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTreasuryModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ الخزينة'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Treasury-to-Treasury Transfer Modal */}
      {showTransferModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleTransferSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-sky-600" />
                <span>تحويل سيولة بين الخزائن والحسابات</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  من خزينة / حساب (المصدر)
                </label>
                <select
                  value={transferForm.fromTreasuryId}
                  onChange={(e) => setTransferForm({ ...transferForm, fromTreasuryId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  إلى خزينة / حساب (الوجهة)
                </label>
                <select
                  value={transferForm.toTreasuryId}
                  onChange={(e) => setTransferForm({ ...transferForm, toTreasuryId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  المبلغ المحول (ج.م) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  value={transferForm.amount}
                  onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm font-bold focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {(() => {
                const fromT = treasuries.find((t) => t.id === transferForm.fromTreasuryId);
                const toT = treasuries.find((t) => t.id === transferForm.toTreasuryId);
                const amt = Number(transferForm.amount || 0);
                if (!fromT || !toT || fromT.id === toT.id || !Number.isFinite(amt) || amt <= 0) return null;
                return (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-2.5 text-[11px] space-y-1 dark:border-sky-900/50 dark:bg-sky-950/30">
                    <div className="flex justify-between">
                      <span>الرصيد المتوقع في ({fromT.name}):</span>
                      <strong className="font-mono-num">{formatEGP(fromT.currentBalance - amt)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>الرصيد المتوقع في ({toT.name}):</span>
                      <strong className="font-mono-num text-emerald-700 dark:text-emerald-400">
                        {formatEGP(toT.currentBalance + amt)}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ملاحظات / سبب التحويل
                </label>
                <input
                  type="text"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  placeholder="مثال: توريد نقدية من درج الكاشير إلى الخزينة الرئيسية"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {saving ? 'جاري التنفيذ...' : 'تأكيد التحويل'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
