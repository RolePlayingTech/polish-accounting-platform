import { describe, expect, it } from 'vitest';
import {
  LegalRuleNotFoundError,
  POLISH_LEGAL_RULES_REGISTRY,
  UnverifiedLegalRuleError,
  buildLegalExplanation,
  listActiveRulesAtDate,
  resolveRuleAtDate,
} from '../src/legal-rules/index.js';
import type { LegalRule } from '../src/legal-rules/index.js';

describe('legal-rules — versioned registry, eventDate resolution & unverified guard', () => {
  it('contains at least 25 unique rule codes and 30+ versioned rule records with verified official metadata', () => {
    expect(POLISH_LEGAL_RULES_REGISTRY.length).toBeGreaterThanOrEqual(30);
    const uniqueCodes = new Set(POLISH_LEGAL_RULES_REGISTRY.map((r) => r.ruleCode));
    expect(uniqueCodes.size).toBeGreaterThanOrEqual(25);

    for (const rule of POLISH_LEGAL_RULES_REGISTRY) {
      expect(rule.id.length).toBeGreaterThan(3);
      expect(rule.sourceUrl.startsWith('https://')).toBe(true);
      expect(rule.legalBasis.actTitle.length).toBeGreaterThan(5);
      expect(rule.legalBasis.journalReference.length).toBeGreaterThan(5);
      expect(rule.legalBasis.article.length).toBeGreaterThan(3);
      expect(rule.referenceTestCases.length).toBeGreaterThanOrEqual(1);
      expect(rule.verificationStatus).not.toBe('unverified');
    }
  });

  it('resolves time-dependent VAT art. 113 limit: 200 000 zł in 2025 vs 240 000 zł in 2026', () => {
    const rule2025 = resolveRuleAtDate('VAT_EXEMPTION_LIMIT_ART_113', '2025-12-31');
    const rule2026 = resolveRuleAtDate('VAT_EXEMPTION_LIMIT_ART_113', '2026-01-01');

    expect(rule2025.parameters?.['annualLimitGrosze']).toBe(20_000_000);
    expect(rule2026.parameters?.['annualLimitGrosze']).toBe(24_000_000);
    expect(rule2026.legalBasis.journalReference).toContain('poz. 896');
  });

  it('resolves time-dependent PKPiR regulation: 2019 17-col in 2025 vs Dz.U. 2025 poz. 1299 in 2026', () => {
    const reg2025 = resolveRuleAtDate('KPIR_REGULATION_COLUMNS', '2025-11-15');
    const reg2026 = resolveRuleAtDate('KPIR_REGULATION_COLUMNS', '2026-01-15');

    expect(reg2025.parameters?.['regulationVersion']).toBe('pkpir_2019_17col');
    expect(reg2026.parameters?.['regulationVersion']).toBe('pkpir_2026_ksef');
  });

  it('resolves ZUS health contribution year across February 1 boundary (2025-01 vs 2025-02 vs 2026-01 vs 2026-02)', () => {
    const jan2025 = resolveRuleAtDate('ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81', '2025-01-15');
    const feb2025 = resolveRuleAtDate('ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81', '2025-02-01');
    const jan2026 = resolveRuleAtDate('ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81', '2026-01-31');
    const feb2026 = resolveRuleAtDate('ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81', '2026-02-01');

    expect(jan2025.parameters?.['minimumContributionGrosze']).toBe(38_178); // 381,78 zł
    expect(feb2025.parameters?.['minimumContributionGrosze']).toBe(31_496); // 314,96 zł (75% * 4666 * 9%)
    expect(jan2026.parameters?.['minimumContributionGrosze']).toBe(31_496); // styczeń 2026 nadal w roku składkowym 2025!
    expect(feb2026.parameters?.['minimumContributionGrosze']).toBe(43_254); // 432,54 zł (100% * 4806 * 9%)
  });

  it('blocks binding calculations when resolved rule has verificationStatus === "unverified"', () => {
    const unverifiedRule: LegalRule = {
      id: 'hypothetical-unverified-2026',
      ruleCode: 'HYPOTHETICAL_RELIEF',
      version: '0.1',
      title: 'Niepotwierdzona ulga podatkowa',
      description: 'Reguła robocza bez potwierdzenia w Dz.U.',
      scope: ['jdg_kpir_skala'],
      validFrom: '2026-01-01',
      validTo: null,
      legalBasis: {
        actTitle: 'Projekt ustawy',
        journalReference: 'Druk roboczy',
        article: 'art. X',
      },
      sourceUrl: 'https://www.podatki.gov.pl/',
      sourceType: 'official_guidance',
      verifiedAt: '2026-11-04',
      verificationStatus: 'unverified',
      exceptions: [],
      referenceTestCases: [
        {
          id: 'tc-unverified',
          description: 'Musi rzucić błąd',
          eventDate: '2026-06-01',
          inputSummary: 'dowolne',
          expectedOutputSummary: 'UnverifiedLegalRuleError',
        },
      ],
    };

    expect(() =>
      resolveRuleAtDate('HYPOTHETICAL_RELIEF', '2026-06-01', {
        customRegistry: [unverifiedRule],
      }),
    ).toThrow(UnverifiedLegalRuleError);

    // Odczyt informacyjny (nie-wiążący, np. do podglądu rejestru) jest dozwolony wyłącznie po jawnym wyłączeniu flagi:
    const nonBinding = resolveRuleAtDate('HYPOTHETICAL_RELIEF', '2026-06-01', {
      customRegistry: [unverifiedRule],
      bindingCalculation: false,
    });
    expect(nonBinding.verificationStatus).toBe('unverified');

    // Ale nawet wtedy próba zbudowania wiążącego LegalExplanation rzuci UnverifiedLegalRuleError!
    expect(() =>
      buildLegalExplanation({
        calculationType: 'test',
        summary: 'Próba użycia niezweryfikowanej reguły',
        eventDate: '2026-06-01',
        rules: [nonBinding],
        steps: [
          {
            stepNumber: 1,
            label: 'Krok',
            formula: 'x',
            inputs: {},
            resultFormatted: '0,00 zł',
          },
        ],
        inputs: {},
        outputs: {},
      }),
    ).toThrow(UnverifiedLegalRuleError);
  });

  it('marks requiresHumanApproval = true when a rule has requires_expert_review status', () => {
    const iwaRule = resolveRuleAtDate('ZUS_INDIVIDUAL_ACCIDENT_RATE_IWA', '2026-05-01');
    expect(iwaRule.verificationStatus).toBe('requires_expert_review');

    const explanation = buildLegalExplanation({
      calculationType: 'zus_iwa_check',
      summary: 'Wyliczenie ze stopą indywidualną ZUS IWA',
      eventDate: '2026-05-01',
      rules: [iwaRule],
      steps: [
        {
          stepNumber: 1,
          label: 'Zastosowanie stopy ZUS IWA',
          formula: 'base * rate',
          inputs: { rateBps: 226 },
          resultFormatted: '127,74 zł',
        },
      ],
      inputs: { rateBps: 226 },
      outputs: { amountGrosze: 12_774 },
    });

    expect(explanation.requiresHumanApproval).toBe(true);
    expect(explanation.warnings.some((w) => w.severity === 'requires_expert_review')).toBe(true);
  });

  it('throws LegalRuleNotFoundError on out-of-range dates or non-existent calendar dates', () => {
    expect(() => resolveRuleAtDate('VAT_EXEMPTION_LIMIT_ART_113', '2018-01-01')).toThrow(
      LegalRuleNotFoundError,
    );
    expect(() => resolveRuleAtDate('VAT_EXEMPTION_LIMIT_ART_113', '2026-02-29')).toThrow(
      /Nieistniejąca data kalendarzowa/,
    );
  });

  it('filters active rules by entity profile at date', () => {
    const spzooRules = listActiveRulesAtDate('2026-06-15', 'spzoo_pelne_ksiegi');
    expect(spzooRules.some((r) => r.ruleCode === 'CIT_RATES_ART_19')).toBe(true);
    expect(spzooRules.some((r) => r.ruleCode === 'PIT_TAX_SCALE_ART_27')).toBe(false);
  });
});
