import {
  ACADEMY_DISCLAIMER,
  ACADEMY_MODULES,
  resolveFieldHelpWithLesson,
  type LegalBasisCitation,
  type TaxProfileCode as AcademyTaxProfileCode,
} from '@pap/domain/academy';
import type { LegalExplanation, LegalRule, RuleVerificationStatus } from '@pap/domain';
import type {
  FieldHelpInfo,
  LegalBasisInfo,
  LegalCalculationStep,
  LegalVerificationStatus,
} from '@pap/ui';

const FIELD_HELP_ALIASES: Readonly<Record<string, string>> = {
  kup_deductibility: 'kpir_col_13',
  vat_deduction_50: 'vat_50_vehicle',
  kpir_sales_col: 'kpir_col_7',
  mpp_split_payment: 'split_payment_mpp',
  whitelist_iban: 'white_list_iban',
  double_entry_wn_ma: 'wn_ma_balance',
};

const SUPPLEMENTARY_UI_FIELD_HELP: Readonly<
  Record<
    string,
    {
      readonly title: string;
      readonly explanation: string;
      readonly example: string;
      readonly lessonSlug: string;
    }
  >
> = {
  tax_regime: {
    title: 'Forma opodatkowania dochodu / przychodu',
    explanation:
      'Wybór pomiędzy skalą podatkową (12%/32% z kwotą wolną 30 000 PLN), podatkiem liniowym (19%), ryczałtem od przychodów ewidencjonowanych (stawki 2%–17% bez kosztów KUP) a CIT dla Sp. z o.o. determinuje rodzaj ksiąg i sposób liczenia składki zdrowotnej.',
    example: 'JDG — KPiR (skala 12% / 32%)',
    lessonSlug: 'wybor-formy-opodatkowania-skala-liniowy-ryczalt',
  },
  vat_exemption_240k: {
    title: 'Zwolnienie podmiotowe z VAT (limit 240 000 PLN od 2026 r.)',
    explanation:
      'Od 1 stycznia 2026 r. roczny limit sprzedaży netto uprawniający do zwolnienia podmiotowego na podstawie art. 113 ust. 1 ustawy o VAT wynosi 240 000 PLN (przy rozpoczęciu działalności w trakcie roku limit liczy się proporcjonalnie do dni).',
    example: '182 000,00 PLN / 240 000,00 PLN',
    lessonSlug: 'zwolnienie-z-vat-limit-240000-metoda-kasowa-i-mpp',
  },
  zus_scheme: {
    title: 'Schemat składek społecznych ZUS przedsiębiorcy JDG',
    explanation:
      'Kolejne etapy ulg ZUS w JDG: Ulga na start (6 pełnych miesięcy — wyłącznie składka zdrowotna), Preferencyjny ZUS (24 miesiące od 30% płacy minimalnej), a następnie Duży ZUS (60% prognozowanego przeciętnego wynagrodzenia) lub Mały ZUS Plus.',
    example: 'Preferencyjny ZUS (24 miesiące)',
    lessonSlug: 'ulga-na-start-preferencyjny-zus-maly-zus-plus-duzy-zus',
  },
  cit_small_taxpayer_9: {
    title: 'Stawka CIT 9% dla małego podatnika vs 19% podstawowa',
    explanation:
      'Spółka z o.o. posiadająca status małego podatnika (przychody ze sprzedaży brutto w poprzednim roku do równowartości 2 mln EUR) oraz bieżące przychody netto poniżej 2 mln EUR może stosować preferencyjną stawkę 9% CIT dla przychodów innych niż z zysków kapitałowych (art. 19 ust. 1 pkt 2 CIT).',
    example: 'CIT 9% (mały podatnik)',
    lessonSlug: 'cit-klasyczny-9-i-19-procent-maly-podatnik-zaliczki',
  },
  mcp_human_confirmation: {
    title: 'Dwukrokowa bramka zatwierdzania człowieka dla AI i MCP (Zasada nr 5)',
    explanation:
      'Zewnętrzni asystenci AI podłączeni przez MCP (np. Claude, Cursor, ChatGPT) mogą wyłącznie odczytywać dane w ramach grantu lub przygotować szkic propozycji (prepare_*). Zapis w księgach wymaga zawsze jawnego zatwierdzenia człowieka i zgodności skrótu SHA-256 payloadu.',
    example: 'PAP-HUMAN-9F4A2C8E11B0',
    lessonSlug: 'bezpieczna-wspolpraca-z-ai-i-mcp-czlowiek-zatwierdza',
  },
};

