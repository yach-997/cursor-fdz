import { create } from 'zustand';
import { fetchSystemBranding, type SystemBranding } from '../api/system';

const CACHE_KEY = 'systemBranding';

export const DEFAULT_BRANDING: SystemBranding = {
  systemName: '阳光运维系统',
  subtitle: '阳光运维平台',
  logoUrl: null,
};

function readCache(): SystemBranding {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = JSON.parse(raw) as Partial<SystemBranding>;
    return {
      systemName: parsed.systemName?.trim() || DEFAULT_BRANDING.systemName,
      subtitle: parsed.subtitle ?? DEFAULT_BRANDING.subtitle,
      logoUrl: parsed.logoUrl || null,
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

function writeCache(branding: SystemBranding) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(branding));
  } catch {
    // ignore quota
  }
}

function applyDocumentTitle(name: string) {
  if (typeof document !== 'undefined' && name) {
    document.title = name;
  }
}

function applyFavicon(logoUrl: string | null) {
  if (typeof document === 'undefined') return;
  const link =
    (document.querySelector("link[rel='icon']") as HTMLLinkElement | null) ||
    (() => {
      const el = document.createElement('link');
      el.rel = 'icon';
      document.head.appendChild(el);
      return el;
    })();
  if (logoUrl) {
    link.href = logoUrl;
    link.type = '';
  } else {
    link.href = '/vite.svg';
    link.type = 'image/svg+xml';
  }
}

type BrandingState = {
  branding: SystemBranding;
  loaded: boolean;
  loading: boolean;
  hydrate: () => void;
  refresh: () => Promise<SystemBranding>;
  setBranding: (branding: SystemBranding) => void;
};

export const useBrandingStore = create<BrandingState>((set, get) => ({
  branding: DEFAULT_BRANDING,
  loaded: false,
  loading: false,
  hydrate: () => {
    const cached = readCache();
    set({ branding: cached, loaded: true });
    applyDocumentTitle(cached.systemName);
    applyFavicon(cached.logoUrl);
  },
  setBranding: (branding) => {
    writeCache(branding);
    applyDocumentTitle(branding.systemName);
    applyFavicon(branding.logoUrl);
    set({ branding, loaded: true });
  },
  refresh: async () => {
    if (get().loading) return get().branding;
    set({ loading: true });
    try {
      const data = await fetchSystemBranding();
      const next: SystemBranding = {
        systemName: data?.systemName?.trim() || DEFAULT_BRANDING.systemName,
        subtitle: data?.subtitle ?? DEFAULT_BRANDING.subtitle,
        logoUrl: data?.logoUrl || null,
        updatedAt: data?.updatedAt ?? null,
      };
      get().setBranding(next);
      return next;
    } catch {
      if (!get().loaded) get().hydrate();
      return get().branding;
    } finally {
      set({ loading: false });
    }
  },
}));

/** 品牌徽标：有 logo 显示图，否则取系统名首字 */
export function brandMarkText(systemName?: string | null) {
  const name = (systemName || DEFAULT_BRANDING.systemName).trim();
  return name.charAt(0) || '光';
}
