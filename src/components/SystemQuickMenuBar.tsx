import {
  BookOpen,
  ChevronDown,
  FileSpreadsheet,
  FolderKanban,
  HelpCircle,
  Layers,
  PlayCircle,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReportSubTab, RolePermissionsMap, StaffUser } from '../shared/types';
import { getEffectivePermissions } from '../utils/formatters';
import type { HelpModalTab } from './HelpCenterModal';
import type { NavTabId } from './Sidebar';

export type QuickMenuKey = 'file' | 'coding' | 'operations' | 'reports' | 'settings' | 'help';

export type SettingsTargetTab =
  | 'store_activity'
  | 'pos_policies'
  | 'treasuries'
  | 'templates'
  | 'payments'
  | 'data_xlsx'
  | 'server_license';

export type PartnersTargetTab = 'customers' | 'suppliers' | 'epayments';

export type InventoryTargetModal = 'add_product' | 'batches' | 'promotions' | 'stocktake' | 'movements';

interface QuickMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick: () => void;
}

interface SystemQuickMenuBarProps {
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  sidebarVisible: boolean;
  darkMode: boolean;
  onOpenTab: (viewId: NavTabId, options?: { forceNew?: boolean }) => void;
  onOpenInventoryModal: (modal: InventoryTargetModal) => void;
  onOpenPartnersTab: (tab: PartnersTargetTab) => void;
  onOpenReportsTab: (tab: ReportSubTab) => void;
  onOpenSettingsTab: (tab: SettingsTargetTab) => void;
  onOpenQuotations?: () => void;
  onOpenShiftClosing: () => void;
  onOpenStoreProfile: () => void;
  onOpenServerConfig: () => void;
  onOpenUserSwitch: () => void;
  onLockScreen: () => void;
  onPrintCurrent: () => void;
  onDownloadBackup: () => void;
  onCloseUnpinnedTabs: () => void;
  onOpenCommandPalette: () => void;
  onToggleSidebar: () => void;
  onToggleDark: () => void;
  onOpenHelp: (tab: HelpModalTab) => void;
}