export const ACADEMY_PROFILE_LABELS_PL: Readonly<Record<AcademyTaxProfileCode, string>> = {
  jdg_kpir_skala: 'JDG — KPiR (skala 12% / 32%)',
  jdg_kpir_liniowy: 'JDG — KPiR (podatek liniowy 19%)',
  jdg_ryczalt: 'JDG — Ryczałt ewidencjonowany',
  spolka_cywilna_kpir: 'Spółka cywilna — KPiR',
  sp_zoo_pelne_ksiegi_cit_klasyczny: 'Sp. z o.o. — Pełne księgi (CIT 9% / 19%)',
  sp_zoo_pelne_ksiegi_cit_estonski: 'Sp. z o.o. — Ryczałt od dochodów spółek (CIT estoński)',
  vat_czynny: 'Czynny podatnik VAT',
  vat_zwolniony_art113: 'Zwolnienie z VAT (art. 113 — limit 240 000 PLN)',
};

export function getCanonicalLessonHref(lessonSlug: string): string {
  for (const mod of ACADEMY_MODULES) {
    if (mod.lessons.some((lesson) => lesson.slug === lessonSlug)) {
      return `/academy/${mod.slug}/${lessonSlug}`;
    }
  }
  return `/academy/lekcja/${lessonSlug}`;
}

export function resolveUiFieldHelp(fieldHelpId: string): FieldHelpInfo | undefined {
  const canonicalId = FIELD_HELP_ALIASES[fieldHelpId] ?? fieldHelpId;
  const resolved = resolveFieldHelpWithLesson(canonicalId);
  if (resolved) {
    const { fieldHelp, relatedLesson } = resolved;
    const lessonHref = getCanonicalLessonHref(fieldHelp.relatedLessonSlug);
    const fullExplanation = [
      fieldHelp.shortHint,
      fieldHelp.detailedExplanation,
      `Uwaga: ${fieldHelp.warningNote}`,
      `Podstawa prawna: ${fieldHelp.legalBasis.actTitle} (${fieldHelp.legalBasis.articleRef}, zweryfikowano ${fieldHelp.legalBasis.verifiedAt}).`,
    ].join(' ');

    return {
      fieldHelpId,
      title: fieldHelp.label,
      explanation: fullExplanation,
      example: fieldHelp.exampleValue,
      lessonTitle: relatedLesson
        ? `Otwórz lekcję: ${relatedLesson.title}`
        : 'Otwórz lekcję w Akademii Księgowości',
      lessonHref,
    };
  }

  const supplementary = SUPPLEMENTARY_UI_FIELD_HELP[canonicalId];
  if (supplementary) {
    return {
      fieldHelpId,
      title: supplementary.title,
      explanation: `${supplementary.explanation} ${ACADEMY_DISCLAIMER}`,
      example: supplementary.example,
      lessonTitle: 'Otwórz powiązaną lekcję w Akademii Księgowości',
      lessonHref: getCanonicalLessonHref(supplementary.lessonSlug),
    };
  }

  return undefined;
}

export function mustResolveUiFieldHelp(fieldHelpId: string): FieldHelpInfo {
  const found = resolveUiFieldHelp(fieldHelpId);
  if (found) {
    return found;
  }
  return {
    fieldHelpId,
    title: 'Objaśnienie księgowe pola',
    explanation: `Sprawdź zasady kwalifikacji podatkowej w Akademii Polskiej Księgowości. ${ACADEMY_DISCLAIMER}`,
    lessonHref: '/academy',
    lessonTitle: 'Przejdź do Akademii Księgowości',
  };
}

function mapRuleVerificationStatus(status: RuleVerificationStatus): LegalVerificationStatus {
  if (status === 'verified') {
    return 'verified_official';
  }
  if (status === 'requires_expert_review') {
    return 'requires_expert_review';
  }
  return 'experimental';
}

