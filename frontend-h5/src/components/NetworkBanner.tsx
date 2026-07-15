import { useEffect, useState } from 'react';

interface NetworkConnection extends EventTarget {
  effectiveType?: string;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** 弱网 / 离线横幅：占位而不盖住导航（避免挡掉返回按钮） */
export default function NetworkBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const conn = (navigator as Navigator & {
      connection?: NetworkConnection;
    }).connection;
    const checkSlow = () => {
      const type = conn?.effectiveType;
      setSlow(type === 'slow-2g' || type === '2g' || type === '3g');
    };
    checkSlow();
    if (conn) {
      conn.addEventListener('change', checkSlow);
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (conn) {
        conn.removeEventListener('change', checkSlow);
      }
    };
  }, []);

  if (online && !slow) return null;

  return (
    <div
      className={`network-banner ${online ? 'is-slow' : 'is-offline'}`}
    >
      <span />
      {!online
        ? '当前离线，恢复网络后可同步上传'
        : '网络较慢，上传照片可能需要更长时间'}
    </div>
  );
}
