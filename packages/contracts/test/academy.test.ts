import { describe, expect, it } from 'vitest';
import {
  ACADEMY_LEGAL_VERIFICATION_DATE,
  FieldHelpEntrySchema,
  LegalBasisCitationSchema,
  NumericalStepSchema,
  QuizSubmissionSchema,
  ScreenshotSlotSchema,
} from '../src/academy.js';

describe('Academy contracts (@pap/contracts/academy)', () => {
  it('przyjmuje poprawną podstawę prawną z oficjalnej domeny urzędowej RP', () => {
    const validCitation = {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 89a i art. 89b',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: ACADEMY_LEGAL_VERIFICATION_DATE,
      appliesSummary: 'Reguluje ulgę na złe długi po upływie 90 dni od terminu płatności.',
    } as const;

    expect(LegalBasisCitationSchema.parse(validCitation)).toEqual(validCitation);
  });

  it('odrzuca nieautoryzowane domeny zewnętrzne i niepoprawny format kwot PLN (scenariusze negatywne)', () => {
    expect(
      LegalBasisCitationSchema.safeParse({
        actTitle: 'Nieoficjalny blog podatkowy w internecie',
        articleRef: 'art. 1',
        sourceKind: 'official_guidance',
        officialUrl: 'https://nieoficjalny-blog-podatkowy.example.com/vat',
        verifiedAt: ACADEMY_LEGAL_VERIFICATION_DATE,
        appliesSummary: 'Ten adres nie należy do oficjalnych serwisów rządowych RP.',
      }).success,
    ).toBe(false);

    expect(
      NumericalStepSchema.safeParse({
        stepNumber: 1,
        label: 'Kwota bez groszy',
        calculation: '100 * 23%',
        amountPln: '12300 PLN',
      }).success,
    ).toBe(false);

    expect(
      ScreenshotSlotSchema.safeParse({
        slotId: 'm10-l01-test',
        appRoute: '/payments',
        caption: 'Opis zrzutu ekranu o wystarczającej długości znaków.',
        captureSelector: '[data-testid="panel"]',
        imagePath: '/academy/screenshots/inny-plik.png',
      }).success,
    ).toBe(false);
  });

  it('waliduje wpisy fieldHelpId oraz zgłoszenia quizu i odrzuca nadmiarowe pola (.strict)', () => {
    const validFieldHelp = {
      fieldHelpId: 'ksef_reference',
      label: 'Numer referencyjny KSeF',
      shortHint: 'Unikalny identyfikator e-faktury nadawany w Krajowym Systemie e-Faktur.',
      detailedExplanation:
        'Numer KSeF identyfikuje jednoznacznie fakturę ustrukturyzowaną w systemie Ministerstwa Finansów oraz w pliku JPK_V7.',
      exampleValue: '5250001003-20260415-A1B2C3-D4E5F6-78',
      warningNote:
        'W razie braku numeru KSeF w JPK_V7 użyj odpowiedniego znacznika OFF, BFK lub DI.',
      audienceScope: {
        type: 'general_education',
        applicableProfiles: ['vat_czynny'],
        scopeNote: 'Dotyczy wszystkich podatników odbierających i wystawiających e-faktury.',
      },
      legalBasis: {
        actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
        articleRef: 'art. 106ga',
        sourceKind: 'statute',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
        verifiedAt: ACADEMY_LEGAL_VERIFICATION_DATE,
        appliesSummary:
          'Ustanawia obowiązek wystawiania faktur ustrukturyzowanych przy użyciu KSeF.',
      },
      relatedLessonSlug: 'ksef-2-0-harmonogram-2026-fa3-offline24-archiwizacja',
    } as const;

    expect(FieldHelpEntrySchema.safeParse(validFieldHelp).success).toBe(true);
    expect(
      FieldHelpEntrySchema.safeParse({ ...validFieldHelp, fieldHelpId: 'INVALID UPPERCASE' })
        .success,
    ).toBe(false);

    expect(
      QuizSubmissionSchema.safeParse({
        lessonSlug: 'ulga-na-zle-dlugi-90-dni-vat-pit-cit',
        answers: { 'q-10-02-01': 1 },
        unexpectedField: true,
      }).success,
    ).toBe(false);
  });
});
