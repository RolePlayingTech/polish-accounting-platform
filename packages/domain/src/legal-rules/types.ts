export type TaxProfileCode =
  'jdg_kpir_skala' | 'jdg_kpir_liniowy' | 'jdg_ryczalt' | 'spzoo_pelne_ksiegi';

export type ProfileSupportLevel = 'supported' | 'reviewed' | 'experimental' | 'planned';

export type LegalSourceType = 'statute' | 'regulation' | 'official_guidance' | 'schema';

export type RuleVerificationStatus = 'verified' | 'requires_expert_review' | 'unverified';

export type LegalRuleCode =
  | 'ORDYNACJA_ART_63_TAX_ROUNDING'
  | 'ORDYNACJA_ART_12_DEADLINE_SHIFT'
  | 'STATUTORY_HOLIDAYS_POLAND'
  | 'VAT_RATES_STANDARD_AND_REDUCED'
  | 'VAT_EXEMPTION_LIMIT_ART_113'
  | 'VAT_VEHICLE_DEDUCTION_ART_86A'
  | 'VAT_SPLIT_PAYMENT_MPP_ART_108A'
  | 'VAT_JPK_V7_DEADLINE_AND_SCHEMA'
  | 'SMALL_TAXPAYER_LIMIT_2M_EUR'
  | 'PIT_TAX_SCALE_ART_27'
  | 'PIT_FLAT_TAX_ART_30C'
  | 'PIT_FLAT_HEALTH_DEDUCTION_LIMIT'
  | 'PIT_ADVANCE_DEADLINE_ART_44'
  | 'KPIR_REGULATION_COLUMNS'
  | 'PIT_CAR_MIXED_EXPENSE_75_ART_23'
  | 'PIT_NKUP_EXCLUSIONS_ART_23'
  | 'RYCZALT_RATES_ART_12'
  | 'RYCZALT_HEALTH_DEDUCTION_50_ART_11'
  | 'RYCZALT_DEADLINE_ART_21'
  | 'ZUS_ULGA_NA_START_ART_18_PP'
  | 'ZUS_PREFERENCYJNY_ART_18A'
  | 'ZUS_DUZY_ART_18_UST_8'
  | 'ZUS_SOCIAL_RATES_ART_22'
  | 'ZUS_INDIVIDUAL_ACCIDENT_RATE_IWA'
  | 'ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81'
  | 'ZUS_HEALTH_RYCZALT_ART_81_UST_2E'
  | 'ZUS_DRA_DEADLINE_ART_47'
  | 'KSEF_MANDATORY_SCHEDULE_2026'
  | 'JPK_INCOME_TAX_SCHEDULE'
  | 'EDORECZENIA_SCHEDULE'
  | 'UOR_DOUBLE_ENTRY_AND_BALANCE'
  | 'CIT_RATES_ART_19';

export interface LegalBasis {
  readonly actTitle: string;
  readonly journalReference: string;
  readonly article: string;
  readonly paragraph?: string;
  readonly notes?: string;
}

export interface RuleReferenceTestCase {
  readonly id: string;
  readonly description: string;
  readonly eventDate: string;
  readonly inputSummary: string;
  readonly expectedOutputSummary: string;
}

export type LegalRuleParameterValue = number | string | boolean;

export interface LegalRule {
  readonly id: string;
  readonly ruleCode: LegalRuleCode | (string & {});
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly scope: readonly TaxProfileCode[];
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly legalBasis: LegalBasis;
  readonly sourceUrl: string;
  readonly sourceType: LegalSourceType;
  readonly verifiedAt: string;
  readonly verificationStatus: RuleVerificationStatus;
  readonly exceptions: readonly string[];
  readonly referenceTestCases: readonly RuleReferenceTestCase[];
  readonly parameters?: Readonly<Record<string, LegalRuleParameterValue>>;
}

export interface AppliedRuleSummary {
  readonly id: string;
  readonly ruleCode: string;
  readonly version: string;
  readonly title: string;
  readonly actTitle: string;
  readonly journalReference: string;
  readonly article: string;
  readonly sourceUrl: string;
  readonly sourceType: LegalSourceType;
  readonly verificationStatus: RuleVerificationStatus;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface ExplanationStep {
  readonly stepNumber: number;
  readonly label: string;
  readonly formula: string;
  readonly inputs: Readonly<Record<string, string | number | boolean>>;
  readonly resultFormatted: string;
  readonly resultGrosze?: number;
}

export type ExplanationWarningSeverity = 'info' | 'warning' | 'requires_expert_review';

export interface ExplanationWarning {
  readonly code: string;
  readonly severity: ExplanationWarningSeverity;
  readonly message: string;
}

export interface LegalExplanation {
  readonly calculationType: string;
  readonly summary: string;
  readonly eventDate: string;
  readonly appliedRules: readonly AppliedRuleSummary[];
  readonly steps: readonly ExplanationStep[];
  readonly inputs: Readonly<Record<string, string | number | boolean>>;
  readonly outputs: Readonly<Record<string, string | number | boolean>>;
  readonly warnings: readonly ExplanationWarning[];
  readonly requiresHumanApproval: boolean;
}

export class LegalRuleNotFoundError extends Error {
  readonly ruleCode: string;
  readonly eventDate: string;

  constructor(ruleCode: string, eventDate: string) {
    super(
      `Brak obowiązującej reguły prawnej "${ruleCode}" na dzień zdarzenia ${eventDate}. Obliczenie zatrzymane (fail-closed).`,
    );
    this.name = 'LegalRuleNotFoundError';
    this.ruleCode = ruleCode;
    this.eventDate = eventDate;
  }
}

export class UnverifiedLegalRuleError extends Error {
  readonly ruleId: string;
  readonly ruleCode: string;
  readonly verificationStatus: RuleVerificationStatus;

  constructor(rule: LegalRule) {
    super(
      `Reguła prawna "${rule.id}" (${rule.ruleCode}) posiada status "${rule.verificationStatus}" i nie może być użyta do wiążących wyliczeń księgowo-podatkowych bez weryfikacji eksperta.`,
    );
    this.name = 'UnverifiedLegalRuleError';
    this.ruleId = rule.id;
    this.ruleCode = rule.ruleCode;
    this.verificationStatus = rule.verificationStatus;
  }
}
