import { Input, Modal, message } from 'antd';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';

/** 危险清空操作确认文案（与后端一致） */
export const FINANCE_CLEAR_CONFIRM_TEXT = '清空';

/** Preview / 本地 / 显式开关可显示清空；生产域名隐藏 */
export function canUseDangerousClear() {
  if (import.meta.env.VITE_ALLOW_DATA_CLEAR === 'true') return true;
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // Vercel 分支 Preview：xxx-git-branch-team.vercel.app
  if (host.includes('-git-')) return true;
  return false;
}

type ConfirmOptions = {
  title: string;
  description: string;
};

/**
 * 强确认：必须输入「清空」才可继续。
 */
export function confirmDangerousClear(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const cleanup = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };

    function Dialog() {
      const [value, setValue] = useState('');
      const matched = value.trim() === FINANCE_CLEAR_CONFIRM_TEXT;
      return createElement(
        Modal,
        {
          open: true,
          title: options.title,
          okText: '确认清空',
          okType: 'danger' as const,
          cancelText: '取消',
          okButtonProps: { disabled: !matched },
          onCancel: () => cleanup(false),
          onOk: () => {
            if (!matched) {
              message.error(`请输入「${FINANCE_CLEAR_CONFIRM_TEXT}」后确认`);
              return Promise.reject();
            }
            cleanup(true);
            return undefined;
          },
          destroyOnClose: true,
        },
        createElement(
          'div',
          null,
          createElement('p', { style: { marginBottom: 8 } }, options.description),
          createElement(
            'p',
            { style: { marginBottom: 8, color: '#cf1322' } },
            `此操作不可恢复。请输入「${FINANCE_CLEAR_CONFIRM_TEXT}」确认：`,
          ),
          createElement(Input, {
            autoFocus: true,
            placeholder: FINANCE_CLEAR_CONFIRM_TEXT,
            value,
            onChange: (e) => setValue(e.target.value),
            onPressEnter: () => {
              if (matched) cleanup(true);
            },
          }),
        ),
      );
    }

    root.render(createElement(Dialog));
  });
}
