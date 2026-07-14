import request from '../utils/request';
import type { ApiResponse, Paginated, SiteItem } from '../types';

export interface SiteQuery {
  province?: string;
  city?: string;
  managerId?: string;
  status?: string;
  keyword?: string;
  page?: number;
  limit?: number;
}

export type SiteMemberRole = 'deputy_manager' | 'inspector';

export interface SiteMemberItem {
  id: string;
  siteId: string;
  userId: string;
  memberRole: SiteMemberRole;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    username: string;
    realName: string;
    phone: string;
    role: string;
    status: string;
    avatar?: string;
  } | null;
}

export async function fetchSites(params: SiteQuery) {
  const { data } = await request.get<ApiResponse<Paginated<SiteItem>>>('/sites', { params });
  return data.data;
}

export async function createSite(payload: Record<string, unknown>) {
  const { data } = await request.post<ApiResponse<SiteItem>>('/sites', payload);
  return data.data;
}

export async function updateSite(id: string, payload: Record<string, unknown>) {
  const { data } = await request.put<ApiResponse<SiteItem>>(`/sites/${id}`, payload);
  return data.data;
}

export async function deleteSite(id: string) {
  const { data } = await request.delete<ApiResponse<{ success: boolean }>>(`/sites/${id}`);
  return data.data;
}

export async function appointManager(id: string, userId: string) {
  const { data } = await request.post<ApiResponse<SiteItem>>(`/sites/${id}/appoint-manager`, {
    userId,
  });
  return data.data;
}

export async function appointDeputy(id: string, userId: string) {
  const { data } = await request.post<ApiResponse<SiteMemberItem>>(`/sites/${id}/deputies`, {
    userId,
  });
  return data.data;
}

export async function removeDeputy(id: string, userId: string) {
  const { data } = await request.delete<ApiResponse<{ success: boolean }>>(
    `/sites/${id}/deputies/${userId}`,
  );
  return data.data;
}

export async function fetchSiteMembers(id: string, role?: SiteMemberRole | 'deputy' | 'inspector') {
  const { data } = await request.get<ApiResponse<SiteMemberItem[]>>(`/sites/${id}/members`, {
    params: role ? { role } : undefined,
  });
  return data.data;
}

export async function addSiteMember(id: string, userId: string) {
  const { data } = await request.post<ApiResponse<SiteMemberItem>>(`/sites/${id}/members`, {
    userId,
  });
  return data.data;
}

export async function removeSiteMember(id: string, userId: string) {
  const { data } = await request.delete<ApiResponse<{ success: boolean }>>(
    `/sites/${id}/members/${userId}`,
  );
  return data.data;
}
