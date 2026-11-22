import { AlertTriangle, Database, PanelRight, ShieldCheck, User, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LicenseStatus, StaffUser, StoreActivityProfile, StoreSettings } from '../shared/types';
import { ROLE_LABELS } from '../utils/formatters';
import type { NavTabId } from './Sidebar';

interface StatusBarProps {
  wsConnected: boolean;
  connectedTerminals: number;
  settings: StoreSettings;
  activeActivity: StoreActivityProfile;
  currentUser: StaffUser;
  license: LicenseStatus;
  lowStockTotal: number;
  openTabCount: number;
  sidebarVisible: boolean;
  onOpenTab: (viewId: NavTabId) => void;
  onOpenUserSwitch: () => void;
  onToggleSidebar: () => void;
  onOpenServerConfig?: (tab: 'database' | 'license') => void;
}

export function StatusBar({
  wsConnected,
  connectedTerminals,
  settings,
  activeActivity,
  currentUser,
  license,
  lowStockTotal,
  openTabCount,
  sidebarVisible,
  onOpenTab,
  onOpenUserSwitch,
  onToggleSidebar,
  onOpenServerConfig,
}: StatusBarProps) {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <footer className="no-print hidden md:flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-600 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5 font-medium">
          {wsConnected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-rose-600" />
          )}
          <span>
            {wsConnected
              ? `مزامنة لحظية (${connectedTerminals} جهاز)`
              : 'غير متصل بالخادم'}
          </span>
        </span>

        <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() => onOpenTab('dashboard')}
          className="hover:text-slate-900 dark:hover:text-white"
        >
          النشاط: <strong className="text-slate-800 dark:text-slate-200">{activeActivity.nameAr}</strong>
        </button>

        <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={onOpenUserSwitch}
          className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
        >
          <User className="h-3 w-3" />
          <span>
            {currentUser.name} ({ROLE_LABELS[currentUser.role]})
          </span>
        </button>

        {lowStockTotal > 0 && (
          <>
            <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" />
            <button
              type="button"
              onClick={() => onOpenTab('inventory')}
              className="flex items-center gap-1 font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" />
              <span className="font-mono-num">{lowStockTotal} أصناف منخفضة</span>
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden lg:flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
        >
          <PanelRight className="h-3 w-3" />
          <span>الشريط الجانبي: {sidebarVisible ? 'ظاهر' : 'مخفي'}</span>
        </button>

        <span className="hidden lg:inline h-3 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() => (onOpenServerConfig ? onOpenServerConfig('database') : onOpenTab('security_license'))}
          className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
        >
          <Database className="h-3 w-3" />
          <span>{settings.dbDriver === 'mysql' ? 'MySQL خارجي' : 'SQLite محلي'}</span>
        </button>

        <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() => (onOpenServerConfig ? onOpenServerConfig('license') : onOpenTab('security_license'))}
          className={`flex items-center gap-1 font-medium ${
            license.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
          }`}
        >
          <ShieldCheck className="h-3 w-3" />
          <span className="font-mono-num">
            {license.valid ? `ترخيص ساري (${license.daysRemaining} يوم)` : 'ترخيص غير صالح'}
          </span>
        </button>

        <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" />

        <span className="font-mono-num">
          {openTabCount} تبويب · {clockText}
        </span>
      </div>
    </footer>
  );
}
