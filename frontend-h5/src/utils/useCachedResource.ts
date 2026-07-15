import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type StoredValue<T> = {
  savedAt: number;
  value: T;
};

const CACHE_PREFIX = 'inspection-h5:data:';
const memoryCache = new Map<string, StoredValue<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function readStored<T>(key: string, maxAge: number): T | undefined {
  const now = Date.now();
  const memory = memoryCache.get(key) as StoredValue<T> | undefined;
  if (memory && now - memory.savedAt <= maxAge) return memory.value;

  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as StoredValue<T>;
    if (now - stored.savedAt > maxAge) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return undefined;
    }
    memoryCache.set(key, stored);
    return stored.value;
  } catch {
    return undefined;
  }
}

function writeStored<T>(key: string, value: T) {
  const stored: StoredValue<T> = { savedAt: Date.now(), value };
  memoryCache.set(key, stored);
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(stored));
  } catch {
    // 浏览器隐私模式或空间不足时仍保留内存缓存。
  }
}

async function requestResource<T>(key: string, loader: () => Promise<T>, force = false) {
  if (force) inflight.delete(key);
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = loader()
    .then((value) => {
      writeStored(key, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/** 提前加载底部页签数据，页面打开时可直接展示，避免先闪空状态。 */
export function prefetchResource<T>(key: string, loader: () => Promise<T>) {
  return requestResource(key, loader).catch(() => undefined);
}

/**
 * 移动端轻量 stale-while-revalidate 数据源：先展示最近成功数据，再后台更新。
 * 首次没有缓存时由页面展示骨架屏，不会误显示“0 / 暂无数据”。
 */
export function useCachedResource<T>(
  key: string,
  loader: () => Promise<T>,
  maxAge = 10 * 60 * 1000,
) {
  const initial = readStored<T>(key, maxAge);
  const [state, setState] = useState<{ key: string; data?: T }>({ key, data: initial });
  const [loading, setLoading] = useState(initial === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const activeKey = useRef(key);
  activeKey.current = key;

  useLayoutEffect(() => {
    const cached = readStored<T>(key, maxAge);
    setState({ key, data: cached });
    setLoading(cached === undefined);
    setRefreshing(cached !== undefined);
    setError(false);
  }, [key, maxAge]);

  const load = useCallback(
    async (force = false) => {
      const cached = readStored<T>(key, maxAge);
      if (cached === undefined) setLoading(true);
      else setRefreshing(true);
      setError(false);
      try {
        const value = await requestResource(key, loader, force);
        if (activeKey.current === key) setState({ key, data: value });
        return value;
      } catch (reason) {
        if (activeKey.current === key) setError(true);
        throw reason;
      } finally {
        if (activeKey.current === key) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, loader, maxAge],
  );

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const data = state.key === key ? state.data : readStored<T>(key, maxAge);
  const reload = useCallback(() => load(true), [load]);
  return { data, loading, refreshing, error, reload };
}
