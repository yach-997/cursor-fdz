import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface DeviceItem {
  id: string;
  siteId: string;
  serialNumber: string;
  deviceType: string;
  model?: string;
}

export interface DeviceHistory {
  device: {
    id: string;
    serialNumber: string;
    deviceType: string;
    model?: string;
  };
  tasks: Array<{
    id: string;
    taskName: string;
    status: string;
    completedAt?: string;
    createdAt: string;
  }>;
  records: Array<{
    id: string;
    taskId: string;
    status: string;
    submittedAt?: string;
    approvedAt?: string;
    createdAt: string;
  }>;
}

export async function fetchDevices(params: {
  siteId?: string;
  serialNumber?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await request.get<
    ApiResponse<{ list: DeviceItem[]; total: number }>
  >('/devices', { params });
  return data.data;
}

export async function fetchDeviceHistory(deviceId: string) {
  const { data } = await request.get<ApiResponse<DeviceHistory>>(`/devices/${deviceId}/history`);
  return data.data;
}
