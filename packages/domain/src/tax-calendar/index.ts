import {
  assertValidIsoCalendarDate,
  buildLegalExplanation,
  getRequiredNumericParameter,
  getRequiredStringParameter,
  resolveRuleAtDate,
} from '../legal-rules/index.js';
import type {
  ExplanationWarning,
  LegalExplanation,
  LegalRule,
  ProfileSupportLevel,
  TaxProfileCode,
} from '../legal-rules/index.js';
import { formatPlnFromGrosze } from '../money.js';

export type TaxObligationCategory =
  'vat' | 'pit' | 'ryczalt' | 'cit' | 'zus' | 'jpk_income_tax' | 'ksef' | 'edoreczenia';

export interface ShiftedNonWorkingDay {
  readonly date: string;
  readonly reason: string;
}

export interface DeadlineShiftResult {
  readonly statutoryDueDate: string;
  readonly effectiveDueDate: string;
  readonly wasShifted: boolean;
  readonly shiftedFromNonWorkingDays: readonly ShiftedNonWorkingDay[];
}

export type ZusPayerDeadlineKind = 'budget_5th' | 'legal_person_15th' | 'other_20th';

export interface TaxProfileCalendarConfig {
  readonly profileCode: TaxProfileCode;
  readonly supportLevel?: ProfileSupportLevel;
  readonly vatStatus: 'czynny' | 'zwolniony_art_113' | 'zwolniony_przedmiotowo';
  readonly vatSettlementPeriod: 'monthly' | 'quarterly' | 'not_applicable';
  readonly zusApplicable: boolean;
  /**
   * Kategoria płatnika ZUS wg art. 47 ust. 1 u.s.u.s.:
   * - `budget_5th`: jednostki budżetowe i samorządowe zakłady budżetowe (do 5. dnia — pkt 2)
   * - `legal_person_15th`: płatnicy z osobowością prawną, w tym Sp. z o.o. zatrudniająca ubezpieczonych (do 15. dnia — pkt 3)
   * - `other_20th`: pozostali płatnicy, w tym JDG, spółki cywilne oraz wspólnik jednoosobowej Sp. z o.o. płacący własne składki (do 20. dnia — pkt 4)
   */
  readonly zusPayerKind?: ZusPayerDeadlineKind;
  readonly ksefSales2024Above200M?: boolean;
  readonly monthlyB2bGrossSalesGrosze?: number;
  readonly ceidgRegisteredBefore2025?: boolean;
  readonly krsRegisteredBefore2025?: boolean;
}

export interface TaxCalendarObligation {
  readonly code: string;
  readonly title: string;
  readonly category: TaxObligationCategory;
  readonly period: string;
  readonly statutoryDueDate: string;
  readonly effectiveDueDate: string;
  readonly shiftedFromNonWorkingDays: readonly ShiftedNonWorkingDay[];
  readonly status: 'applicable' | 'exempt_transitional' | 'informational';
  readonly explanation: LegalExplanation;
}

