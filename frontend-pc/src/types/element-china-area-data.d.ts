declare module 'element-china-area-data' {
  export type CascaderOption = {
    label: string;
    value: string;
    children?: CascaderOption[];
  };
  export const pcaTextArr: CascaderOption[];
  export const regionData: CascaderOption[];
  export const provinceAndCityData: CascaderOption[];
  export const pcTextArr: CascaderOption[];
  export const codeToText: Record<string, string>;
}
