import { BarChart3, Boxes, LayoutDashboard, Menu, ShoppingCart } from 'lucide-react';
import type { RolePermissionsMap, StaffUser } from '../shared/types';
import { getEffectivePermissions } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

interface MobileBottomNavProps {
  activeTab: NavTabId;
  currentUser: StaffUser;
  rolePermissions: RolePermissionsMap;
  lowStockCount: number;
  onSelectTab: (tab: NavTabId) => void;
  onOpenMore: () => void;
}

export function MobileBottomNav({
  activeTab,
  currentUser,
  rolePermissions,
  lowStockCount,
  onSelectTab,
  onOpenMore,
}: MobileBottomNavProps) {
  const perms = getEffectivePermissions(currentUser, rolePermissions);

  const items: Array<{
    id: NavTabId | 'more';
    label: string;
    icon: typeof LayoutDashboard;
    disabled?: boolean;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
    { id: 'pos', label: 'الكاشير', icon: ShoppingCart, disabled: !perms.pos_sell },
    {
      id: 'inventory',
      label: 'المخزون',
      icon: Boxes,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
    },
    { id: 'reports', label: 'التقارير', icon: BarChart3, disabled: !perms.view_reports },
    { id: 'more', label: 'المزيد', icon: Menu },
  ];

  return (
    <nav
      aria-label="التنقل السريع على الهاتف"
      className="no-print lg:hidden shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id !== 'more' && activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.id === 'more') {
                  onOpenMore();
                } else if (!item.disabled) {
                  onSelectTab(item.id);
                }
              }}
              className={`relative flex min-h-[54px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {item.badge !== undefined && (
                  <span className="font-mono-num absolute -top-1.5 -left-2.5 rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-tight text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="truncate max-w-full">{item.label}</span>
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-b bg-emerald-600 dark:bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
