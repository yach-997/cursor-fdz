import request from '../utils/request';
import type { ApiResponse } from '../types';

const unwrap = <T>(response: { data: ApiResponse<T> }) => response.data.data;

export interface CaseChecklistItem {
  entryId: string;
  name: string;
  description: string;
  isRequired: boolean;
  isOptionalModule: boolean;
  enabled: boolean;
  done: boolean;
  photoUrls: string[];
  note: string;
  order: number;
}

export interface ExpenseNavShot {
  url: string;
  remark?: string;
}

export interface ExpenseLineItem {
  id: string;
  type: 'trip' | 'toll' | 'other';
  content: string;
  expenseDate?: string | null;
  amount?: string | number | null;
  note?: string | null;
  startOdometerUrl?: string | null;
  startMileage?: string | number | null;
  startNavShots?: ExpenseNavShot[];
  endOdometerUrl?: string | null;
  endMileage?: string | number | null;
  endNavShots?: ExpenseNavShot[];
  mileageKm?: string | number | null;
  voucherUrls?: string[];
  photoUrls?: string[];
}

export interface TripExpenseClaim {
  id: string;
  workUnitId?: string | null;
  inspectorId?: string;
  unitSeq?: number | null;
  unitTitle?: string | null;
  /** 结算/核定额 */
  amount: string;
  /** 工程师申报额 */
  claimAmount?: string;
  note?: string | null;
  lineItems?: ExpenseLineItem[];
  voucherUrls?: string[];
  startOdometerUrl?: string | null;
  startNavUrl?: string | null;
  startNavUrls?: string[];
  startMileage?: string | null;
  endOdometerUrl?: string | null;
  endNavUrl?: string | null;
  endNavUrls?: string[];
  endMileage?: string | null;
  mileageKm?: string | null;
  /** 开工选择无行程 */
  tripSkipped?: boolean;
  status: string;
  reviewNote?: string | null;
  inspectorName?: string;
}

export interface TripExpensePayload {
  lineItems?: ExpenseLineItem[];
  startOdometerUrl?: string | null;
  startNavUrl?: string | null;
  startNavUrls?: string[];
  startMileage?: number | null;
  endOdometerUrl?: string | null;
  endNavUrl?: string | null;
  endNavUrls?: string[];
  endMileage?: number | null;
  amount?: number;
  voucherUrls?: string[];
  note?: string;
  /** true=无行程；false=改为需要行程 */
  tripSkipped?: boolean;
  submit?: boolean;
  /** 兼容旧数据挂台，非唯一键 */
  workUnitId?: string;
}