function formatUtcDate(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * Oblicza datę Niedzieli Wielkanocnej metodą Meeusa/Jonesa/Butchera dla kalendarza gregoriańskiego.
 */
export function computeEasterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzec, 4 = kwiecień
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Zwraca mapę polskich świąt ustawowo wolnych od pracy (`YYYY-MM-DD -> nazwa święta`) dla danego roku,
 * uwzględniając święta ruchome oraz wolną Wigilię Bożego Narodzenia (24 grudnia) obowiązującą od 2025 r.
 * (ustawa z dnia 6 grudnia 2024 r., Dz.U. z 2024 r. poz. 1965).
 */
export function getPolishStatutoryHolidaysForYear(year: number): ReadonlyMap<string, string> {
  const holidays = new Map<string, string>();
  const y = String(year).padStart(4, '0');

  holidays.set(`${y}-01-01`, 'Nowy Rok');
  holidays.set(`${y}-01-06`, 'Święto Trzech Króli');
  holidays.set(`${y}-05-01`, 'Święto Państwowe (1 Maja)');
  holidays.set(`${y}-05-03`, 'Święto Narodowe Trzeciego Maja');
  holidays.set(`${y}-08-15`, 'Wniebowzięcie Najświętszej Maryi Panny');
  holidays.set(`${y}-11-01`, 'Wszystkich Świętych');
  holidays.set(`${y}-11-11`, 'Narodowe Święto Niepodległości');
  if (year >= 2025) {
    holidays.set(`${y}-12-24`, 'Wigilia Bożego Narodzenia');
  }
  holidays.set(`${y}-12-25`, 'Pierwszy dzień Bożego Narodzenia');
  holidays.set(`${y}-12-26`, 'Drugi dzień Bożego Narodzenia');

  const easterSunday = computeEasterSundayUtc(year);
  const easterMonday = addDaysUtc(easterSunday, 1);
  const pentecostSunday = addDaysUtc(easterSunday, 49);
  const corpusChristiThursday = addDaysUtc(easterSunday, 60);

  holidays.set(formatUtcDate(easterSunday), 'Wielkanoc (Pierwszy dzień)');
  holidays.set(formatUtcDate(easterMonday), 'Poniedziałek Wielkanocny');
  holidays.set(formatUtcDate(pentecostSunday), 'Pierwszy dzień Zielonych Świątek');
  holidays.set(formatUtcDate(corpusChristiThursday), 'Boże Ciało');

  return holidays;
}

export function getNonWorkingDayReason(dateStr: string): string | null {
  assertValidIsoCalendarDate(dateStr, 'dateStr');
  const parts = dateStr.split('-').map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay(); // 0 = niedziela, 6 = sobota

  const holidays = getPolishStatutoryHolidaysForYear(year);
  const holidayName = holidays.get(dateStr);

  if (holidayName !== undefined && dayOfWeek === 6) {
    return `Sobota oraz święto ustawowe: ${holidayName}`;
  }
  if (holidayName !== undefined && dayOfWeek === 0) {
    return `Niedziela oraz święto ustawowe: ${holidayName}`;
  }
  if (holidayName !== undefined) {
    return `Święto ustawowe: ${holidayName}`;
  }
  if (dayOfWeek === 6) {
    return 'Sobota';
  }
  if (dayOfWeek === 0) {
    return 'Niedziela';
  }
  return null;
}

/**
 * Przesuwa termin ustawowy wypadający w sobotę, niedzielę lub polskie święto ustawowe
 * na najbliższy kolejny dzień roboczy zgodnie z art. 12 § 5 Ordynacji podatkowej.
 */
export function shiftTaxDeadlineToBusinessDay(statutoryDueDate: string): DeadlineShiftResult {
  assertValidIsoCalendarDate(statutoryDueDate, 'statutoryDueDate');
  const parts = statutoryDueDate.split('-').map(Number);
  let cursor = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  const shifted: ShiftedNonWorkingDay[] = [];

  for (let guard = 0; guard < 15; guard += 1) {
    const currentStr = formatUtcDate(cursor);
    const reason = getNonWorkingDayReason(currentStr);
    if (reason === null) {
      return {
        statutoryDueDate,
        effectiveDueDate: currentStr,
        wasShifted: shifted.length > 0,
        shiftedFromNonWorkingDays: shifted,
      };
    }
    shifted.push({ date: currentStr, reason });
    cursor = addDaysUtc(cursor, 1);
  }

  throw new Error(`Nie udało się wyznaczyć dnia roboczego po dacie ${statutoryDueDate}`);
}

function getNextMonthIsoDate(period: string, dayOfMonth: number): string {
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
}

function createDeadlineObligation(params: {
  readonly code: string;
  readonly title: string;
  readonly category: TaxObligationCategory;
  readonly period: string;
  readonly eventDate: string;
  readonly statutoryDueDate: string;
  readonly status: 'applicable' | 'exempt_transitional' | 'informational';
  readonly primaryRule: LegalRule;
  readonly shiftRule: LegalRule;
  readonly holidaysRule: LegalRule;
  readonly summaryPrefix: string;
  readonly warnings?: readonly ExplanationWarning[];
}): TaxCalendarObligation {
  const shift = shiftTaxDeadlineToBusinessDay(params.statutoryDueDate);
  const rules: LegalRule[] = shift.wasShifted
    ? [params.primaryRule, params.shiftRule, params.holidaysRule]
    : [params.primaryRule];

  const explanation = buildLegalExplanation({
    calculationType: 'tax_calendar_deadline',
    summary: shift.wasShifted
      ? `${params.summaryPrefix}: termin ustawowy ${shift.statutoryDueDate} przesunięty na ${shift.effectiveDueDate} (art. 12 § 5 OP).`
      : `${params.summaryPrefix}: termin przypada w dzień roboczy ${shift.effectiveDueDate}.`,
    eventDate: params.eventDate,
    rules,
    steps: [
      {
        stepNumber: 1,
        label: 'Wyznaczenie ustawowego dnia terminu dla okresu sprawozdawczego',
        formula: 'statutoryDueDate wg przepisu materialnego',
        inputs: { period: params.period, statutoryDueDate: shift.statutoryDueDate },
        resultFormatted: shift.statutoryDueDate,
      },
      {
        stepNumber: 2,
        label: 'Kontrola sobót, niedziel i świąt ustawowych wg art. 12 § 5 Ordynacji podatkowej',
        formula: 'effectiveDueDate = pierwszy dzień roboczy >= statutoryDueDate',
        inputs: {
          wasShifted: shift.wasShifted,
          skippedDaysCount: shift.shiftedFromNonWorkingDays.length,
        },
        resultFormatted: shift.effectiveDueDate,
      },
    ],
    inputs: {
      period: params.period,
      obligationCode: params.code,
    },
    outputs: {
      statutoryDueDate: shift.statutoryDueDate,
      effectiveDueDate: shift.effectiveDueDate,
      wasShifted: shift.wasShifted,
    },
    ...(params.warnings !== undefined ? { warnings: params.warnings } : {}),
  });

  return {
    code: params.code,
    title: params.title,
    category: params.category,
    period: params.period,
    statutoryDueDate: shift.statutoryDueDate,
    effectiveDueDate: shift.effectiveDueDate,
    shiftedFromNonWorkingDays: shift.shiftedFromNonWorkingDays,
    status: params.status,
    explanation,
  };
}

/**
 * Generuje listę obowiązków podatkowych, ZUS, JPK, KSeF i e-Doręczeń dla podanego profilu firmy i okresu `YYYY-MM`,
 * z automatycznym przesuwaniem terminów na dni robocze zgodnie z art. 12 § 5 Ordynacji podatkowej.
 */
export function generateTaxCalendarObligations(
  profile: TaxProfileCalendarConfig,
  period: string,
  customRegistry?: readonly LegalRule[],
): readonly TaxCalendarObligation[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Nieprawidłowy okres kalendarza podatkowego: "${period}" (wymagany YYYY-MM)`);
  }

  const eventDate = `${period}-01`;
  const monthNumber = Number(period.slice(5, 7));
  const yearNumber = Number(period.slice(0, 4));
  const ruleOptions = customRegistry !== undefined ? { customRegistry } : undefined;

  const shiftRule = resolveRuleAtDate('ORDYNACJA_ART_12_DEADLINE_SHIFT', eventDate, ruleOptions);
  const holidaysRule = resolveRuleAtDate('STATUTORY_HOLIDAYS_POLAND', eventDate, ruleOptions);
  const obligations: TaxCalendarObligation[] = [];

  // 1. ZUS DRA i składki (5. dla jednostek budżetowych, 15. dla osób prawnych jak Sp. z o.o., 20. dla JDG i pozostałych)
  if (profile.zusApplicable) {
    const zusRule = resolveRuleAtDate('ZUS_DRA_DEADLINE_ART_47', eventDate, ruleOptions);
    const effectivePayerKind: ZusPayerDeadlineKind =
      profile.zusPayerKind ??
      (profile.profileCode === 'spzoo_pelne_ksiegi' ? 'legal_person_15th' : 'other_20th');

    const dueDay =
      effectivePayerKind === 'budget_5th'
        ? getRequiredNumericParameter(zusRule, 'budgetEntityDueDay')
        : effectivePayerKind === 'legal_person_15th'
          ? getRequiredNumericParameter(zusRule, 'legalPersonDueDay')
          : getRequiredNumericParameter(zusRule, 'otherPayersDueDay');

    const zusTitle =
      effectivePayerKind === 'budget_5th'
        ? 'Deklaracja ZUS DRA i opłacenie składek (jednostka budżetowa — do 5. dnia)'
        : effectivePayerKind === 'legal_person_15th'
          ? 'Deklaracja ZUS DRA i opłacenie składek (płatnik z osobowością prawną — do 15. dnia)'
          : 'Deklaracja ZUS DRA i opłacenie składek przedsiębiorcy (do 20. dnia)';

    obligations.push(
      createDeadlineObligation({
        code: 'ZUS_DRA_PAYMENT',
        title: zusTitle,
        category: 'zus',
        period,
        eventDate,
        statutoryDueDate: getNextMonthIsoDate(period, dueDay),
        status: 'applicable',
        primaryRule: zusRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `ZUS DRA za ${period}`,
      }),
    );
  }

  // 2. Podatek dochodowy (PIT zaliczka / Ryczałt / CIT zaliczka — do 20. dnia następnego miesiąca)
  if (profile.profileCode === 'jdg_kpir_skala' || profile.profileCode === 'jdg_kpir_liniowy') {
    const pitDeadlineRule = resolveRuleAtDate(
      'PIT_ADVANCE_DEADLINE_ART_44',
      eventDate,
      ruleOptions,
    );
    const dueDay = getRequiredNumericParameter(pitDeadlineRule, 'dueDayOfMonth');
    obligations.push(
      createDeadlineObligation({
        code: 'PIT_MONTHLY_ADVANCE',
        title:
          profile.profileCode === 'jdg_kpir_skala'
            ? 'Wpłata miesięcznej zaliczki PIT (skala podatkowa — PIT-36)'
            : 'Wpłata miesięcznej zaliczki PIT (podatek liniowy 19% — PIT-36L)',
        category: 'pit',
        period,
        eventDate,
        statutoryDueDate: getNextMonthIsoDate(period, dueDay),
        status: 'applicable',
        primaryRule: pitDeadlineRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `Zaliczka PIT za ${period}`,
      }),
    );
  } else if (profile.profileCode === 'jdg_ryczalt') {
    const ryczaltDeadlineRule = resolveRuleAtDate(
      'RYCZALT_DEADLINE_ART_21',
      eventDate,
      ruleOptions,
    );
    const dueDay = getRequiredNumericParameter(ryczaltDeadlineRule, 'dueDayOfMonth');
    obligations.push(
      createDeadlineObligation({
        code: 'RYCZALT_PPE_PAYMENT',
        title: 'Obliczenie i wpłata ryczałtu od przychodów ewidencjonowanych (PPE)',
        category: 'ryczalt',
        period,
        eventDate,
        statutoryDueDate: getNextMonthIsoDate(period, dueDay),
        status: 'applicable',
        primaryRule: ryczaltDeadlineRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `Ryczałt PPE za ${period}`,
      }),
    );
  } else if (profile.profileCode === 'spzoo_pelne_ksiegi') {
    const citRule = resolveRuleAtDate('CIT_RATES_ART_19', eventDate, ruleOptions);
    const dueDay = getRequiredNumericParameter(citRule, 'dueDayOfMonth');
    obligations.push(
      createDeadlineObligation({
        code: 'CIT_MONTHLY_ADVANCE',
        title: 'Wpłata miesięcznej zaliczki na podatek dochodowy od osób prawnych (CIT)',
        category: 'cit',
        period,
        eventDate,
        statutoryDueDate: getNextMonthIsoDate(period, dueDay),
        status: 'applicable',
        primaryRule: citRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `Zaliczka CIT za ${period}`,
      }),
    );
  }

  // 3. VAT — JPK_V7M / JPK_V7K do 25. dnia następnego miesiąca
  if (profile.vatStatus === 'czynny' && profile.vatSettlementPeriod !== 'not_applicable') {
    const jpkRule = resolveRuleAtDate('VAT_JPK_V7_DEADLINE_AND_SCHEMA', eventDate, ruleOptions);
    const dueDay = getRequiredNumericParameter(jpkRule, 'dueDayOfMonth');
    const isQuarterlyEnd = monthNumber % 3 === 0;
    const schemaName =
      profile.vatSettlementPeriod === 'monthly'
        ? getRequiredStringParameter(jpkRule, 'schemaVersionM')
        : getRequiredStringParameter(jpkRule, 'schemaVersionK');

    const title =
      profile.vatSettlementPeriod === 'monthly'
        ? `Wysyłka pliku ${schemaName} i zapłata podatku VAT`
        : isQuarterlyEnd
          ? `Wysyłka części ewidencyjnej i deklaracyjnej ${schemaName} oraz zapłata VAT za kwartał`
          : `Wysyłka miesięcznej części ewidencyjnej ${schemaName}`;

    obligations.push(
      createDeadlineObligation({
        code: profile.vatSettlementPeriod === 'monthly' ? 'VAT_JPK_V7M' : 'VAT_JPK_V7K',
        title,
        category: 'vat',
        period,
        eventDate,
        statutoryDueDate: getNextMonthIsoDate(period, dueDay),
        status: 'applicable',
        primaryRule: jpkRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `${schemaName} za ${period}`,
      }),
    );
  }

  // 4. Obowiązki KSeF 2.0 w 2026 r.
  if (yearNumber === 2026) {
    const ksefRule = resolveRuleAtDate('KSEF_MANDATORY_SCHEDULE_2026', eventDate, ruleOptions);
    const receivingFrom = getRequiredStringParameter(ksefRule, 'receivingMandatoryFrom');
    const largeFrom = getRequiredStringParameter(ksefRule, 'largeTaxpayerIssuingFrom');
    const generalFrom = getRequiredStringParameter(ksefRule, 'generalIssuingFrom');
    const microLimit = getRequiredNumericParameter(
      ksefRule,
      'microExemptionMonthlyGrossLimitGrosze',
    );

    if (eventDate >= receivingFrom) {
      const issuingStart = profile.ksefSales2024Above200M === true ? largeFrom : generalFrom;
      const isMicroExempt =
        eventDate >= issuingStart &&
        profile.monthlyB2bGrossSalesGrosze !== undefined &&
        profile.monthlyB2bGrossSalesGrosze <= microLimit;

      const status: TaxCalendarObligation['status'] =
        eventDate < issuingStart
          ? 'informational'
          : isMicroExempt
            ? 'exempt_transitional'
            : 'applicable';

      const ksefWarnings: ExplanationWarning[] = isMicroExempt
        ? [
            {
              code: 'KSEF_MICRO_EXEMPTION_10K_ACTIVE',
              severity: 'info',
              message: `Miesięczna sprzedaż fakturowana B2B (${formatPlnFromGrosze(profile.monthlyB2bGrossSalesGrosze!)}) nie przekracza 10 000,00 zł brutto — dopuszczalne wystawianie poza KSeF do końca 2026 r. (odbiór w KSeF nadal obowiązkowy).`,
            },
          ]
        : [];

      obligations.push(
        createDeadlineObligation({
          code: 'KSEF_COMPLIANCE_2026',
          title:
            eventDate < issuingStart
              ? 'Obowiązek odbioru faktur zakupowych w KSeF 2.0'
              : isMicroExempt
                ? 'Odbiór faktur w KSeF (przejściowe wyłączenie wystawiania <= 10 000 zł brutto/mies.)'
                : 'Obowiązek wystawiania i odbioru faktur ustrukturyzowanych w KSeF 2.0',
          category: 'ksef',
          period,
          eventDate,
          statutoryDueDate: eventDate,
          status,
          primaryRule: ksefRule,
          shiftRule,
          holidaysRule,
          summaryPrefix: `Status KSeF 2.0 w okresie ${period}`,
          warnings: ksefWarnings,
        }),
      );
    }
  }

  // 5. JPK dochodowe (JPK_PKPIR / JPK_EWP / JPK_KR_PD) — obowiązek prowadzenia elektronicznego w 2026 dla podatników JPK_V7M
  if (
    yearNumber >= 2026 &&
    monthNumber === 1 &&
    profile.vatStatus === 'czynny' &&
    profile.vatSettlementPeriod === 'monthly'
  ) {
    const jpkPdRule = resolveRuleAtDate('JPK_INCOME_TAX_SCHEDULE', eventDate, ruleOptions);
    obligations.push(
      createDeadlineObligation({
        code: 'JPK_INCOME_TAX_KEEPING',
        title:
          profile.profileCode === 'spzoo_pelne_ksiegi'
            ? 'Prowadzenie ksiąg rachunkowych wg struktury JPK_KR_PD / JPK_ST_KR'
            : profile.profileCode === 'jdg_ryczalt'
              ? 'Prowadzenie ewidencji przychodów wg struktury JPK_EWP'
              : 'Prowadzenie PKPiR wg struktury JPK_PKPIR',
        category: 'jpk_income_tax',
        period,
        eventDate,
        statutoryDueDate: `${String(yearNumber + 1)}-${profile.profileCode === 'spzoo_pelne_ksiegi' ? '03-31' : '04-30'}`,
        status: 'informational',
        primaryRule: jpkPdRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: `Obowiązek struktury JPK podatku dochodowego za rok ${String(yearNumber)}`,
      }),
    );
  }

  // 6. e-Doręczenia (KRS od 2025-04-01, CEIDG przed 2025 od 2026-10-01)
  const edoreczeniaRule = resolveRuleAtDate('EDORECZENIA_SCHEDULE', eventDate, ruleOptions);
  const krsMandatoryFrom = getRequiredStringParameter(edoreczeniaRule, 'krsExistingMandatoryFrom');
  const ceidgMandatoryFrom = getRequiredStringParameter(
    edoreczeniaRule,
    'ceidgExistingMandatoryFrom',
  );

  if (profile.profileCode === 'spzoo_pelne_ksiegi' && period === krsMandatoryFrom.slice(0, 7)) {
    obligations.push(
      createDeadlineObligation({
        code: 'EDORECZENIA_KRS_MANDATORY',
        title: 'Obowiązek posiadania aktywnego adresu do e-Doręczeń dla podmiotu w KRS',
        category: 'edoreczenia',
        period,
        eventDate,
        statutoryDueDate: krsMandatoryFrom,
        status: 'applicable',
        primaryRule: edoreczeniaRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: 'Wejście w życie obowiązku e-Doręczeń dla KRS',
      }),
    );
  } else if (
    profile.profileCode !== 'spzoo_pelne_ksiegi' &&
    profile.ceidgRegisteredBefore2025 !== false &&
    period === ceidgMandatoryFrom.slice(0, 7)
  ) {
    obligations.push(
      createDeadlineObligation({
        code: 'EDORECZENIA_CEIDG_MANDATORY',
        title: 'Powszechny obowiązek posiadania aktywnego adresu do e-Doręczeń w CEIDG',
        category: 'edoreczenia',
        period,
        eventDate,
        statutoryDueDate: ceidgMandatoryFrom,
        status: 'applicable',
        primaryRule: edoreczeniaRule,
        shiftRule,
        holidaysRule,
        summaryPrefix: 'Wejście w życie powszechnego obowiązku e-Doręczeń dla CEIDG',
      }),
    );
  }

  return obligations;
}
