const configuredApi = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') || '';

const imageProxyBase = configuredApi || (supabaseUrl ? `${supabaseUrl}/functions/v1/api` : '/api');

/** 为 HTTP 页面和 HTTPS 部署环境生成可显示的巡检图片地址。 */
export function displayPhotoUrl(source?: string | null) {
  const url = String(source || '').trim();
  if (!url || /^(data:|blob:)/i.test(url)) return url;

  const isQiniuTestDomain = /^https?:\/\/[^/]+\.clouddn\.com\//i.test(url);
  const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  // 七牛测试域名没有可信 HTTPS 证书，本地 HTTP 开发时直接降级读取。
  if (!pageIsHttps && isQiniuTestDomain) {
    return url.replace(/^https:/i, 'http:');
  }

  // HTTPS 页面不能显示 HTTP 图片；七牛测试域名的 HTTPS 也需要后端代理。
  if (pageIsHttps && (/^http:/i.test(url) || isQiniuTestDomain)) {
    return `${imageProxyBase}/upload/image?url=${encodeURIComponent(url)}`;
  }
  return url;
}
