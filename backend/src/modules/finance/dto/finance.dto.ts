import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsPostgresUuid } from '../../../common/decorators/postgres-uuid.decorator';

export class ImportPreviewQueryDto {
  @IsOptional() @IsIn(['true', 'false']) preview?: string;
  /** 分块入库起始下标（配合 limit，避免一次写入超时） */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) offset?: number;
  /** 本批处理条数；不传则一次全部写入（导入专用，可大于列表查询的 100） */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(2000) limit?: number;
  /** 续传同一导入批次（import_batch.id，bigint 字符串） */
  @IsOptional() @IsString() @MaxLength(32) batchId?: string;
}

export class FinanceCaseQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() region?: string;
  /** 按案例省份筛选（GSP 导入字段） */
  @IsOptional() @IsString() @MaxLength(32) province?: string;
  /** 按案例城市筛选；建议与 province 联用 */
  @IsOptional() @IsString() @MaxLength(32) city?: string;
  @IsOptional() @IsString() month?: string;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsPostgresUuid() siteId?: string;
  /** unassigned=未挂网格点；assigned_site=已挂网格点 */
  @IsOptional() @IsIn(['unassigned', 'assigned_site']) siteBind?: 'unassigned' | 'assigned_site';
  /** 按服务类型模板 id 筛选；兼容旧值 inspection/service */
  @IsOptional() @IsString() @MaxLength(64) taskType?: string;
}

export class SetCaseSiteDto {
  @IsPostgresUuid() siteId: string;
}

export class BatchAssignCasesToSitesDto {
  @IsArray()
  @IsString({ each: true })
  caseIds: string[];
  @IsPostgresUuid() siteId: string;
}

export class SetCaseTaskTypeDto {
  /** 服务类型设置中的模板 id */
  @IsPostgresUuid({ message: '请选择服务类型' })
  templateId: string;

  /** 产品线名称（服务类型配置了产品线时必填） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productLine?: string;
}

export class BatchCreateTasksFromCasesDto {
  @IsArray()
  @IsString({ each: true })
  caseIds: string[];
  /** 必填：派给本网格工程师（案例作业，不依赖设备） */
  @IsPostgresUuid() inspectorId: string;
}

export class PoOrderQueryDto extends PaginationDto {
  @IsOptional() @IsIn(['matched', 'pending']) matchStatus?: 'matched' | 'pending';
  @IsOptional() @IsString() keyword?: string;
}

export class PriceQueryDto extends PaginationDto {
  @IsOptional() @IsIn(['settle', 'perf']) type?: 'settle' | 'perf';
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() scene?: string;
  @IsOptional() @IsString() region?: string;
}

export class ClearPriceQueryDto {
  @IsIn(['settle', 'perf']) type: 'settle' | 'perf';
  /** 必须传「清空」 */
  @IsString() confirm: string;
}

export class ClearConfirmQueryDto {
  /** 必须传「清空」 */
  @IsString() confirm: string;
}

export class MatchPoDto {
  @IsString() @MaxLength(32) gspCaseNo: string;
}

export class CreatePriceDto {
  @IsIn(['settle', 'perf']) priceType: 'settle' | 'perf';
  @IsString() itemCode: string;
  @IsString() itemName: string;
  @IsOptional() @IsString() itemDesc?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() productModel?: string;
  @IsOptional() @IsString() scene?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() coopType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) workHours?: number;
  @Type(() => Number) @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsOptional() @IsString() changeRemark?: string;
}

export class UpdatePriceDto extends CreatePriceDto {
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class SaveItemMappingDto {
  @IsString() @MaxLength(255) sourceItemName: string;
  @IsString() @MaxLength(255) targetItemCode: string;
}

export class DashboardQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() project?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() demandType?: string;
}

export class AssignCaseDto {
  /** 兼容单人 */
  @IsOptional() @IsPostgresUuid({ message: '工程师ID格式不正确' }) inspectorId?: string;
  /** 多人派单 */
  @IsOptional() @IsArray() @IsPostgresUuid({ each: true, message: '工程师ID格式不正确' })
  inspectorIds?: string[];
  /** 派单时选择：单人 / 多人（不再跟服务类型绑定） */
  @IsOptional() @IsIn(['single', 'multi']) assignMode?: 'single' | 'multi';
  /** 多人模式计划台数 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) plannedUnits?: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class SetCaseWorkPlanDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) plannedUnits?: number;
  @IsOptional() @IsBoolean() expenseEnabled?: boolean;
}

/** @deprecated 兼容旧客户端；新流程用 SaveTripExpenseDto */
export class SaveExpenseClaimDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) voucherUrls?: string[];
  @IsOptional() @IsBoolean() submit?: boolean;
  /** 行程报销挂载台 */
  @IsOptional() @IsString() workUnitId?: string;
  @IsOptional() @IsString() startOdometerUrl?: string;
  @IsOptional() @IsString() startNavUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) startMileage?: number;
  @IsOptional() @IsString() endOdometerUrl?: string;
  @IsOptional() @IsString() endNavUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) endMileage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) tollAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) fuelAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) otherAmount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) tollVoucherUrls?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) fuelVoucherUrls?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) otherVoucherUrls?: string[];
}