export function SystemQuickMenuBar({
  currentUser,
  rolePermissions,
  sidebarVisible,
  darkMode,
  onOpenTab,
  onOpenInventoryModal,
  onOpenPartnersTab,
  onOpenReportsTab,
  onOpenSettingsTab,
  onOpenQuotations,
  onOpenShiftClosing,
  onOpenStoreProfile,
  onOpenServerConfig,
  onOpenUserSwitch,
  onLockScreen,
  onPrintCurrent,
  onDownloadBackup,
  onCloseUnpinnedTabs,
  onOpenCommandPalette,
  onToggleSidebar,
  onToggleDark,
  onOpenHelp,
}: SystemQuickMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<QuickMenuKey | null>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({
    top: 38,
    left: 16,
    width: 280,
  });

  const barRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<QuickMenuKey, HTMLButtonElement | null>>({
    file: null,
    coding: null,
    operations: null,
    reports: null,
    settings: null,
    help: null,
  });

  const perms = getEffectivePermissions(currentUser, rolePermissions);
  const canSettingsOrData = Boolean(perms.manage_settings || perms.manage_data_xlsx);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  const openDropdownFor = (key: QuickMenuKey) => {
    const btn = btnRefs.current[key];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const dropdownWidth = Math.min(288, window.innerWidth - 16);
      // In RTL, align dropdown right edge with button right edge while clamping inside viewport
      const desiredLeft = rect.right - dropdownWidth;
      const clampedLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - dropdownWidth - 8));
      setDropdownCoords({
        top: rect.bottom + 2,
        left: clampedLeft,
        width: dropdownWidth,
      });
    }
    setOpenMenu(key);
  };

  const toggleMenu = (key: QuickMenuKey) => {
    if (openMenu === key) {
      setOpenMenu(null);
    } else {
      openDropdownFor(key);
    }
  };

  const runAction = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  const menus: Array<{
    key: QuickMenuKey;
    label: string;
    icon: typeof FolderKanban;
    items: QuickMenuItem[];
  }> = [
    {
      key: 'file',
      label: 'ملف',
      icon: FolderKanban,
      items: [
        {
          label: 'ملخص المحل اليومي (الرئيسية)',
          shortcut: 'Alt+1',
          onClick: () => onOpenTab('dashboard'),
        },
        {
          label: 'فتح تبويب كاشير جديد (موازي)',
          shortcut: 'Ctrl+Shift+N',
          disabled: !perms.pos_sell,
          onClick: () => onOpenTab('pos', { forceNew: true }),
        },
        {
          label: 'تبديل الموظف (PIN)',
          shortcut: 'Ctrl+U',
          divider: true,
          onClick: onOpenUserSwitch,
        },
        {
          label: 'قفل الشاشة (تسجيل الخروج)',
          onClick: onLockScreen,
        },
        {
          label: 'طباعة الشاشة الحالية',
          shortcut: 'Ctrl+P',
          divider: true,
          onClick: onPrintCurrent,
        },
        {
          label: 'تصدير نسخة احتياطية كاملة (JSON)',
          disabled: !perms.manage_data_xlsx,
          onClick: onDownloadBackup,
        },
        {
          label: 'إغلاق التبويبات غير المثبتة',
          divider: true,
          onClick: onCloseUnpinnedTabs,
        },
      ],
    },
    {
      key: 'coding',
      label: 'تكويد',
      icon: Layers,
      items: [
        {
          label: 'تكويد صنف جديد (المخزون والأسعار)',
          disabled: !perms.edit_prices_stock,
          onClick: () => onOpenInventoryModal('add_product'),
        },
        {
          label: 'دليل الأصناف والأسعار والمخزون',
          shortcut: 'Alt+3',
          onClick: () => onOpenTab('inventory'),
        },
        {
          label: 'تكويد التشغيلات وتواريخ الصلاحية (FEFO)',
          onClick: () => onOpenInventoryModal('batches'),
        },
        {
          label: 'تكويد العروض الترويجية والخصومات',
          onClick: () => onOpenInventoryModal('promotions'),
        },
        {
          label: 'تكويد العملاء والحد الائتماني',
          shortcut: 'Alt+6',
          divider: true,
          disabled: !perms.manage_partners,
          onClick: () => onOpenPartnersTab('customers'),
        },
        {
          label: 'تكويد الموردين وجهات التوريد',
          disabled: !perms.manage_partners,
          onClick: () => onOpenPartnersTab('suppliers'),
        },
        {
          label: 'تكويد الخزائن وحسابات الدفع',
          divider: true,
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('treasuries'),
        },
        {
          label: 'تكويد الشركاء ورأس المال وحصص الأرباح',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('equity_partners'),
        },
      ],
    },
    {
      key: 'operations',
      label: 'عمليات',
      icon: PlayCircle,
      items: [
        {
          label: 'شاشة نقطة البيع (الكاشير)',
          shortcut: 'F2',
          disabled: !perms.pos_sell,
          onClick: () => onOpenTab('pos'),
        },
        {
          label: 'فاتورة مبيعات مكتبية (جدول الأصناف)',
          shortcut: 'F3',
          disabled: !perms.pos_sell,
          onClick: () => onOpenTab('sales_invoice'),
        },
        {
          label: 'عروض الأسعار والفواتير المبدئية',
          disabled: !perms.pos_sell,
          onClick: () => (onOpenQuotations ? onOpenQuotations() : onOpenTab('sales_invoice')),
        },
        {
          label: 'فواتير المبيعات والمرتجعات والاستبدال',
          shortcut: 'Alt+4',
          onClick: () => onOpenTab('invoices'),
        },
        {
          label: 'المشتريات وفواتير التوريد',
          shortcut: 'Alt+8',
          divider: true,
          disabled: !perms.manage_purchases,
          onClick: () => onOpenTab('purchases'),
        },
        {
          label: 'جرد المخزون الفعلي وتسوية الأرصدة',
          disabled: !perms.edit_prices_stock,
          onClick: () => onOpenInventoryModal('stocktake'),
        },
        {
          label: 'سجل حركة الأصناف التفصيلي',
          onClick: () => onOpenInventoryModal('movements'),
        },
        {
          label: 'المصروفات والنثريات والخزينة',
          shortcut: 'Alt+9',
          divider: true,
          disabled: !perms.manage_expenses,
          onClick: () => onOpenTab('expenses'),
        },
        {
          label: 'التحصيلات وسداد الموردين والمدفوعات',
          disabled: !perms.manage_partners,
          onClick: () => onOpenPartnersTab('epayments'),
        },
        {
          label: 'تقفيل الوردية وجرد الدرج (Z-Report)',
          divider: true,
          disabled: !perms.pos_sell,
          onClick: onOpenShiftClosing,
        },
      ],
    },
    {
      key: 'reports',
      label: 'تقارير',
      icon: FileSpreadsheet,
      items: [
        {
          label: 'ملخص صاحب العمل الشامل',
          shortcut: 'Alt+5',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('executive_overview'),
        },
        {
          label: 'قائمة الأرباح والخسائر التفصيلية (P&L)',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('profit_loss'),
        },
        {
          label: 'محاكاة الأرباح والتكاليف (What-If)',
          disabled: !perms.view_reports || !perms.view_profits_costs,
          onClick: () => onOpenReportsTab('what_if_analysis'),
        },
        {
          label: 'حصص الشركاء وتوزيعات الأرباح',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('equity_partners'),
        },
        {
          label: 'المبيعات اليومية والشهرية والسنوية',
          divider: true,
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('sales_profit'),
        },
        {
          label: 'أرباح الأصناف بالتكلفة التاريخية',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('product_profit'),
        },
        {
          label: 'الأصناف الراكدة ومعدل دوران المخزون',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('slow_moving'),
        },
        {
          label: 'تقرير جرد وحالة المخزون',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('inventory_health'),
        },
        {
          label: 'المركز المالي والخزائن والذمم',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('financial_summary'),
        },
        {
          label: 'منشئ التقارير المخصصة',
          divider: true,
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('custom_report'),
        },
        {
          label: 'جدولة التقارير اليومية والأسبوعية',
          disabled: !perms.view_reports,
          onClick: () => onOpenReportsTab('scheduled_reports'),
        },
      ],
    },
    {
      key: 'settings',
      label: 'إعدادات',
      icon: Settings,
      items: [
        {
          label: 'بيانات المحل وترويسة الطباعة',
          disabled: !perms.manage_settings,
          onClick: onOpenStoreProfile,
        },
        {
          label: 'النشاط التجاري والبيانات العامة',
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('store_activity'),
        },
        {
          label: 'سياسات الكاشير ونقاط الولاء',
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('pos_policies'),
        },
        {
          label: 'قوالب الطباعة والتقارير (A4 / 80mm)',
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('templates'),
        },
        {
          label: 'بوابات الدفع وعمولات البطاقات',
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('payments'),
        },
        {
          label: 'استيراد وتصدير Excel الشامل',
          shortcut: 'Alt+0',
          disabled: !canSettingsOrData,
          onClick: () => onOpenSettingsTab('data_xlsx'),
        },
        {
          label: 'إدارة الصلاحيات والمستخدمين والترخيص',
          shortcut: 'Alt+7',
          divider: true,
          disabled: !perms.manage_security_rbac,
          onClick: () => onOpenTab('security_license'),
        },
        {
          label: 'إعدادات الخادم وقواعد البيانات (SQLite / MySQL)',
          onClick: onOpenServerConfig,
        },
      ],
    },
    {
      key: 'help',
      label: 'مساعدة',
      icon: HelpCircle,
      items: [
        {
          label: 'دليل استخدام النظام وخريطة العمل',
          onClick: () => onOpenHelp('guide'),
        },
        {
          label: 'اختصارات لوحة المفاتيح السريعة',
          onClick: () => onOpenHelp('shortcuts'),
        },
        {
          label: 'البحث الشامل والأوامر السريعة',
          shortcut: 'Ctrl+K',
          divider: true,
          onClick: onOpenCommandPalette,
        },
        {
          label: sidebarVisible ? 'إخفاء الشريط الجانبي' : 'إظهار الشريط الجانبي',
          shortcut: 'Ctrl+B',
          onClick: onToggleSidebar,
        },
        {
          label: darkMode ? 'التبديل للوضع الفاتح' : 'التبديل للوضع الداكن',
          onClick: onToggleDark,
        },
        {
          label: 'حول تاجر برو ومعلومات الترخيص',
          divider: true,
          onClick: () => onOpenHelp('about'),
        },
      ],
    },
  ];

  const activeMenuObj = openMenu ? menus.find((m) => m.key === openMenu) : null;

  return (
    <div
      ref={barRef}
      className="no-print flex min-h-[40px] lg:min-h-[34px] items-center justify-between gap-2 border-b border-slate-200 bg-slate-100/95 px-2 sm:px-3 text-xs select-none dark:border-slate-800 dark:bg-slate-950"
      role="menubar"
      aria-label="القائمة السريعة لتقسيم استخدام النظام"
    >
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar py-0.5">
        {menus.map((menu) => {
          const Icon = menu.icon;
          const isOpen = openMenu === menu.key;
          return (
            <button
              key={menu.key}
              ref={(el) => {
                btnRefs.current[menu.key] = el;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => toggleMenu(menu.key)}
              onMouseEnter={() => {
                if (openMenu !== null && openMenu !== menu.key) {
                  openDropdownFor(menu.key);
                }
              }}
              className={`inline-flex min-h-[36px] lg:min-h-[28px] items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1 font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isOpen
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-700 hover:bg-slate-200/80 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isOpen ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
              <span>{menu.label}</span>
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : 'opacity-60'}`} />
            </button>
          );
        })}
      </div>

      <div className="hidden xl:flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
        <BookOpen className="h-3.5 w-3.5 text-slate-400" />
        <span>التقسيم السريع للنظام</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono-num">F2 الكاشير</span>
        <span aria-hidden="true">/</span>
        <span className="font-mono-num">Ctrl+K بحث</span>
      </div>

      {activeMenuObj && (
        <div
          role="menu"
          style={{
            top: dropdownCoords.top,
            left: dropdownCoords.left,
            width: dropdownCoords.width,
          }}
          className="fixed z-50 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="px-3.5 py-1 text-[11px] font-bold text-slate-400 dark:text-slate-500">
            قائمة {activeMenuObj.label}
          </div>
          {activeMenuObj.items.map((item, idx) => (
            <div key={idx}>
              {item.divider && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => runAction(item.onClick)}
                className="flex w-full min-h-[38px] lg:min-h-[32px] items-center justify-between gap-3 px-3.5 py-1.5 text-right text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-emerald-300"
              >
                <span className="truncate">{item.label}</span>
                {item.shortcut && (
                  <span className="font-mono-num text-[11px] text-slate-400 shrink-0" dir="ltr">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