export function mapDomainExplanationToBasisInfo(
  explanation: LegalExplanation,
  customTitle?: string,
): LegalBasisInfo {
  const primaryRule = explanation.appliedRules[0];
  const warningNotes =
    explanation.warnings.length > 0
      ? ` Ostrzeżenia: ${explanation.warnings.map((w) => w.message).join(' | ')}`
      : '';

  const steps: LegalCalculationStep[] = explanation.steps.map((step) => ({
    label: step.label,
    formula: step.formula,
    valueFormatted: step.resultFormatted,
  }));

  return {
    title: customTitle ?? primaryRule?.title ?? 'Wyjaśnienie wyliczenia podatkowo-księgowego',
    provision: primaryRule
      ? `${primaryRule.actTitle} — ${primaryRule.article}`
      : 'Przepisy podatkowe RP (2025/2026)',
    journalReference: primaryRule?.journalReference ?? 'Dz.U. RP (rejestr zweryfikowany)',
    effectiveFrom: primaryRule?.validFrom ?? explanation.eventDate,
    effectiveTo: primaryRule?.validTo ?? null,
    ruleVersion: primaryRule ? `${primaryRule.id} (v${primaryRule.version})` : 'domain-1.0',
    verificationStatus: primaryRule
      ? mapRuleVerificationStatus(primaryRule.verificationStatus)
      : 'verified_official',
    plainExplanation: `${explanation.summary}${warningNotes} — ${ACADEMY_DISCLAIMER}`,
    calculationSteps: steps,
    officialSourceUrl: primaryRule?.sourceUrl ?? 'https://www.podatki.gov.pl/',
    officialSourceLabel: 'Otwórz źródło urzędowe (ISAP / Dz.U. / podatki.gov.pl / ZUS)',
  };
}

export function mapLegalRuleToBasisInfo(
  rule: LegalRule,
  customSteps?: readonly LegalCalculationStep[],
): LegalBasisInfo {
  const steps: LegalCalculationStep[] = customSteps
    ? [...customSteps]
    : rule.referenceTestCases.map((tc) => ({
        label: tc.description,
        formula: tc.inputSummary,
        valueFormatted: tc.expectedOutputSummary,
        note: `Data zdarzenia referencyjnego: ${tc.eventDate}`,
      }));

  const exceptionsNote =
    rule.exceptions.length > 0 ? ` Wyjątki: ${rule.exceptions.join('; ')}.` : '';

  return {
    title: rule.title,
    provision: `${rule.legalBasis.actTitle} — ${rule.legalBasis.article}${rule.legalBasis.paragraph ? ` (${rule.legalBasis.paragraph})` : ''}`,
    journalReference: rule.legalBasis.journalReference,
    effectiveFrom: rule.validFrom,
    effectiveTo: rule.validTo,
    ruleVersion: `${rule.id} · ${rule.ruleCode} (v${rule.version})`,
    verificationStatus: mapRuleVerificationStatus(rule.verificationStatus),
    plainExplanation: `${rule.description}${exceptionsNote} Zweryfikowano: ${rule.verifiedAt}. ${ACADEMY_DISCLAIMER}`,
    calculationSteps: steps,
    officialSourceUrl: rule.sourceUrl,
    officialSourceLabel: 'Otwórz akt źródłowy (ISAP / Dz.U. / podatki.gov.pl / ZUS)',
  };
}

export function mapAcademyCitationsToBasisInfo(
  citations: readonly LegalBasisCitation[],
  lessonTitle: string,
): LegalBasisInfo {
  const primary = citations[0];
  const steps: LegalCalculationStep[] = citations.map((citation) => ({
    label: `${citation.actTitle} (${citation.articleRef})`,
    valueFormatted: `Stan: ${citation.verifiedAt}`,
    note: citation.appliesSummary,
  }));

  return {
    title: `Podstawy prawne lekcji: ${lessonTitle}`,
    provision: primary
      ? `${primary.actTitle} — ${primary.articleRef}`
      : 'Przepisy prawa podatkowego i bilansowego RP',
    journalReference:
      primary?.sourceKind === 'statute'
        ? 'Ustawa / akt normatywny RP (ISAP / Dz.U.)'
        : 'Oficjalne objaśnienia urzędowe MF / ZUS',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ruleVersion: `akademia-v1.0 (${primary?.verifiedAt ?? '2026-11-04'})`,
    verificationStatus: 'verified_official',
    plainExplanation: `${primary?.appliesSummary ?? ''} ${ACADEMY_DISCLAIMER}`.trim(),
    calculationSteps: steps,
    officialSourceUrl: primary?.officialUrl ?? 'https://www.podatki.gov.pl/',
    officialSourceLabel: 'Otwórz publikator urzędowy aktu prawnego',
  };
}
