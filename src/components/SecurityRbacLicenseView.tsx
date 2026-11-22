import {
  CheckCircle2,
  Database,
  Download,
  Edit3,
  History,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type {
  IntegrityReport,
  LicenseStatus,
  PermissionKey,
  RolePermissionsMap,
  SecurityAuditLog,
  StaffUser,
  StoreSettings,
  UserRole,
} from '../shared/types';
import {
  formatDateTimeAr,
  getEffectivePermissions,
  PERMISSION_LABELS,
  ROLE_LABELS,
} from '../utils/formatters';
import { SearchableSelect } from './ui/SearchableSelect';

interface SecurityRbacLicenseViewProps {
  staff: StaffUser[];
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  license: LicenseStatus;
  settings: StoreSettings;
  auditLogs?: SecurityAuditLog[];
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onOpenUserSwitch: () => void;
  onOpenServerConfig?: () => void;
  onMutated: (msg: string) => void;
}

export function SecurityRbacLicenseView({
  staff,
  currentUser,
  rolePermissions,
  license,
  settings,
  auditLogs = [],
  apiFetch,
  onOpenUserSwitch,
  onOpenServerConfig,
  onMutated,
}: SecurityRbacLicenseViewProps) {
  const userEffectivePerms = getEffectivePermissions(currentUser, rolePermissions);
  const canManageSecurity = Boolean(userEffectivePerms.manage_security_rbac);
  const isOwner = currentUser.role === 'owner';
  const activeOwnerCount = useMemo(
    () => staff.filter((s) => s.role === 'owner' && s.active).length,
    [staff]
  );

  const [newStaff, setNewStaff] = useState({ name: '', role: 'cashier' as UserRole, pin: '' });
  const [editingStaff, setEditingStaff] = useState<StaffUser | null>(null);
  const [editStaffForm, setEditStaffForm] = useState({
    name: '',
    role: 'cashier' as UserRole,
    active: true,
    newPin: '',
  });
  const [permModalUser, setPermModalUser] = useState<StaffUser | null>(null);
  const [permOverridesDraft, setPermOverridesDraft] = useState<
    Partial<Record<PermissionKey, boolean | null>>
  >({});
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);

  const [licenseInput, setLicenseInput] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [mysqlForm, setMysqlForm] = useState({
    host: settings.mysqlConfig.host,
    port: settings.mysqlConfig.port,
    user: settings.mysqlConfig.user,
    password: 'DemoTestPassword_2026',
    database: settings.mysqlConfig.database,
  });
  const [storeForm, setStoreForm] = useState({
    storeName: settings.storeName,
    phone: settings.phone,
    address: settings.address,
    taxNumber: settings.taxNumber,
    receiptFooter: settings.receiptFooter,
  });
  const [mysqlResult, setMysqlResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showSchemaModal, setShowSchemaModal] = useState(false);
  const [mysqlSchemaSql, setMysqlSchemaSql] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);

  // Audit Log search & filter
  const [auditSearch, setAuditSearch] = useState('');
  const debouncedAuditSearch = useDebouncedValue(auditSearch, 250);
  const [auditCatFilter, setAuditCatFilter] = useState<string>('all');
  const [auditVisibleCount, setAuditVisibleCount] = useState(20);

  useEffect(() => {
    setStoreForm({
      storeName: settings.storeName,
      phone: settings.phone,
      address: settings.address,
      taxNumber: settings.taxNumber,
      receiptFooter: settings.receiptFooter,
    });
  }, [settings]);

  const filteredAuditLogs = useMemo(() => {
    const q = debouncedAuditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (auditCatFilter !== 'all' && l.category !== auditCatFilter) return false;
      if (!q) return true;
      return (
        l.actorName.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.target.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, debouncedAuditSearch, auditCatFilter]);

  const handleTogglePermission = async (role: UserRole, permKey: PermissionKey) => {
    if (!canManageSecurity) return;
    if (role === 'owner' && permKey === 'manage_security_rbac') return;
    setErrMsg(null);
    try {
      const nextVal = !rolePermissions[role][permKey];
      await apiFetch('/api/security/rbac/permissions', {
        method: 'POST',
        body: JSON.stringify({ role, permissions: { [permKey]: nextVal } }),
      });
      onMutated(`تم تحديث صلاحية "${PERMISSION_LABELS[permKey].title}" لدور ${ROLE_LABELS[role]}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل تحديث الصلاحيات');
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    try {
      await apiFetch('/api/security/staff', {
        method: 'POST',
        body: JSON.stringify(newStaff),
      });
      setNewStaff({ name: '', role: 'cashier', pin: '' });
      onMutated('تمت إضافة الموظف وتشفير الرمز السري بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل إضافة الموظف');
    }
  };

  const openEditStaff = (u: StaffUser) => {
    setEditingStaff(u);
    setEditStaffForm({
      name: u.name,
      role: u.role,
      active: u.active,
      newPin: '',
    });
  };

  const handleSaveStaffEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setErrMsg(null);
    try {
      await apiFetch(`/api/security/staff/${editingStaff.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editStaffForm.name,
          role: editStaffForm.role,
          active: editStaffForm.active,
          newPin: editStaffForm.newPin.trim() || undefined,
        }),
      });
      setEditingStaff(null);
      onMutated(`تم تحديث بيانات وصلاحيات الموظف: ${editStaffForm.name}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تعديل بيانات الموظف');
    }
  };

  const handleToggleStaff = async (u: StaffUser) => {
    setErrMsg(null);
    try {
      await apiFetch(`/api/security/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !u.active }),
      });
      onMutated(`تم ${!u.active ? 'تفعيل' : 'تعطيل'} حساب ${u.name}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر تعديل حالة الموظف');
    }
  };

  const openPermModal = (u: StaffUser) => {
    setPermModalUser(u);
    const initial: Partial<Record<PermissionKey, boolean | null>> = {};
    for (const pk of Object.keys(PERMISSION_LABELS) as PermissionKey[]) {
      initial[pk] =
        u.customPermissions && u.customPermissions[pk] !== undefined
          ? Boolean(u.customPermissions[pk])
          : null;
    }
    setPermOverridesDraft(initial);
  };

  const handleSaveCustomPerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permModalUser) return;
    setErrMsg(null);
    try {
      await apiFetch(`/api/security/staff/${permModalUser.id}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ customPermissions: permOverridesDraft }),
      });
      setPermModalUser(null);
      onMutated(`تم تحديث الصلاحيات الفردية وإعادة تأمين جلسة: ${permModalUser.name}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ الصلاحيات الفردية');
    }
  };

  const handleRevokeSessions = async (u: StaffUser) => {
    setErrMsg(null);
    try {
      await apiFetch(`/api/security/staff/${u.id}/revoke-sessions`, { method: 'POST' });
      onMutated(`تم إنهاء كافة الجلسات النشطة لحساب ${u.name}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر إنهاء الجلسات');
    }
  };

  const handleDeleteStaff = async (u: StaffUser) => {
    setErrMsg(null);
    try {
      await apiFetch(`/api/security/staff/${u.id}`, { method: 'DELETE' });
      setConfirmDeleteUserId(null);
      onMutated(`تم حذف حساب الموظف: ${u.name}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حذف الحساب');
    }
  };

  const handleVerifyIntegrity = async () => {
    setCheckingIntegrity(true);
    try {
      const res = await apiFetch<IntegrityReport>('/api/security/integrity');
      setIntegrity(res);
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleIssueDemoLicense = async (tier: 'pro' | 'enterprise') => {
    setErrMsg(null);
    try {
      const res = await apiFetch<{ licenseKey: string }>('/api/security/license/issue-demo', {
        method: 'POST',
        body: JSON.stringify({ tier, durationDays: 365, maxTerminals: tier === 'enterprise' ? 25 : 5 }),
      });
      setGeneratedKey(res.licenseKey);
      setLicenseInput(res.licenseKey);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر إصدار المفتاح');
    }
  };

  const handleActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    try {
      await apiFetch('/api/security/license/activate', {
        method: 'POST',
        body: JSON.stringify({ licenseKey: licenseInput }),
      });
      onMutated('تم التحقق من التوقيع الرقمي Ed25519 وتفعيل الترخيص بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل تفعيل الترخيص');
    }
  };

  const handleTestMysql = async (e: React.FormEvent) => {
    e.preventDefault();
    setMysqlResult(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/database/test-mysql', {
        method: 'POST',
        body: JSON.stringify(mysqlForm),
      });
      setMysqlResult(res);
    } catch (err) {
      setMysqlResult({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل الاتصال بخادم MySQL',
      });
    }
  };

  const handleViewMysqlSchema = async () => {
    const res = await fetch('/api/database/mysql-schema');
    const txt = await res.text();
    setMysqlSchemaSql(txt);
    setShowSchemaModal(true);
  };

  const handleDownloadBackup = async () => {
    const data = await apiFetch('/api/database/export-backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tajirpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveStoreInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(storeForm),
      });
      onMutated('تم تحديث بيانات المحل الافتراضية بنجاح');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'تعذر حفظ بيانات المحل');
    }
  };

  const handleResetDemo = async () => {
    setResettingDemo(true);
    setErrMsg(null);
    try {
      await apiFetch('/api/database/reset-demo', { method: 'POST' });
      onMutated('تمت استعادة جميع البيانات الافتراضية المؤقتة للتجربة');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'فشل استعادة بيانات التجربة');
    } finally {
      setResettingDemo(false);
    }
  };

  const roles: UserRole[] = ['owner', 'manager', 'cashier'];
  const permKeys = Object.keys(PERMISSION_LABELS) as PermissionKey[];

  return (
    <div className="space-y-6">
      {/* Active User Notice */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">
            الحساب النشط حالياً: {currentUser.name} ({ROLE_LABELS[currentUser.role]})
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {canManageSecurity
              ? 'لديك صلاحيات كاملة لإدارة الأدوار، الموظفين، والترخيص.'
              : 'هذا الحساب محدود الصلاحيات — يمكنك تبديل الحساب برمز PIN لتجربة صلاحيات المالك أو المدير.'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenServerConfig && (
            <button
              type="button"
              onClick={onOpenServerConfig}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Database className="h-4 w-4 text-emerald-600" />
              <span>إعدادات الخادم وقواعد البيانات</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenUserSwitch}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
          >
            <UserCog className="h-4 w-4" />
            <span>تبديل الموظف (PIN)</span>
          </button>
        </div>
      </div>

      {errMsg && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errMsg}
        </div>
      )}

      {/* RBAC Matrix */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600" />
            <span>مصفوفة صلاحيات المستخدمين والأدوار (RBAC)</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            تُفرض هذه الصلاحيات على مستوى الخادم والواجهة معاً لحماية أسعار الشراء والأرباح وإعدادات المحل.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">الصلاحية والوظيفة</th>
                {roles.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {permKeys.map((pk) => (
                <tr key={pk}>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {PERMISSION_LABELS[pk]?.title || pk}
                    </div>
                    <div className="text-[11px] text-slate-500">{PERMISSION_LABELS[pk]?.desc || ''}</div>
                  </td>
                  {roles.map((role) => {
                    const checked = Boolean(rolePermissions[role]?.[pk]);
                    const locked =
                      !canManageSecurity ||
                      (role === 'owner' && pk === 'manage_security_rbac') ||
                      (!isOwner && (role === 'owner' || pk === 'manage_security_rbac'));
                    return (
                      <td key={role} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => handleTogglePermission(role, pk)}
                          className="h-4 w-4 accent-emerald-600 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Staff Accounts Management */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold">الموظفون والحسابات المسجلة</h3>
            <span className="text-[11px] text-slate-500 font-mono-num">
              إجمالي الحسابات: {staff.length} · المالكون النشطون: {activeOwnerCount}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {staff.map((u) => {
              const overrideCount = u.customPermissions
                ? Object.keys(u.customPermissions).length
                : 0;
              const isSelf = u.id === currentUser.id;
              const isTargetOwner = u.role === 'owner';
              const cannotTouchTarget = !canManageSecurity || (!isOwner && isTargetOwner);
              const isLastActiveOwner = isTargetOwner && u.active && activeOwnerCount <= 1;
              const cannotDisable =
                cannotTouchTarget || isSelf || u.id === 'usr-owner' || (u.active && isLastActiveOwner);
              const cannotDelete =
                cannotTouchTarget || isSelf || u.id === 'usr-owner' || isLastActiveOwner;

              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                      <span>{u.name}</span>
                      {isSelf && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          (الحساب الحالي)
                        </span>
                      )}
                      {overrideCount > 0 && (
                        <span className="font-mono-num text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          · {overrideCount} تخصيص فردي
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {ROLE_LABELS[u.role]} · آخر دخول: {formatDateTimeAr(u.lastLoginAt)} · إصدار الجلسة: v
                      <span className="font-mono-num">{u.tokenVersion || 1}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-xs font-semibold ml-1 ${
                        u.active ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {u.active ? 'نشط' : 'معطل'}
                    </span>
                    {!cannotTouchTarget && (
                      <>
                        <button
                          type="button"
                          onClick={() => openPermModal(u)}
                          title="تخصيص صلاحيات فردية لهذا الموظف"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 whitespace-nowrap"
                        >
                          <SlidersHorizontal className="h-3 w-3 text-emerald-600" />
                          <span>صلاحيات خاصة</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditStaff(u)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 whitespace-nowrap"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>تعديل / PIN</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevokeSessions(u)}
                          title="إلغاء جميع الجلسات المفتوحة وإجبار الموظف على إعادة الدخول"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-slate-700 dark:text-amber-400 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <LogOut className="h-3 w-3" />
                          <span>إنهاء الجلسات</span>
                        </button>
                      </>
                    )}
                    {!cannotDisable && (
                      <button
                        type="button"
                        onClick={() => handleToggleStaff(u)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 whitespace-nowrap"
                      >
                        {u.active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    )}
                    {!cannotDelete &&
                      (confirmDeleteUserId === u.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteStaff(u)}
                            className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 whitespace-nowrap"
                          >
                            تأكيد الحذف
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUserId(null)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 whitespace-nowrap"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUserId(u.id)}
                          title="حذف الحساب نهائياً"
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/30 whitespace-nowrap"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <form
          onSubmit={handleAddStaff}
          className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3 h-fit"
        >
          <h3 className="font-display text-sm font-bold">إضافة موظف جديد</h3>
          <div>
            <label className="block text-xs font-medium mb-1">اسم الموظف</label>
            <input
              required
              disabled={!canManageSecurity}
              value={newStaff.name}
              onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">الدور الوظيفي</label>
              <SearchableSelect
                disabled={!canManageSecurity}
                value={newStaff.role}
                onChange={(val) => setNewStaff({ ...newStaff, role: val as UserRole })}
                options={[
                  { value: 'cashier', label: 'موظف مبيعات / كاشير' },
                  { value: 'manager', label: 'مدير فرع' },
                  ...(isOwner ? [{ value: 'owner', label: 'مالك شريك' }] : []),
                ]}
                searchPlaceholder="ابحث في الأدوار..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">رمز الدخول (PIN)</label>
              <input
                required
                disabled={!canManageSecurity}
                pattern="\d{4,8}"
                placeholder="4-8 أرقام"
                value={newStaff.pin}
                onChange={(e) => setNewStaff({ ...newStaff, pin: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!canManageSecurity}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة الموظف</span>
          </button>
        </form>
      </section>

      {/* Cryptographic License & Anti-Tamper Section */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>نظام الترخيص المشفر (Ed25519 + Machine Binding)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                التراخيص موقعة رقمياً ومربوطة ببصمة الجهاز لمنع النسخ أو التزوير.
              </p>
            </div>
            <span
              className={`text-xs font-bold ${
                license.valid ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {license.valid ? 'ترخيص موثق ساري' : 'غير مفعل / تالف'}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">بصمة الجهاز الحالية</span>
              <span className="font-mono-num font-semibold">{license.machineFingerprint}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">الباقة والمدة المتبقية</span>
              <span className="font-mono-num font-semibold">
                {license.payload?.tier.toUpperCase()} · متبقي {license.daysRemaining} يوم
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-500">حالة التوقيع الرقمي</span>
              <span className="font-semibold text-emerald-600">
                {license.signatureVerified ? 'توقيع Ed25519 سليم 100%' : 'فشل التحقق'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleVerifyIntegrity}
              disabled={checkingIntegrity}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingIntegrity ? 'animate-spin' : ''}`} />
              <span>فحص سلامة الفواتير (SHA-256 Chain)</span>
            </button>
            {canManageSecurity && (
              <button
                type="button"
                onClick={() => handleIssueDemoLicense('enterprise')}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>توليد مفتاح Enterprise سنوي لهذا الجهاز</span>
              </button>
            )}
          </div>

          {integrity && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                {integrity.chainIntact ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                )}
                <span>
                  {integrity.chainIntact
                    ? `سلسلة الفواتير سليمة بالكامل (${integrity.validInvoices} / ${integrity.totalInvoicesChecked} فاتورة)`
                    : `تحذير: رصد تلاعب في ${integrity.brokenInvoiceIds.length} فواتير!`}
                </span>
              </div>
            </div>
          )}

          {canManageSecurity && (
            <form onSubmit={handleActivateLicense} className="space-y-2 pt-2">
              <label className="block text-xs font-medium">تفعيل مفتاح ترخيص موقع (TP1....)</label>
              <textarea
                rows={2}
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                placeholder={generatedKey || 'الصق مفتاح الترخيص هنا...'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono-num text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="submit"
                disabled={!licenseInput.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700"
              >
                التحقق وتفعيل الترخيص
              </button>
            </form>
          )}
        </div>

        {/* Local SQLite + External MySQL Database Config */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-600" />
                <span>قاعدة البيانات المحلية والخارجية (SQLite / MySQL)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                يعمل النظام محلياً بقاعدة SQLite فورية، ويدعم الربط بخادم MySQL خارجي للفروع.
              </p>
            </div>
            <span className="font-mono-num text-xs font-semibold text-emerald-600">
              النشط: {settings.dbDriver === 'mysql' ? 'MySQL' : 'Local SQLite'}
            </span>
          </div>

          <form onSubmit={handleTestMysql} className="grid grid-cols-2 gap-3 text-xs">
            <div className="col-span-2 sm:col-span-1">
              <label className="block font-medium mb-1">خادم MySQL (Host)</label>
              <input
                disabled={!canManageSecurity}
                value={mysqlForm.host}
                onChange={(e) => setMysqlForm({ ...mysqlForm, host: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block font-medium mb-1">المنفذ (Port)</label>
              <input
                type="number"
                disabled={!canManageSecurity}
                value={mysqlForm.port}
                onChange={(e) => setMysqlForm({ ...mysqlForm, port: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">اسم قاعدة البيانات</label>
              <input
                disabled={!canManageSecurity}
                value={mysqlForm.database}
                onChange={(e) => setMysqlForm({ ...mysqlForm, database: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">اسم المستخدم</label>
              <input
                disabled={!canManageSecurity}
                value={mysqlForm.user}
                onChange={(e) => setMysqlForm({ ...mysqlForm, user: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-medium mb-1">كلمة المرور</label>
              <input
                type="password"
                disabled={!canManageSecurity}
                value={mysqlForm.password}
                onChange={(e) => setMysqlForm({ ...mysqlForm, password: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="col-span-2 flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={!canManageSecurity}
                className="rounded-lg bg-slate-900 px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700"
              >
                اختبار الاتصال بـ MySQL
              </button>
              <button
                type="button"
                onClick={handleViewMysqlSchema}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold hover:bg-slate-50 dark:border-slate-700"
              >
                عرض هيكل MySQL SQL
              </button>
              <button
                type="button"
                onClick={handleDownloadBackup}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <Download className="h-3.5 w-3.5" />
                <span>نسخة احتياطية JSON</span>
              </button>
              {canManageSecurity && (
                <button
                  type="button"
                  disabled={resettingDemo}
                  onClick={handleResetDemo}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${resettingDemo ? 'animate-spin' : ''}`} />
                  <span>إعادة ضبط بيانات التجربة الافتراضية</span>
                </button>
              )}
            </div>
          </form>

          {mysqlResult && (
            <div
              className={`rounded-lg border p-3 text-xs ${
                mysqlResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300'
              }`}
            >
              {mysqlResult.message}
            </div>
          )}

          {/* Store Profile Quick Editor */}
          <form onSubmit={handleSaveStoreInfo} className="border-t border-slate-100 pt-4 dark:border-slate-800 space-y-3 text-xs">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              بيانات المحل الأساسية
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block mb-1 text-slate-500">اسم المحل</label>
                <input
                  disabled={!canManageSecurity}
                  value={storeForm.storeName}
                  onChange={(e) => setStoreForm({ ...storeForm, storeName: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">رقم الهاتف</label>
                <input
                  disabled={!canManageSecurity}
                  value={storeForm.phone}
                  onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">العنوان</label>
                <input
                  disabled={!canManageSecurity}
                  value={storeForm.address}
                  onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">الرقم الضريبي (اختياري)</label>
                <input
                  disabled={!canManageSecurity}
                  value={storeForm.taxNumber}
                  onChange={(e) => setStoreForm({ ...storeForm, taxNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>
            {canManageSecurity && (
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700"
              >
                حفظ بيانات المحل
              </button>
            )}
          </form>
        </div>
      </section>

      {/* Security Audit Log Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <History className="h-4 w-4 text-emerald-600" />
              <span>سجل التدقيق الأمني والرقابي (Security Audit Log)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              توثيق آلي لكافة عمليات تسجيل الدخول وتعديل الصلاحيات واستيراد البيانات وإعدادات القاعدة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="بحث في السجل..."
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            />
            <select
              value={auditCatFilter}
              onChange={(e) => setAuditCatFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">كل التصنيفات</option>
              <option value="auth">تسجيل الدخول</option>
              <option value="rbac">الصلاحيات والموظفين</option>
              <option value="security">الأمان والترخيص</option>
              <option value="settings">الإعدادات</option>
              <option value="data">البيانات و Excel</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-right text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">التاريخ والوقت</th>
                <th className="px-3 py-2">الموظف</th>
                <th className="px-3 py-2">التصنيف</th>
                <th className="px-3 py-2">العملية المنفذة</th>
                <th className="px-3 py-2">الهدف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAuditLogs.slice(0, auditVisibleCount).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-2 font-mono-num text-slate-500">{formatDateTimeAr(log.timestamp)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{log.actorName}</td>
                  <td className="px-3 py-2 font-mono-num text-slate-500">{log.category}</td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{log.action}</td>
                  <td className="px-3 py-2 font-mono-num text-slate-500">{log.target || '—'}</td>
                </tr>
              ))}
              {filteredAuditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    لا توجد سجلات مطابقة لعوامل التصفية الحالية
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {auditVisibleCount < filteredAuditLogs.length && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setAuditVisibleCount((c) => c + 25)}
              className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700"
            >
              عرض المزيد ({filteredAuditLogs.length - auditVisibleCount} سجل متبقي)
            </button>
          </div>
        )}
      </section>

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveStaffEdit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold">تعديل بيانات الموظف: {editingStaff.name}</h3>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">الاسم الكامل</label>
                <input
                  required
                  value={editStaffForm.name}
                  onChange={(e) => setEditStaffForm({ ...editStaffForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">الدور الوظيفي</label>
                <SearchableSelect
                  value={editStaffForm.role}
                  disabled={
                    editingStaff.id === 'usr-owner' ||
                    (editingStaff.role === 'owner' && editingStaff.active && activeOwnerCount <= 1)
                  }
                  onChange={(val) => setEditStaffForm({ ...editStaffForm, role: val as UserRole })}
                  options={[
                    { value: 'cashier', label: 'موظف مبيعات / كاشير' },
                    { value: 'manager', label: 'مدير فرع' },
                    ...(isOwner || editingStaff.role === 'owner'
                      ? [{ value: 'owner', label: 'مالك شريك' }]
                      : []),
                  ]}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">إعادة تعيين رمز الدخول (PIN) اختياري</label>
                <input
                  pattern="\d{4,8}"
                  placeholder="اتركه فارغاً للإبقاء على الرمز الحالي"
                  value={editStaffForm.newPin}
                  onChange={(e) => setEditStaffForm({ ...editStaffForm, newPin: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              {editingStaff.id !== 'usr-owner' &&
                editingStaff.id !== currentUser.id &&
                !(editingStaff.role === 'owner' && editingStaff.active && activeOwnerCount <= 1) && (
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editStaffForm.active}
                    onChange={(e) => setEditStaffForm({ ...editStaffForm, active: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="font-semibold">الحساب نشط ومسموح له بالدخول</span>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                حفظ التعديلات
              </button>
            </div>
          </form>
        </div>
      )}

      {showSchemaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">هيكل جداول MySQL 8.0 الإنتاجي</h3>
              <button
                type="button"
                onClick={() => setShowSchemaModal(false)}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold dark:border-slate-700"
              >
                إغلاق
              </button>
            </div>
            <pre
              dir="ltr"
              className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 font-mono-num text-xs text-emerald-300"
            >
              {mysqlSchemaSql}
            </pre>
          </div>
        </div>
      )}

      {/* Per-User Custom Permission Overrides Modal */}
      {permModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <form
            onSubmit={handleSaveCustomPerms}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-bold">
                  الصلاحيات الفردية الخاصة: {permModalUser.name}
                </h3>
                <p className="text-xs text-slate-500">
                  الدور الأساسي: {ROLE_LABELS[permModalUser.role]} — يمكنك منح صلاحية استثنائية أو سحب صلاحية محددة لهذا الموظف فقط.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPermModalUser(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {permKeys.map((pk) => {
                const roleDefault = Boolean(rolePermissions[permModalUser.role]?.[pk]);
                const val = permOverridesDraft[pk] ?? null;
                const locked =
                  (permModalUser.id === 'usr-owner' && pk === 'manage_security_rbac') ||
                  (!isOwner && pk === 'manage_security_rbac');
                return (
                  <div key={pk} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {PERMISSION_LABELS[pk]?.title || pk}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        افتراضي الدور ({ROLE_LABELS[permModalUser.role]}):{' '}
                        <span className={roleDefault ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                          {roleDefault ? 'مسموح' : 'ممنوع'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setPermOverridesDraft({ ...permOverridesDraft, [pk]: null })}
                        className={`rounded-md border px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                          val === null
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'
                        } disabled:opacity-40`}
                      >
                        وراثة الدور
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setPermOverridesDraft({ ...permOverridesDraft, [pk]: true })}
                        className={`rounded-md border px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                          val === true
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-200 text-slate-600 hover:bg-emerald-50 dark:border-slate-700 dark:text-slate-300'
                        } disabled:opacity-40`}
                      >
                        سماح استثنائي
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setPermOverridesDraft({ ...permOverridesDraft, [pk]: false })}
                        className={`rounded-md border px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                          val === false
                            ? 'border-rose-600 bg-rose-600 text-white'
                            : 'border-slate-200 text-slate-600 hover:bg-rose-50 dark:border-slate-700 dark:text-slate-300'
                        } disabled:opacity-40`}
                      >
                        منع استثنائي
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPermModalUser(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                اعتماد الصلاحيات الفردية
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
