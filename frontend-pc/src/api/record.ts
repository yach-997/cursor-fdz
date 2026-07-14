import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface Paginated<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}

export interface RecordEntry {
  templateEntryId: string;
  photos: string[];
  aiResult: { status: string; confidence: number; reason: string };
  manualResult: string;
  finalResult: string | null;
  remark: string;
}

export interface AuditTrailEvent {
  action: string;
  at: string;
  by?: string;
  byName?: string;
  reason?: string;
  entryIds?: string[];
  summary?: string;
}

export interface RecordItem {
  id: string;
  taskId: string;
  deviceType: string;
  entries: RecordEntry[];
  reportPhotos?: string[] | null;
  status: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectReason?: {
    reason: string;
    rejectedAt?: string;
    entryIds?: string[];
  } | null;
  auditTrail?: AuditTrailEvent[];
  aiSummary?: { pass: number; fail: number; pending: number };
  needsAudit?: boolean;
  createdAt: string;
  task?: {
    id: string;
    taskName: string;
    siteId: string;
    deviceId: string;
    inspectorId: string;
    status: string;
    templateSnapshot?: Array<{ id: string; name: string; description: string }>;
  };
}

export async function fetchRecords(params: Record<string, unknown>) {
  const { data } = await request.get<ApiResponse<Paginated<RecordItem>>>('/records', {
    params,
  });
  return data.data;
}

export async function fetchRecord(id: string) {
  const { data } = await request.get<ApiResponse<RecordItem>>(`/records/${id}`);
  return data.data;
}

export async function approveRecord(id: string) {
  const { data } = await request.put<ApiResponse<RecordItem>>(`/records/${id}/approve`);
  return data.data;
}

export async function rejectRecord(
  id: string,
  reason: string,
  entryIds?: string[],
) {
  const { data } = await request.put<ApiResponse<RecordItem>>(`/records/${id}/reject`, {
    reason,
    entryIds,
  });
  return data.data;
}

export async function compareRecords(deviceId: string, recordIds: string[]) {
  const { data } = await request.get<
    ApiResponse<{ deviceId: string; list: RecordItem[] }>
  >(`/records/device/${deviceId}/compare`, {
    params: { record_ids: recordIds.join(',') },
  });
  return data.data;
}
