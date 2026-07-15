import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodeQuery {
  address: string;
  province?: string;
  city?: string;
  district?: string;
  detail?: string;
  name?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
  provider: 'amap' | 'amap_poi' | 'nominatim' | 'openmeteo';
}

export interface RegeoResult {
  latitude: number;
  longitude: number;
  province: string;
  city: string;
  district: string;
  address: string;
  displayName: string;
}

/** 地址 → 坐标（高德优先，失败回退 OSM） */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);

  constructor(private readonly config: ConfigService) {}

  private get amapKey(): string {
    return (
      this.config.get<string>('AMAP_WEB_SERVICE_KEY') ||
      this.config.get<string>('AMAP_WEB_KEY') ||
      this.config.get<string>('AMAP_KEY') ||
      this.config.get<string>('VITE_AMAP_KEY') ||
      ''
    ).trim();
  }

  isAmapEnabled(): boolean {
    return Boolean(this.amapKey);
  }

  async geocode(query: GeocodeQuery | string): Promise<GeocodeResult | null> {
    const parsed =
      typeof query === 'string'
        ? { address: query.trim() }
        : { ...query, address: query.address.trim() };
    if (!parsed.address) return null;

    const cityHint = this.normalizeCity(parsed.city);
    const candidates = this.buildCandidates(parsed);
    const poiKeywords = this.buildPoiKeywords(parsed);
    // 大学/地标类优先走 POI，地理编码常只落到区县中心
    const preferPoi = this.looksLikeLandmark(parsed);

    if (this.amapKey) {
      if (preferPoi) {
        for (const keyword of poiKeywords) {
          const hit = await this.searchAmapPoi(keyword, cityHint);
          if (this.acceptHit(hit, parsed)) return hit;
        }
      }
      for (const item of candidates) {
        const hit = await this.searchAmapGeo(item.text, item.city || cityHint);
        if (this.acceptHit(hit, parsed)) return hit;
      }
      if (!preferPoi) {
        for (const keyword of poiKeywords) {
          const hit = await this.searchAmapPoi(keyword, cityHint);
          if (this.acceptHit(hit, parsed)) return hit;
        }
      }
      this.logger.warn(`高德未命中地址: ${parsed.address}`);
    } else {
      this.logger.warn('未配置 AMAP_WEB_SERVICE_KEY，无法调用高德地理编码');
    }

    // OSM 对「省市区 + 地标」整句的命中率较低，地标类先查抽取后的学校/园区名。
    const nominatimQueries = this.buildNominatimQueries(
      parsed,
      candidates.map((c) => c.text),
      poiKeywords,
      preferPoi,
    );
    for (const text of [...new Set(nominatimQueries)]) {
      const hit = await this.searchNominatim(text);
      if (this.acceptHit(hit, parsed)) return hit;
    }

    const fallback = await this.searchOpenMeteo(parsed.address);
    return this.acceptHit(fallback, parsed) ? fallback : null;
  }

  /** 坐标 → 地址（现场定位后自动填地址） */
  async regeo(longitude: number, latitude: number): Promise<RegeoResult | null> {
    if (!this.amapKey) {
      this.logger.warn('未配置 AMAP_WEB_SERVICE_KEY，无法逆地理编码');
      return null;
    }

    try {
      const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
      url.searchParams.set('location', `${longitude},${latitude}`);
      url.searchParams.set('key', this.amapKey);
      url.searchParams.set('extensions', 'base');
      url.searchParams.set('output', 'JSON');

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(1_500),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        status: string;
        info?: string;
        regeocode?: {
          formatted_address?: string;
          addressComponent?: {
            province?: string;
            city?: string | string[];
            district?: string;
            township?: string;
            streetNumber?: { street?: string; number?: string };
          };
        };
      };

      if (data.status !== '1' || !data.regeocode) return null;

      const comp = data.regeocode.addressComponent;
      if (!comp) return null;

      const cityRaw = comp.city;
      const city = Array.isArray(cityRaw)
        ? cityRaw[0] || ''
        : cityRaw || comp.province || '';
      const street = comp.streetNumber?.street || '';
      const number = comp.streetNumber?.number || '';
      const detail = [street, number].filter(Boolean).join('') || comp.township || '';

      return {
        longitude: Number(longitude.toFixed(7)),
        latitude: Number(latitude.toFixed(7)),
        province: comp.province || '',
        city,
        district: comp.district || '',
        address: detail || data.regeocode.formatted_address || '',
        displayName: data.regeocode.formatted_address || detail,
      };
    } catch (err) {
      this.logger.warn(`高德 regeo 失败: ${(err as Error).message}`);
      return null;
    }
  }

  private buildCandidates(query: GeocodeQuery) {
    const { province, city, district, detail, name, address } = query;
    const detailClean = (detail || '').trim();
    // 详细地址已含省市区时不要再拼接，避免「宜宾市三江新区四川省宜宾市…」这类脏串
    const detailHasRegion =
      /[省市州]/.test(detailClean) || detailClean.includes(city || '___NO__');
    const full = detailHasRegion
      ? detailClean
      : [province, city, district, detailClean].filter(Boolean).join('');
    const list: Array<{ text: string; city?: string }> = [];

    if (full) list.push({ text: full, city });
    if (name && city) list.push({ text: `${city}${district || ''}${name}`, city });
    if (name) list.push({ text: name, city });
    if (address && address !== full) list.push({ text: address.trim(), city });

    const seen = new Set<string>();
    return list.filter((item) => {
      const key = `${item.text}|${item.city || ''}`;
      if (!item.text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildPoiKeywords(query: GeocodeQuery) {
    // 站点名称通常比短地址更精确。例如「卧龙湖二期伏电站」应优先于
    // 地址末尾的「高峰」，否则 POI 搜索可能误命中同名的高峰公园。
    const raw = [query.name, query.detail, query.address]
      .map((s) => s?.trim())
      .filter(Boolean) as string[];
    const keys: string[] = [];
    for (const text of raw) {
      keys.push(text);
      const landmark = this.extractLandmark(text);
      if (landmark) keys.push(landmark);
    }
    return [...new Set(keys)];
  }

  /**
   * Nominatim 对中文行政区地址使用「地点, 区县, 城市, 省, 中国」的结构化写法
   * 命中率明显高于直接拼成一整句。结构化候选必须放在普通候选之前，避免
   * 「四川省自贡市自流井区高峰」这类街道/乡镇地址被误判为无结果。
   */
  private buildNominatimQueries(
    query: GeocodeQuery,
    candidates: string[],
    poiKeywords: string[],
    preferPoi: boolean,
  ) {
    const province = query.province?.trim();
    const city = query.city?.trim();
    const district = query.district?.trim();
    const detail = query.detail?.trim();
    const regionParts = [district, city, province, '中国'].filter(Boolean);
    const structured: string[] = [];

    if (detail && regionParts.length > 1) {
      structured.push([detail, ...regionParts].join(','));
    }
    if (query.name?.trim() && regionParts.length > 1) {
      structured.push([query.name.trim(), ...regionParts].join(','));
    }

    const ordered = [
      ...structured,
      ...(preferPoi ? poiKeywords : []),
      ...candidates,
      ...(!preferPoi ? poiKeywords : []),
    ];

    return ordered
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => (text.includes('中国') ? text : `中国${text}`));
  }

  /** 是否像学校/园区等地标（优先 POI） */
  private looksLikeLandmark(query: GeocodeQuery) {
    const text = [query.detail, query.name, query.address].filter(Boolean).join('');
    return /大学|学院|学校|园区|电站|产业园|公司|工厂|基地|大厦|广场|医院|机场|火车站/.test(
      text,
    );
  }

  /** 从「四川省宜宾市翠屏区四川轻化工大学」抽出「四川轻化工大学」 */
  private extractLandmark(text: string): string | null {
    const cleaned = text
      .replace(/^中国/, '')
      .replace(/^[\u4e00-\u9fa5]+(?:省|自治区|特别行政区)/, '')
      .replace(/^[\u4e00-\u9fa5]+市/, '')
      .replace(/^[\u4e00-\u9fa5]+(?:区|县|旗|新区)/, '')
      // 容错「翠屏区叙州区某大学」这类重复区县前缀，保留真正地标名称
      .replace(/^[\u4e00-\u9fa5]+(?:区|县|旗|新区)/, '')
      .trim();
    if (!cleaned || cleaned === text) {
      const m = text.match(
        /([\u4e00-\u9fa5A-Za-z0-9]{2,}(?:大学|学院|学校|园区|电站|产业园|公司|工厂|基地|大厦|广场|医院))/,
      );
      return m?.[1] || null;
    }
    if (/大学|学院|学校|园区|电站|产业园|公司|工厂|基地|大厦|广场|医院/.test(cleaned)) {
      return cleaned;
    }
    return cleaned.length >= 2 ? cleaned : null;
  }

  private normalizeCity(city?: string) {
    if (!city) return undefined;
    return city.replace(/市$/, '');
  }

  /** 防止外部地图服务将同名地标解析到其他省市。 */
  private acceptHit(
    hit: GeocodeResult | null,
    query: Pick<GeocodeQuery, 'province' | 'city'>,
  ): hit is GeocodeResult {
    if (!hit) return false;
    const display = this.normalizeRegionText(hit.displayName);
    const expected = [query.province, query.city]
      .map((value) => this.normalizeRegionText(value || ''))
      .filter((value) => value.length >= 2);
    const accepted = expected.every((value) => display.includes(value));
    if (!accepted) {
      this.logger.warn(
        `已拒绝跨地区地址结果: ${hit.displayName} (期望 ${expected.join('/')})`,
      );
    }
    return accepted;
  }

  private normalizeRegionText(value: string) {
    return value
      .replace(/\s+/g, '')
      .replace(/(壮族|回族|维吾尔)自治区/g, '')
      .replace(/(特别行政区|自治州|自治区|地区|省|市)$/g, '');
  }

  private parseLocation(location: string) {
    const [lngStr, latStr] = location.split(',');
    const latitude = Number(Number(latStr).toFixed(7));
    const longitude = Number(Number(lngStr).toFixed(7));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  /** 高德地理编码（GCJ-02） */
  private async searchAmapGeo(
    address: string,
    city?: string,
  ): Promise<GeocodeResult | null> {
    try {
      const url = new URL('https://restapi.amap.com/v3/geocode/geo');
      url.searchParams.set('address', address);
      url.searchParams.set('key', this.amapKey);
      url.searchParams.set('output', 'JSON');
      if (city) url.searchParams.set('city', city);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        status: string;
        info?: string;
        infocode?: string;
        geocodes?: Array<{
          formatted_address?: string;
          location?: string;
          level?: string;
          province?: string;
          city?: string;
          district?: string;
        }>;
      };

      if (data.status !== '1' || !data.geocodes?.length) {
        if (data.info && data.info !== 'OK') {
          this.logger.warn(`高德 geocode[${address}]: ${data.info} (${data.infocode || ''})`);
        }
        return null;
      }

      const first = data.geocodes.find((g) => g.location?.includes(','));
      if (!first?.location) return null;

      const coords = this.parseLocation(first.location);
      if (!coords) return null;

      return {
        ...coords,
        displayName:
          [first.province, first.city, first.district, first.formatted_address]
            .filter(Boolean)
            .join('') || address,
        provider: 'amap',
      };
    } catch (err) {
      this.logger.warn(`高德 geocode 失败: ${(err as Error).message}`);
      return null;
    }
  }

  /** 高德 POI 关键词搜索（适合「西华大学」「轻化工」等） */
  private async searchAmapPoi(
    keywords: string,
    city?: string,
  ): Promise<GeocodeResult | null> {
    try {
      const url = new URL('https://restapi.amap.com/v3/place/text');
      url.searchParams.set('keywords', keywords);
      url.searchParams.set('key', this.amapKey);
      url.searchParams.set('output', 'JSON');
      url.searchParams.set('offset', '1');
      url.searchParams.set('page', '1');
      if (city) {
        url.searchParams.set('city', city);
        url.searchParams.set('citylimit', 'true');
      }

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        status: string;
        info?: string;
        pois?: Array<{
          name?: string;
          address?: string;
          location?: string;
          pname?: string;
          cityname?: string;
          adname?: string;
        }>;
      };

      if (data.status !== '1' || !data.pois?.length) return null;

      const first = data.pois.find((p) => p.location?.includes(','));
      if (!first?.location) return null;

      const coords = this.parseLocation(first.location);
      if (!coords) return null;

      const displayName = [first.pname, first.cityname, first.adname, first.name, first.address]
        .filter(Boolean)
        .join(' · ');

      return {
        ...coords,
        displayName: displayName || keywords,
        provider: 'amap_poi',
      };
    } catch (err) {
      this.logger.warn(`高德 POI 失败: ${(err as Error).message}`);
      return null;
    }
  }

  private async searchNominatim(query: string): Promise<GeocodeResult | null> {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');
      url.searchParams.set('countrycodes', 'cn');

      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'PVInspectionSystem/1.0 (contact@local.dev)',
          'Accept-Language': 'zh-CN,zh',
        },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
      }>;
      const first = data?.[0];
      if (!first?.lat || !first?.lon) return null;

      return {
        latitude: Number(Number(first.lat).toFixed(7)),
        longitude: Number(Number(first.lon).toFixed(7)),
        displayName: first.display_name,
        provider: 'nominatim',
      };
    } catch (err) {
      this.logger.warn(`Nominatim 失败: ${(err as Error).message}`);
      return null;
    }
  }

  private async searchOpenMeteo(query: string): Promise<GeocodeResult | null> {
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', query);
      url.searchParams.set('count', '1');
      url.searchParams.set('language', 'zh');
      url.searchParams.set('countryCode', 'CN');

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        results?: Array<{
          latitude: number;
          longitude: number;
          name: string;
          admin1?: string;
          country?: string;
        }>;
      };
      const first = data.results?.[0];
      if (!first) return null;

      return {
        latitude: Number(Number(first.latitude).toFixed(7)),
        longitude: Number(Number(first.longitude).toFixed(7)),
        displayName: [first.name, first.admin1, first.country].filter(Boolean).join(', '),
        provider: 'openmeteo',
      };
    } catch (err) {
      this.logger.warn(`Open-Meteo 失败: ${(err as Error).message}`);
      return null;
    }
  }
}
