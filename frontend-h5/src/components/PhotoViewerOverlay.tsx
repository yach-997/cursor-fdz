import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayPhotoUrl } from '../utils/photo-url';
import './photo-viewer.css';

interface Props {
  urls: string[];
  initialIndex?: number;
  onClose: () => void;
}

export default function PhotoViewerOverlay({ urls, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(
    Math.min(Math.max(initialIndex, 0), Math.max(urls.length - 1, 0)),
  );
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((value) => (value - 1 + urls.length) % urls.length);
      if (event.key === 'ArrowRight') setIndex((value) => (value + 1) % urls.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, urls.length]);

  const go = (delta: number) => {
    if (urls.length <= 1) return;
    setIndex((value) => (value + delta + urls.length) % urls.length);
  };

  if (!urls.length) return null;

  return createPortal(
    <div className="photo-viewer-overlay" role="dialog" aria-modal="true">
      <header className="photo-viewer-header">
        <button type="button" onClick={onClose}>← 返回</button>
        <strong>照片预览</strong>
        <span>{index + 1} / {urls.length}</span>
      </header>
      <div
        className="photo-viewer-stage"
        onClick={onClose}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
          const distance = endX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(distance) > 45) go(distance > 0 ? -1 : 1);
        }}
      >
        <img
          src={displayPhotoUrl(urls[index])}
          alt={`照片 ${index + 1}`}
          onClick={(event) => event.stopPropagation()}
        />
        {urls.length > 1 && (
          <>
            <button
              type="button"
              className="photo-viewer-arrow is-left"
              aria-label="上一张"
              onClick={(event) => { event.stopPropagation(); go(-1); }}
            >
              ‹
            </button>
            <button
              type="button"
              className="photo-viewer-arrow is-right"
              aria-label="下一张"
              onClick={(event) => { event.stopPropagation(); go(1); }}
            >
              ›
            </button>
          </>
        )}
      </div>
      <footer className="photo-viewer-footer">可上下滑动查看长图 · 左右滑动切换</footer>
    </div>,
    document.body,
  );
}
