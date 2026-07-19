import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CasePerformance,
  ChangeLog,
  ImportBatch,
  PoItem,
  PoOrder,
  PriceLibrary,
  ServiceCase,
  User,
  ItemPriceMapping,
  CaseWorkRecord,
  Assessment,
  MonthlySettlement,
} from '../../entities';
import { UploadModule } from '../upload/upload.module';
import { FinanceImportController } from './controllers/import.controller';
import { FinanceCaseController } from './controllers/case.controller';
import { FinancePoController } from './controllers/po-order.controller';
import { FinancePriceController } from './controllers/price.controller';
import { FinanceDashboardController } from './controllers/finance-dashboard.controller';
import { ExcelParserService } from './services/excel-parser.service';
import { FinanceImportService } from './services/finance-import.service';
import { FinanceQueryService } from './services/finance-query.service';
import { FinanceScopeService } from './services/finance-scope.service';
import { PriceService } from './services/price.service';
import { ChangeLogService } from './services/change-log.service';
import { PriceMappingService } from './services/price-mapping.service';
import { FinanceWorkflowService } from './services/finance-workflow.service';
import { FinanceReviewController } from './controllers/review.controller';
import { FinanceIncomeController } from './controllers/income.controller';
import { FinanceAssessmentController } from './controllers/assessment.controller';
import { FinanceMonthlySettlementController } from './controllers/monthly-settlement.controller';
import { FinanceSettlementService } from './services/finance-settlement.service';

@Module({
  imports: [
    UploadModule,
    TypeOrmModule.forFeature([
      User,
      ServiceCase,
      PoOrder,
      PoItem,
      PriceLibrary,
      CasePerformance,
      ImportBatch,
      ChangeLog,
      ItemPriceMapping,
      CaseWorkRecord,
      Assessment,
      MonthlySettlement,
    ]),
  ],
  controllers: [
    FinanceImportController,
    FinanceCaseController,
    FinancePoController,
    FinancePriceController,
    FinanceDashboardController,
    FinanceReviewController,
    FinanceIncomeController,
    FinanceAssessmentController,
    FinanceMonthlySettlementController,
  ],
  providers: [
    ExcelParserService,
    FinanceImportService,
    FinanceQueryService,
    FinanceScopeService,
    PriceService,
    ChangeLogService,
    PriceMappingService,
    FinanceWorkflowService,
    FinanceSettlementService,
  ],
})
export class FinanceModule {}
