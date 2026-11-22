import { useCallback, useEffect, useRef, useState } from 'react';

interface UseInfiniteScrollOptions {
  batchSize?: number;
  resetKey?: string | number;
}

export function useInfiniteScroll<T>(items: T[], options?: UseInfiniteScrollOptions) {
  const batchSize = options?.batchSize ?? 20;
  const resetKey = options?.resetKey;

  const [visibleCount, setVisibleCount] = useState(batchSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, resetKey, items.length]);

  const hasMore = visibleCount < items.length;
  const visibleItems = items.slice(0, visibleCount);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(items.length, prev + batchSize));
  }, [items.length, batchSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: '140px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return {
    visibleItems,
    visibleCount: Math.min(visibleCount, items.length),
    totalCount: items.length,
    hasMore,
    loadMore,
    sentinelRef,
  };
}
