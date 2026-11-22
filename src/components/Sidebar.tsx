import {
  BarChart3,
  Boxes,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  PanelRightClose,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { PermissionKey, RolePermissionsMap, StaffUser, StoreActivityProfile, StoreSettings } from '../shared/types';
import { getEffectivePermissions, ROLE_LABELS } from '../utils/formatters';

export type NavTabId =
  | 'dashboard'
  | 'pos'
  | 'sales_invoice'
  | 'inventory'
  | 'purchases'
  | 'invoices'
  | 'expenses'
  | 'reports'
  | 'partners_payments'
  | 'security_license'
  | 'settings_data';

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  settings: StoreSettings;
  activeActivity: StoreActivityProfile;
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  lowStockCount: number;
  desktopVisible: boolean;
  onToggleDesktopSidebar: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenUserSwitch: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  settings,
  activeActivity,
  currentUser,
  rolePermissions,
  lowStockCount,
  desktopVisible,
  onToggleDesktopSidebar,
  mobileOpen,
  onCloseMobile,
  onOpenUserSwitch,
}: SidebarProps) {
  const userPerms = getEffectivePermissions(currentUser, rolePermissions);
  const hasPerm = (perm?: PermissionKey | 'settings_or_data') => {
    if (!perm) return true;
    if (perm === 'settings_or_data') {
      return Boolean(userPerms.manage_settings || userPerms.manage_data_xlsx);
    }
    return Boolean(userPerms[perm]);
  };

  const navItems: Array<{
    id: NavTabId;
    label: string;
    icon: typeof LayoutDashboard;
    requiredPerm?: PermissionKey | 'settings_or_data';
    countHint?: number;
  }> = [
    { id: 'dashboard', label: 'ملخص المحل', icon: LayoutDashboard },
    { id: 'pos', label: 'الكاشير والبيع السريع', icon: ShoppingCart, requiredPerm: 'pos_sell' },
    { id: 'sales_invoice', label: 'فاتورة مبيعات (جدول)', icon: FileSpreadsheet, requiredPerm: 'pos_sell' },
    {
      id: 'inventory',
      label: 'المخزون والأسعار',
      icon: Boxes,
      countHint: lowStockCount > 0 ? lowStockCount : undefined,
    },
    {
      id: 'purchases',
      label: 'المشتريات والتوريد',
      icon: Truck,
      requiredPerm: 'manage_purchases',
    },
    { id: 'invoices', label: 'الفواتير والأرباح', icon: FileText },
    {
      id: 'expenses',
      label: 'المصروفات والخزينة',
      icon: Wallet,
      requiredPerm: 'manage_expenses',
    },
    { id: 'reports', label: 'التقارير الشاملة', icon: BarChart3, requiredPerm: 'view_reports' },
    {
      id: 'partners_payments',
      label: 'العملاء والدفع الإلكتروني',
      icon: Users,
      requiredPerm: 'manage_partners',
    },
    {
      id: 'settings_data',
      label: 'الإعدادات والبيانات والنماذج',
      icon: Settings,
      requiredPerm: 'settings_or_data',
    },
    {
      id: 'security_license',
      label: 'الصلاحيات والترخيص',
      icon: ShieldCheck,
      requiredPerm: 'manage_security_rbac',
    },
  ];

  const content = (
    <aside className="flex h-full w-64 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
        <div className="min-w-0">
          <div className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white truncate">
            تاجر برو
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            {settings.storeName} · {activeActivity.nameAr}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleDesktopSidebar}
          title="إخفاء الشريط الجانبي (Ctrl+B)"
          className="hidden lg:flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="إخفاء الشريط الجانبي"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="إغلاق القائمة"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const allowed = hasPerm(item.requiredPerm);
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!allowed}
              onClick={() => {
                if (!allowed) return;
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                  : allowed
                    ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                    : 'cursor-not-allowed text-slate-400 opacity-50 dark:text-slate-600'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.countHint !== undefined && (
                <span className="font-mono-num text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {item.countHint} نواقص
                </span>
              )}
              {!allowed && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">مقيد</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onOpenUserSwitch}
          className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-right transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-800"
        >
          <img
            src="/src/assets/images/avatar_store_owner_1794938311404.jpg"
            alt={currentUser.name}
            referrerPolicy="no-referrer"
            className="h-10 w-10 shrink-0 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {currentUser.name}
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              {ROLE_LABELS[currentUser.role]} · تبديل الحساب
            </div>
          </div>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {desktopVisible && <div className="hidden lg:block lg:shrink-0">{content}</div>}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/50" onClick={onCloseMobile} />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
