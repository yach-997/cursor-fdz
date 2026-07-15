import { useEffect, useState } from 'react';
import { Button, Loading } from 'react-vant';
import { useRouteError } from 'react-router-dom';
import {
  isStaleAssetError,
  recoverLatestVersion,
} from '../utils/assetRecovery';

export default function RouteErrorPage() {
  const error = useRouteError();
  const [recovering, setRecovering] = useState(isStaleAssetError(error));

  useEffect(() => {
    if (!isStaleAssetError(error)) return;
    void recoverLatestVersion().then((started) => setRecovering(started));
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 'max(88px, env(safe-area-inset-top)) 24px 40px',
        textAlign: 'center',
        color: '#18382d',
        background: '#edf3f0',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          padding: '34px 24px',
          border: '1px solid rgba(22, 78, 59, .09)',
          borderRadius: 20,
          background: '#fff',
          boxShadow: '0 16px 40px rgba(18, 67, 49, .08)',
        }}
      >
        {recovering ? (
          <>
            <Loading type="spinner" size="32px" color="#16835f" />
            <h2 style={{ margin: '18px 0 8px', fontSize: 20 }}>正在更新页面</h2>
            <p style={{ marginBottom: 0, color: '#74877f', lineHeight: 1.7 }}>
              检测到系统已发布新版本，正在自动恢复，请稍候。
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 38 }}>↻</div>
            <h2 style={{ margin: '12px 0 8px', fontSize: 20 }}>页面需要重新加载</h2>
            <p style={{ margin: '0 0 22px', color: '#74877f', lineHeight: 1.7 }}>
              巡检记录和登录状态不会丢失，请加载最新版本后继续操作。
            </p>
            <Button
              block
              round
              type="primary"
              onClick={() => void recoverLatestVersion(true)}
            >
              重新加载最新版本
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
