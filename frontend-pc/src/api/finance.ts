import request from '../utils/request';
import type { ApiResponse } from '../types';
import type {
  FinanceCase,
  FinanceDashboard,
  FinanceVarianceDetail,
  FinancePage,
  ImportResult,
  PoOrder,
  PriceItem,
  ItemPriceMappingList,
  FinanceInspectorOption,
  FinanceReviewItem,
  ReviewAmountBreakdown,
  FinanceAssessment,
  AssessmentEventCatalogItem,
  AssessmentEventRow,
  FinanceMonthlySettlement,
} from '../types/finance';

const unwrap = <T>(response: { data: ApiResponse<T> }) => response.data.data;
export async function fetchFinanceCases(params: Record<string, unknown>) {
  return unwrap(await request.get<ApiResponse<FinancePage<FinanceCase>>>('/cases', { params }));
}
export async function fetchFinanceCaseLocationOptions() {
  return unwrap(
    await request.get<
      ApiResponse<{ provinces: string[]; citiesByProvince: Record<string, string[]> }>
    >('/cases/location-options'),
  );
}
export async function clearFinanceCases() {
  return unwrap(
    await request.delete<ApiResponse<{ deleted: number }>>('/cases/clear', {
      params: { confirm: '清空' },
    }),
  );
}

