export interface FinancePage<T> {
  list: T[];
  total: number;
  page: number;
  limit: number;
}
export interface FinanceCase {
  id: string;
  gspCaseNo: string;
  projectName: string;
  serviceType?: string;
  province?: string;
  city?: string;
  region: string;
  status: string;
  inspectorId?: string;
  finishTime?: string;
  updatedAt: string;
  caseRevenue: string;
}
export interface PoOrder {
  id: string;
  poNo: string;
  gspCaseNo: string;
  poTotalAmount: string;
  demandDate?: string;
  demandType?: string;
  productModel?: string;
  province?: string;
  projectName?: string;
  projectScene?: string;
  matchStatus: 'matched' | 'pending';
}
export interface PriceItem {
  id: string;
  priceType: 'settle' | 'perf';
  itemCode: string;
  itemName: string;
  itemDesc?: string;
  unit?: string;
  productModel?: string;
  scene?: string;
  region?: string;
  coopType?: string;
  workHours?: string;
  unitPrice: string;
  effectiveDate: string;
  status: string;
  changeRemark?: string;
}
export interface ItemPriceMappingRow {
  sourceItemName: string;
  totalCount: number;
  pendingCount: number;
  targetItemCode?: string;
  mappingType?: 'manual' | 'builtin';
  suggestedTargetCode?: string;
  confidence?: number;
}
export interface ItemPriceMappingList {
  list: ItemPriceMappingRow[];
  targetCodes: string[];
}
export interface FinanceDashboard {
  summary: {
    income: number;
    poTotalAmount: number;
    poCount: number;
    caseCount: number;
    pendingMatch: number;
    pendingPrice: number;
    varianceRate: number;
    performanceExpense?: number;
    otherCost?: number;
    grossProfit?: number;
  };
  trend: Array<{ month: string; income: string }>;
}

export interface FinanceAssessment {
  id?: string;
  month: string;
  userId: string;
  realName: string;
  username: string;
  region?: string;
  userRole: string;
  internalScore?: string;
  sungrowScore?: string;
  totalScore?: string;
  rankResult?: string;
  rewardAmount?: string;
  toolSubsidy?: string;
  otherSubsidy?: string;
  subsidyRemark?: string;
}
export interface FinanceMonthlySettlement {
  id: string;
  month: string;
  userId: string;
  perfTotal: string;
  rewardTotal: string;
  subsidyTotal: string;
  correctionTotal: string;
  finalAmount: string;
  status: 'draft' | 'corrected' | 'locked';
  user?: { realName: string; username: string; region?: string };
}
export interface FinanceInspectorOption {
  id: string;
  realName: string;
  phone: string;
  region: string;
  available: boolean;
}
export interface FinanceReviewItem {
  id: string;
  gspCaseNo: string;
  projectName: string;
  region: string;
  inspectorName?: string;
  finishTime?: string;
  dueAt?: string;
  overdue: boolean;
  remainingHours?: number;
  perfBase: string;
  deduction: string;
  perfFinal: string;
  caseRevenue: string;
  reviewStatus: string;
  deductionStatus: string;
  missingPerf: number;
  approvalReady: boolean;
}
export interface ImportResult {
  preview?: unknown[];
  totalRows?: number;
  totalOrders?: number;
  sourceItemRows?: number;
  normalizedItemCount?: number;
  successRows?: number;
  failRows?: number;
  failures?: Array<{ row: number; reason: string }>;
  batchId?: string;
  generatedCases?: number;
  matchedOrders?: number;
}
