import { pcaTextArr } from 'element-china-area-data';

export type RegionOption = {
  label: string;
  value: string;
  children?: RegionOption[];
};

/** 省市区级联选项（中文名为 value） */
export const chinaRegionOptions = pcaTextArr as RegionOption[];

function normalizeRegionName(name: string) {
  return name
    .replace(/特别行政区$/, '')
    .replace(/壮族自治区|回族自治区|维吾尔自治区|自治区$/, '')
    .replace(/(省|市)$/, '')
    .trim();
}

function findChild(list: RegionOption[] | undefined, name?: string) {
  if (!list?.length || !name) return undefined;
  const exact = list.find((item) => item.value === name || item.label === name);
  if (exact) return exact;
  const n = normalizeRegionName(name);
  return list.find(
    (item) =>
      normalizeRegionName(item.value) === n ||
      item.value.includes(name) ||
      name.includes(item.value),
  );
}

/** 把已有省市区字符串尽量映射成 Cascader 路径 */
export function resolveRegionPath(
  province?: string,
  city?: string,
  district?: string,
): string[] | undefined {
  if (!province) return undefined;
  const p = findChild(chinaRegionOptions, province);
  if (!p) return undefined;

  let c = findChild(p.children, city);
  // 直辖市常见：逆地理解出来的市名等于省名，数据里是「市辖区」
  if (!c && p.children?.length) {
    if (p.children.length === 1) c = p.children[0];
    else c = p.children.find((item) => item.value === '市辖区') || findChild(p.children, province);
  }
  if (!c) return [p.value];

  const d = findChild(c.children, district);
  if (!d) return [p.value, c.value];
  return [p.value, c.value, d.value];
}
