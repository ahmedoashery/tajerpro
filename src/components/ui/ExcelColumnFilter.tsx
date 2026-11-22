import { ArrowDownAZ, ArrowUpZA, Check, Filter, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export interface ExcelColumnDef<T> {
  key: string;
  label: string;
  getValue: (row: T) => string;
  getSortValue?: (row: T) => string | number;
}

export type SortDirection = 'asc' | 'desc' | null;

export interface ExcelSortState {
  columnKey: string;
  direction: SortDirection;
}

export function useExcelTableFilter<T>(
  rows: T[],
  columns: ExcelColumnDef<T>[]
) {
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [sortState, setSortState] = useState<ExcelSortState>({ columnKey: '', direction: null });

  const columnMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  // Distinct values for a given column computed from rows filtered by OTHER columns (true Excel cascade)
  const getColumnOptions = (targetKey: string): Array<{ value: string; count: number }> => {
    const targetCol = columnMap.get(targetKey);
    if (!targetCol) return [];

    const counts = new Map<string, number>();
    for (const row of rows) {
      let passesOther = true;
      for (const [k, allowedSet] of Object.entries(columnFilters)) {
        if (k === targetKey) continue;
        const col = columnMap.get(k);
        if (!col) continue;
        if (!allowedSet.has(col.getValue(row))) {
          passesOther = false;
          break;
        }
      }
      if (!passesOther) continue;
      const val = targetCol.getValue(row);
      counts.set(val, (counts.get(val) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value, 'ar'));
  };

  const filteredAndSortedRows = useMemo(() => {
    const activeEntries = Object.entries(columnFilters);
    const filtered =
      activeEntries.length === 0
        ? rows
        : rows.filter((row) =>
            activeEntries.every(([k, allowed]) => {
              const col = columnMap.get(k);
              if (!col) return true;
              return allowed.has(col.getValue(row));
            })
          );

    if (!sortState.columnKey || !sortState.direction) return filtered;
    const sortCol = columnMap.get(sortState.columnKey);
    if (!sortCol) return filtered;

    return [...filtered].sort((a, b) => {
      const va = sortCol.getSortValue ? sortCol.getSortValue(a) : sortCol.getValue(a);
      const vb = sortCol.getSortValue ? sortCol.getSortValue(b) : sortCol.getValue(b);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), 'ar');
      }
      return sortState.direction === 'asc' ? cmp : -cmp;
    });
  }, [rows, columnFilters, sortState, columnMap]);

  const applyColumnFilter = (columnKey: string, selectedValues: Set<string> | null) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!selectedValues) {
        delete next[columnKey];
      } else {
        next[columnKey] = selectedValues;
      }
      return next;
    });
  };

  const setColumnSort = (columnKey: string, direction: SortDirection) => {
    setSortState({ columnKey: direction ? columnKey : '', direction });
  };

  const clearAllFilters = () => {
    setColumnFilters({});
    setSortState({ columnKey: '', direction: null });
  };

  const activeFilterKeys = Object.keys(columnFilters);

  return {
    filteredRows: filteredAndSortedRows,
    columnFilters,
    sortState,
    activeFilterKeys,
    getColumnOptions,
    applyColumnFilter,
    setColumnSort,
    clearAllFilters,
  };
}

interface ExcelColumnHeaderProps {
  columnKey: string;
  label: string;
  options: Array<{ value: string; count: number }>;
  activeFilterValues?: Set<string>;
  sortDirection: SortDirection;
  onApplyFilter: (selected: Set<string> | null) => void;
  onSort: (dir: SortDirection) => void;
}

