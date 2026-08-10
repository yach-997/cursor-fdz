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
  creator?: string;
  province?: string;
  city?: string;
  siteDesc?: string;
  region: string;
  status: string;
  siteId?: string | null;
  siteName?: string | null;
  siteManagerName?: string | null;
  taskType?: string | null;
  taskTemplateId?: string | null;
  taskTypeName?: string | null;
  assignMode?: 'single' | 'multi';
  plannedUnits?: number;
  completedUnits?: number;
  expenseEnabled?: boolean;
  unitLabel?: string;
  productLine?: string | null;
  inspectorId?: string;
  inspectorName?: string | null;
  finishTime?: string;
  updatedAt: string;
  caseRevenue: string;
  assignments?: Array<{
    inspectorId: string;
    inspectorName?: string;
    username?: string;
    phone?: string;
    status?: string;
    completedUnits?: number;
  }>;
}
export interface PoItemRow {
  id: string;
  poId: string;
  itemCategory: 'special' | 'general';
  itemCode: string;
  itemName: string;
  itemDesc?: string | null;
  unit?: string | null;
  qty: string | number;
  priceStatus?: string;
}
export interface PoOrder {
  id: string;
  poNo: string;
  gspCaseNo: string;
  poTotalAmount: string;
  demandDate?: string;
  demandType?: string;
  productModel?: string;
  productQty?: string | number | null;
  faultLevel?: string;
  durationReq?: string;
  province?: string;
  projectName?: string;
  projectScene?: string;
  matchStatus: 'matched' | 'pending';
  items?: PoItemRow[];
  specialItemCount?: number;
  generalItemCount?: number;
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
  ignoredList?: Array<{ sourceItemName: string; totalCount: number; qty: number }>;
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
    ignoredCount?: number;
    okCount?: number;
    varianceAmount?: number;
    varianceRate: number;
    performanceExpense?: number;
    otherCost?: number;
    grossProfit?: number;
  };
  ignoredItems?: Array<{ itemCode: string; count: number; qty: number }>;
  trend: Array<{ month: string; income: string }>;
}

export interface FinanceVarianceDetail {
  summary: {
    income: number;
    poTotalAmount: number;
    varianceAmount: number;
    varianceRate: number;
    pendingPrice: number;
    ignoredCount: number;
    okCount: number;
    unmatchedPoCount: number;
    unmatchedPoAmount: number;
    caseGapCount: number;
    caseGapAmount: number;
  };
  buckets: Array<{
    key: string;
    label: string;
    amount: number;
    count: number;
    tip: string;
  }>;
  cases: Array<{
    caseId: string;
    gspCaseNo: string;
    projectName: string;
    poTotalAmount: number;
    caseRevenue: number;
    gap: number;
    pendingPrice: number;
    ignoredCount: number;
    okCount: number;
    reason: string;
  }>;
  unmatchedPos: Array<{
    id: string;
    poNo: string;
    gspCaseNo: string;
    projectName: string;
    poTotalAmount: number;
    matchStatus: string;
  }>;
  ignoredItems: Array<{ itemCode: string; count: number; qty: number }>;
}

export interface FinanceAssessment {
  id?: string;
  month: string;
  userId: string;
  realName: string;
  username: string;
  region?: string;
  userRole: string; // site_manager | inspector | dual
  siteId?: string | null;
  siteName?: string | null;
  internalScore?: string;
  sungrowScore?: string;
  totalScore?: string;
  /** 本网格参考名次（第几名，不发奖） */
  siteRankResult?: string | null;
  /** 全司正式排名 */
  rankResult?: string;
  rewardAmount?: string;
  eventPenalty?: string;
  toolSubsidy?: string;
  otherSubsidy?: string;
  subsidyRemark?: string;
}
export interface AssessmentEventCatalogItem {
  id: string;
  category: string;
  content: string;
  unit: string;
  unitAmount: number | null;
  remark?: string;
}
export interface AssessmentEventRow {
  id: string;
  month: string;
  userId: string;
  userName?: string | null;
  serviceCaseId?: string | null;
  category: string;
  content: string;
  unit: string;
  qty: string;
  unitAmount?: string | null;
  amount: string;
  remark?: string | null;
}
export interface FinanceMonthlySettlement {
  id: string;
  month: string;
  userId: string;
  perfTotal: string;
  rewardTotal: string;
  eventPenalty?: string;
  subsidyTotal: string;
  correctionTotal: string;
  finalAmount: string;
  status: 'draft' | 'corrected' | 'locked';
  user?: { realName: string; username: string; region?: string };
}
export interface FinanceInspectorOption {
  id: string;
  realName: string;
  username?: string;
  phone: string;
  region: string;
  available: boolean;
  /** 当前在办案例数（允许多人多案后仅作提示） */
  activeCaseCount?: number;
}
export interface FinanceReviewItem {
  id: string;
  gspCaseNo: string;
  projectName: string;
  region: string;
  inspectorId?: string;
  inspectorName?: string;
  finishTime?: string;
  dueAt?: string;
  overdue: boolean;
  remainingHours?: number;
  perfBase: string;
  deduction: string;
  /** 本案例已登记的事件扣罚合计 */
  eventPenalty?: number | string;
  perfFinal: string;
  caseRevenue: string;
  reviewStatus: string;
  deductionStatus: string;
  missingPerf: number;
  /** 本案例待核定行程报销条数 */
  pendingExpenseCount?: number;
  approvalReady: boolean;
  reviewTime?: string | null;
  reviewComment?: string | null;
}
export interface ReviewCaseExpense {
  id: string;
  serviceCaseId: string;
  workUnitId?: string | null;
  unitSeq?: number | null;
  unitLabel?: string | null;
  inspectorId: string;
  inspectorName?: string;
  amount: string;
  claimAmount?: string | null;
  note?: string | null;
  voucherUrls?: string[];
  startOdometerUrl?: string | null;
  startNavUrl?: string | null;
  startMileage?: string | null;
  endOdometerUrl?: string | null;
  endNavUrl?: string | null;
  endMileage?: string | null;
  mileageKm?: string | null;
  tripSkipped?: boolean;
  status: string;
  reviewNote?: string | null;
  reviewAt?: string | null;
  createdAt?: string;
}
export interface ReviewAmountBreakdown {
  caseId: string;
  gspCaseNo: string;
  projectName: string;
  finishTime?: string | null;
  caseRevenue: string;
  perfBase: string;
  deduction: string;
  perfFinal: string;
  eventPenalty: string;
  pendingExpenseCount?: number;
  items: Array<{
    id: string;
    poId: string;
    itemCode: string;
    itemName: string;
    unit?: string | null;
    qty: string;
    settlePrice?: string | null;
    itemRevenue: string;
    perfPrice?: string | null;
    itemPerf: string;
    priceStatus?: string;
  }>;
  events: Array<{
    id: string;
    category?: string;
    content: string;
    amount: string;
    remark?: string | null;
    userId: string;
    userName?: string | null;
    createdAt?: string;
  }>;
  expenses?: ReviewCaseExpense[];
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
  warnings?: Array<{ row?: number; warning?: string }>;
  matchWarnings?: Array<{
    row?: number;
    gspCaseNo?: string;
    code?: string;
    message: string;
  }>;
  matchedTypes?: number;
  batchId?: string;
  generatedCases?: number;
  matchedOrders?: number;
  offset?: number;
  nextOffset?: number;
  done?: boolean;
  chunkSuccess?: number;
}
