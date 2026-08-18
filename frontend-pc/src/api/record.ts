import request, { type AppAxiosRequestConfig } from '../utils/request';
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
  aiResult: { status: string; confidence: number; reason: string; startedAt?: string };
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
  location?: {
    status?: 'ok' | 'weak' | 'failed' | 'skipped';
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number;
    capturedAt?: string;
    address?: string;
    distanceToSiteMeters?: number;
    reasonCode?: string;
    reason?: string;
  } | null;
  status: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectReason?: {
    reason: string;
    rejectedAt?: string;
    entryIds?: string[];
  } | null;
  auditTrail?: AuditTrailEvent[];
  aiSummary?: { pass: number; fail: number; pending: number; error: number };
  needsAudit?: boolean;
  createdAt: string;
  groupKey?: string;
  serviceCaseId?: string | null;
  gspCaseNo?: string | null;
  projectName?: string | null;
  unitLabel?: string | null;
  assignMode?: string | null;
  plannedUnits?: number | null;
  completedUnits?: number | null;
  caseStatus?: string | null;
  workUnit?: { id: string; seq: number; title: string | null } | null;
  inspectorName?: string | null;
  task?: {
    id: string;
    taskName: string;
    siteId: string;
    deviceId: string;
    inspectorId: string;
    status: string;
    aiEnabled: boolean;
    serviceCaseId?: string | null;
    workUnitId?: string | null;
    templateSnapshot?: Array<{
      id: string;
      name: string;
      description: string;
      samplePhotos?: string[];
      entryKind?: 'check' | 'record';
      checkType?: 'photo' | 'text';
      aiEnabled?: boolean;
    }>;
  };
}

/** 条目是否启用 AI（含旧数据推断） */
export function resolveEntryAiEnabled(entry: {
  aiEnabled?: boolean;
  entryKind?: 'check' | 'record' | string;
  checkType?: 'photo' | 'text' | string;
}): boolean {
  if (entry.aiEnabled === true) return true;
  if (entry.aiEnabled === false) return false;
  if (entry.entryKind === 'record') return false;
  if (entry.entryKind === 'check') return true;
  if (entry.checkType === 'text') return false;
  return true;
}

/** @deprecated 请用 resolveEntryAiEnabled；false≈原 record */
export function resolveEntryKind(entry: {
  entryKind?: 'check' | 'record' | string;
  checkType?: 'photo' | 'text' | string;
  aiEnabled?: boolean;
}): 'check' | 'record' {
  return resolveEntryAiEnabled(entry) ? 'check' : 'record';
}

export interface RecordCaseGroup {
  groupKey: string;
  serviceCaseId: string | null;
  gspCaseNo: string | null;
  projectName: string | null;
  unitLabel: string | null;
  assignMode: string | null;
  siteId: string | null;
  /** 计划台数（案例总台数） */
  plannedUnits?: number | null;
  /** 案例已完成台数 */
  completedUnits?: number | null;
  /** 案例状态 */
  caseStatus?: string | null;
  recordCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  latestSubmittedAt: string | null;
}

export async function fetchRecords(params: Record<string, unknown>) {
  const { data } = await request.get<ApiResponse<Paginated<RecordItem>>>('/records', {
    params,
  });
  return data.data;
}

export async function fetchRecordCaseGroups(params: Record<string, unknown>) {
  const { data } = await request.get<ApiResponse<Paginated<RecordCaseGroup>>>(
    '/records/case-groups',
    { params },
  );
  return data.data;
}

export async function fetchRecordsByCase(
  groupKey: string,
  params: Record<string, unknown> = {},
) {
  const { data } = await request.get<
    ApiResponse<Paginated<RecordItem> & { groupKey: string }>
  >(`/records/by-case/${encodeURIComponent(groupKey)}`, { params });
  return data.data;
}

export async function fetchRecord(id: string) {
  const { data } = await request.get<ApiResponse<RecordItem>>(`/records/${id}`);
  return data.data;
}

export async function analyzeAi(payload: {
  recordId: string;
  templateEntryId: string;
  photoUrls: string[];
  samplePhotoUrls?: string[];
}) {
  const { data } = await request.post<
    ApiResponse<{ queued: boolean; completed?: boolean }>
  >('/ai/analyze', payload, {
    timeout: 180_000,
    skipErrorToast: true,
  } as AppAxiosRequestConfig);
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

export async function setRecordManualResult(
  id: string,
  templateEntryId: string,
  manualResult: 'pass' | 'fail',
) {
  const { data } = await request.put<ApiResponse<RecordItem>>(
    `/records/${id}/entries/${encodeURIComponent(templateEntryId)}/manual-result`,
    { manualResult },
  );
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