export interface MobileFinanceCase {
  id: string;
  gspCaseNo: string;
  projectName: string;
  serviceType?: string;
  province?: string;
  city?: string;
  status: string;
  siteId?: string | null;
  taskType?: 'inspection' | 'service' | string | null;
  taskTypeName?: string | null;
  taskTemplateId?: string | null;
  assignMode?: 'single' | 'multi';
  plannedUnits?: number;
  completedUnits?: number;
  expenseEnabled?: boolean;
  unitLabel?: string;
  /** 是否已挂 PO；无 PO 完工后不计件结算 */
  hasPo?: boolean;
  /** 派单/改派备注 */
  assignRemark?: string | null;
  expenses?: TripExpenseClaim[];
  expenseSummary?: {
    totalAmount: string;
    approvedAmount: string;
    submittedAmount: string;
    count: number;
  };
  taskEntries?: Array<{
    id: string;
    name: string;
    description: string;
    isRequired: boolean;
    isOptionalModule?: boolean;
    order: number;
  }>;
  checklist?: CaseChecklistItem[];
  inspectionTaskId?: string | null;
  inspectionTaskStatus?: string | null;
  inspectionDone?: boolean;
  activeUnit?: {
    id: string;
    seq: number;
    title?: string | null;
    status: string;
    inspectionTaskId?: string | null;
  } | null;
  myActiveUnits?: Array<{
    id: string;
    seq: number;
    title?: string | null;
    status: string;
    inspectionTaskId?: string | null;
  }>;
  units?: Array<{
    id: string;
    seq: number;
    title?: string | null;
    status: string;
    inspectorId?: string | null;
    inspectionTaskId?: string | null;
    deviceSerial?: string | null;
    serialPhotoUrl?: string | null;
    serialConfirmedAt?: string | null;
  }>;
  assignTime?: string;
  finishTime?: string;
  workRecord?: CaseWorkRecord | null;
}
export interface CaseWorkRecord {
  workload?: {
    description?: string;
    checklist?: CaseChecklistItem[];
    templateName?: string;
  };
  mileage: string;
  expenses: string;
  expenseNote?: string;
  mileageScreenshotUrls: string[];
  workNote?: string;
}
export interface IncomeEventPenalty {
  id: string;
  category: string;
  content: string;
  qty: string;
  unit: string;
  amount: string;
  remark?: string | null;
}
export interface IncomeLedger {
  id: string;
  gspCaseNo: string;
  perfBase: string;
  deduction: string;
  deductionReason?: string;
  perfFinal: string;
  casePerfFinal?: string;
  caseRevenue?: string;
  myShareRatio?: string;
  myCompletedUnits?: number | null;
  plannedUnits?: number | null;
  assignMode?: 'single' | 'multi';
  isShared?: boolean;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewComment?: string | null;
  serviceCase?: MobileFinanceCase;
  items: Array<{
    itemName: string;
    qty: string;
    perfPrice: string;
    itemPerf: string;
    caseItemPerf?: string;
  }>;
  eventPenalties?: IncomeEventPenalty[];
  eventPenaltyTotal?: string;
  expenses?: Array<{
    id: string;
    serviceCaseId: string;
    workUnitId?: string | null;
    unitSeq?: number | null;
    amount: string;
    claimAmount?: string | null;
    note?: string | null;
    status: string;
    reviewNote?: string | null;
    mileageKm?: string | null;
    tripSkipped?: boolean;
  }>;
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
    eventPenalty?: string;
    toolSubsidy: string;
    otherSubsidy: string;
    subsidyRemark?: string;
    correctionAmount?: string;
    correctionReason?: string | null;
  } | null;
  monthlySettlement?: {
    perfTotal?: string;
    expenseTotal?: string;
    rewardTotal?: string;
    eventPenalty?: string;
    subsidyTotal?: string;
    correctionTotal?: string;
    finalAmount: string;
    status: string;
  } | null;
  expenses?: Array<{
    id: string;
    serviceCaseId: string;
    amount: string;
    note?: string | null;
    month?: string | null;
    projectName?: string | null;
    gspCaseNo?: string | null;
  }>;
  otherEventPenalties?: IncomeEventPenalty[];
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
export async function finishFinanceCase(id: string, opts?: { skipErrorToast?: boolean }) {
  const res = await request.post<ApiResponse<MobileFinanceCase>>(
    `/cases/${id}/finish`,
    undefined,
    { skipErrorToast: opts?.skipErrorToast } as never,
  );
  return unwrap(res);
}
export async function claimFinanceUnit(caseId: string, unitId: string) {
  return unwrap(
    await request.post<ApiResponse<{ inspectionTaskId: string; case: MobileFinanceCase }>>(
      `/cases/${caseId}/units/${unitId}/claim`,
    ),
  );
}
export async function completeFinanceUnit(
  caseId: string,
  unitId: string,
  opts?: { skipErrorToast?: boolean },
) {
  const res = await request.post<ApiResponse<MobileFinanceCase>>(
    `/cases/${caseId}/units/${unitId}/complete`,
    undefined,
    { skipErrorToast: opts?.skipErrorToast } as never,
  );
  return unwrap(res);
}
export async function saveUnitTripExpense(
  caseId: string,
  unitId: string,
  payload: TripExpensePayload,
) {
  return unwrap(
    await request.post<ApiResponse<TripExpenseClaim>>(
      `/cases/${caseId}/units/${unitId}/expense`,
      payload,
    ),
  );
}

/** 本人本案例行程（推荐；不按台） */
export async function saveMyTripExpense(caseId: string, payload: TripExpensePayload) {
  return unwrap(
    await request.post<ApiResponse<TripExpenseClaim>>(
      `/cases/${caseId}/my-expense`,
      payload,
    ),
  );
}

export async function ocrUnitMileage(
  caseId: string,
  unitId: string,
  imageUrl: string,
  kind: 'start' | 'end' = 'start',
) {
  return unwrap(
    await request.post<
      ApiResponse<{
        mileage: number | null;
        confidence: number;
        rawText: string;
        kind: string;
      }>
    >(`/cases/${caseId}/units/${unitId}/expense/ocr-mileage`, { imageUrl, kind }),
  );
}

export async function ocrMyMileage(
  caseId: string,
  imageUrl: string,
  kind: 'start' | 'end' = 'start',
) {
  return unwrap(
    await request.post<
      ApiResponse<{
        mileage: number | null;
        confidence: number;
        rawText: string;
        kind: string;
      }>
    >(`/cases/${caseId}/my-expense/ocr-mileage`, { imageUrl, kind }),
  );
}

export async function ocrUnitDeviceSerial(caseId: string, unitId: string, imageUrl: string) {
  return unwrap(
    await request.post<
      ApiResponse<{
        serial: string | null;
        confidence: number;
        rawText: string;
        provider: string;
      }>
    >(`/cases/${caseId}/units/${unitId}/serial/ocr`, { imageUrl }),
  );
}

export async function saveUnitDeviceSerial(
  caseId: string,
  unitId: string,
  payload: { deviceSerial: string; serialPhotoUrl?: string },
) {
  const res = await request.post<
    ApiResponse<{
      id: string;
      seq: number;
      deviceSerial: string;
      serialPhotoUrl?: string | null;
      serialConfirmedAt?: string;
    }>
  >(`/cases/${caseId}/units/${unitId}/serial`, payload, { skipErrorToast: true } as never);
  return unwrap(res);
}

/** @deprecated 使用 saveUnitTripExpense */
export async function saveFinanceExpense(
  caseId: string,
  payload: TripExpensePayload & { workUnitId?: string; amount?: number; voucherUrls?: string[] },
) {
  return unwrap(await request.post<ApiResponse<TripExpenseClaim>>(`/cases/${caseId}/expenses`, payload));
}
export async function fetchMyIncome(month?: string) {
  return unwrap(await request.get<ApiResponse<MyIncome>>('/my/income', { params: { month } }));
}