export async function clearFinanceAssessments() {
  return unwrap(
    await request.delete<
      ApiResponse<{
        deleted: { assessmentEvent: number; monthlySettlement: number; assessment: number };
      }>
    >('/assessments/clear', {
      params: { confirm: '清空' },
    }),
  );
}
export async function fetchFinanceAssessments(params: {
  month: string;
  keyword?: string;
  siteId?: string;
  role?: string;
}) {
  return unwrap(await request.get<ApiResponse<FinanceAssessment[]>>('/assessments', { params }));
}
export async function saveFinanceAssessment(payload: Record<string, unknown>) {
  return unwrap(await request.post<ApiResponse<FinanceAssessment>>('/assessments', payload));
}
export async function rankFinanceAssessments(
  month: string,
  mode: 'site_preview' | 'company_inspectors' | 'company_managers',
  siteId?: string,
) {
  return unwrap(
    await request.post<ApiResponse<FinanceAssessment[]>>(`/assessments/${month}/rank`, {
      mode,
      ...(siteId ? { siteId } : {}),
    }),
  );
}
export async function fetchAssessmentEventCatalog() {
  return unwrap(await request.get<ApiResponse<AssessmentEventCatalogItem[]>>('/assessments/event-catalog'));
}
export async function fetchAssessmentEvents(
  month: string,
  userId?: string,
  serviceCaseId?: string,
) {
  return unwrap(
    await request.get<ApiResponse<AssessmentEventRow[]>>('/assessments/events', {
      params: {
        month,
        ...(userId ? { userId } : {}),
        ...(serviceCaseId ? { serviceCaseId } : {}),
      },
    }),
  );
}
export async function createAssessmentEvent(payload: Record<string, unknown>) {
  return unwrap(await request.post<ApiResponse<AssessmentEventRow>>('/assessments/events', payload));
}
export async function deleteAssessmentEvent(id: string) {
  return unwrap(await request.delete<ApiResponse<{ id: string }>>(`/assessments/events/${id}`));
}
export async function fetchMonthlySettlements(params: {
  month: string;
  keyword?: string;
  siteId?: string;
  role?: string;
}) {
  return unwrap(
    await request.get<ApiResponse<FinanceMonthlySettlement[]>>('/monthly-settlements', { params }),
  );
}
export async function correctMonthlySettlement(month: string, userId: string, amount: number, reason: string) {
  return unwrap(await request.post<ApiResponse<FinanceMonthlySettlement>>(`/monthly-settlements/${month}/correct`, { userId, amount, reason }));
}
export async function lockMonthlySettlements(month: string) {
  return unwrap(await request.post<ApiResponse<{ month: string; locked: number }>>(`/monthly-settlements/${month}/lock`));
}
export async function exportMonthlySettlements(month: string, template: 'reconcile' | 'payroll') {
  const response = await request.get(`/monthly-settlements/${month}/export`, { params: { template }, responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${month}-${template === 'payroll' ? '发薪表' : '对账表'}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const TEMPLATE_FILENAMES: Record<'gsp' | 'po' | 'settle-price' | 'perf-price', string> = {
  gsp: 'GSP案例导入模板.xlsx',
  po: '钉钉PO导入模板.xlsx',
  'settle-price': '甲方结算价导入模板.xlsx',
  'perf-price': '内部绩效价导入模板.xlsx',
};

export async function downloadFinanceImportTemplate(
  kind: 'gsp' | 'po' | 'settle-price' | 'perf-price',
) {
  const response = await request.get(`/import/templates/${kind}`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = TEMPLATE_FILENAMES[kind];
  anchor.click();
  URL.revokeObjectURL(url);
}
export async function fetchFinanceInspectors(caseId: string) {
  return unwrap(
    await request.get<ApiResponse<FinanceInspectorOption[]>>(`/cases/${caseId}/inspectors`),
  );
}
export async function assignFinanceCase(
  caseId: string,
  inspectorIdOrIds: string | string[],
  reason?: string,
  options?: { assignMode?: 'single' | 'multi'; plannedUnits?: number },
) {
  const body =
    typeof inspectorIdOrIds === 'string'
      ? { inspectorId: inspectorIdOrIds, reason, ...options }
      : { inspectorIds: inspectorIdOrIds, reason, ...options };
  return unwrap(await request.post<ApiResponse<FinanceCase>>(`/cases/${caseId}/assign`, body));
}
export async function withdrawFinanceAssignee(caseId: string, inspectorId: string) {
  return unwrap(
    await request.post<ApiResponse<unknown>>(
      `/cases/${caseId}/assignees/${inspectorId}/withdraw`,
    ),
  );
}
export async function setFinanceCaseWorkPlan(
  caseId: string,
  payload: { plannedUnits?: number; expenseEnabled?: boolean },
) {
  return unwrap(
    await request.put<ApiResponse<unknown>>(`/cases/${caseId}/work-plan`, payload),
  );
}
export async function fetchPendingExpenses(params?: {
  status?: 'pending' | 'approved' | 'rejected' | 'all';
  keyword?: string;
  month?: string;
}) {
  return unwrap(
    await request.get<ApiResponse<ExpenseReviewRow[]>>('/cases/expenses/pending', {
      params,
    }),
  );
}
export async function reviewExpense(
  expenseId: string,
  pass: boolean,
  note?: string,
  approvedAmount?: number,
) {
  return unwrap(
    await request.post<ApiResponse<unknown>>(
      `/cases/expenses/${expenseId}/${pass ? 'approve' : 'reject'}`,
      {
        note,
        ...(pass && approvedAmount !== undefined ? { approvedAmount } : {}),
      },
    ),
  );
}

export type ExpenseReviewRow = {
  id: string;
  serviceCaseId: string;
  gspCaseNo?: string;
  projectName?: string;
  inspectorId: string;
  inspectorName?: string;
  amount: string;
  note?: string | null;
  voucherUrls?: string[];
  status: string;
  month?: string | null;
  reviewNote?: string | null;
  reviewAt?: string | null;
  createdAt?: string;
};
export async function setFinanceCaseSite(caseId: string, siteId: string) {
  return unwrap(
    await request.put<ApiResponse<FinanceCase>>(`/cases/${caseId}/site`, { siteId }),
  );
}
export async function batchAssignFinanceCasesToSites(caseIds: string[], siteId: string) {
  return unwrap(
    await request.post<
      ApiResponse<{
        updated: number;
        siteId: string;
        siteName: string;
        skipped?: Array<{ caseId: string; reason: string }>;
      }>
    >('/cases/assign-sites', { caseIds, siteId }),
  );
}
export async function setFinanceCaseTaskType(
  caseId: string,
  templateId: string,
  productLine?: string,
) {
  return unwrap(
    await request.put<ApiResponse<FinanceCase>>(`/cases/${caseId}/task-type`, {
      templateId,
      productLine: productLine || undefined,
    }),
  );
}
export async function batchCreateTasksFromCases(payload: {
  caseIds: string[];
  inspectorId: string;
}) {
  return unwrap(
    await request.post<
      ApiResponse<{
        createdTasks: number;
        serviceAssigned: number;
        skipped: Array<{ caseId: string; reason: string }>;
        taskIds: string[];
      }>
    >('/cases/batch-create-tasks', payload),
  );
}
export async function fetchPendingFinanceReviews(params?: {
  keyword?: string;
  siteId?: string;
  month?: string;
  overdue?: string;
  reviewStatus?: 'pending' | 'approved' | 'rejected' | 'all';
}) {
  return unwrap(
    await request.get<ApiResponse<FinanceReviewItem[]>>('/review/pending', { params }),
  );
}
export async function fetchReviewAmountBreakdown(caseId: string) {
  return unwrap(
    await request.get<ApiResponse<ReviewAmountBreakdown>>(`/review/${caseId}/amount-breakdown`),
  );
}
export async function approveFinanceReview(caseId: string, comment?: string) {
  return unwrap(await request.post<ApiResponse<Record<string, unknown>>>(`/review/${caseId}/approve`, { comment }));
}
export async function rejectFinanceReview(caseId: string, reason: string) {
  return unwrap(await request.post<ApiResponse<Record<string, unknown>>>(`/review/${caseId}/reject`, { reason }));
}
export async function saveFinanceDeduction(caseId: string, amount: number, reason: string) {
  return unwrap(
    await request.post<ApiResponse<Record<string, unknown>>>(`/review/${caseId}/deduction`, {
      amount,
      reason,
    }),
  );
}
export async function reviewFinanceDeduction(caseId: string, approved: boolean, comment?: string) {
  return unwrap(
    await request.post<ApiResponse<Record<string, unknown>>>(
      `/review/${caseId}/deduction/${approved ? 'approve' : 'reject'}`,
      { comment },
    ),
  );
}
export async function fetchFinanceCase(id: string) {
  return unwrap(await request.get<ApiResponse<FinanceCase>>(`/cases/${id}`));
}
export async function fetchPoOrders(params: Record<string, unknown>) {
  return unwrap(await request.get<ApiResponse<FinancePage<PoOrder>>>('/po-orders', { params }));
}
export async function clearPoOrders() {
  return unwrap(
    await request.delete<ApiResponse<{ deleted: number }>>('/po-orders/clear', {
      params: { confirm: '清空' },
    }),
  );
}
export async function matchPoOrder(id: string, gspCaseNo: string) {
  return unwrap(await request.post<ApiResponse<PoOrder>>(`/po-orders/${id}/match`, { gspCaseNo }));
}
export async function fetchPrices(params: Record<string, unknown>) {
  return unwrap(await request.get<ApiResponse<FinancePage<PriceItem>>>('/prices', { params }));
}
export async function createPrice(payload: Record<string, unknown>) {
  return unwrap(await request.post<ApiResponse<PriceItem>>('/prices', payload));
}
export async function updatePrice(id: string, payload: Record<string, unknown>) {
  return unwrap(await request.put<ApiResponse<PriceItem>>(`/prices/${id}`, payload));
}
export async function deletePrice(id: string) {
  return unwrap(await request.delete<ApiResponse<{ id: string; deleted: boolean }>>(`/prices/${id}`));
}
export async function clearPrices(type: 'settle' | 'perf') {
  return unwrap(
    await request.delete<ApiResponse<{ priceType: string; deleted: number }>>('/prices/clear', {
      params: { type, confirm: '清空' },
    }),
  );
}
export async function fetchItemPriceMappings() {
  return unwrap(await request.get<ApiResponse<ItemPriceMappingList>>('/prices/mappings'));
}
export async function saveItemPriceMapping(sourceItemName: string, targetItemCode: string) {
  return unwrap(
    await request.post<ApiResponse<Record<string, unknown>>>('/prices/mappings', {
      sourceItemName,
      targetItemCode,
    }),
  );
}
export async function recalculateItemPrices() {
  return unwrap(
    await request.post<
      ApiResponse<{
        affectedItems: number;
        pricedItems: number;
        pendingPrice: number;
        income: string;
      }>
    >('/prices/mappings/recalculate'),
  );
}
export async function generateCasesFromPo() {
  return unwrap(
    await request.post<
      ApiResponse<{
        pendingOrders: number;
        generatedCases: number;
        matchedOrders: number;
        failRows: number;
      }>
    >('/po-orders/generate-cases'),
  );
}
export async function fetchFinanceDashboard(params: Record<string, unknown> = {}) {
  return unwrap(await request.get<ApiResponse<FinanceDashboard>>('/finance/dashboard', { params }));
}
export async function fetchFinanceVarianceDetail(params: Record<string, unknown> = {}) {
  return unwrap(
    await request.get<ApiResponse<FinanceVarianceDetail>>('/finance/dashboard/variance', { params }),
  );
}
export async function uploadFinanceExcel(
  kind: 'gsp' | 'po' | 'price' | 'perf-price',
  file: File,
  preview: boolean,
  chunk?: { offset?: number; limit?: number; batchId?: string },
) {
  const form = new FormData();
  form.append('file', file);
  const url =
    kind === 'gsp'
      ? '/import/gsp-cases'
      : kind === 'po'
        ? '/import/po-orders'
        : kind === 'perf-price'
          ? '/prices/import-perf'
          : '/prices/import';
  return unwrap(
    await request.post<ApiResponse<ImportResult>>(url, form, {
      params: {
        preview: String(preview),
        ...(chunk?.offset != null ? { offset: chunk.offset } : {}),
        ...(chunk?.limit != null ? { limit: chunk.limit } : {}),
        ...(chunk?.batchId ? { batchId: chunk.batchId } : {}),
      },
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    }),
  );
}
