const RELOAD_MARKER = 'h5:asset-recovery-at';
const RELOAD_COOLDOWN = 30_000;

export function isStaleAssetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /dynamically imported module|module script|importing a module|chunkloaderror|loading chunk|failed to fetch/i.test(
    message,
  );
}

/**
 * 发布新版本后，旧页面可能仍引用已经替换的分包文件。
 * 只清理网页资源缓存，不清除登录信息、巡检草稿和当前页面地址。
 */
export async function recoverLatestVersion(force = false) {
  const now = Date.now();
  const lastAttempt = Number(sessionStorage.getItem(RELOAD_MARKER) || 0);
  if (!force && now - lastAttempt < RELOAD_COOLDOWN) return false;

  sessionStorage.setItem(RELOAD_MARKER, String(now));
  try {
    if ('caches' in window) {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // 缓存清理失败时仍继续刷新，网络页面通常可以恢复。
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('_refresh', String(now));
  window.location.replace(nextUrl.toString());
  return true;
}
