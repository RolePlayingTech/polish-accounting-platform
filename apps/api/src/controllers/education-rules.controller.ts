import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccountingWorkspaceValidationError } from '@pap/application';
import {
  ExplainLegalRuleRequestSchema,
  TaxProfileCodeSchema,
  type GradeAcademyLessonRequest,
  type TaxProfileCode,
} from '@pap/contracts';
import { JwtBearerAuthGuard, OptionalJwtAuth } from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';

@Controller('/api/v1')
@UseGuards(JwtBearerAuthGuard)
@OptionalJwtAuth()
export class EducationRulesController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
  ) {}

  @Get('/legal-rules')
  @Header('Cache-Control', 'no-store')
  listLegalRules(@Query('asOfDate') asOfDate?: string, @Query('profile') rawProfile?: string) {
    let profile: TaxProfileCode | undefined;
    if (rawProfile !== undefined) {
      const parsed = TaxProfileCodeSchema.safeParse(rawProfile);
      if (!parsed.success) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_tax_profile',
          `Nieznany kod profilu podatkowego: ${rawProfile}.`,
        );
      }
      profile = parsed.data;
    }
    return this.workspace.listLegalRules(asOfDate, profile);
  }

  @Get('/legal-rules/:ruleCode')
  @Header('Cache-Control', 'no-store')
  getLegalRuleDetail(@Param('ruleCode') ruleCode: string, @Query('asOfDate') asOfDate?: string) {
    return this.workspace.getLegalRuleDetail(ruleCode, asOfDate);
  }

  @Post('/legal-rules/explain')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  explainLegalRule(@Body() body: unknown) {
    const parsed = ExplainLegalRuleRequestSchema.parse(body ?? {});
    return this.workspace.explainLegalRule(parsed);
  }

  @Get('/academy')
  @Header('Cache-Control', 'no-store')
  getAcademyCourse() {
    return this.workspace.getAcademyCourse();
  }

  @Post('/academy/lessons/:lessonSlug/grade')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  gradeAcademyLesson(@Param('lessonSlug') lessonSlug: string, @Body() body: unknown) {
    return this.workspace.gradeAcademyLesson(lessonSlug, (body ?? {}) as GradeAcademyLessonRequest);
  }
}
