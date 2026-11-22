import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  batchSize?: number;
  usePortal?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'اختر من القائمة...',
  searchPlaceholder = 'ابحث داخل القائمة...',
  disabled = false,
  className = '',
  batchSize = 20,
  usePortal = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [portalRect, setPortalRect] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  }>({ top: 0, left: 0, width: 280, openUpward: false });

  const rootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(q)) ||
        o.value.toLowerCase().includes(q)
    );
  }, [options, debouncedQuery]);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [debouncedQuery, batchSize, open]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inRoot = rootRef.current?.contains(target);
      const inPortal = portalRef.current?.contains(target);
      if (!inRoot && !inPortal) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  useEffect(() => {
    if (!open || !usePortal) return;
    const syncPos = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < 290 && rect.top > 300;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPortalRect({
        top: openUpward ? rect.top - 6 : rect.bottom + 6,
        left,
        width,
        openUpward,
      });
    };
    syncPos();
    window.addEventListener('resize', syncPos);
    window.addEventListener('scroll', syncPos, true);
    return () => {
      window.removeEventListener('resize', syncPos);
      window.removeEventListener('scroll', syncPos, true);
    };
  }, [open, usePortal]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
    }
  }, [open]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      setVisibleCount((prev) => Math.min(filteredOptions.length, prev + batchSize));
    }
  };

  const visibleSlice = filteredOptions.slice(0, visibleCount);
  const hasMore = visibleCount < filteredOptions.length;

  const dropdownContent = (
    <div
      ref={portalRef}
      style={
        usePortal
          ? {
              position: 'fixed',
              top: portalRect.openUpward ? undefined : portalRect.top,
              bottom: portalRect.openUpward ? window.innerHeight - portalRect.top : undefined,
              left: portalRect.left,
              width: portalRect.width,
              zIndex: 70,
            }
          : undefined
      }
      className={
        usePortal
          ? 'rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900'
          : 'absolute right-0 left-0 top-full z-50 mt-1.5 min-w-[240px] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900'
      }
    >
      {/* Debounced Search Input */}
      <div className="border-b border-slate-100 p-2 dark:border-slate-800">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-8 pl-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="مسح البحث"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Infinite Scroll Options List */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70"
      >
        {visibleSlice.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs text-slate-500">
            لا توجد نتائج مطابقة للبحث
          </div>
        ) : (
          visibleSlice.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-xs transition-colors ${
                  isSelected
                    ? 'bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{opt.label}</div>
                  {opt.sublabel && (
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {opt.sublabel}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
              </button>
            );
          })
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(filteredOptions.length, prev + batchSize))}
            className="w-full py-2 text-center text-[11px] font-semibold text-emerald-600 hover:bg-slate-50 dark:text-emerald-400 dark:hover:bg-slate-800"
          >
            عرض المزيد ({visibleCount} / {filteredOptions.length})
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 font-mono-num flex justify-between dark:border-slate-800">
        <span>المتاح: {filteredOptions.length}</span>
        <span>معروض: {visibleSlice.length}</span>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm text-slate-900 transition-colors hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:border-slate-600"
      >
        <span className="truncate">
          {selectedOption ? (
            <>
              <span className="font-medium">{selectedOption.label}</span>
              {selectedOption.sublabel && (
                <span className="mr-1.5 text-xs text-slate-500 dark:text-slate-400">
                  ({selectedOption.sublabel})
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (usePortal && typeof document !== 'undefined' ? createPortal(dropdownContent, document.body) : dropdownContent)}
    </div>
  );
}
