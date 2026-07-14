/** 拼接完整地址（编辑回填用） */
export function composeFullAddress(parts: {
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
}) {
  const detail = (parts.address || '').trim();
  const region = [parts.province, parts.city, parts.district].filter(Boolean).join('');
  if (!detail) return region;
  if (!region) return detail;
  if (detail.startsWith(region) || (parts.province && detail.includes(parts.province))) {
    return detail;
  }
  return `${region}${detail}`;
}

/** 从整段地址尽量拆出省市区 + 详细地点 */
export function parseChineseAddress(full: string) {
  const text = full.trim().replace(/\s+/g, '');
  if (!text) {
    return { province: '', city: '', district: '', detail: '' };
  }

  const provinceMatch = text.match(
    /^(.+?(?:省|自治区|特别行政区)|北京|上海|天津|重庆|北京市|上海市|天津市|重庆市)/,
  );
  let rest = text;
  let province = '';
  if (provinceMatch) {
    province = provinceMatch[1];
    if (['北京', '上海', '天津', '重庆'].includes(province)) {
      province = `${province}市`;
    }
    rest = text.slice(provinceMatch[0].length);
  }

  let city = '';
  const cityMatch = rest.match(/^(.+?(?:市|自治州|地区|盟))/);
  if (cityMatch) {
    city = cityMatch[1];
    rest = rest.slice(cityMatch[0].length);
  } else if (/^(北京市|上海市|天津市|重庆市)$/.test(province)) {
    city = '市辖区';
  }

  let district = '';
  const districtMatch = rest.match(/^(.+?(?:区|县|旗|新区|市))/);
  if (districtMatch) {
    district = districtMatch[1];
    rest = rest.slice(districtMatch[0].length);
  }

  return {
    province,
    city,
    district,
    detail: rest || text,
  };
}
