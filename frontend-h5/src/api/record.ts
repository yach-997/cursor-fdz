import request from '../utils/request';
import type { ApiResponse } from '../types';

export interface RecordEntry {
  templateEntryId: string;
  photos: string[];
  aiResult: {
    status: string;
    confidence: number;
    reason: string;
  };
  manualResult: string;
  finalResult: string | null;
  remark: string;
}

export interface RecordItem {
  id: string;
  taskId: string;
  deviceType: string;
  entries: RecordEntry[];
  status: string;
  submittedAt?: string | null;
  rejectReason?: { reason: string; entryIds?: string[]; rejectedAt?: string } | null;
  task?: {
    id: string;
    taskName: string;
    siteId: string;
    deviceId: string;
    aiEnabled: boolean;
    templateSnapshot?: Array<{
      id: string;
      name: string;
      description: string;
      isRequired: boolean;
      samplePhotos?: string[];
      isOptionalModule?: boolean;
    }>;
  };
}

export async function fetchRecord(id: string) {
  const { data } = await request.get<ApiResponse<RecordItem>>(`/records/${id}`);
  return data.data;
}

export async function saveDraft(id: string, entries: Partial<RecordEntry>[]) {
  const { data } = await request.put<ApiResponse<RecordItem>>(`/records/${id}/draft`, {
    entries,
  });
  return data.data;
}

export async function submitRecord(
  id: string,
  payload?: {
    enabledOptionalModuleIds?: string[];
    gps?: string;
    accuracy?: string;
    capturedAt?: string;
  },
) {
  const { data } = await request.put<ApiResponse<RecordItem>>(
    `/records/${id}/submit`,
    payload || {},
  );
  return data.data;
}

export async function uploadPhoto(
  file: File,
  meta: {
    taskId?: string;
    gps?: string;
    accuracy?: string;
    capturedAt?: string;
    photoTakenAt?: string;
  },
  onProgress?: (percent: number) => void,
) {
  const form = new FormData();
  form.append('file', file);
  Object.entries(meta).forEach(([key, value]) => {
    if (value) form.append(key, value);
  });
  const { data } = await request.post<
    ApiResponse<{ url: string; original: boolean }>
  >('/upload/photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 45_000,
    onUploadProgress: (event) => {
      if (!event.total) return;
      onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    },
  });
  return data.data;
}

export interface LocationVerification {
  verified: boolean;
  distanceMeters: number;
  radiusMeters: number;
  accuracyMeters: number;
  checkedAt: string;
  siteName: string;
}

export async function checkTaskLocation(payload: {
  taskId: string;
  gps: string;
  accuracy: string;
  capturedAt: string;
}) {
  const { data } = await request.post<ApiResponse<LocationVerification>>(
    '/upload/location-check',
    payload,
  );
  return data.data;
}

export async function analyzeAi(payload: {
  recordId: string;
  templateEntryId: string;
  photoUrl?: string;
  photoUrls?: string[];
  samplePhotoUrls?: string[];
}) {
  const { data } = await request.post<
    ApiResponse<{ queued: boolean; completed?: boolean }>
  >(
    '/ai/analyze',
    payload,
  );
  return data.data;
}

export async function fetchAiResult(templateEntryId: string, recordId: string) {
  const { data } = await request.get<
    ApiResponse<{
      aiResult?: { status: string; confidence: number; reason: string };
      status?: string;
    }>
  >(`/ai/result/${templateEntryId}`, { params: { recordId } });
  return data.data;
}