export class SaveTripExpenseDto {
  @IsOptional() @IsString() startOdometerUrl?: string;
  @IsOptional() @IsString() startNavUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) startMileage?: number;
  @IsOptional() @IsString() endOdometerUrl?: string;
  @IsOptional() @IsString() endNavUrl?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) endMileage?: number;
  /** 工程师自算申报金额 */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) voucherUrls?: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() submit?: boolean;
  /** 开工选择无行程；可再改为 false 并补开始里程 */
  @IsOptional() @IsBoolean() tripSkipped?: boolean;
}

export class OcrMileageDto {
  @IsString() @IsNotEmpty() imageUrl: string;
  @IsOptional() @IsIn(['start', 'end']) kind?: 'start' | 'end';
}

export class ReviewExpenseDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** 核定报销金额；不传则按工程师申报金额通过 */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) approvedAmount?: number;
}

export class SaveCaseWorkDto {
  @IsOptional() @IsObject() workload?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) mileage?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) expenses?: number;
  @IsOptional() @IsString() @MaxLength(500) expenseNote?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) mileageScreenshotUrls?: string[];
  @IsOptional() @IsString() @MaxLength(1000) workNote?: string;
}

export class ReviewCommentDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class RejectSettlementDto {
  @IsString() @MaxLength(500) reason: string;
}

export class DeductionDto {
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
  @IsString() @MaxLength(500) reason: string;
}

export class DeductionReviewDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class IncomeQueryDto {
  @IsOptional() @IsString() month?: string;
}

export class AssessmentQueryDto {
  @IsString() month: string;
  @IsOptional() @IsString() @MaxLength(64) keyword?: string;
  @IsOptional() @IsPostgresUuid() siteId?: string;
  @IsOptional() @IsIn(['site_manager', 'inspector']) role?: 'site_manager' | 'inspector';
}

export class RankAssessmentDto {
  /** site_preview=本网格仅看名次(1/2/3…)；company_*=全司正式排名+奖罚 */
  @IsIn(['site_preview', 'company_inspectors', 'company_managers'])
  mode: 'site_preview' | 'company_inspectors' | 'company_managers';
  /** 管理员对本网格参考排名时可选网格；网格长忽略，固定本网格 */
  @IsOptional() @IsPostgresUuid() siteId?: string;
}

export class SaveAssessmentDto {
  @IsString() month: string;
  @IsPostgresUuid({ message: '用户ID格式不正确' }) userId: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) internalScore: number;
  /** 已取消阳光加权，保留字段兼容旧客户端，写入时忽略 */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) sungrowScore?: number;
  @IsOptional() @Type(() => Number) @IsNumber() rewardAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) toolSubsidy?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) otherSubsidy?: number;
  @IsOptional() @IsString() @MaxLength(500) subsidyRemark?: string;
}

export class CreateAssessmentEventDto {
  @IsString() month: string;
  @IsPostgresUuid({ message: '用户ID格式不正确' }) userId: string;
  @IsString() @MaxLength(64) catalogId: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) qty?: number;
  /** 自定义金额项必填；标准项可省略（按标准×次数） */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
  /** 关联案例：结算审核录入时应带上，便于一单一算追溯（service_case.id） */
  @IsOptional() @IsString() @MaxLength(32) serviceCaseId?: string;
}

export class MonthlyQueryDto {
  @IsString() month: string;
  @IsOptional() @IsString() @MaxLength(64) keyword?: string;
  @IsOptional() @IsPostgresUuid() siteId?: string;
  @IsOptional() @IsIn(['site_manager', 'inspector']) role?: 'site_manager' | 'inspector';
}

export class ReviewPendingQueryDto {
  @IsOptional() @IsString() @MaxLength(64) keyword?: string;
  @IsOptional() @IsPostgresUuid() siteId?: string;
  @IsOptional() @IsString() month?: string;
  @IsOptional() @IsIn(['true', 'false', '1', '0']) overdue?: string;
  /** pending=待审(默认)；approved=已通过；rejected=已驳回；all=全部 */
  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'all']) reviewStatus?: string;
}

export class CorrectMonthlyDto {
  @IsPostgresUuid({ message: '用户ID格式不正确' }) userId: string;
  @Type(() => Number) @IsNumber() amount: number;
  @IsString() @MaxLength(500) reason: string;
}

export class MonthlyExportDto {
  @IsOptional() @IsIn(['reconcile', 'payroll']) template?: 'reconcile' | 'payroll';
}
