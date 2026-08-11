import { Grid } from 'antd';

/** 桌面固定宽度，手机全宽（适配抽屉 / 宽弹层） */
export function useDrawerWidth(desktopWidth = 720): number | string {
  const screens = Grid.useBreakpoint();
  return screens.md ? desktopWidth : '100%';
}
