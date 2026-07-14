import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NavBar } from 'react-vant';

/** 照片预览（自定义全屏，避免 react-vant ImagePreview closeIcon 崩溃） */
export default function PhotoPreviewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const urls = useMemo(() => {
    const list = params.getAll('url');
    if (list.length) return list;
    const single = params.get('url');
    return single ? [single] : [];
  }, [params]);

  const initial = Number(params.get('index') || 0);
  const [index, setIndex] = useState(
    Number.isFinite(initial) ? Math.min(Math.max(initial, 0), Math.max(urls.length - 1, 0)) : 0,
  );

  if (!urls.length) {
    return (
      <div>
        <NavBar title="照片预览" onClickLeft={() => navigate(-1)} />
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>无照片</div>
      </div>
    );
  }

  const go = (delta: number) => {
    setIndex((i) => {
      const next = i + delta;
      if (next < 0) return urls.length - 1;
      if (next >= urls.length) return 0;
      return next;
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column' }}>
      <NavBar
        title={urls.length > 1 ? `${index + 1} / ${urls.length}` : '照片预览'}
        onClickLeft={() => navigate(-1)}
        style={{ background: 'rgba(0,0,0,.6)', color: '#fff' }}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: 12,
        }}
        onClick={() => navigate(-1)}
      >
        <img
          src={urls[index]}
          alt=""
          style={{
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 140px)',
            objectFit: 'contain',
            userSelect: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        />
        {urls.length > 1 && (
          <>
            <button
              type="button"
              aria-label="上一张"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              style={navBtnStyle('left')}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="下一张"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              style={navBtnStyle('right')}
            >
              ›
            </button>
          </>
        )}
      </div>
      <div
        style={{
          padding: '12px 16px 28px',
          color: 'rgba(255,255,255,.75)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        照片已嵌入时间 / 站点 / 设备 / 巡检员水印
      </div>
    </div>
  );
}

function navBtnStyle(side: 'left' | 'right'): CSSProperties {
  return {
    position: 'absolute',
    [side]: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 40,
    height: 40,
    border: 'none',
    borderRadius: 20,
    background: 'rgba(255,255,255,.2)',
    color: '#fff',
    fontSize: 28,
    lineHeight: '40px',
    padding: 0,
    cursor: 'pointer',
  };
}
