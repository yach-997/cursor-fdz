import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
  provider?: string;
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

/** 地址 → 坐标 */
export async function geocodeAddress(payload: {
  address: string;
  province?: string;
  city?: string;
  district?: string;
  detail?: string;
  name?: string;
}) {
  const { data } = await request.get<ApiResponse<GeocodeResult>>('/geocode', {
    params: payload,
  });
  return data.data;
}

/** 坐标 → 地址（现场定位） */
export async function reverseGeocode(longitude: number, latitude: number) {
  const { data } = await request.get<ApiResponse<RegeoResult>>('/geocode/regeo', {
    params: { longitude, latitude },
  });
  return data.data;
}
