import { useEffect, useRef } from 'react';

type Options = {
  /** 静默刷新（force reload） */
  reload: () => void | Promise<unknown>;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 轮询间隔，默认 30 秒 */
  intervalMs?: number;
};

/**
 * 页面停留时定时刷新；切回前台立即刷新。
 * 适合工程师端作业列表，避免必须手动下拉/刷新才看到新派单。
 */
export function useVisiblePolling({
  reload,
  enabled = true,
  intervalMs = 30_000,
}: Options) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      void Promise.resolve(reloadRef.current()).catch(() => undefined);
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(run, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
        start();
      } else {
        window.clearInterval(timer);
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}

/**
 * 对比前后「待办/作业中」案例 id，有新增时回调（首次加载不提示）。
 */
export function useNewOrderNotice(
  activeCaseIds: string[] | undefined,
  onNew: (count: number) => void,
  resetKey?: string,
) {
  const prevRef = useRef<Set<string> | null>(null);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      prevRef.current = null;
    }
  }, [resetKey]);

  useEffect(() => {
    if (!activeCaseIds) return;
    const next = new Set(activeCaseIds);
    const prev = prevRef.current;
    if (prev) {
      let added = 0;
      for (const id of next) {
        if (!prev.has(id)) added += 1;
      }
      if (added > 0) onNew(added);
    }
    prevRef.current = next;
  }, [activeCaseIds, onNew]);
}
