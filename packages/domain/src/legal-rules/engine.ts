import { POLISH_LEGAL_RULES_REGISTRY } from './registry.js';
import type {
  AppliedRuleSummary,
  ExplanationStep,
  ExplanationWarning,
  LegalExplanation,
  LegalRule,
  TaxProfileCode,
} from './types.js';
import { LegalRuleNotFoundError, UnverifiedLegalRuleError } from './types.js';

const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertValidIsoCalendarDate(dateStr: string, label = 'eventDate'): string {
  if (!ISO_DATE_REGEX.test(dateStr)) {
    throw new Error(`Pole ${label} musi mieć format YYYY-MM-DD (otrzymano: "${dateStr}")`);
  }
  const parts = dateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Nieprawidłowa data ${label}: "${dateStr}"`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Nieistniejąca data kalendarzowa ${label}: "${dateStr}"`);
  }
  return dateStr;
}

export interface ResolveRuleOptions {
  readonly customRegistry?: readonly LegalRule[];
  readonly profile?: TaxProfileCode;
  readonly bindingCalculation?: boolean;
  readonly disallowExpertReviewRules?: boolean;
}

/**
 * Rozwiązuje obowiązującą wersję reguły prawnej na wskazany dzień zdarzenia `eventDate` (`YYYY-MM-DD`).
 * Przy wyliczeniach wiążących (`bindingCalculation !== false`) automatycznie blokuje użycie reguł o statusie `unverified`.
 */
export function resolveRuleAtDate(
  ruleCode: string,
  eventDate: string,
  options?: ResolveRuleOptions,
): LegalRule {
  assertValidIsoCalendarDate(eventDate, 'eventDate');
  const registry = options?.customRegistry ?? POLISH_LEGAL_RULES_REGISTRY;
  const binding = options?.bindingCalculation ?? true;

  const matching = registry.filter((rule) => {
    if (rule.ruleCode !== ruleCode) {
      return false;
    }
    if (options?.profile !== undefined && !rule.scope.includes(options.profile)) {
      return false;
    }
    const afterStart = rule.validFrom <= eventDate;
    const beforeEnd = rule.validTo === null || eventDate <= rule.validTo;
    return afterStart && beforeEnd;
  });

  if (matching.length === 0) {
    throw new LegalRuleNotFoundError(ruleCode, eventDate);
  }

  // Jeżeli istnieje więcej niż jedna pasująca wersja (np. nakładający się epizod), wybieramy regułę z najpóźniejszym validFrom.
  const sorted = [...matching].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const selected = sorted[0];
  if (selected === undefined) {
    throw new LegalRuleNotFoundError(ruleCode, eventDate);
  }

  if (binding && selected.verificationStatus === 'unverified') {
    throw new UnverifiedLegalRuleError(selected);
  }

  if (
    binding &&
    options?.disallowExpertReviewRules === true &&
    selected.verificationStatus === 'requires_expert_review'
  ) {
    throw new UnverifiedLegalRuleError(selected);
  }

  return selected;
}

export function listActiveRulesAtDate(
  eventDate: string,
  profile?: TaxProfileCode,
  customRegistry?: readonly LegalRule[],
): readonly LegalRule[] {
  assertValidIsoCalendarDate(eventDate, 'eventDate');
  const registry = customRegistry ?? POLISH_LEGAL_RULES_REGISTRY;
  return registry.filter((rule) => {
    if (profile !== undefined && !rule.scope.includes(profile)) {
      return false;
    }
    return rule.validFrom <= eventDate && (rule.validTo === null || eventDate <= rule.validTo);
  });
}

export function toAppliedRuleSummary(rule: LegalRule): AppliedRuleSummary {
  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    version: rule.version,
    title: rule.title,
    actTitle: rule.legalBasis.actTitle,
    journalReference: rule.legalBasis.journalReference,
    article: rule.legalBasis.article,
    sourceUrl: rule.sourceUrl,
    sourceType: rule.sourceType,
    verificationStatus: rule.verificationStatus,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
  };
}

export function getRequiredNumericParameter(rule: LegalRule, paramName: string): number {
  const value = rule.parameters?.[paramName];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Reguła prawna "${rule.id}" nie zawiera wymaganego parametru liczbowego "${paramName}"`,
    );
  }
  return value;
}

export function getRequiredStringParameter(rule: LegalRule, paramName: string): string {
  const value = rule.parameters?.[paramName];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Reguła prawna "${rule.id}" nie zawiera wymaganego parametru tekstowego "${paramName}"`,
    );
  }
  return value;
}

export interface BuildLegalExplanationInput {
  readonly calculationType: string;
  readonly summary: string;
  readonly eventDate: string;
  readonly rules: readonly LegalRule[];
  readonly steps: readonly ExplanationStep[];
  readonly inputs: Readonly<Record<string, string | number | boolean>>;
  readonly outputs: Readonly<Record<string, string | number | boolean>>;
  readonly warnings?: readonly ExplanationWarning[];
  readonly forceHumanApproval?: boolean;
}

/**
 * Buduje deterministyczne wyjaśnienie „Dlaczego? / Podstawa prawna” (`LegalExplanation`).
 * Automatycznie blokuje reguły `unverified` oraz podnosi `requiresHumanApproval = true`
 * w przypadku użycia jakiejkolwiek reguły `requires_expert_review` lub ostrzeżenia o tym poziomie.
 */
export function buildLegalExplanation(input: BuildLegalExplanationInput): LegalExplanation {
  assertValidIsoCalendarDate(input.eventDate, 'eventDate');
  if (input.rules.length === 0) {
    throw new Error('Wyjaśnienie prawne musi wskazywać co najmniej jedną zastosowaną regułę.');
  }
  if (input.steps.length === 0) {
    throw new Error('Wyjaśnienie prawne musi zawierać co najmniej jeden krok obliczeniowy.');
  }

  const extraWarnings: ExplanationWarning[] = [...(input.warnings ?? [])];
  let requiresExpertReview = false;

  for (const rule of input.rules) {
    if (rule.verificationStatus === 'unverified') {
      throw new UnverifiedLegalRuleError(rule);
    }
    if (rule.verificationStatus === 'requires_expert_review') {
      requiresExpertReview = true;
      extraWarnings.push({
        code: `RULE_EXPERT_REVIEW_${rule.ruleCode}`,
        severity: 'requires_expert_review',
        message: `Zastosowano regułę "${rule.title}" (${rule.legalBasis.article}) wymagającą potwierdzenia przez uprawnionego księgowego/doradcę podatkowego.`,
      });
    }
  }

  for (const warning of extraWarnings) {
    if (warning.severity === 'requires_expert_review') {
      requiresExpertReview = true;
    }
  }

  return {
    calculationType: input.calculationType,
    summary: input.summary,
    eventDate: input.eventDate,
    appliedRules: input.rules.map(toAppliedRuleSummary),
    steps: input.steps,
    inputs: input.inputs,
    outputs: input.outputs,
    warnings: extraWarnings,
    requiresHumanApproval: input.forceHumanApproval === true || requiresExpertReview,
  };
}
