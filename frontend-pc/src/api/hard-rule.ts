import request from '../utils/request';
import type { ApiResponse } from '../types';

export type HardRuleMatchMode = 'title_exact' | 'title_includes' | 'criteria_includes';
export type HardRuleEnforceMode = 'strict' | 'normal' | 'off';

export interface HardRuleItem {
  id: string;
  code: string;
  name: string;
  matchMode: HardRuleMatchMode | string;
  matchPattern: string;
  promptText: string;
  jsonSchemaHint: string | null;
  enabled: boolean;
  enforceMode: HardRuleEnforceMode | string;
  version: number;
  changeNote: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  builtin?: boolean;
}

export async function fetchHardRules() {
  const { data } = await request.get<ApiResponse<HardRuleItem[]>>('/ai-hard-rules');
  return data.data;
}

export async function fetchHardRule(code: string) {
  const { data } = await request.get<ApiResponse<HardRuleItem>>(`/ai-hard-rules/${code}`);
  return data.data;
}

export async function createHardRule(payload: {
  name: string;
  matchMode?: HardRuleMatchMode;
  matchPattern: string;
  promptText?: string;
  passCriteria?: string;
  failCriteria?: string;
  jsonSchemaHint?: string | null;
  enabled?: boolean;
  enforceMode?: HardRuleEnforceMode;
  changeNote?: string;
}) {
  const { data } = await request.post<ApiResponse<HardRuleItem>>('/ai-hard-rules', payload);
  return data.data;
}

export async function updateHardRule(
  code: string,
  payload: {
    name?: string;
    matchMode?: HardRuleMatchMode;
    matchPattern?: string;
    promptText?: string;
    passCriteria?: string;
    failCriteria?: string;
    jsonSchemaHint?: string | null;
    enabled?: boolean;
    enforceMode?: HardRuleEnforceMode;
    changeNote?: string;
  },
) {
  const { data } = await request.put<ApiResponse<HardRuleItem>>(`/ai-hard-rules/${code}`, payload);
  return data.data;
}

export async function deleteHardRule(code: string) {
  const { data } = await request.delete<ApiResponse<{ ok: boolean; code: string }>>(
    `/ai-hard-rules/${code}`,
  );
  return data.data;
}

export async function resetHardRule(code: string, changeNote?: string) {
  const { data } = await request.post<ApiResponse<HardRuleItem>>(`/ai-hard-rules/${code}/reset`, {
    changeNote: changeNote || '恢复内置默认硬规则',
  });
  return data.data;
}
