import request from '../utils/request';
import type { ApiResponse, Paginated, DeviceItem, DeviceType, DeviceStatus } from '../types';

export interface DeviceQuery {
  siteId?: string;
  deviceType?: DeviceType;
  serialNumber?: string;
  status?: DeviceStatus;
  page?: number;
  limit?: number;
}

export async function fetchDevices(params: DeviceQuery) {
  const { data } = await request.get<ApiResponse<Paginated<DeviceItem>>>('/devices', { params });
  return data.data;
}

export async function createDevice(payload: Record<string, unknown>) {
  const { data } = await request.post<ApiResponse<DeviceItem>>('/devices', payload);
  return data.data;
}

export async function updateDevice(id: string, payload: Record<string, unknown>) {
  const { data } = await request.put<ApiResponse<DeviceItem>>(`/devices/${id}`, payload);
  return data.data;
}

export async function deleteDevice(id: string) {
  const { data } = await request.delete(`/devices/${id}`);
  return data.data;
}

export async function batchImportDevices(file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await request.post<
    ApiResponse<{
      successCount: number;
      failCount: number;
      failed: { row: number; reason: string }[];
    }>
  >('/devices/batch-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}

export async function fetchDeviceHistory(id: string) {
  const { data } = await request.get(`/devices/${id}/history`);
  return data.data;
}
