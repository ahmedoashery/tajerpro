import {
  BarChart3,
  Boxes,
  Copy,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Pin,
  PinOff,
  Plus,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RolePermissionsMap, StaffUser } from '../shared/types';
import { getEffectivePermissions } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

export interface WorkspaceTab {
  id: string;
  viewId: NavTabId;
  title: string;
  pinned: boolean;
}

interface TabStripProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onTogglePinTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseUnpinnedTabs: () => void;
  onOpenNewTab: (viewId: NavTabId, options?: { forceNew?: boolean }) => void;
}

const VIEW_ICONS: Record<NavTabId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  sales_invoice: FileSpreadsheet,
  inventory: Boxes,
  purchases: Truck,
  invoices: FileText,
  expenses: Wallet,
  reports: BarChart3,
  partners_payments: Users,
  security_license: ShieldCheck,
  settings_data: Settings,
};

export function TabStrip({
  tabs,
  activeTabId,
  currentUser,
  rolePermissions,
  onActivateTab,
  onCloseTab,
  onTogglePinTab,
  onDuplicateTab,
  onCloseOtherTabs,
  onCloseUnpinnedTabs,
  onOpenNewTab,
}: TabStripProps) {
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);

  const newTabRef = useRef<HTMLDivElement>(null);
  const perms = getEffectivePermissions(currentUser, rolePermissions);

  useEffect(() => {
    const closeMenus = (e: MouseEvent) => {
      setContextMenu(null);
      if (newTabRef.current && !newTabRef.current.contains(e.target as Node)) {
        setNewTabMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  const targetContextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  const quickTabs: Array<{ viewId: NavTabId; label: string; allowed: boolean }> = [
    { viewId: 'pos', label: 'تبويب كاشير جديد', allowed: Boolean(perms.pos_sell) },
    { viewId: 'sales_invoice', label: 'فاتورة مبيعات (جدول الأصناف)', allowed: Boolean(perms.pos_sell) },
    { viewId: 'inventory', label: 'المخزون والأسعار', allowed: true },
    { viewId: 'purchases', label: 'المشتريات والتوريد', allowed: Boolean(perms.manage_purchases) },
    { viewId: 'invoices', label: 'الفواتير والأرباح', allowed: true },
    { viewId: 'expenses', label: 'المصروفات والخزينة', allowed: Boolean(perms.manage_expenses) },
    { viewId: 'reports', label: 'التقارير الشاملة', allowed: Boolean(perms.view_reports) },
    {
      viewId: 'partners_payments',
      label: 'العملاء والدفع الإلكتروني',
      allowed: Boolean(perms.manage_partners),
    },
    {
      viewId: 'settings_data',
      label: 'الإعدادات والبيانات والنماذج',
      allowed: Boolean(perms.manage_settings || perms.manage_data_xlsx),
    },
    {
      viewId: 'security_license',
      label: 'الصلاحيات والترخيص',
      allowed: Boolean(perms.manage_security_rbac),
    },
  ];

  return (
    <div className="no-print hidden sm:flex items-end gap-1 border-b border-slate-200 bg-slate-100/90 px-3 pt-1.5 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-1 items-end gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = VIEW_ICONS[tab.viewId];
          const active = tab.id === activeTabId;
          const canClose = tabs.length > 1 && !tab.pinned;

          return (
            <div
              key={tab.id}
              onClick={() => onActivateTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              className={`group flex h-9 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs transition-colors select-none ${
                active
                  ? 'border-slate-200 bg-slate-50 font-bold text-emerald-700 dark:border-slate-800 dark:bg-slate-900 dark:text-emerald-400'
                  : 'border-transparent bg-slate-200/60 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:bg-slate-800/70'
              }`}
              title="انقر بالزر الأيمن لخيارات التبويب (تثبيت / تكرار / إغلاق)"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{tab.title}</span>

              {tab.pinned && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePinTab(tab.id);
                  }}
                  title="تبويب مثبت — انقر لإلغاء التثبيت"
                  className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 shrink-0"
                >
                  <Pin className="h-3 w-3" />
                </button>
              )}

              {canClose && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  aria-label={`إغلاق ${tab.title}`}
                  className="rounded p-0.5 text-slate-400 opacity-75 hover:bg-slate-300/60 hover:text-slate-900 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-white shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add New Tab Menu */}
      <div className="relative pb-1 shrink-0" ref={newTabRef}>
        <button
          type="button"
          onClick={() => setNewTabMenuOpen((o) => !o)}
          title="فتح تبويب جديد"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
        </button>

        {newTabMenuOpen && (
          <div className="absolute left-0 top-9 z-50 w-56 rounded-lg border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-400">
              فتح نافذة / تبويب جديد
            </div>
            {quickTabs.map((qt) => (
              <button
                key={qt.viewId}
                type="button"
                disabled={!qt.allowed}
                onClick={() => {
                  setNewTabMenuOpen(false);
                  onOpenNewTab(qt.viewId, { forceNew: qt.viewId === 'pos' });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span>{qt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Right-Click Context Menu */}
      {contextMenu && targetContextTab && (
        <div
          style={{ left: Math.max(8, contextMenu.x - 160), top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 text-xs"
        >
          <button
            type="button"
            onClick={() => {
              onTogglePinTab(targetContextTab.id);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {targetContextTab.pinned ? (
              <>
                <PinOff className="h-3.5 w-3.5 text-slate-500" />
                <span>إلغاء تثبيت التبويب</span>
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5 text-emerald-600" />
                <span>تثبيت التبويب</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onDuplicateTab(targetContextTab.id);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Copy className="h-3.5 w-3.5 text-slate-500" />
            <span>تكرار في تبويب موازي</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          {!targetContextTab.pinned && tabs.length > 1 && (
            <button
              type="button"
              onClick={() => {
                onCloseTab(targetContextTab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-right text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <X className="h-3.5 w-3.5" />
              <span>إغلاق التبويب</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onCloseOtherTabs(targetContextTab.id);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span>إغلاق التبويبات الأخرى</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onCloseUnpinnedTabs();
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-right hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span>إغلاق غير المثبتة</span>
          </button>
        </div>
      )}
    </div>
  );
}
