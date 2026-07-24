import request from '../utils/request';
import type { ApiResponse } from '../types';
import type {
  FinanceCase,
  FinanceDashboard,
  FinancePage,
  ImportResult,
  PoOrder,
  PriceItem,
  ItemPriceMappingList,
  FinanceInspectorOption,
  FinanceReviewItem,
  FinanceAssessment,
  AssessmentEventCatalogItem,
  AssessmentEventRow,
  FinanceMonthlySettlement,
} from '../types/finance';

const unwrap = <T>(response: { data: ApiResponse<T> }) => response.data.data;
export async function fetchFinanceCases(params: Record<string, unknown>) {
  return unwrap(await request.get<ApiResponse<FinancePage<FinanceCase>>>('/cases', { params }));
}

export async function fetchFinanceAssessments(month: string) {
  return unwrap(await request.get<ApiResponse<FinanceAssessment[]>>('/assessments', { params: { month } }));
}
export async function saveFinanceAssessment(payload: Record<string, unknown>) {
  return unwrap(await request.post<ApiResponse<FinanceAssessment>>('/assessments', payload));
}
export async function rankFinanceAssessments(month: string) {
  return unwrap(await request.post<ApiResponse<FinanceAssessment[]>>(`/assessments/${month}/rank`));
}
export async function fetchAssessmentEventCatalog() {
  return unwrap(await request.get<ApiResponse<AssessmentEventCatalogItem[]>>('/assessments/event-catalog'));
}
export async function fetchAssessmentEvents(month: string, userId: string) {
  return unwrap(
    await request.get<ApiResponse<AssessmentEventRow[]>>('/assessments/events', {
      params: { month, userId },
    }),
  );
}
export async function createAssessmentEvent(payload: Record<string, unknown>) {
  return unwrap(await request.post<ApiResponse<AssessmentEventRow>>('/assessments/events', payload));
}
export async function deleteAssessmentEvent(id: string) {
  return unwrap(await request.delete<ApiResponse<{ id: string }>>(`/assessments/events/${id}`));
}
export async function fetchMonthlySettlements(month: string) {
  return unwrap(await request.get<ApiResponse<FinanceMonthlySettlement[]>>('/monthly-settlements', { params: { month } }));
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
export async function fetchFinanceInspectors(caseId: string) {
  return unwrap(
    await request.get<ApiResponse<FinanceInspectorOption[]>>(`/cases/${caseId}/inspectors`),
  );
}
export async function assignFinanceCase(caseId: string, inspectorId: string, reason?: string) {
  return unwrap(
    await request.post<ApiResponse<FinanceCase>>(`/cases/${caseId}/assign`, {
      inspectorId,
      reason,
    }),
  );
}
export async function fetchPendingFinanceReviews() {
  return unwrap(await request.get<ApiResponse<FinanceReviewItem[]>>('/review/pending'));
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
  return unwrap(await request.get<ApiResponse<Record<string, unknown>>>(`/cases/${id}`));
}
export async function fetchPoOrders(params: Record<string, unknown>) {
  return unwrap(await request.get<ApiResponse<FinancePage<PoOrder>>>('/po-orders', { params }));
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
      params: { type },
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
      timeout: 180000,
    }),
  );
}