export function ExcelColumnHeader({
  label,
  options,
  activeFilterValues,
  sortDirection,
  onApplyFilter,
  onSort,
}: ExcelColumnHeaderProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(25);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isFiltered = Boolean(activeFilterValues);

  useEffect(() => {
    if (open) {
      setDraftSelected(
        activeFilterValues
          ? new Set(activeFilterValues)
          : new Set(options.map((o) => o.value))
      );
      setVisibleLimit(25);
    } else {
      setSearch('');
    }
  }, [open, activeFilterValues, options]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const searchedOptions = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, debouncedSearch]);

  const allVisibleSelected =
    searchedOptions.length > 0 && searchedOptions.every((o) => draftSelected.has(o.value));

  const toggleAll = () => {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        searchedOptions.forEach((o) => next.delete(o.value));
      } else {
        searchedOptions.forEach((o) => next.add(o.value));
      }
      return next;
    });
  };

  const toggleOne = (val: string) => {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const handleApply = () => {
    if (draftSelected.size === options.length && !debouncedSearch.trim()) {
      onApplyFilter(null);
    } else {
      onApplyFilter(new Set(draftSelected));
    }
    setOpen(false);
  };

  const handleListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setVisibleLimit((prev) => Math.min(searchedOptions.length, prev + 25));
    }
  };

  const visibleSlice = searchedOptions.slice(0, visibleLimit);

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-1.5">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`تصفية وترتيب عمود ${label}`}
        className={`no-print inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
          isFiltered || sortDirection
            ? 'bg-emerald-600 text-white'
            : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
        }`}
      >
        <Filter className="h-3 w-3" />
      </button>

      {open && (
        <div
          dir="rtl"
          className="no-print absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-2.5 text-right text-xs font-normal text-slate-700 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 space-y-2"
        >
          {/* Sort Controls */}
          <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 pb-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onSort(sortDirection === 'asc' ? null : 'asc');
                setOpen(false);
              }}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                sortDirection === 'asc'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              <ArrowDownAZ className="h-3.5 w-3.5" />
              <span>تصاعدي</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSort(sortDirection === 'desc' ? null : 'desc');
                setOpen(false);
              }}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                sortDirection === 'desc'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              <ArrowUpZA className="h-3.5 w-3.5" />
              <span>تنازلي</span>
            </button>
          </div>

          {/* Debounced Value Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث في قيم العمود..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-6 text-xs focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Select All */}
          <label className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              <span>(تحديد الكل)</span>
            </span>
            <span className="font-mono-num text-[10px] text-slate-400">{searchedOptions.length}</span>
          </label>

          {/* Scrollable Value Checkboxes (Infinite Scroll) */}
          <div
            ref={listRef}
            onScroll={handleListScroll}
            className="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100 dark:divide-slate-800 dark:border-slate-800"
          >
            {visibleSlice.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-slate-400">لا توجد قيم مطابقة</div>
            ) : (
              visibleSlice.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={draftSelected.has(opt.value)}
                      onChange={() => toggleOne(opt.value)}
                      className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
                    />
                    <span className="truncate">{opt.value || '—'}</span>
                  </span>
                  <span className="font-mono-num text-[10px] text-slate-400 shrink-0">
                    ({opt.count})
                  </span>
                </label>
              ))
            )}
            {visibleLimit < searchedOptions.length && (
              <button
                type="button"
                onClick={() => setVisibleLimit((p) => p + 25)}
                className="w-full py-1.5 text-center text-[11px] font-semibold text-emerald-600 hover:bg-slate-50 dark:text-emerald-400"
              >
                عرض المزيد ({visibleLimit}/{searchedOptions.length})
              </button>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onApplyFilter(null);
                onSort(null);
                setOpen(false);
              }}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              مسح
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              <Check className="h-3 w-3" />
              <span>تطبيق</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActiveExcelFiltersBar<T>({
  columns,
  activeFilterKeys,
  sortState,
  totalBefore,
  totalAfter,
  onClearOne,
  onClearAll,
}: {
  columns: ExcelColumnDef<T>[];
  activeFilterKeys: string[];
  sortState: ExcelSortState;
  totalBefore: number;
  totalAfter: number;
  onClearOne: (key: string) => void;
  onClearAll: () => void;
}) {
  if (activeFilterKeys.length === 0 && !sortState.direction) return null;
  const colMap = new Map(columns.map((c) => [c.key, c.label]));

  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-emerald-800 dark:text-emerald-300">
          فلاتر الأعمدة النشطة ({totalAfter} من {totalBefore}):
        </span>
        {activeFilterKeys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onClearOne(k)}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-medium text-slate-800 border border-emerald-200 hover:bg-rose-50 hover:text-rose-700 dark:bg-slate-900 dark:text-slate-200 dark:border-emerald-800"
          >
            <span>{colMap.get(k) || k}</span>
            <X className="h-3 w-3" />
          </button>
        ))}
        {sortState.direction && (
          <span className="font-medium text-slate-600 dark:text-slate-300">
            ترتيب: {colMap.get(sortState.columnKey) || sortState.columnKey} (
            {sortState.direction === 'asc' ? 'تصاعدي' : 'تنازلي'})
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onClearAll}
        className="font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400"
      >
        مسح كل الفلاتر
      </button>
    </div>
  );
}

export function InfiniteTableFooter({
  visibleCount,
  totalCount,
  hasMore,
  onLoadMore,
  sentinelRef,
}: {
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="no-print border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 flex items-center justify-between dark:border-slate-800 dark:text-slate-400">
      <span className="font-mono-num">
        معروض {visibleCount} من أصل {totalCount} سجل
      </span>
      <div ref={sentinelRef}>
        {hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
          >
            تحميل المزيد تلقائياً...
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">تم عرض جميع السجلات</span>
        )}
      </div>
    </div>
  );
}
