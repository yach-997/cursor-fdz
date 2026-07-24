import {
  IsArray,
  IsIn,
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
  /** 本批处理条数；不传则一次全部写入 */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) limit?: number;
  /** 续传同一导入批次（import_batch.id，bigint 字符串） */
  @IsOptional() @IsString() @MaxLength(32) batchId?: string;
}

export class FinanceCaseQueryDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() month?: string;
  @IsOptional() @IsString() keyword?: string;
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
  /** 种子账号可能是非 RFC UUID，按 Postgres uuid 文本格式校验 */
  @IsPostgresUuid({ message: '工程师ID格式不正确' }) inspectorId: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
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
}

export class MonthlyQueryDto {
  @IsString() month: string;
}

export class CorrectMonthlyDto {
  @IsPostgresUuid({ message: '用户ID格式不正确' }) userId: string;
  @Type(() => Number) @IsNumber() amount: number;
  @IsString() @MaxLength(500) reason: string;
}

export class MonthlyExportDto {
  @IsOptional() @IsIn(['reconcile', 'payroll']) template?: 'reconcile' | 'payroll';
}
