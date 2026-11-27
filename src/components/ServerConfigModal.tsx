import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  Globe,
  KeyRound,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { normalizeServerUrl } from '../hooks/useStoreSync';
import type {
  IntegrityReport,
  LicenseStatus,
  ServerRuntimeInfo,
  StoreSettings,
} from '../shared/types';
import { SearchableSelect } from './ui/SearchableSelect';

export type ServerConfigTab = 'server' | 'database' | 'license' | 'diagnostics';

interface ServerConfigModalProps {
  open: boolean;
  initialTab?: ServerConfigTab;
  onClose: () => void;
  serverUrl: string;
  onChangeServerUrl: (url: string) => void;
  settings: StoreSettings | null;
  license?: LicenseStatus | null;
  canManageSecurity: boolean;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onSaved: (msg: string) => void;
}

export function ServerConfigModal({
  open,
  initialTab = 'server',
  onClose,
  serverUrl,
  onChangeServerUrl,
  settings,
  license,
  canManageSecurity,
  apiFetch,
  onSaved,
}: ServerConfigModalProps) {
  const [tab, setTab] = useState<ServerConfigTab>(initialTab);

  // Tab 1: Server Endpoint & Health
  const [endpointMode, setEndpointMode] = useState<'same_origin' | 'custom'>(
    serverUrl ? 'custom' : 'same_origin'
  );
  const [customUrl, setCustomUrl] = useState(serverUrl || 'http://192.168.1.10:3000');
  const [pingResult, setPingResult] = useState<{
    ok: boolean;
    latencyMs: number;
    storeName?: string;
    dbDriver?: string;
    message: string;
  } | null>(null);
  const [pinging, setPinging] = useState(false);

  // Tab 2: Database Engine & MySQL Full Control
  const [dbDriver, setDbDriver] = useState<'sqlite' | 'mysql'>(settings?.dbDriver || 'sqlite');
  const [mysqlForm, setMysqlForm] = useState({
    host: settings?.mysqlConfig.host || '127.0.0.1',
    port: settings?.mysqlConfig.port || 3306,
    database: settings?.mysqlConfig.database || 'tajirpro_pos',
    user: settings?.mysqlConfig.user || 'tajirpro_user',
    password: '',
    ssl: Boolean(settings?.mysqlConfig.ssl),
    connectionLimit: settings?.mysqlConfig.connectionLimit || 10,
    connected: Boolean(settings?.mysqlConfig.connected),
  });
  const [adminPinOverride, setAdminPinOverride] = useState('');
  const [dbMsg, setDbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingMysql, setTestingMysql] = useState(false);
  const [provisioningMysql, setProvisioningMysql] = useState(false);
  const [savingDb, setSavingDb] = useState(false);
  const [schemaText, setSchemaText] = useState('');
  const [showSchema, setShowSchema] = useState(false);

  // Tab 3: License & Security Control (usable pre-login too via Owner PIN)
  const [licenseInput, setLicenseInput] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [licenseMsg, setLicenseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activatingLicense, setActivatingLicense] = useState(false);

  // Tab 4: Runtime Diagnostics
  const [runtimeInfo, setRuntimeInfo] = useState<ServerRuntimeInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);

  const loadRuntimeInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const info = await apiFetch<ServerRuntimeInfo>('/api/server/info');
      setRuntimeInfo(info);
    } catch {
      // ignore if unreachable server
    } finally {
      setLoadingInfo(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setEndpointMode(serverUrl ? 'custom' : 'same_origin');
    if (serverUrl) setCustomUrl(serverUrl);
    if (settings) {
      setDbDriver(settings.dbDriver);
      setMysqlForm((prev) => ({
        ...prev,
        host: settings.mysqlConfig.host,
        port: settings.mysqlConfig.port,
        database: settings.mysqlConfig.database,
        user: settings.mysqlConfig.user,
        ssl: Boolean(settings.mysqlConfig.ssl),
        connectionLimit: settings.mysqlConfig.connectionLimit || 10,
        connected: Boolean(settings.mysqlConfig.connected),
      }));
    }
    setDbMsg(null);
    setLicenseMsg(null);
    setPingResult(null);
    loadRuntimeInfo();
  }, [open, initialTab, serverUrl, settings, loadRuntimeInfo]);

  if (!open) return null;

  const targetBase = endpointMode === 'same_origin' ? '' : normalizeServerUrl(customUrl);

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {};
    if (adminPinOverride.trim()) {
      h['x-admin-pin'] = adminPinOverride.trim();
    }
    return h;
  };

  const handleTestServerHealth = async () => {
    setPinging(true);
    setPingResult(null);
    const url = targetBase ? `${targetBase}/api/health` : '/api/health';
    const t0 = performance.now();
    try {
      const res = await fetch(url);
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`HTTP ${res.status} (${url})`);
      }
      const data = (await res.json()) as {
        ok: boolean;
        storeName: string;
        dbDriver: string;
      };
      setPingResult({
        ok: true,
        latencyMs,
        storeName: data.storeName,
        dbDriver: data.dbDriver,
        message: `الخادم متصل ويعمل بكفاءة (${latencyMs}ms) — المتجر: ${data.storeName}`,
      });
    } catch (err) {
      setPingResult({
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        message:
          err instanceof Error
            ? `تعذر الوصول للخادم (${err.message})`
            : 'تعذر الوصول لعنوان الخادم المحدد',
      });
    } finally {
      setPinging(false);
    }
  };

  const handleApplyServerEndpoint = () => {
    const nextUrl = endpointMode === 'same_origin' ? '' : normalizeServerUrl(customUrl);
    onChangeServerUrl(nextUrl);
    onSaved(
      nextUrl
        ? `تم توجيه النظام إلى الخادم: ${nextUrl}`
        : 'تم ضبط الاتصال على الخادم المحلي الافتراضي (Same-Origin)'
    );
    onClose();
  };

  const handleTestMysql = async () => {
    setTestingMysql(true);
    setDbMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/database/test-mysql', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(mysqlForm),
      });
      setDbMsg({ ok: res.ok, text: res.message });
      if (res.ok) {
        setMysqlForm((p) => ({ ...p, connected: true }));
      }
    } catch (err) {
      setDbMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'فشل اختبار الاتصال بـ MySQL',
      });
    } finally {
      setTestingMysql(false);
    }
  };

  const handleProvisionMysql = async () => {
    setProvisioningMysql(true);
    setDbMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/database/provision-mysql', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(mysqlForm),
      });
      setDbMsg({ ok: res.ok, text: res.message });
    } catch (err) {
      setDbMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر إنشاء الجداول في MySQL',
      });
    } finally {
      setProvisioningMysql(false);
    }
  };

  const handleSaveDatabaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDb(true);
    setDbMsg(null);
    try {
      await apiFetch('/api/database/config', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          dbDriver,
          mysqlConfig: mysqlForm,
        }),
      });
      setDbMsg({ ok: true, text: 'تم حفظ إعدادات محرك قاعدة البيانات وتعميمها على الخادم بنجاح.' });
      loadRuntimeInfo();
      onSaved(
        `تم تحديث إعدادات قاعدة البيانات (${dbDriver === 'mysql' ? 'MySQL 8.0' : 'SQLite WAL'})`
      );
    } catch (err) {
      setDbMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر حفظ إعدادات قاعدة البيانات',
      });
    } finally {
      setSavingDb(false);
    }
  };

  const handleIssueDemoLicense = async (tier: 'pro' | 'enterprise') => {
    setLicenseMsg(null);
    try {
      const res = await apiFetch<{ licenseKey: string }>('/api/security/license/issue-demo', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          tier,
          durationDays: 365,
          maxTerminals: tier === 'enterprise' ? 25 : 5,
        }),
      });
      setGeneratedKey(res.licenseKey);
      setLicenseInput(res.licenseKey);
      setLicenseMsg({ ok: true, text: `تم توليد مفتاح ${tier.toUpperCase()} سنوي موقع برقم بصمة الجهاز.` });
    } catch (err) {
      setLicenseMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر توليد المفتاح — تأكد من إدخال رمز PIN المالك',
      });
    }
  };

  const handleActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivatingLicense(true);
    setLicenseMsg(null);
    try {
      await apiFetch('/api/security/license/activate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ licenseKey: licenseInput }),
      });
      setLicenseMsg({ ok: true, text: 'تم التحقق من التوقيع الرقمي Ed25519 وتفعيل الترخيص بنجاح.' });
      onSaved('تم تفعيل الترخيص الموثق للنظام بنجاح');
    } catch (err) {
      setLicenseMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'فشل تفعيل الترخيص',
      });
    } finally {
      setActivatingLicense(false);
    }
  };

  const handleLoadSchema = async () => {
    if (showSchema) {
      setShowSchema(false);
      return;
    }
    const base = serverUrl || '';
    const res = await fetch(`${base}/api/database/mysql-schema`);
    if (!res.ok) {
      setDbMsg({
        ok: false,
        text: `تعذر تحميل هيكل MySQL SQL (/api/database/mysql-schema -> HTTP ${res.status})`,
      });
      return;
    }
    const txt = await res.text();
    setSchemaText(txt);
    setShowSchema(true);
  };

  const handleBackupDownload = async () => {
    const data = await apiFetch('/api/database/export-backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tajirpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onSaved('تم تنزيل نسخة احتياطية كاملة بصيغة JSON');
  };

  const handleCheckIntegrity = async () => {
    const res = await apiFetch<IntegrityReport>('/api/security/integrity');
    setIntegrity(res);
  };

  const handleResetDemo = async () => {
    setResettingDemo(true);
    setDbMsg(null);
    try {
      await apiFetch('/api/database/reset-demo', {
        method: 'POST',
        headers: authHeaders(),
      });
      onSaved('تمت استعادة البيانات الافتراضية المؤقتة للتجربة');
      loadRuntimeInfo();
    } catch (err) {
      setDbMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر إعادة ضبط بيانات التجربة',
      });
    } finally {
      setResettingDemo(false);
    }
  };

  const renderAdminPinPrompt = () =>
    !canManageSecurity ? (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 space-y-2">
        <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          <span>التفويض الأمني (مطلوب قبل الدخول أو للصلاحيات المقيدة)</span>
        </div>
        <input
          type="password"
          value={adminPinOverride}
          onChange={(e) => setAdminPinOverride(e.target.value)}
          placeholder="أدخل رمز PIN المالك (الافتراضي 1234) لاعتماد التعديلات الحساسة"
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono-num text-xs dark:border-amber-800 dark:bg-slate-950"
        />
      </div>
    ) : null;

  return (
    <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-5 max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-600" />
              <span>التحكم الكامل في الخادم وقواعد البيانات والترخيص</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              إدارة عنوان الخادم (محلي / شبكة LAN / سحابي)، محرك SQLite أو MySQL 8.0، وتفعيل التراخيص المشفرة
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setTab('server')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'server'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            <Globe className="h-3.5 w-3.5 text-emerald-600" />
            <span>عنوان الخادم والربط</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('database')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'database'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            <Database className="h-3.5 w-3.5 text-emerald-600" />
            <span>قواعد البيانات (SQLite / MySQL)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('license')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'license'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>الترخيص والتشفير</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('diagnostics')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'diagnostics'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
            <span>التشخيص والصيانة</span>
          </button>
        </div>

        {/* Tab 1: Server Endpoint & Health */}
        {tab === 'server' && (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                وضع الاتصال بالخادم (Server Endpoint)
              </label>
              <SearchableSelect
                value={endpointMode}
                onChange={(val) => setEndpointMode(val as 'same_origin' | 'custom')}
                options={[
                  {
                    value: 'same_origin',
                    label: 'الخادم المحلي الحالي (Same-Origin)',
                    sublabel: window.location.origin,
                  },
                  {
                    value: 'custom',
                    label: 'خادم شبكة محلية (LAN) أو سحابي مخصص',
                    sublabel: 'ربط عدة أجهزة كاشير بخادم رئيسي واحد',
                  },
                ]}
                searchPlaceholder="ابحث في أوضاع الاتصال..."
              />
            </div>

            {endpointMode === 'custom' && (
              <div>
                <label className="block font-medium mb-1">عنوان الخادم (HTTP/HTTPS URL)</label>
                <input
                  dir="ltr"
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="http://192.168.1.10:3000"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  يتم استخدام نفس العنوان تلقائياً لمزامنة المخزون اللحظية عبر WebSocket.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestServerHealth}
                disabled={pinging}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${pinging ? 'animate-spin' : ''}`} />
                <span>فحص اتصال وسرعة استجابة الخادم</span>
              </button>

              <button
                type="button"
                onClick={handleApplyServerEndpoint}
                className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
              >
                اعتماد عنوان الخادم وإعادة المزامنة
              </button>
            </div>

            {pingResult && (
              <div
                className={`rounded-lg border p-3 text-xs font-medium ${
                  pingResult.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'
                }`}
              >
                {pingResult.message}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Database Engine & Full MySQL Control */}
        {tab === 'database' && (
          <form onSubmit={handleSaveDatabaseConfig} className="space-y-4 text-xs">
            {renderAdminPinPrompt()}

            <div>
              <label className="block font-semibold mb-1.5">محرك قاعدة البيانات النشط</label>
              <SearchableSelect
                value={dbDriver}
                onChange={(val) => setDbDriver(val as 'sqlite' | 'mysql')}
                options={[
                  {
                    value: 'sqlite',
                    label: 'قاعدة بيانات محلية فورية (SQLite WAL)',
                    sublabel: 'تعمل محلياً بدون خادم إضافي وبسرعة فائقة',
                  },
                  {
                    value: 'mysql',
                    label: 'خادم قواعد بيانات خارجي / شبكي (MySQL 8.0)',
                    sublabel: 'للفروع المتعددة والخوادم المركزية',
                  },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="sm:col-span-2 font-bold text-slate-800 dark:text-slate-200">
                إعدادات اتصال خادم MySQL 8.0
              </div>

              <div>
                <label className="block font-medium mb-1">المضيف (Host / IP)</label>
                <input
                  dir="ltr"
                  value={mysqlForm.host}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, host: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">المنفذ (Port)</label>
                <input
                  dir="ltr"
                  type="number"
                  value={mysqlForm.port}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, port: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">اسم قاعدة البيانات</label>
                <input
                  dir="ltr"
                  value={mysqlForm.database}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, database: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">اسم المستخدم (User)</label>
                <input
                  dir="ltr"
                  value={mysqlForm.user}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, user: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">كلمة المرور (Password)</label>
                <input
                  dir="ltr"
                  type="password"
                  value={mysqlForm.password}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">حد الاتصالات (Pool Limit)</label>
                <input
                  dir="ltr"
                  type="number"
                  min={1}
                  max={100}
                  value={mysqlForm.connectionLimit}
                  onChange={(e) =>
                    setMysqlForm({ ...mysqlForm, connectionLimit: Number(e.target.value) || 10 })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <label className="sm:col-span-2 flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mysqlForm.ssl}
                  onChange={(e) => setMysqlForm({ ...mysqlForm, ssl: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span className="font-medium">تفعيل اتصال مشفر SSL/TLS لخادم MySQL السحابي</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleTestMysql}
                disabled={testingMysql}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {testingMysql ? 'جاري الاختبار...' : 'اختبار الاتصال بـ MySQL'}
              </button>

              <button
                type="button"
                onClick={handleProvisionMysql}
                disabled={provisioningMysql}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-nowrap shrink-0"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>{provisioningMysql ? 'جاري التهيئة...' : 'إنشاء الجداول تلقائياً في MySQL'}</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSchema}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {showSchema ? 'إخفاء كود SQL' : 'معاينة هيكل MySQL SQL'}
              </button>

              <button
                type="submit"
                disabled={savingDb}
                className="mr-auto rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {savingDb ? 'جاري الحفظ...' : 'حفظ واعتماد إعدادات القاعدة'}
              </button>
            </div>

            {dbMsg && (
              <div
                className={`rounded-lg border p-3 font-medium ${
                  dbMsg.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
                }`}
              >
                {dbMsg.text}
              </div>
            )}

            {showSchema && (
              <pre
                dir="ltr"
                className="max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 font-mono-num text-[11px] text-emerald-300"
              >
                {schemaText}
              </pre>
            )}
          </form>
        )}

        {/* Tab 3: Cryptographic License & Security Control */}
        {tab === 'license' && (
          <div className="space-y-4 text-xs">
            {renderAdminPinPrompt()}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950 space-y-1.5">
                <div className="text-slate-500">حالة الترخيص الحالية</div>
                <div
                  className={`text-sm font-bold flex items-center gap-1.5 ${
                    license?.valid ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {license?.valid ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                  <span>{license?.valid ? 'ترخيص موثق ساري' : license?.reason || 'غير مفعل'}</span>
                </div>
                {license?.payload && (
                  <div className="font-mono-num text-[11px] text-slate-600 dark:text-slate-400">
                    الباقة: {license.payload.tier.toUpperCase()} · متبقي {license.daysRemaining} يوم · حتى{' '}
                    {license.payload.maxTerminals} أجهزة
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950 space-y-1.5">
                <div className="text-slate-500">بصمة الجهاز المرتبط (Machine ID)</div>
                <div className="font-mono-num text-sm font-bold text-slate-900 dark:text-white break-all">
                  {license?.machineFingerprint || '—'}
                </div>
                <div className="text-[11px] text-emerald-600 font-semibold">
                  {license?.signatureVerified
                    ? 'التوقيع الرقمي Ed25519 سليم ومطابق 100%'
                    : 'بانتظار مفتاح موقع صالح'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleIssueDemoLicense('pro')}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 whitespace-nowrap shrink-0"
              >
                <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
                <span>توليد مفتاح PRO (5 أجهزة)</span>
              </button>
              <button
                type="button"
                onClick={() => handleIssueDemoLicense('enterprise')}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-nowrap shrink-0"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>توليد مفتاح Enterprise (25 جهاز)</span>
              </button>
              <button
                type="button"
                onClick={handleCheckIntegrity}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>فحص سلسلة الفواتير SHA-256</span>
              </button>
            </div>

            <form onSubmit={handleActivateLicense} className="space-y-2">
              <label className="block font-semibold text-slate-700 dark:text-slate-200">
                تفعيل مفتاح ترخيص موقع (TP1....)
              </label>
              <textarea
                rows={3}
                dir="ltr"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                placeholder={generatedKey || 'TP1....'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="submit"
                disabled={!licenseInput.trim() || activatingLicense}
                className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {activatingLicense ? 'جاري التحقق...' : 'التحقق من التوقيع وتفعيل الترخيص'}
              </button>
            </form>

            {licenseMsg && (
              <div
                className={`rounded-lg border p-3 font-medium ${
                  licenseMsg.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'
                }`}
              >
                {licenseMsg.text}
              </div>
            )}

            {integrity && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {integrity.chainIntact
                    ? `جميع الفواتير سليمة ومؤمنة (${integrity.validInvoices} / ${integrity.totalInvoicesChecked} فاتورة)`
                    : `تم رصد اختلاف في ${integrity.brokenInvoiceIds.length} فواتير`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Runtime Diagnostics & Maintenance */}
        {tab === 'diagnostics' && (
          <div className="space-y-4 text-xs">
            {renderAdminPinPrompt()}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">محرك القاعدة النشط</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-emerald-600">
                  {runtimeInfo?.dbDriver === 'mysql' ? 'MySQL 8.0' : 'SQLite WAL'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">حجم ملف SQLite المحلي</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {runtimeInfo ? `${runtimeInfo.sqliteSizeKb} KB` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">إصدار Node.js / وقت التشغيل</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {runtimeInfo ? `${runtimeInfo.nodeVersion} · ${runtimeInfo.uptimeSec}s` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">الأصناف / الفواتير</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {runtimeInfo ? `${runtimeInfo.productCount} صنف · ${runtimeInfo.invoiceCount} فاتورة` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">وضع التزامن (WAL)</div>
                <div className="mt-1 font-semibold text-emerald-600">
                  {runtimeInfo?.sqliteWal ? 'مفعل (سريع وآمن)' : 'قياسي'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-slate-500">الأجهزة المتصلة الآن</div>
                <div className="mt-1 font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                  {runtimeInfo?.connectedTerminals ?? '—'} جهاز
                </div>
              </div>
            </div>

            {runtimeInfo && (
              <div className="rounded-lg border border-slate-200 px-3 py-2 font-mono-num text-[11px] text-slate-500 dark:border-slate-800">
                مسار القاعدة المحلية: <span dir="ltr">{runtimeInfo.sqlitePath}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadRuntimeInfo}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingInfo ? 'animate-spin' : ''}`} />
                <span>تحديث القراءات</span>
              </button>

              <button
                type="button"
                onClick={handleCheckIntegrity}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700 whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>فحص سلامة سلسلة الفواتير (SHA-256)</span>
              </button>

              <button
                type="button"
                onClick={handleBackupDownload}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>تنزيل نسخة احتياطية JSON</span>
              </button>

              <button
                type="button"
                onClick={handleResetDemo}
                disabled={resettingDemo}
                className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${resettingDemo ? 'animate-spin' : ''}`} />
                <span>استعادة البيانات التجريبية</span>
              </button>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/20 space-y-2.5">
              <div className="font-bold text-slate-900 dark:text-white">
                تنزيل حزمة المشروع للتشغيل التلقائي محلياً أو النشر على Vercel
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                بعد فك الضغط، انقر نقراً مزدوجاً على <span dir="ltr" className="font-mono-num font-bold">START-WINDOWS.bat</span> أو{' '}
                <span dir="ltr" className="font-mono-num font-bold">START-MAC-LINUX.command</span> ليتم تثبيت الحزم وتشغيل الخادم وفتح المتصفح تلقائياً.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/full-project.zip`}
                  download="tajirpro-full-project.zip"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>تنزيل المشروع الكامل للتشغيل التلقائي (ZIP)</span>
                </a>
                <a
                  href={`${serverUrl ? serverUrl.replace(/\/+$/, '') : ''}/api/download/nuxt-project.zip`}
                  download="tajirpro-nuxt-prisma-mysql.zip"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600" />
                  <span>تنزيل نسخة Nuxt + Prisma + MySQL لـ Vercel (ZIP)</span>
                </a>
              </div>
            </div>

            {integrity && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {integrity.chainIntact
                    ? `جميع الفواتير سليمة ومؤمنة (${integrity.validInvoices} / ${integrity.totalInvoicesChecked} فاتورة)`
                    : `تم رصد اختلاف في ${integrity.brokenInvoiceIds.length} فواتير`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
