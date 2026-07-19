import request from '../utils/request';
import type { ApiResponse } from '../types';

const unwrap = <T>(response: { data: ApiResponse<T> }) => response.data.data;

export interface MobileFinanceCase {
  id: string;
  gspCaseNo: string;
  projectName: string;
  serviceType?: string;
  province?: string;
  city?: string;
  status: string;
  assignTime?: string;
  finishTime?: string;
  workRecord?: CaseWorkRecord | null;
}
export interface CaseWorkRecord {
  workload?: { description?: string };
  mileage: string;
  expenses: string;
  expenseNote?: string;
  mileageScreenshotUrls: string[];
  workNote?: string;
}
export interface IncomeLedger {
  id: string;
  gspCaseNo: string;
  perfBase: string;
  deduction: string;
  deductionReason?: string;
  perfFinal: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  serviceCase?: MobileFinanceCase;
  items: Array<{ itemName: string; qty: string; perfPrice: string; itemPerf: string }>;
}
export interface MyIncome {
  month: string;
  approvedAmount: string;
  pendingAmount: string;
  totalAmount: string;
  caseCount: number;
  list: IncomeLedger[];
  assessment?: {
    totalScore: string;
    rankResult?: string;
    rewardAmount: string;
    toolSubsidy: string;
    otherSubsidy: string;
    subsidyRemark?: string;
  } | null;
  monthlySettlement?: { finalAmount: string; status: string } | null;
}

export async function fetchMyFinanceCases() {
  return unwrap(await request.get<ApiResponse<MobileFinanceCase[]>>('/cases/my/list'));
}
export async function fetchMyFinanceCase(id: string) {
  return unwrap(await request.get<ApiResponse<MobileFinanceCase>>(`/cases/my/${id}`));
}
export async function startFinanceCase(id: string) {
  return unwrap(await request.post<ApiResponse<MobileFinanceCase>>(`/cases/${id}/start`));
}
export async function saveFinanceCaseWork(id: string, payload: Record<string, unknown>) {
  return unwrap(await request.put<ApiResponse<CaseWorkRecord>>(`/cases/${id}/work-record`, payload));
}
export async function uploadFinanceWorkPhoto(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return unwrap(
    await request.post<ApiResponse<{ url: string }>>(`/cases/${id}/work-photo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),
  );
}
export async function finishFinanceCase(id: string) {
  return unwrap(await request.post<ApiResponse<MobileFinanceCase>>(`/cases/${id}/finish`));
}
export async function fetchMyIncome(month?: string) {
  return unwrap(await request.get<ApiResponse<MyIncome>>('/my/income', { params: { month } }));
}
