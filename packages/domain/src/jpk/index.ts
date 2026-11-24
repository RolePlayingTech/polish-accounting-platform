import { validateKsefNumber } from '../ksef/index.js';
import { assertValidIsoCalendarDate } from '../legal-rules/index.js';
import { validatePolishNip } from '../money.js';
import type { AccountingTaxProfileCode } from '../tax-rules/index.js';

export type OfficialJpkStructureCode =
  | 'JPK_V7M(2)'
  | 'JPK_V7M(3)'
  | 'JPK_V7K(3)'
  | 'JPK_PKPIR(3)'
  | 'JPK_EWP(4)'
  | 'JPK_ST(1)'
  | 'JPK_KR_PD(1)'
  | 'JPK_ST_KR(1)';

export type VatSettlementCadence = 'monthly' | 'quarterly' | 'not_applicable';

export interface JpkApplicabilityInput {
  profile: AccountingTaxProfileCode;
  vatPayer: boolean;
  vatCadence: VatSettlementCadence;
  /** YYYY-MM settlement period (e.g. "2026-01", "2026-02", "2026-03") */
  periodYearMonth: string;
  /** Prior tax year revenue in EUR for CIT JPK_PD 2025/2026/2027 wave determination */
  priorYearRevenueEur?: number;
}

export interface ApplicableJpkStructureDescriptor {
  structureCode: OfficialJpkStructureCode;
  obligationKind: 'periodic_statutory' | 'annual_statutory' | 'on_demand_or_annual';
  mandatoryForTaxYear: boolean;
  statutoryEffectiveFrom: string;
  officialNamespace: string;
  notesPl: string;
}

function parsePeriodYearMonth(periodYearMonth: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodYearMonth);
  if (!match) {
    throw new Error(`Invalid YYYY-MM period "${periodYearMonth}".`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

/**
 * Resolves the exact statutory MF JPK structures applicable to a Polish taxpayer profile,
 * VAT settlement cadence, and effective date (including the 2026-02-01 JPK_V7M(3)/V7K(3)
 * cutover and the 2025/2026/2027 JPK_PD rollout schedule).
 */
export function resolveApplicableJpkStructures(
  input: JpkApplicabilityInput,
): ReadonlyArray<ApplicableJpkStructureDescriptor> {
  const { year, month } = parsePeriodYearMonth(input.periodYearMonth);
  const results: ApplicableJpkStructureDescriptor[] = [];

  if (input.vatPayer) {
    if (input.vatCadence === 'not_applicable') {
      throw new Error('Active VAT payer must specify monthly or quarterly VAT cadence.');
    }
    const isFromFeb2026 = year > 2026 || (year === 2026 && month >= 2);
    if (input.vatCadence === 'monthly') {
      if (isFromFeb2026) {
        results.push({
          structureCode: 'JPK_V7M(3)',
          obligationKind: 'periodic_statutory',
          mandatoryForTaxYear: true,
          statutoryEffectiveFrom: '2026-02-01',
          officialNamespace: 'http://crd.gov.pl/wzor/2025/12/19/14090/',
          notesPl:
            'Miesięczny JPK_V7M(3) z oznaczeniami KSeF (NrKSeF / OFF / BFK / DI) obowiązujący od rozliczenia za luty 2026 r.',
        });
      } else {
        results.push({
          structureCode: 'JPK_V7M(2)',
          obligationKind: 'periodic_statutory',
          mandatoryForTaxYear: true,
          statutoryEffectiveFrom: '2022-01-01',
          officialNamespace: 'http://crd.gov.pl/wzor/2021/12/27/11148/',
          notesPl:
            'Archiwalny miesięczny JPK_V7M(2) właściwy dla okresów do stycznia 2026 r. włącznie.',
        });
      }
    } else {
      if (!isFromFeb2026) {
        throw new Error(
          `Quarterly JPK_V7K(3) applies from 2026-02-01; archival JPK_V7K(2) before 2026-02 is outside 2026 scope (got ${input.periodYearMonth}).`,
        );
      }
      results.push({
        structureCode: 'JPK_V7K(3)',
        obligationKind: 'periodic_statutory',
        mandatoryForTaxYear: true,
        statutoryEffectiveFrom: '2026-02-01',
        officialNamespace: 'http://crd.gov.pl/wzor/2025/12/19/14089/',
        notesPl:
          month % 3 === 0
            ? 'Kwartalny JPK_V7K(3) za 3. miesiąc kwartału: część ewidencyjna + deklaracyjna VAT-7K(17).'
            : 'Kwartalny JPK_V7K(3) za 1./2. miesiąc kwartału: wyłącznie część ewidencyjna.',
      });
    }
  }

  // PIT JPK_PD rollout: mandatory from 2026-01-01 for JPK_V7M filers, from 2027-01-01 for V7K / VAT-exempt
  const pitJpkPdMandatory =
    year >= 2027 || (year === 2026 && input.vatPayer && input.vatCadence === 'monthly');

  if (input.profile === 'jdg_kpir_skala' || input.profile === 'jdg_kpir_liniowy') {
    results.push({
      structureCode: 'JPK_PKPIR(3)',
      obligationKind: pitJpkPdMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: pitJpkPdMandatory,
      statutoryEffectiveFrom: '2026-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/10/30/10302/',
      notesPl: pitJpkPdMandatory
        ? 'Obowiązkowe roczne przesyłanie JPK_PKPIR(3) (podatnik składający JPK_V7M od 2026 r. lub wszyscy od 2027 r.).'
        : 'Struktura JPK_PKPIR(3) dostępna na żądanie organu; obowiązek roczny JPK_PD dla podatników zwolnionych z VAT / kwartalnych od 2027 r.',
    });
    results.push({
      structureCode: 'JPK_ST(1)',
      obligationKind: pitJpkPdMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: pitJpkPdMandatory,
      statutoryEffectiveFrom: '2026-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/11/26/11262/',
      notesPl: 'Wykaz środków trwałych oraz WNiP JPK_ST(1) (gałąź PKPIR, ZnacznikST=2).',
    });
  } else if (input.profile === 'jdg_ryczalt') {
    results.push({
      structureCode: 'JPK_EWP(4)',
      obligationKind: pitJpkPdMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: pitJpkPdMandatory,
      statutoryEffectiveFrom: '2026-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/10/30/10301/',
      notesPl: pitJpkPdMandatory
        ? 'Obowiązkowe roczne przesyłanie JPK_EWP(4) (ryczałt).'
        : 'Struktura JPK_EWP(4) dostępna na żądanie; obowiązek roczny dla zwolnionych z VAT / V7K od 2027 r.',
    });
    results.push({
      structureCode: 'JPK_ST(1)',
      obligationKind: pitJpkPdMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: pitJpkPdMandatory,
      statutoryEffectiveFrom: '2026-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/11/26/11262/',
      notesPl: 'Wykaz środków trwałych oraz WNiP JPK_ST(1) (gałąź EWP, ZnacznikST=1).',
    });
  } else if (input.profile === 'spzoo_pelne_ksiegi') {
    const citLargeOver50mEur = (input.priorYearRevenueEur ?? 0) > 50_000_000;
    const citJpkKrMandatory =
      year >= 2027 ||
      (year >= 2025 && citLargeOver50mEur) ||
      (year === 2026 && input.vatPayer && input.vatCadence === 'monthly');

    results.push({
      structureCode: 'JPK_KR_PD(1)',
      obligationKind: citJpkKrMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: citJpkKrMandatory,
      statutoryEffectiveFrom: '2025-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/09/04/09041/',
      notesPl: citJpkKrMandatory
        ? 'Obowiązkowe księgi rachunkowe JPK_KR_PD(1) po zakończeniu roku podatkowego CIT.'
        : 'Księgi rachunkowe JPK_KR_PD(1) (obowiązek powszechny dla pozostałych podatników CIT od roku rozpoczynającego się po 31.12.2026).',
    });
    results.push({
      structureCode: 'JPK_ST_KR(1)',
      obligationKind: citJpkKrMandatory ? 'annual_statutory' : 'on_demand_or_annual',
      mandatoryForTaxYear: citJpkKrMandatory,
      statutoryEffectiveFrom: '2025-01-01',
      officialNamespace: 'http://jpk.mf.gov.pl/wzor/2024/04/24/04242/',
      notesPl:
        'Ewidencja środków trwałych i WNiP dla ksiąg rachunkowych JPK_ST_KR(1) (obowiązkowa od 2026/2027 r. zależnie od fali JPK_CIT).',
    });
  }

  return results;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function assertValidNip10(nip: string, label: string): void {
  if (!/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(nip)) {
    throw new Error(`Invalid Polish 10-digit NIP for ${label}: "${nip}".`);
  }
  const check = validatePolishNip(nip);
  if (!check.valid) {
    throw new Error(
      `Invalid Polish NIP modulo-11 checksum for ${label} ("${nip}"): ${check.reason ?? 'checksum mismatch'}.`,
    );
  }
}

function assertValidIsoDate(date: string, label: string): void {
  assertValidIsoCalendarDate(date, label);
}

function assertValidIsoDateTimeUtc(dateTime: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(dateTime)) {
    throw new Error(`Invalid UTC ISO-8601 timestamp for ${label}: "${dateTime}".`);
  }
}

function assertValidTaxOfficeCode(code: string): void {
  if (!/^\d{4}$/.test(code) || code === '0000' || code === '0201') {
    throw new Error(`Invalid 4-digit Polish tax office code (TKodUS): "${code}".`);
  }
}

function assertSafeIntegerGrosze(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer in grosze, got ${value}.`);
  }
}

export function formatGroszeDecimal(grosze: number): string {
  assertSafeIntegerGrosze(grosze, 'grosze');
  const sign = grosze < 0 ? '-' : '';
  const abs = Math.abs(grosze);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

function roundGroszeHalfUpToPlnInteger(grosze: number): number {
  assertSafeIntegerGrosze(grosze, 'grosze');
  const sign = grosze < 0 ? -1 : 1;
  const abs = Math.abs(grosze);
  return sign * Math.floor((abs + 50) / 100);
}

export type JpkTaxpayerSubject =
  | {
      kind: 'natural_person';
      nip: string;
      firstName: string;
      lastName: string;
      birthDate: string;
      email?: string;
      phone?: string;
    }
  | {
      kind: 'legal_entity';
      nip: string;
      fullName: string;
      email?: string;
      phone?: string;
      regon?: string;
    };

export interface JpkPolishAddress {
  voivodeship: string;
  county: string;
  municipality: string;
  street?: string;
  buildingNumber: string;
  apartmentNumber?: string;
  city: string;
  postalCode: string;
}

export type JpkKsefMarkerChoice =
  { kind: 'KSEF'; ksefNumber: string } | { kind: 'OFF' } | { kind: 'BFK' } | { kind: 'DI' };

export type JpkGtuCode =
  | 'GTU_01'
  | 'GTU_02'
  | 'GTU_03'
  | 'GTU_04'
  | 'GTU_05'
  | 'GTU_06'
  | 'GTU_07'
  | 'GTU_08'
  | 'GTU_09'
  | 'GTU_10'
  | 'GTU_11'
  | 'GTU_12'
  | 'GTU_13';

export type JpkSalesProcedureCode =
  | 'WSTO_EE'
  | 'IED'
  | 'TP'
  | 'TT_WNT'
  | 'TT_D'
  | 'MR_T'
  | 'MR_UZ'
  | 'I_42'
  | 'I_63'
  | 'B_SPV'
  | 'B_SPV_DOSTAWA'
  | 'B_MPV_PROWIZJA';

const ORDERED_GTU_CODES: ReadonlyArray<JpkGtuCode> = [
  'GTU_01',
  'GTU_02',
  'GTU_03',
  'GTU_04',
  'GTU_05',
  'GTU_06',
  'GTU_07',
  'GTU_08',
  'GTU_09',
  'GTU_10',
  'GTU_11',
  'GTU_12',
  'GTU_13',
];

const ORDERED_SALES_PROCEDURES: ReadonlyArray<JpkSalesProcedureCode> = [
  'WSTO_EE',
  'IED',
  'TP',
  'TT_WNT',
  'TT_D',
  'MR_T',
  'MR_UZ',
  'I_42',
  'I_63',
  'B_SPV',
  'B_SPV_DOSTAWA',
  'B_MPV_PROWIZJA',
];

export interface JpkV7SalesRowInput {
  counterpartyCountryCode?: string;
  counterpartyTin?: string;
  counterpartyName: string;
  documentNumber: string;
  issueDate: string;
  saleDate?: string;
  ksefMarker: JpkKsefMarkerChoice;
  documentType?: 'RO' | 'WEW' | 'FP';
  gtuCodes?: ReadonlyArray<JpkGtuCode>;
  procedureCodes?: ReadonlyArray<JpkSalesProcedureCode>;
  exemptNetGrosze?: number; // K_10
  outsideCountryNetGrosze?: number; // K_11
  zeroDomesticNetGrosze?: number; // K_13
  net5Grosze?: number; // K_15
  vat5Grosze?: number; // K_16
  net8Grosze?: number; // K_17
  vat8Grosze?: number; // K_18
  net23Grosze?: number; // K_19
  vat23Grosze?: number; // K_20
}

export interface JpkV7PurchaseRowInput {
  supplierCountryCode?: string;
  supplierTin: string;
  supplierName: string;
  documentNumber: string;
  purchaseDate: string;
  receiptDate?: string;
  ksefMarker: JpkKsefMarkerChoice;
  documentType?: 'MK' | 'VAT_RR' | 'WEW';
  importFlag?: boolean;
  fixedAssetsNetGrosze?: number; // K_40
  fixedAssetsVatGrosze?: number; // K_41
  otherAcquisitionsNetGrosze?: number; // K_42
  otherAcquisitionsVatGrosze?: number; // K_43
}

export type JpkVatRefundTimeframe =
  | '15_days' // P_540: rachunek rozliczeniowy podatnika w terminie 15 dni
  | '25_days_vat_account' // P_55: rachunek VAT podatnika w terminie 25 dni
  | '25_days_art87_6' // P_56: rachunek rozliczeniowy w terminie 25 dni (art. 87 ust. 6 ustawy o VAT)
  | '40_days' // P_560: rachunek rozliczeniowy w terminie 40 dni (podstawowy termin zwrotu od 2026-02 w KSeF)
  | '60_days' // P_57: rachunek rozliczeniowy w terminie 60 dni (WYŁĄCZNIE archiwalny JPK_V7M(2)!)
  | '180_days'; // P_58: rachunek rozliczeniowy w terminie 180 dni

export interface GenerateJpkV7Input {
  variant: 'JPK_V7M(3)' | 'JPK_V7K(3)' | 'JPK_V7M(2)';
  generatedAtIso: string;
  systemName?: string;
  purpose: 1 | 2;
  taxOfficeCode: string;
  year: number;
  month: number;
  subject: JpkTaxpayerSubject;
  salesRows: ReadonlyArray<JpkV7SalesRowInput>;
  purchaseRows: ReadonlyArray<JpkV7PurchaseRowInput>;
  /** Prior period excess input VAT carried forward in PLN integer (P_39) */
  priorExcessCarryoverPln?: number;
  /** Requested bank refund in PLN integer (P_54); remainder goes to P_62 carryover */
  requestedRefundPln?: number;
  refundTimeframe?: JpkVatRefundTimeframe;
  correctionJustification?: string;
  /**
   * For JPK_V7K(3) in month 3 of a quarter, aggregated declaration totals for months 1+2
   * can be added onto month 3's register totals if needed.
   */
  quarterlyPriorMonthsCarry?: {
    exemptPln?: number;
    outsideCountryPln?: number;
    zeroDomesticPln?: number;
    net5Pln?: number;
    vat5Pln?: number;
    net8Pln?: number;
    vat8Pln?: number;
    net23Pln?: number;
    vat23Pln?: number;
    fixedAssetsNetPln?: number;
    fixedAssetsVatPln?: number;
    otherAcquisitionsNetPln?: number;
    otherAcquisitionsVatPln?: number;
  };
  /**
   * Exact integer grosze carry for JPK_V7K(3) months 1+2 so quarterly VAT-7K(17) fields
   * are summed in grosze across all 3 months of the quarter and rounded once per rate/bucket
   * (Art. 99 ust. 2–3 ustawy o VAT + Art. 63 § 1 Ordynacji podatkowej).
   */
  quarterlyPriorMonthsCarryGrosze?: {
    exemptNetGrosze?: number;
    outsideCountryNetGrosze?: number;
    zeroDomesticNetGrosze?: number;
    net5Grosze?: number;
    vat5Grosze?: number;
    net8Grosze?: number;
    vat8Grosze?: number;
    net23Grosze?: number;
    vat23Grosze?: number;
    fixedAssetsNetGrosze?: number;
    fixedAssetsVatGrosze?: number;
    otherAcquisitionsNetGrosze?: number;
    otherAcquisitionsVatGrosze?: number;
  };
}

function renderKsefMarkerChoiceXml(marker: JpkKsefMarkerChoice, indent: string): string[] {
  if (marker.kind === 'KSEF') {
    const valid = validateKsefNumber(marker.ksefNumber);
    if (!valid.valid) {
      throw new Error(
        `Invalid KSeF number in JPK_V7(3) NrKSeF: "${marker.ksefNumber}" (${valid.reason}).`,
      );
    }
    return [`${indent}<NrKSeF>${escapeXml(marker.ksefNumber)}</NrKSeF>`];
  }
  return [`${indent}<${marker.kind}>1</${marker.kind}>`];
}

function renderJpkV7Podmiot1Xml(subject: JpkTaxpayerSubject, requireEmail: boolean): string[] {
  assertValidNip10(subject.nip, 'Podmiot1.NIP');
  const lines: string[] = ['  <Podmiot1 rola="Podatnik">'];
  if (subject.kind === 'natural_person') {
    assertValidIsoDate(subject.birthDate, 'OsobaFizyczna.DataUrodzenia');
    if (requireEmail && (!subject.email || subject.email.trim().length === 0)) {
      throw new Error('JPK_V7 Podmiot1.OsobaFizyczna requires <Email>.');
    }
    lines.push('    <OsobaFizyczna>');
    lines.push(`      <etd:NIP>${escapeXml(subject.nip)}</etd:NIP>`);
    lines.push(`      <etd:ImiePierwsze>${escapeXml(subject.firstName)}</etd:ImiePierwsze>`);
    lines.push(`      <etd:Nazwisko>${escapeXml(subject.lastName)}</etd:Nazwisko>`);
    lines.push(`      <etd:DataUrodzenia>${escapeXml(subject.birthDate)}</etd:DataUrodzenia>`);
    if (subject.email) {
      lines.push(`      <Email>${escapeXml(subject.email)}</Email>`);
    }
    if (subject.phone) {
      lines.push(`      <Telefon>${escapeXml(subject.phone)}</Telefon>`);
    }
    lines.push('    </OsobaFizyczna>');
  } else {
    if (requireEmail && (!subject.email || subject.email.trim().length === 0)) {
      throw new Error('JPK_V7 Podmiot1.OsobaNiefizyczna requires <Email>.');
    }
    lines.push('    <OsobaNiefizyczna>');
    lines.push(`      <NIP>${escapeXml(subject.nip)}</NIP>`);
    lines.push(`      <PelnaNazwa>${escapeXml(subject.fullName)}</PelnaNazwa>`);
    if (subject.email) {
      lines.push(`      <Email>${escapeXml(subject.email)}</Email>`);
    }
    if (subject.phone) {
      lines.push(`      <Telefon>${escapeXml(subject.phone)}</Telefon>`);
    }
    lines.push('    </OsobaNiefizyczna>');
  }
  lines.push('  </Podmiot1>');
  return lines;
}

/**
 * Generates deterministic, XSD-compliant XML for `JPK_V7M(3)`, `JPK_V7K(3)`, and archival `JPK_V7M(2)`.
 */
export function generateJpkV7Xml(input: GenerateJpkV7Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidTaxOfficeCode(input.taxOfficeCode);
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error(`Invalid JPK_V7 month: ${input.month}.`);
  }

  const isV3 = input.variant === 'JPK_V7M(3)' || input.variant === 'JPK_V7K(3)';
  const isQuarterly = input.variant === 'JPK_V7K(3)';

  if (isV3 && input.year < 2026) {
    throw new Error(`${input.variant} requires year >= 2026 (got ${input.year}).`);
  }
  if (isV3 && input.year === 2026 && input.month < 2) {
    throw new Error(`${input.variant} applies starting 2026-02 (got 2026-0${input.month}).`);
  }
  if (isV3 && input.generatedAtIso < '2026-02-01T00:00:00Z') {
    throw new Error(
      `${input.variant} XSD requires DataWytworzeniaJPK >= 2026-02-01T00:00:00Z (got ${input.generatedAtIso}).`,
    );
  }

  const targetNs =
    input.variant === 'JPK_V7M(3)'
      ? 'http://crd.gov.pl/wzor/2025/12/19/14090/'
      : input.variant === 'JPK_V7K(3)'
        ? 'http://crd.gov.pl/wzor/2025/12/19/14089/'
        : 'http://crd.gov.pl/wzor/2021/12/27/11148/';

  const etdNs = isV3
    ? 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/'
    : 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2021/06/08/eD/DefinicjeTypy/';

  const systemCodeAttr =
    input.variant === 'JPK_V7M(3)'
      ? 'JPK_V7M (3)'
      : input.variant === 'JPK_V7K(3)'
        ? 'JPK_V7K (3)'
        : 'JPK_V7M (2)';
  const variantNum = isV3 ? '3' : '2';

  let totalExemptGrosze = 0;
  let totalOutsideCountryGrosze = 0;
  let totalZeroDomesticGrosze = 0;
  let totalNet5Grosze = 0;
  let totalVat5Grosze = 0;
  let totalNet8Grosze = 0;
  let totalVat8Grosze = 0;
  let totalNet23Grosze = 0;
  let totalVat23Grosze = 0;
  let totalOutputVatGrosze = 0;

  let totalFixedAssetsNetGrosze = 0;
  let totalFixedAssetsVatGrosze = 0;
  let totalOtherNetGrosze = 0;
  let totalOtherVatGrosze = 0;
  let totalInputVatGrosze = 0;

  const salesXmlLines: string[] = [];
  input.salesRows.forEach((row, index) => {
    assertValidIsoDate(row.issueDate, `SprzedazWiersz[${index + 1}].DataWystawienia`);
    if (row.saleDate) {
      assertValidIsoDate(row.saleDate, `SprzedazWiersz[${index + 1}].DataSprzedazy`);
    }

    const k10 = row.exemptNetGrosze ?? 0;
    const k11 = row.outsideCountryNetGrosze ?? 0;
    const k13 = row.zeroDomesticNetGrosze ?? 0;
    const k15 = row.net5Grosze ?? 0;
    const k16 = row.vat5Grosze ?? 0;
    const k17 = row.net8Grosze ?? 0;
    const k18 = row.vat8Grosze ?? 0;
    const k19 = row.net23Grosze ?? 0;
    const k20 = row.vat23Grosze ?? 0;

    totalExemptGrosze += k10;
    totalOutsideCountryGrosze += k11;
    totalZeroDomesticGrosze += k13;
    totalNet5Grosze += k15;
    totalVat5Grosze += k16;
    totalNet8Grosze += k17;
    totalVat8Grosze += k18;
    totalNet23Grosze += k19;
    totalVat23Grosze += k20;
    totalOutputVatGrosze += k16 + k18 + k20;

    salesXmlLines.push('    <SprzedazWiersz>');
    salesXmlLines.push(`      <LpSprzedazy>${index + 1}</LpSprzedazy>`);
    if (row.counterpartyCountryCode) {
      salesXmlLines.push(
        `      <KodKrajuNadaniaTIN>${escapeXml(row.counterpartyCountryCode)}</KodKrajuNadaniaTIN>`,
      );
    }
    salesXmlLines.push(
      `      <NrKontrahenta>${escapeXml(row.counterpartyTin ?? 'BRAK')}</NrKontrahenta>`,
    );
    salesXmlLines.push(
      `      <NazwaKontrahenta>${escapeXml(row.counterpartyName)}</NazwaKontrahenta>`,
    );
    salesXmlLines.push(`      <DowodSprzedazy>${escapeXml(row.documentNumber)}</DowodSprzedazy>`);
    salesXmlLines.push(`      <DataWystawienia>${escapeXml(row.issueDate)}</DataWystawienia>`);
    if (row.saleDate) {
      salesXmlLines.push(`      <DataSprzedazy>${escapeXml(row.saleDate)}</DataSprzedazy>`);
    }
    if (isV3) {
      salesXmlLines.push(...renderKsefMarkerChoiceXml(row.ksefMarker, '      '));
    }
    if (row.documentType) {
      salesXmlLines.push(`      <TypDokumentu>${escapeXml(row.documentType)}</TypDokumentu>`);
    }
    if (row.gtuCodes && row.gtuCodes.length > 0) {
      const gtuSet = new Set(row.gtuCodes);
      for (const code of ORDERED_GTU_CODES) {
        if (gtuSet.has(code)) {
          salesXmlLines.push(`      <${code}>1</${code}>`);
        }
      }
    }
    if (row.procedureCodes && row.procedureCodes.length > 0) {
      const procSet = new Set(row.procedureCodes);
      for (const proc of ORDERED_SALES_PROCEDURES) {
        if (procSet.has(proc)) {
          salesXmlLines.push(`      <${proc}>1</${proc}>`);
        }
      }
    }
    if (k10 !== 0) {
      salesXmlLines.push(`      <K_10>${formatGroszeDecimal(k10)}</K_10>`);
    }
    if (k11 !== 0) {
      salesXmlLines.push(`      <K_11>${formatGroszeDecimal(k11)}</K_11>`);
    }
    if (k13 !== 0) {
      salesXmlLines.push(`      <K_13>${formatGroszeDecimal(k13)}</K_13>`);
    }
    if (k15 !== 0 || k16 !== 0) {
      salesXmlLines.push(`      <K_15>${formatGroszeDecimal(k15)}</K_15>`);
      salesXmlLines.push(`      <K_16>${formatGroszeDecimal(k16)}</K_16>`);
    }
    if (k17 !== 0 || k18 !== 0) {
      salesXmlLines.push(`      <K_17>${formatGroszeDecimal(k17)}</K_17>`);
      salesXmlLines.push(`      <K_18>${formatGroszeDecimal(k18)}</K_18>`);
    }
    if (k19 !== 0 || k20 !== 0) {
      salesXmlLines.push(`      <K_19>${formatGroszeDecimal(k19)}</K_19>`);
      salesXmlLines.push(`      <K_20>${formatGroszeDecimal(k20)}</K_20>`);
    }
    salesXmlLines.push('    </SprzedazWiersz>');
  });

  salesXmlLines.push('    <SprzedazCtrl>');
  salesXmlLines.push(
    `      <LiczbaWierszySprzedazy>${input.salesRows.length}</LiczbaWierszySprzedazy>`,
  );
  salesXmlLines.push(
    `      <PodatekNalezny>${formatGroszeDecimal(totalOutputVatGrosze)}</PodatekNalezny>`,
  );
  salesXmlLines.push('    </SprzedazCtrl>');

  const purchaseXmlLines: string[] = [];
  input.purchaseRows.forEach((row, index) => {
    assertValidIsoDate(row.purchaseDate, `ZakupWiersz[${index + 1}].DataZakupu`);
    if (row.receiptDate) {
      assertValidIsoDate(row.receiptDate, `ZakupWiersz[${index + 1}].DataWplywu`);
    }
    const k40 = row.fixedAssetsNetGrosze ?? 0;
    const k41 = row.fixedAssetsVatGrosze ?? 0;
    const k42 = row.otherAcquisitionsNetGrosze ?? 0;
    const k43 = row.otherAcquisitionsVatGrosze ?? 0;

    totalFixedAssetsNetGrosze += k40;
    totalFixedAssetsVatGrosze += k41;
    totalOtherNetGrosze += k42;
    totalOtherVatGrosze += k43;
    totalInputVatGrosze += k41 + k43;

    purchaseXmlLines.push('    <ZakupWiersz>');
    purchaseXmlLines.push(`      <LpZakupu>${index + 1}</LpZakupu>`);
    if (row.supplierCountryCode) {
      purchaseXmlLines.push(
        `      <KodKrajuNadaniaTIN>${escapeXml(row.supplierCountryCode)}</KodKrajuNadaniaTIN>`,
      );
    }
    purchaseXmlLines.push(`      <NrDostawcy>${escapeXml(row.supplierTin)}</NrDostawcy>`);
    purchaseXmlLines.push(`      <NazwaDostawcy>${escapeXml(row.supplierName)}</NazwaDostawcy>`);
    purchaseXmlLines.push(`      <DowodZakupu>${escapeXml(row.documentNumber)}</DowodZakupu>`);
    purchaseXmlLines.push(`      <DataZakupu>${escapeXml(row.purchaseDate)}</DataZakupu>`);
    if (row.receiptDate) {
      purchaseXmlLines.push(`      <DataWplywu>${escapeXml(row.receiptDate)}</DataWplywu>`);
    }
    if (isV3) {
      purchaseXmlLines.push(...renderKsefMarkerChoiceXml(row.ksefMarker, '      '));
    }
    if (row.documentType) {
      purchaseXmlLines.push(
        `      <DokumentZakupu>${escapeXml(row.documentType)}</DokumentZakupu>`,
      );
    }
    if (row.importFlag) {
      purchaseXmlLines.push('      <IMP>1</IMP>');
    }
    if (k40 !== 0 || k41 !== 0) {
      purchaseXmlLines.push(`      <K_40>${formatGroszeDecimal(k40)}</K_40>`);
      purchaseXmlLines.push(`      <K_41>${formatGroszeDecimal(k41)}</K_41>`);
    }
    if (k42 !== 0 || k43 !== 0) {
      purchaseXmlLines.push(`      <K_42>${formatGroszeDecimal(k42)}</K_42>`);
      purchaseXmlLines.push(`      <K_43>${formatGroszeDecimal(k43)}</K_43>`);
    }
    purchaseXmlLines.push('    </ZakupWiersz>');
  });

  purchaseXmlLines.push('    <ZakupCtrl>');
  purchaseXmlLines.push(
    `      <LiczbaWierszyZakupow>${input.purchaseRows.length}</LiczbaWierszyZakupow>`,
  );
  purchaseXmlLines.push(
    `      <PodatekNaliczony>${formatGroszeDecimal(totalInputVatGrosze)}</PodatekNaliczony>`,
  );
  purchaseXmlLines.push('    </ZakupCtrl>');

  const includeDeclaration = !isQuarterly || input.month % 3 === 0;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<JPK xmlns="${targetNs}" xmlns:etd="${etdNs}">`,
    '  <Naglowek>',
    `    <KodFormularza kodSystemowy="${systemCodeAttr}" wersjaSchemy="1-0E">JPK_VAT</KodFormularza>`,
    `    <WariantFormularza>${variantNum}</WariantFormularza>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <NazwaSystemu>${escapeXml(input.systemName ?? 'Polish Accounting Platform')}</NazwaSystemu>`,
    `    <CelZlozenia poz="P_7">${input.purpose}</CelZlozenia>`,
    `    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`,
    `    <Rok>${input.year}</Rok>`,
    `    <Miesiac>${input.month}</Miesiac>`,
    '  </Naglowek>',
    ...renderJpkV7Podmiot1Xml(input.subject, true),
  ];

  if (includeDeclaration) {
    const qCarry = input.quarterlyPriorMonthsCarry;
    const qGrosze = input.quarterlyPriorMonthsCarryGrosze;
    const p10 =
      roundGroszeHalfUpToPlnInteger(totalExemptGrosze + (qGrosze?.exemptNetGrosze ?? 0)) +
      (qCarry?.exemptPln ?? 0);
    const p11 =
      roundGroszeHalfUpToPlnInteger(
        totalOutsideCountryGrosze + (qGrosze?.outsideCountryNetGrosze ?? 0),
      ) + (qCarry?.outsideCountryPln ?? 0);
    const p13 =
      roundGroszeHalfUpToPlnInteger(
        totalZeroDomesticGrosze + (qGrosze?.zeroDomesticNetGrosze ?? 0),
      ) + (qCarry?.zeroDomesticPln ?? 0);
    const p15 =
      roundGroszeHalfUpToPlnInteger(totalNet5Grosze + (qGrosze?.net5Grosze ?? 0)) +
      (qCarry?.net5Pln ?? 0);
    const p16 =
      roundGroszeHalfUpToPlnInteger(totalVat5Grosze + (qGrosze?.vat5Grosze ?? 0)) +
      (qCarry?.vat5Pln ?? 0);
    const p17 =
      roundGroszeHalfUpToPlnInteger(totalNet8Grosze + (qGrosze?.net8Grosze ?? 0)) +
      (qCarry?.net8Pln ?? 0);
    const p18 =
      roundGroszeHalfUpToPlnInteger(totalVat8Grosze + (qGrosze?.vat8Grosze ?? 0)) +
      (qCarry?.vat8Pln ?? 0);
    const p19 =
      roundGroszeHalfUpToPlnInteger(totalNet23Grosze + (qGrosze?.net23Grosze ?? 0)) +
      (qCarry?.net23Pln ?? 0);
    const p20 =
      roundGroszeHalfUpToPlnInteger(totalVat23Grosze + (qGrosze?.vat23Grosze ?? 0)) +
      (qCarry?.vat23Pln ?? 0);

    const p37 = p10 + p11 + p13 + p15 + p17 + p19;
    const p38 = p16 + p18 + p20;
    const p39 = input.priorExcessCarryoverPln ?? 0;
    if (!Number.isInteger(p39) || p39 < 0) {
      throw new Error(
        `priorExcessCarryoverPln (P_39) must be a non-negative integer PLN, got ${p39}.`,
      );
    }

    const p40 =
      roundGroszeHalfUpToPlnInteger(
        totalFixedAssetsNetGrosze + (qGrosze?.fixedAssetsNetGrosze ?? 0),
      ) + (qCarry?.fixedAssetsNetPln ?? 0);
    const p41 =
      roundGroszeHalfUpToPlnInteger(
        totalFixedAssetsVatGrosze + (qGrosze?.fixedAssetsVatGrosze ?? 0),
      ) + (qCarry?.fixedAssetsVatPln ?? 0);
    const p42 =
      roundGroszeHalfUpToPlnInteger(
        totalOtherNetGrosze + (qGrosze?.otherAcquisitionsNetGrosze ?? 0),
      ) + (qCarry?.otherAcquisitionsNetPln ?? 0);
    const p43 =
      roundGroszeHalfUpToPlnInteger(
        totalOtherVatGrosze + (qGrosze?.otherAcquisitionsVatGrosze ?? 0),
      ) + (qCarry?.otherAcquisitionsVatPln ?? 0);

    const p48 = p39 + p41 + p43;
    const p51 = Math.max(0, p38 - p48);
    const p53 = Math.max(0, p48 - p38);

    const requestedRefundPln = input.requestedRefundPln ?? 0;
    if (!Number.isInteger(requestedRefundPln) || requestedRefundPln < 0) {
      throw new Error(`requestedRefundPln (P_54) must be a non-negative integer PLN.`);
    }
    if (requestedRefundPln > p53) {
      throw new Error(
        `Requested VAT refund P_54 (${requestedRefundPln} PLN) exceeds excess input VAT P_53 (${p53} PLN).`,
      );
    }
    const p62 = p53 - requestedRefundPln;

    lines.push('  <Deklaracja>');
    lines.push('    <Naglowek>');
    if (isQuarterly) {
      const quarter = Math.ceil(input.month / 3);
      lines.push(
        '      <KodFormularzaDekl kodSystemowy="VAT-7K (17)" kodPodatku="VAT" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7K</KodFormularzaDekl>',
      );
      lines.push('      <WariantFormularzaDekl>17</WariantFormularzaDekl>');
      lines.push(`      <Kwartal>${quarter}</Kwartal>`);
    } else if (isV3) {
      lines.push(
        '      <KodFormularzaDekl kodSystemowy="VAT-7 (23)" kodPodatku="VAT" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7</KodFormularzaDekl>',
      );
      lines.push('      <WariantFormularzaDekl>23</WariantFormularzaDekl>');
    } else {
      lines.push(
        '      <KodFormularzaDekl kodSystemowy="VAT-7 (22)" kodPodatku="VAT" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7</KodFormularzaDekl>',
      );
      lines.push('      <WariantFormularzaDekl>22</WariantFormularzaDekl>');
    }
    lines.push('    </Naglowek>');
    lines.push('    <PozycjeSzczegolowe>');
    if (p10 !== 0) {
      lines.push(`      <P_10>${p10}</P_10>`);
    }
    if (p11 !== 0) {
      lines.push(`      <P_11>${p11}</P_11>`);
    }
    if (p13 !== 0) {
      lines.push(`      <P_13>${p13}</P_13>`);
    }
    if (p15 !== 0 || p16 !== 0) {
      lines.push(`      <P_15>${p15}</P_15>`);
      lines.push(`      <P_16>${p16}</P_16>`);
    }
    if (p17 !== 0 || p18 !== 0) {
      lines.push(`      <P_17>${p17}</P_17>`);
      lines.push(`      <P_18>${p18}</P_18>`);
    }
    if (p19 !== 0 || p20 !== 0) {
      lines.push(`      <P_19>${p19}</P_19>`);
      lines.push(`      <P_20>${p20}</P_20>`);
    }
    if (p37 !== 0) {
      lines.push(`      <P_37>${p37}</P_37>`);
    }
    lines.push(`      <P_38>${p38}</P_38>`);
    if (p39 > 0) {
      lines.push(`      <P_39>${p39}</P_39>`);
    }
    if (p40 !== 0 || p41 !== 0) {
      lines.push(`      <P_40>${p40}</P_40>`);
      lines.push(`      <P_41>${p41}</P_41>`);
    }
    if (p42 !== 0 || p43 !== 0) {
      lines.push(`      <P_42>${p42}</P_42>`);
      lines.push(`      <P_43>${p43}</P_43>`);
    }
    if (p48 > 0) {
      lines.push(`      <P_48>${p48}</P_48>`);
    }
    lines.push(`      <P_51>${p51}</P_51>`);
    if (p53 > 0) {
      lines.push(`      <P_53>${p53}</P_53>`);
    }
    if (requestedRefundPln > 0) {
      const timeframe: JpkVatRefundTimeframe =
        input.refundTimeframe ?? (isV3 ? '40_days' : '60_days');
      if (timeframe === '60_days' && isV3) {
        throw new Error(
          `60-day VAT refund (P_57) was abolished starting 2026-02-01 in ${input.variant}; use "40_days" (P_560), "25_days_vat_account" (P_55), "25_days_art87_6" (P_56), "15_days" (P_540), or "180_days" (P_58).`,
        );
      }
      const refundTag =
        timeframe === '15_days'
          ? 'P_540'
          : timeframe === '25_days_vat_account'
            ? 'P_55'
            : timeframe === '25_days_art87_6'
              ? 'P_56'
              : timeframe === '40_days'
                ? 'P_560'
                : timeframe === '60_days'
                  ? 'P_57'
                  : 'P_58';
      lines.push(`      <P_54>${requestedRefundPln}</P_54>`);
      lines.push(`      <${refundTag}>1</${refundTag}>`);
    }
    if (p62 > 0) {
      lines.push(`      <P_62>${p62}</P_62>`);
    }
    if (input.correctionJustification) {
      lines.push(`      <P_ORDZU>${escapeXml(input.correctionJustification)}</P_ORDZU>`);
    }
    lines.push('    </PozycjeSzczegolowe>');
    lines.push('    <Pouczenia>1</Pouczenia>');
    lines.push('  </Deklaracja>');
  }

  lines.push('  <Ewidencja>');
  lines.push(...salesXmlLines);
  lines.push(...purchaseXmlLines);
  lines.push('  </Ewidencja>');
  lines.push('</JPK>');

  return `${lines.join('\n')}\n`;
}

// ============================================================================
// JPK_PKPIR(3) — v1-0 (http://jpk.mf.gov.pl/wzor/2024/10/30/10302/)
// ============================================================================

export interface JpkPkpirRowInput {
  entryDate: string; // K_2
  documentNumber: string; // K_3A
  ksefNumber?: string; // K_3B
  counterpartyCountryCode?: string; // K_4A
  counterpartyTin?: string; // K_4B
  counterpartyName: string; // K_5A
  counterpartyAddress: string; // K_5B
  description: string; // K_6
  salesRevenueGrosze?: number; // K_7
  otherRevenueGrosze?: number; // K_8
  goodsPurchaseGrosze?: number; // K_10
  incidentalPurchaseCostsGrosze?: number; // K_11
  remunerationGrosze?: number; // K_12
  otherExpensesGrosze?: number; // K_13
  rdCostDescription?: string; // K_16A
  rdCostGrosze?: number; // K_16B
  remarks?: string; // K_17
}

export interface GenerateJpkPkpir3Input {
  purpose: 0 | 1 | 2;
  generatedAtIso: string;
  dateFrom: string;
  dateTo: string;
  taxOfficeCode: string;
  subject: JpkTaxpayerSubject;
  cashBasisPit?: boolean;
  openingInventoryGrosze: number; // P_1
  closingInventoryGrosze: number; // P_2
  rows: ReadonlyArray<JpkPkpirRowInput>;
}

function renderJpkPitPodmiot1Xml(
  subject: JpkTaxpayerSubject,
  extraChildLines: ReadonlyArray<string>,
): string[] {
  assertValidNip10(subject.nip, 'Podmiot1.NIP');
  const lines: string[] = ['  <Podmiot1 rola="Podatnik">'];
  if (subject.kind === 'natural_person') {
    assertValidIsoDate(subject.birthDate, 'OsobaFizyczna.DataUrodzenia');
    lines.push('    <OsobaFizyczna>');
    lines.push(`      <etd:NIP>${escapeXml(subject.nip)}</etd:NIP>`);
    lines.push(`      <etd:ImiePierwsze>${escapeXml(subject.firstName)}</etd:ImiePierwsze>`);
    lines.push(`      <etd:Nazwisko>${escapeXml(subject.lastName)}</etd:Nazwisko>`);
    lines.push(`      <etd:DataUrodzenia>${escapeXml(subject.birthDate)}</etd:DataUrodzenia>`);
    if (subject.email) {
      lines.push(`      <Email>${escapeXml(subject.email)}</Email>`);
    }
    if (subject.phone) {
      lines.push(`      <Telefon>${escapeXml(subject.phone)}</Telefon>`);
    }
    lines.push('    </OsobaFizyczna>');
  } else {
    lines.push('    <OsobaNiefizyczna>');
    lines.push(`      <NIP>${escapeXml(subject.nip)}</NIP>`);
    lines.push(`      <PelnaNazwa>${escapeXml(subject.fullName)}</PelnaNazwa>`);
    if (subject.email) {
      lines.push(`      <Email>${escapeXml(subject.email)}</Email>`);
    }
    if (subject.phone) {
      lines.push(`      <Telefon>${escapeXml(subject.phone)}</Telefon>`);
    }
    lines.push('    </OsobaNiefizyczna>');
  }
  lines.push(...extraChildLines);
  lines.push('  </Podmiot1>');
  return lines;
}

export function generateJpkPkpir3Xml(input: GenerateJpkPkpir3Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidIsoDate(input.dateFrom, 'DataOd');
  assertValidIsoDate(input.dateTo, 'DataDo');
  assertValidTaxOfficeCode(input.taxOfficeCode);

  if (input.rows.length === 0) {
    throw new Error(
      'JPK_PKPIR(3) requires at least one PKPIRWiersz entry (XSD PKPIRCtrl/LiczbaWierszy is TNaturalnyJPK >= 1).',
    );
  }

  let totalRevenueGrosze = 0;
  let totalGoodsAndIncidentalGrosze = 0;
  let totalExpensesCol14Grosze = 0;

  const rowXmlLines: string[] = [];
  input.rows.forEach((row, idx) => {
    assertValidIsoDate(row.entryDate, `PKPIRWiersz[${idx + 1}].K_2`);
    if (row.ksefNumber) {
      const check = validateKsefNumber(row.ksefNumber);
      if (!check.valid) {
        throw new Error(`Invalid K_3B NrKSeF "${row.ksefNumber}": ${check.reason}`);
      }
    }

    const k7 = row.salesRevenueGrosze ?? 0;
    const k8 = row.otherRevenueGrosze ?? 0;
    const k9 = k7 + k8;
    const k10 = row.goodsPurchaseGrosze ?? 0;
    const k11 = row.incidentalPurchaseCostsGrosze ?? 0;
    const k12 = row.remunerationGrosze ?? 0;
    const k13 = row.otherExpensesGrosze ?? 0;
    const k14 = k12 + k13;

    totalRevenueGrosze += k9;
    totalGoodsAndIncidentalGrosze += k10 + k11;
    totalExpensesCol14Grosze += k14;

    rowXmlLines.push('  <PKPIRWiersz>');
    rowXmlLines.push(`    <K_1>${idx + 1}</K_1>`);
    rowXmlLines.push(`    <K_2>${escapeXml(row.entryDate)}</K_2>`);
    rowXmlLines.push(`    <K_3A>${escapeXml(row.documentNumber)}</K_3A>`);
    if (row.ksefNumber) {
      rowXmlLines.push(`    <K_3B>${escapeXml(row.ksefNumber)}</K_3B>`);
    }
    if (row.counterpartyCountryCode) {
      rowXmlLines.push(`    <K_4A>${escapeXml(row.counterpartyCountryCode)}</K_4A>`);
    }
    if (row.counterpartyTin) {
      rowXmlLines.push(`    <K_4B>${escapeXml(row.counterpartyTin)}</K_4B>`);
    }
    rowXmlLines.push(`    <K_5A>${escapeXml(row.counterpartyName)}</K_5A>`);
    rowXmlLines.push(`    <K_5B>${escapeXml(row.counterpartyAddress)}</K_5B>`);
    rowXmlLines.push(`    <K_6>${escapeXml(row.description)}</K_6>`);
    if (k7 !== 0) {
      rowXmlLines.push(`    <K_7>${formatGroszeDecimal(k7)}</K_7>`);
    }
    if (k8 !== 0) {
      rowXmlLines.push(`    <K_8>${formatGroszeDecimal(k8)}</K_8>`);
    }
    if (k9 !== 0) {
      rowXmlLines.push(`    <K_9>${formatGroszeDecimal(k9)}</K_9>`);
    }
    if (k10 !== 0) {
      rowXmlLines.push(`    <K_10>${formatGroszeDecimal(k10)}</K_10>`);
    }
    if (k11 !== 0) {
      rowXmlLines.push(`    <K_11>${formatGroszeDecimal(k11)}</K_11>`);
    }
    if (k12 !== 0) {
      rowXmlLines.push(`    <K_12>${formatGroszeDecimal(k12)}</K_12>`);
    }
    if (k13 !== 0) {
      rowXmlLines.push(`    <K_13>${formatGroszeDecimal(k13)}</K_13>`);
    }
    if (k14 !== 0) {
      rowXmlLines.push(`    <K_14>${formatGroszeDecimal(k14)}</K_14>`);
    }
    if (row.rdCostDescription && row.rdCostGrosze !== undefined) {
      rowXmlLines.push(`    <K_16A>${escapeXml(row.rdCostDescription)}</K_16A>`);
      rowXmlLines.push(`    <K_16B>${formatGroszeDecimal(row.rdCostGrosze)}</K_16B>`);
    }
    if (row.remarks) {
      rowXmlLines.push(`    <K_17>${escapeXml(row.remarks)}</K_17>`);
    }
    rowXmlLines.push('  </PKPIRWiersz>');
  });

  // P_3: total tax-year costs adjusted for opening/closing inventory
  const totalTaxCostsGrosze =
    input.openingInventoryGrosze +
    totalGoodsAndIncidentalGrosze -
    input.closingInventoryGrosze +
    totalExpensesCol14Grosze;
  const taxIncomeGrosze = Math.max(0, totalRevenueGrosze - totalTaxCostsGrosze);

  const extraPodmiot = input.cashBasisPit ? ['    <Kasowy_PIT>1</Kasowy_PIT>'] : [];

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2024/10/30/10302/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/">',
    '  <Naglowek>',
    '    <KodFormularza kodSystemowy="JPK_PKPIR (3)" wersjaSchemy="1-0">JPK_PKPIR</KodFormularza>',
    '    <WariantFormularza>3</WariantFormularza>',
    `    <CelZlozenia>${input.purpose}</CelZlozenia>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <DataOd>${escapeXml(input.dateFrom)}</DataOd>`,
    `    <DataDo>${escapeXml(input.dateTo)}</DataDo>`,
    `    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`,
    '  </Naglowek>',
    ...renderJpkPitPodmiot1Xml(input.subject, extraPodmiot),
    '  <PKPIRInfo>',
    `    <P_1>${formatGroszeDecimal(input.openingInventoryGrosze)}</P_1>`,
    `    <P_2>${formatGroszeDecimal(input.closingInventoryGrosze)}</P_2>`,
    `    <P_3>${formatGroszeDecimal(totalTaxCostsGrosze)}</P_3>`,
    `    <P_4>${formatGroszeDecimal(taxIncomeGrosze)}</P_4>`,
    '  </PKPIRInfo>',
    ...rowXmlLines,
    '  <PKPIRCtrl>',
    `    <LiczbaWierszy>${input.rows.length}</LiczbaWierszy>`,
    `    <SumaPrzychodow>${formatGroszeDecimal(totalRevenueGrosze)}</SumaPrzychodow>`,
    '  </PKPIRCtrl>',
    '</JPK>',
  ];

  return `${lines.join('\n')}\n`;
}

// ============================================================================
// JPK_EWP(4) — v1-0 (http://jpk.mf.gov.pl/wzor/2024/10/30/10301/)
// ============================================================================

export type JpkEwp4RateString = '17' | '15' | '14' | '12.5' | '12' | '10' | '8.5' | '5.5' | '3';

const ALLOWED_JPK_EWP4_RATES = new Set<string>([
  '17',
  '15',
  '14',
  '12.5',
  '12',
  '10',
  '8.5',
  '5.5',
  '3',
]);

export interface JpkEwpRowInput {
  entryDate: string; // K_2
  revenueDate: string; // K_3
  documentNumber: string; // K_4
  ksefNumber?: string; // K_5
  counterpartyCountryCode?: string; // K_6
  counterpartyTin?: string; // K_7
  revenueGrosze: number; // K_8
  ratePercent: string; // K_9
  remarks?: string; // K_10
}

export interface GenerateJpkEwp4Input {
  purpose: 0 | 1 | 2;
  generatedAtIso: string;
  dateFrom: string;
  dateTo: string;
  taxOfficeCode: string;
  subject: JpkTaxpayerSubject;
  cashBasisPit?: boolean;
  rows: ReadonlyArray<JpkEwpRowInput>;
}

export function generateJpkEwp4Xml(input: GenerateJpkEwp4Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidIsoDate(input.dateFrom, 'DataOd');
  assertValidIsoDate(input.dateTo, 'DataDo');
  assertValidTaxOfficeCode(input.taxOfficeCode);

  if (input.rows.length === 0) {
    throw new Error(
      'JPK_EWP(4) requires at least one EWPWiersz entry (XSD EWPCtrl/LiczbaWierszy is TNaturalnyJPK >= 1).',
    );
  }

  let totalRevenueGrosze = 0;
  const rowXmlLines: string[] = [];

  input.rows.forEach((row, idx) => {
    assertValidIsoDate(row.entryDate, `EWPWiersz[${idx + 1}].K_2`);
    assertValidIsoDate(row.revenueDate, `EWPWiersz[${idx + 1}].K_3`);
    if (!ALLOWED_JPK_EWP4_RATES.has(row.ratePercent)) {
      throw new Error(
        `Unsupported JPK_EWP(4) TStawkaPodatku rate "${row.ratePercent}" in row ${idx + 1}. Official MF XSD enum permits only: ${[...ALLOWED_JPK_EWP4_RATES].join(', ')}.`,
      );
    }
    if (row.ksefNumber) {
      const check = validateKsefNumber(row.ksefNumber);
      if (!check.valid) {
        throw new Error(`Invalid K_5 NrKSeF "${row.ksefNumber}": ${check.reason}`);
      }
    }

    totalRevenueGrosze += row.revenueGrosze;

    rowXmlLines.push('  <EWPWiersz>');
    rowXmlLines.push(`    <K_1>${idx + 1}</K_1>`);
    rowXmlLines.push(`    <K_2>${escapeXml(row.entryDate)}</K_2>`);
    rowXmlLines.push(`    <K_3>${escapeXml(row.revenueDate)}</K_3>`);
    rowXmlLines.push(`    <K_4>${escapeXml(row.documentNumber)}</K_4>`);
    if (row.ksefNumber) {
      rowXmlLines.push(`    <K_5>${escapeXml(row.ksefNumber)}</K_5>`);
    }
    if (row.counterpartyCountryCode) {
      rowXmlLines.push(`    <K_6>${escapeXml(row.counterpartyCountryCode)}</K_6>`);
    }
    if (row.counterpartyTin) {
      rowXmlLines.push(`    <K_7>${escapeXml(row.counterpartyTin)}</K_7>`);
    }
    rowXmlLines.push(`    <K_8>${formatGroszeDecimal(row.revenueGrosze)}</K_8>`);
    rowXmlLines.push(`    <K_9>${escapeXml(row.ratePercent)}</K_9>`);
    if (row.remarks) {
      rowXmlLines.push(`    <K_10>${escapeXml(row.remarks)}</K_10>`);
    }
    rowXmlLines.push('  </EWPWiersz>');
  });

  const extraPodmiot = input.cashBasisPit ? ['    <Kasowy_PIT>1</Kasowy_PIT>'] : [];

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2024/10/30/10301/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/">',
    '  <Naglowek>',
    '    <KodFormularza kodSystemowy="JPK_EWP (4)" wersjaSchemy="1-0">JPK_EWP</KodFormularza>',
    '    <WariantFormularza>4</WariantFormularza>',
    `    <CelZlozenia>${input.purpose}</CelZlozenia>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <DataOd>${escapeXml(input.dateFrom)}</DataOd>`,
    `    <DataDo>${escapeXml(input.dateTo)}</DataDo>`,
    `    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`,
    '  </Naglowek>',
    ...renderJpkPitPodmiot1Xml(input.subject, extraPodmiot),
    ...rowXmlLines,
    '  <EWPCtrl>',
    `    <LiczbaWierszy>${input.rows.length}</LiczbaWierszy>`,
    `    <SumaPrzychodow>${formatGroszeDecimal(totalRevenueGrosze)}</SumaPrzychodow>`,
    '  </EWPCtrl>',
    '</JPK>',
  ];

  return `${lines.join('\n')}\n`;
}

// ============================================================================
// JPK_ST(1) — v1-2 (http://jpk.mf.gov.pl/wzor/2024/11/26/11262/)
// ============================================================================

export type JpkAcquisitionModeCode = 'S' | 'D' | 'N' | 'W' | 'F' | 'I';
export type JpkDepreciationMethodCode = 'D' | 'L' | 'J' | 'I' | 'X';
export type JpkStDisposalReasonCode = 'S' | 'X' | 'K' | 'D' | 'N' | 'I';
export type JpkStKrDisposalReasonCode = 'A' | JpkStDisposalReasonCode;

export interface JpkStDisposalInput {
  disposalDate: string; // F_12 / G_18
  reasonCode: JpkStDisposalReasonCode; // F_13 / G_19
  disposalDocumentNumber: string; // F_14 / G_20
  ksefNumbers?: ReadonlyArray<string>; // KSeF/F_15 or KSeF/G_21
}

export interface JpkStPkpirAssetRowInput {
  assetKind: 'tangible' | 'intangible'; // G_2 vs G_3
  acquisitionDate: string;
  acceptanceDate: string; // G_4
  acceptanceDocumentNumber?: string; // G_5
  acquisitionMode: JpkAcquisitionModeCode; // G_6
  assetName: string; // G_7
  kstSymbol?: string; // G_8
  depreciationMethod: JpkDepreciationMethodCode; // G_9
  annualRatePercent: number; // G_10
  initialValueGrosze: number; // G_12
  annualTaxDepreciationGrosze: number; // G_14
  cumulativeTaxDepreciationGrosze: number; // G_15
  disposal?: JpkStDisposalInput; // G_18..G_21
  /** G_22: Reklasyfikacja KŚT w trakcie roku (1 - TAK; 2 - NIE, domyślnie 2) */
  kstReclassifiedInYear?: 1 | 2;
}

export interface JpkStEwpAssetRowInput {
  assetKind: 'tangible' | 'intangible'; // F_2 vs F_3
  acquisitionDate: string;
  acceptanceDate: string; // F_4
  acceptanceDocumentNumber?: string; // F_5
  acquisitionMode: JpkAcquisitionModeCode; // F_6
  assetName: string; // F_7
  kstSymbol?: string; // F_8
  annualRatePercent: number; // F_9
  initialValueGrosze: number; // F_10
  disposal?: JpkStDisposalInput; // F_12..F_15
  /** F_16: Reklasyfikacja KŚT w trakcie roku (1 - TAK; 2 - NIE, domyślnie 2) */
  kstReclassifiedInYear?: 1 | 2;
}

export type GenerateJpkSt1Input = {
  purpose: 0 | 1 | 2;
  generatedAtIso: string;
  dateFrom: string;
  dateTo: string;
  taxOfficeCode: string;
  subject: JpkTaxpayerSubject;
} & (
  | {
      registerBranch: 'PKPIR';
      rows: ReadonlyArray<JpkStPkpirAssetRowInput>;
    }
  | {
      registerBranch: 'EWP';
      rows: ReadonlyArray<JpkStEwpAssetRowInput>;
    }
);

export function generateJpkSt1Xml(input: GenerateJpkSt1Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidIsoDate(input.dateFrom, 'DataOd');
  assertValidIsoDate(input.dateTo, 'DataDo');
  assertValidTaxOfficeCode(input.taxOfficeCode);

  const znacznik = input.registerBranch === 'EWP' ? '1' : '2';
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2024/11/26/11262/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/">',
    '  <Naglowek>',
    '    <KodFormularza kodSystemowy="JPK_ST (1)" wersjaSchemy="1-2">JPK_ST</KodFormularza>',
    '    <WariantFormularza>1</WariantFormularza>',
    `    <CelZlozenia>${input.purpose}</CelZlozenia>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <DataOd>${escapeXml(input.dateFrom)}</DataOd>`,
    `    <DataDo>${escapeXml(input.dateTo)}</DataDo>`,
    `    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`,
    '  </Naglowek>',
    ...renderJpkPitPodmiot1Xml(input.subject, [`    <ZnacznikST>${znacznik}</ZnacznikST>`]),
  ];

  if (input.registerBranch === 'EWP') {
    lines.push('  <EWP>');
    input.rows.forEach((row, idx) => {
      assertValidIsoDate(row.acquisitionDate, `EWP.Wiersz[${idx + 1}].acquisitionDate`);
      assertValidIsoDate(row.acceptanceDate, `EWP.Wiersz[${idx + 1}].F_4`);
      lines.push('    <Wiersz>');
      lines.push(`      <F_1>${idx + 1}</F_1>`);
      const dateTag = row.assetKind === 'tangible' ? 'F_2' : 'F_3';
      lines.push(`      <${dateTag}>${escapeXml(row.acquisitionDate)}</${dateTag}>`);
      lines.push(`      <F_4>${escapeXml(row.acceptanceDate)}</F_4>`);
      if (row.acceptanceDocumentNumber) {
        lines.push(`      <F_5>${escapeXml(row.acceptanceDocumentNumber)}</F_5>`);
      }
      lines.push(`      <F_6>${row.acquisitionMode}</F_6>`);
      lines.push(`      <F_7>${escapeXml(row.assetName)}</F_7>`);
      if (row.kstSymbol) {
        lines.push(`      <F_8>${escapeXml(row.kstSymbol)}</F_8>`);
      }
      lines.push(`      <F_9>${row.annualRatePercent.toFixed(2)}</F_9>`);
      lines.push(`      <F_10>${formatGroszeDecimal(row.initialValueGrosze)}</F_10>`);
      if (row.disposal) {
        assertValidIsoDate(row.disposal.disposalDate, `EWP.Wiersz[${idx + 1}].F_12`);
        lines.push(`      <F_12>${escapeXml(row.disposal.disposalDate)}</F_12>`);
        lines.push(`      <F_13>${row.disposal.reasonCode}</F_13>`);
        lines.push(`      <F_14>${escapeXml(row.disposal.disposalDocumentNumber)}</F_14>`);
        if (row.disposal.ksefNumbers && row.disposal.ksefNumbers.length > 0) {
          lines.push('      <KSeF>');
          for (const ksefNo of row.disposal.ksefNumbers) {
            const check = validateKsefNumber(ksefNo);
            if (!check.valid) {
              throw new Error(`Invalid F_15 NrKSeF "${ksefNo}": ${check.reason}`);
            }
            lines.push(`        <F_15>${escapeXml(ksefNo)}</F_15>`);
          }
          lines.push('      </KSeF>');
        }
      }
      lines.push(`      <F_16>${row.kstReclassifiedInYear ?? 2}</F_16>`);
      lines.push('    </Wiersz>');
    });
    lines.push('  </EWP>');
  } else {
    lines.push('  <PKPIR>');
    input.rows.forEach((row, idx) => {
      assertValidIsoDate(row.acquisitionDate, `PKPIR.Wiersz[${idx + 1}].acquisitionDate`);
      assertValidIsoDate(row.acceptanceDate, `PKPIR.Wiersz[${idx + 1}].G_4`);
      lines.push('    <Wiersz>');
      lines.push(`      <G_1>${idx + 1}</G_1>`);
      const dateTag = row.assetKind === 'tangible' ? 'G_2' : 'G_3';
      lines.push(`      <${dateTag}>${escapeXml(row.acquisitionDate)}</${dateTag}>`);
      lines.push(`      <G_4>${escapeXml(row.acceptanceDate)}</G_4>`);
      if (row.acceptanceDocumentNumber) {
        lines.push(`      <G_5>${escapeXml(row.acceptanceDocumentNumber)}</G_5>`);
      }
      lines.push(`      <G_6>${row.acquisitionMode}</G_6>`);
      lines.push(`      <G_7>${escapeXml(row.assetName)}</G_7>`);
      if (row.kstSymbol) {
        lines.push(`      <G_8>${escapeXml(row.kstSymbol)}</G_8>`);
      }
      lines.push(`      <G_9>${row.depreciationMethod}</G_9>`);
      lines.push(`      <G_10>${row.annualRatePercent.toFixed(2)}</G_10>`);
      lines.push(`      <G_12>${formatGroszeDecimal(row.initialValueGrosze)}</G_12>`);
      lines.push(`      <G_14>${formatGroszeDecimal(row.annualTaxDepreciationGrosze)}</G_14>`);
      lines.push(`      <G_15>${formatGroszeDecimal(row.cumulativeTaxDepreciationGrosze)}</G_15>`);
      if (row.disposal) {
        assertValidIsoDate(row.disposal.disposalDate, `PKPIR.Wiersz[${idx + 1}].G_18`);
        lines.push(`      <G_18>${escapeXml(row.disposal.disposalDate)}</G_18>`);
        lines.push(`      <G_19>${row.disposal.reasonCode}</G_19>`);
        lines.push(`      <G_20>${escapeXml(row.disposal.disposalDocumentNumber)}</G_20>`);
        if (row.disposal.ksefNumbers && row.disposal.ksefNumbers.length > 0) {
          lines.push('      <KSeF>');
          for (const ksefNo of row.disposal.ksefNumbers) {
            const check = validateKsefNumber(ksefNo);
            if (!check.valid) {
              throw new Error(`Invalid G_21 NrKSeF "${ksefNo}": ${check.reason}`);
            }
            lines.push(`        <G_21>${escapeXml(ksefNo)}</G_21>`);
          }
          lines.push('      </KSeF>');
        }
      }
      lines.push(`      <G_22>${row.kstReclassifiedInYear ?? 2}</G_22>`);
      lines.push('    </Wiersz>');
    });
    lines.push('  </PKPIR>');
  }

  lines.push('</JPK>');
  return `${lines.join('\n')}\n`;
}

// ============================================================================
// JPK_KR_PD(1) — v1-1 (http://jpk.mf.gov.pl/wzor/2024/09/04/09041/)
// ============================================================================

export interface JpkKrPdCounterpartyInput {
  code: string; // T_1
  countryCode?: string; // T_2
  tin?: string; // T_3
}

export interface JpkKrPdZois7AccountInput {
  accountId: string; // S_1: Identyfikator konta ostatecznego zapisu
  accountName: string; // S_2: Nazwa konta
  parentAccountId: string; // S_3: Identyfikator konta nadrzędnego
  openingDebitGrosze: number; // S_4
  openingCreditGrosze: number; // S_5
  turnoverPeriodDebitGrosze: number; // S_6
  turnoverPeriodCreditGrosze: number; // S_7
  turnoverCumulativeDebitGrosze: number; // S_8
  turnoverCumulativeCreditGrosze: number; // S_9
  closingDebitGrosze: number; // S_10
  closingCreditGrosze: number; // S_11
  balanceSheetTagS12_1: string; // S_12_1 (TMapKontaPOZ, e.g. BAAI1_W)
  secondaryTagS12_2?: string; // S_12_2
  taxTagS12_3?: string; // S_12_3 (TMapKontaPD, e.g. PD1)
}

export interface JpkKrPdPostingLineInput {
  description: string; // Z_2
  accountId: string; // Z_3
  side: 'Wn' | 'Ma';
  amountGrosze: number; // Z_4 or Z_7
}

export interface JpkKrPdJournalEntryInput {
  journalName: string; // D_2
  counterpartyCode?: string; // D_3
  documentNumber: string; // D_4
  documentKind: string; // D_5
  operationDate: string; // D_6
  documentDate: string; // D_7
  postingDate: string; // D_8
  operatorName: string; // D_9
  description: string; // D_10
  journalAmountGrosze: number; // D_11
  ksefNumber?: string; // D_12
  postings: ReadonlyArray<JpkKrPdPostingLineInput>;
}

export interface JpkKrPdRpdSummaryInput {
  /** K_1: Przychody zwolnione z opodatkowania (trwałe różnice rachunkowo-podatkowe) */
  k1ExemptRevenuesPermanentGrosze?: number;
  /** K_2: Przychody niepodlegające opodatkowaniu w roku bieżącym */
  k2NonTaxableCurrentYearRevenuesGrosze?: number;
  /** K_3: Przychody podlegające opodatkowaniu w roku bieżącym, ujęte w księgach rachunkowych lat ubiegłych */
  k3TaxableCurrentYearPriorLedgerRevenuesGrosze?: number;
  /** K_4: Koszty niestanowiące kosztów uzyskania przychodów (trwałe różnice rachunkowo-podatkowe) */
  k4NonDeductibleCostsPermanentGrosze?: number;
  /** K_5: Koszty nieuznawane za koszty uzyskania przychodów w bieżącym roku */
  k5NonDeductibleCurrentYearCostsGrosze?: number;
  /** K_6: Koszty uznawane za koszty uzyskania przychodów w roku bieżącym, ujęte w księgach lat ubiegłych */
  k6DeductibleCurrentYearPriorLedgerCostsGrosze?: number;
  /** K_7: Przychody podlegające opodatkowaniu nie ujmowane w księgach rachunkowych */
  k7OffLedgerTaxableRevenuesGrosze?: number;
  /** K_8: Koszty uznawane za koszty uzyskania przychodów nie ujmowane w księgach rachunkowych */
  k8OffLedgerDeductibleCostsGrosze?: number;
}

export interface GenerateJpkKrPd1Input {
  purpose: 1 | 2;
  generatedAtIso: string;
  dateFrom: string;
  dateTo: string;
  financialYearFrom: string;
  financialYearTo: string;
  taxYearFrom?: string;
  taxYearTo?: string;
  defaultCurrency?: string;
  taxOfficeCode: string;
  companyNip: string;
  companyFullName: string;
  companyRegon?: string;
  address: JpkPolishAddress;
  counterparties?: ReadonlyArray<JpkKrPdCounterpartyInput>;
  zois7Accounts: ReadonlyArray<JpkKrPdZois7AccountInput>;
  journalEntries: ReadonlyArray<JpkKrPdJournalEntryInput>;
  rpd?: JpkKrPdRpdSummaryInput;
}

function renderCorporatePodmiot1Xml(params: {
  nip: string;
  fullName: string;
  regon?: string | undefined;
  address: JpkPolishAddress;
}): string[] {
  assertValidNip10(params.nip, 'IdentyfikatorPodmiotu.NIP');
  const lines: string[] = [
    '  <Podmiot1>',
    '    <IdentyfikatorPodmiotu>',
    `      <etd:NIP>${escapeXml(params.nip)}</etd:NIP>`,
    `      <etd:PelnaNazwa>${escapeXml(params.fullName)}</etd:PelnaNazwa>`,
  ];
  if (params.regon) {
    lines.push(`      <etd:REGON>${escapeXml(params.regon)}</etd:REGON>`);
  }
  lines.push('    </IdentyfikatorPodmiotu>');
  lines.push('    <Adres>');
  lines.push('      <AdresPol>');
  lines.push('        <etd:KodKraju>PL</etd:KodKraju>');
  lines.push(`        <etd:Wojewodztwo>${escapeXml(params.address.voivodeship)}</etd:Wojewodztwo>`);
  lines.push(`        <etd:Powiat>${escapeXml(params.address.county)}</etd:Powiat>`);
  lines.push(`        <etd:Gmina>${escapeXml(params.address.municipality)}</etd:Gmina>`);
  if (params.address.street) {
    lines.push(`        <etd:Ulica>${escapeXml(params.address.street)}</etd:Ulica>`);
  }
  lines.push(`        <etd:NrDomu>${escapeXml(params.address.buildingNumber)}</etd:NrDomu>`);
  if (params.address.apartmentNumber) {
    lines.push(`        <etd:NrLokalu>${escapeXml(params.address.apartmentNumber)}</etd:NrLokalu>`);
  }
  lines.push(`        <etd:Miejscowosc>${escapeXml(params.address.city)}</etd:Miejscowosc>`);
  lines.push(`        <etd:KodPocztowy>${escapeXml(params.address.postalCode)}</etd:KodPocztowy>`);
  lines.push('      </AdresPol>');
  lines.push('    </Adres>');
  lines.push('  </Podmiot1>');
  return lines;
}

export function generateJpkKrPd1Xml(input: GenerateJpkKrPd1Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidIsoDate(input.dateFrom, 'DataOd');
  assertValidIsoDate(input.dateTo, 'DataDo');
  assertValidIsoDate(input.financialYearFrom, 'RokDataOd');
  assertValidIsoDate(input.financialYearTo, 'RokDataDo');
  assertValidTaxOfficeCode(input.taxOfficeCode);

  if (input.zois7Accounts.length === 0) {
    throw new Error('JPK_KR_PD(1) requires at least one ZOiS7 account entry.');
  }
  if (input.journalEntries.length === 0) {
    throw new Error('JPK_KR_PD(1) requires at least one Dziennik journal entry.');
  }

  let totalJournalAmountGrosze = 0;
  let totalPostingCount = 0;
  let totalDebitGrosze = 0;
  let totalCreditGrosze = 0;

  const journalLines: string[] = [];
  input.journalEntries.forEach((entry, entryIdx) => {
    assertValidIsoDate(entry.operationDate, `Dziennik[${entryIdx + 1}].D_6`);
    assertValidIsoDate(entry.documentDate, `Dziennik[${entryIdx + 1}].D_7`);
    assertValidIsoDate(entry.postingDate, `Dziennik[${entryIdx + 1}].D_8`);
    if (entry.postings.length === 0) {
      throw new Error(`Dziennik[${entryIdx + 1}] must contain at least one KontoZapis line.`);
    }
    if (entry.ksefNumber) {
      const check = validateKsefNumber(entry.ksefNumber);
      if (!check.valid) {
        throw new Error(`Invalid D_12 NrKSeF "${entry.ksefNumber}": ${check.reason}`);
      }
    }

    let entryDebit = 0;
    let entryCredit = 0;
    entry.postings.forEach((p) => {
      if (p.side === 'Wn') {
        entryDebit += p.amountGrosze;
      } else {
        entryCredit += p.amountGrosze;
      }
    });
    if (entryDebit !== entryCredit) {
      throw new Error(
        `Unbalanced double-entry Dziennik[${entryIdx + 1}] ("${entry.documentNumber}"): Wn ${entryDebit} grosze !== Ma ${entryCredit} grosze.`,
      );
    }

    totalJournalAmountGrosze += entry.journalAmountGrosze;

    journalLines.push('  <Dziennik>');
    journalLines.push(`    <D_1>${entryIdx + 1}</D_1>`);
    journalLines.push(`    <D_2>${escapeXml(entry.journalName)}</D_2>`);
    if (entry.counterpartyCode) {
      journalLines.push(`    <D_3>${escapeXml(entry.counterpartyCode)}</D_3>`);
    }
    journalLines.push(`    <D_4>${escapeXml(entry.documentNumber)}</D_4>`);
    journalLines.push(`    <D_5>${escapeXml(entry.documentKind)}</D_5>`);
    journalLines.push(`    <D_6>${escapeXml(entry.operationDate)}</D_6>`);
    journalLines.push(`    <D_7>${escapeXml(entry.documentDate)}</D_7>`);
    journalLines.push(`    <D_8>${escapeXml(entry.postingDate)}</D_8>`);
    journalLines.push(`    <D_9>${escapeXml(entry.operatorName)}</D_9>`);
    journalLines.push(`    <D_10>${escapeXml(entry.description)}</D_10>`);
    journalLines.push(`    <D_11>${formatGroszeDecimal(entry.journalAmountGrosze)}</D_11>`);
    if (entry.ksefNumber) {
      journalLines.push(`    <D_12>${escapeXml(entry.ksefNumber)}</D_12>`);
    }

    entry.postings.forEach((posting, postIdx) => {
      totalPostingCount += 1;
      journalLines.push('    <KontoZapis>');
      journalLines.push(`      <Z_1>${postIdx + 1}</Z_1>`);
      journalLines.push(`      <Z_2>${escapeXml(posting.description)}</Z_2>`);
      journalLines.push(`      <Z_3>${escapeXml(posting.accountId)}</Z_3>`);
      if (posting.side === 'Wn') {
        totalDebitGrosze += posting.amountGrosze;
        journalLines.push(`      <Z_4>${formatGroszeDecimal(posting.amountGrosze)}</Z_4>`);
      } else {
        totalCreditGrosze += posting.amountGrosze;
        journalLines.push(`      <Z_7>${formatGroszeDecimal(posting.amountGrosze)}</Z_7>`);
      }
      journalLines.push('    </KontoZapis>');
    });

    journalLines.push('  </Dziennik>');
  });

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2024/09/04/09041/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/">',
    '  <Naglowek>',
    '    <KodFormularza kodSystemowy="JPK_KR_PD (1)" wersjaSchemy="1-1">JPK_KR_PD</KodFormularza>',
    '    <WariantFormularza>1</WariantFormularza>',
    `    <CelZlozenia>${input.purpose}</CelZlozenia>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <DataOd>${escapeXml(input.dateFrom)}</DataOd>`,
    `    <DataDo>${escapeXml(input.dateTo)}</DataDo>`,
    `    <RokDataOd>${escapeXml(input.financialYearFrom)}</RokDataOd>`,
    `    <RokDataDo>${escapeXml(input.financialYearTo)}</RokDataDo>`,
  ];
  if (input.taxYearFrom && input.taxYearTo) {
    assertValidIsoDate(input.taxYearFrom, 'RokPdDataOd');
    assertValidIsoDate(input.taxYearTo, 'RokPdDataDo');
    lines.push(`    <RokPdDataOd>${escapeXml(input.taxYearFrom)}</RokPdDataOd>`);
    lines.push(`    <RokPdDataDo>${escapeXml(input.taxYearTo)}</RokPdDataDo>`);
  }
  lines.push(
    `    <DomyslnyKodWaluty>${escapeXml(input.defaultCurrency ?? 'PLN')}</DomyslnyKodWaluty>`,
  );
  lines.push(`    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`);
  lines.push('  </Naglowek>');

  lines.push(
    ...renderCorporatePodmiot1Xml({
      nip: input.companyNip,
      fullName: input.companyFullName,
      regon: input.companyRegon,
      address: input.address,
    }),
  );

  for (const cp of input.counterparties ?? []) {
    lines.push('  <Kontrahent>');
    lines.push(`    <T_1>${escapeXml(cp.code)}</T_1>`);
    if (cp.countryCode) {
      lines.push(`    <T_2>${escapeXml(cp.countryCode)}</T_2>`);
    }
    if (cp.tin) {
      lines.push(`    <T_3>${escapeXml(cp.tin)}</T_3>`);
    }
    lines.push('  </Kontrahent>');
  }

  lines.push('  <ZOiS>');
  for (const acc of input.zois7Accounts) {
    lines.push('    <ZOiS7>');
    lines.push(`      <S_1>${escapeXml(acc.accountId)}</S_1>`);
    lines.push(`      <S_2>${escapeXml(acc.accountName)}</S_2>`);
    lines.push(`      <S_3>${escapeXml(acc.parentAccountId)}</S_3>`);
    lines.push(`      <S_4>${formatGroszeDecimal(acc.openingDebitGrosze)}</S_4>`);
    lines.push(`      <S_5>${formatGroszeDecimal(acc.openingCreditGrosze)}</S_5>`);
    lines.push(`      <S_6>${formatGroszeDecimal(acc.turnoverPeriodDebitGrosze)}</S_6>`);
    lines.push(`      <S_7>${formatGroszeDecimal(acc.turnoverPeriodCreditGrosze)}</S_7>`);
    lines.push(`      <S_8>${formatGroszeDecimal(acc.turnoverCumulativeDebitGrosze)}</S_8>`);
    lines.push(`      <S_9>${formatGroszeDecimal(acc.turnoverCumulativeCreditGrosze)}</S_9>`);
    lines.push(`      <S_10>${formatGroszeDecimal(acc.closingDebitGrosze)}</S_10>`);
    lines.push(`      <S_11>${formatGroszeDecimal(acc.closingCreditGrosze)}</S_11>`);
    lines.push(`      <S_12_1>${escapeXml(acc.balanceSheetTagS12_1)}</S_12_1>`);
    if (acc.secondaryTagS12_2) {
      lines.push(`      <S_12_2>${escapeXml(acc.secondaryTagS12_2)}</S_12_2>`);
    }
    if (acc.taxTagS12_3) {
      lines.push(`      <S_12_3>${escapeXml(acc.taxTagS12_3)}</S_12_3>`);
    }
    lines.push('    </ZOiS7>');
  }
  lines.push('  </ZOiS>');

  lines.push(...journalLines);

  lines.push('  <Ctrl>');
  lines.push(`    <C_1>${input.journalEntries.length}</C_1>`);
  lines.push(`    <C_2>${formatGroszeDecimal(totalJournalAmountGrosze)}</C_2>`);
  lines.push(`    <C_3>${totalPostingCount}</C_3>`);
  lines.push(`    <C_4>${formatGroszeDecimal(totalDebitGrosze)}</C_4>`);
  lines.push(`    <C_5>${formatGroszeDecimal(totalCreditGrosze)}</C_5>`);
  lines.push('  </Ctrl>');

  const rpd = input.rpd ?? {};
  lines.push('  <RPD>');
  lines.push(`    <K_1>${formatGroszeDecimal(rpd.k1ExemptRevenuesPermanentGrosze ?? 0)}</K_1>`);
  lines.push(
    `    <K_2>${formatGroszeDecimal(rpd.k2NonTaxableCurrentYearRevenuesGrosze ?? 0)}</K_2>`,
  );
  lines.push(
    `    <K_3>${formatGroszeDecimal(rpd.k3TaxableCurrentYearPriorLedgerRevenuesGrosze ?? 0)}</K_3>`,
  );
  lines.push(`    <K_4>${formatGroszeDecimal(rpd.k4NonDeductibleCostsPermanentGrosze ?? 0)}</K_4>`);
  lines.push(
    `    <K_5>${formatGroszeDecimal(rpd.k5NonDeductibleCurrentYearCostsGrosze ?? 0)}</K_5>`,
  );
  lines.push(
    `    <K_6>${formatGroszeDecimal(rpd.k6DeductibleCurrentYearPriorLedgerCostsGrosze ?? 0)}</K_6>`,
  );
  lines.push(`    <K_7>${formatGroszeDecimal(rpd.k7OffLedgerTaxableRevenuesGrosze ?? 0)}</K_7>`);
  lines.push(`    <K_8>${formatGroszeDecimal(rpd.k8OffLedgerDeductibleCostsGrosze ?? 0)}</K_8>`);
  lines.push('  </RPD>');

  lines.push('</JPK>');
  return `${lines.join('\n')}\n`;
}

// ============================================================================
// JPK_ST_KR(1) — v1-0 (http://jpk.mf.gov.pl/wzor/2024/04/24/04242/)
// ============================================================================

export type JpkDepreciationFrequencyCode = 'M' | 'K' | 'R' | 'J' | 'S' | 'I' | 'X';

export interface JpkStKrDisposalInput {
  disposalDate: string; // E_28
  reasonCode: JpkStKrDisposalReasonCode; // E_29
  disposalDocumentNumber: string; // E_30
  ksefNumbers?: ReadonlyArray<string>; // KSeF/E_31
}

export interface JpkStKrAssetRowInput {
  inventoryNumber: string; // E_1
  assetKind: 'tangible' | 'intangible'; // E_2 vs E_3
  acquisitionDate: string;
  acceptanceDate: string; // E_4
  acceptanceDocumentNumber: string; // E_5
  acquisitionMode: JpkAcquisitionModeCode; // E_6
  assetName: string; // E_7
  kstSymbol?: string; // E_8
  /** E_9_1: Metoda amortyzacji podatkowa */
  depreciationMethod: JpkDepreciationMethodCode;
  /** E_10A: Stawka amortyzacyjna podatkowa podstawowa (procentowa) */
  taxRatePercent: number;
  /** E_10B: Stawka amortyzacyjna podatkowa podstawowa (kwotowa) */
  taxAnnualAmountGrosze: number;
  /** E_12: Wartość początkowa podatkowa */
  taxInitialValueGrosze: number;
  /** E_17: Częstotliwość odpisu */
  depreciationFrequency: JpkDepreciationFrequencyCode;
  /** E_19: Suma odpisów amortyzacyjnych podatkowych dla danego roku */
  taxPeriodDepreciationGrosze: number;
  /** E_20: Suma odpisów amortyzacyjnych podatkowych narastająco */
  taxCumulativeDepreciationGrosze: number;
  /** E_21: Wartość początkowa rachunkowa */
  accountingInitialValueGrosze: number;
  /** E_25A: Stawka amortyzacyjna rachunkowa (procentowa) */
  accountingRatePercent: number;
  /** E_25B: Stawka amortyzacyjna rachunkowa (kwotowa) */
  accountingAnnualAmountGrosze: number;
  /** E_26: Suma odpisów amortyzacyjnych rachunkowych dla danego roku */
  accountingPeriodDepreciationGrosze: number;
  /** E_27: Suma odpisów amortyzacyjnych rachunkowych narastająco */
  accountingCumulativeDepreciationGrosze: number;
  /** E_28..E_31: Opcjonalne wykreślenie z ewidencji (w tym numery KSeF zbycia E_31) */
  disposal?: JpkStKrDisposalInput;
  /** E_32: Reklasyfikacja KŚT w trakcie roku (1 - TAK; 2 - NIE, domyślnie 2) */
  kstReclassifiedInYear?: 1 | 2;
}

export interface GenerateJpkStKr1Input {
  purpose: 1 | 2;
  generatedAtIso: string;
  financialYearFrom: string;
  financialYearTo: string;
  taxYearFrom?: string;
  taxYearTo?: string;
  defaultCurrency?: string;
  taxOfficeCode: string;
  companyNip: string;
  companyFullName: string;
  companyRegon?: string;
  address: JpkPolishAddress;
  assets: ReadonlyArray<JpkStKrAssetRowInput>;
}

export function generateJpkStKr1Xml(input: GenerateJpkStKr1Input): string {
  assertValidIsoDateTimeUtc(input.generatedAtIso, 'DataWytworzeniaJPK');
  assertValidIsoDate(input.financialYearFrom, 'RokDataOd');
  assertValidIsoDate(input.financialYearTo, 'RokDataDo');
  assertValidTaxOfficeCode(input.taxOfficeCode);

  if (input.assets.length === 0) {
    throw new Error('JPK_ST_KR(1) requires at least one ST_KR asset row.');
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<JPK xmlns="http://jpk.mf.gov.pl/wzor/2024/04/24/04242/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/">',
    '  <Naglowek>',
    '    <KodFormularza kodSystemowy="JPK_ST_KR (1)" wersjaSchemy="1-0">JPK_ST</KodFormularza>',
    '    <WariantFormularza>1</WariantFormularza>',
    `    <CelZlozenia>${input.purpose}</CelZlozenia>`,
    `    <DataWytworzeniaJPK>${escapeXml(input.generatedAtIso)}</DataWytworzeniaJPK>`,
    `    <RokDataOd>${escapeXml(input.financialYearFrom)}</RokDataOd>`,
    `    <RokDataDo>${escapeXml(input.financialYearTo)}</RokDataDo>`,
  ];
  if (input.taxYearFrom && input.taxYearTo) {
    assertValidIsoDate(input.taxYearFrom, 'RokPdDataOd');
    assertValidIsoDate(input.taxYearTo, 'RokPdDataDo');
    lines.push(`    <RokPdDataOd>${escapeXml(input.taxYearFrom)}</RokPdDataOd>`);
    lines.push(`    <RokPdDataDo>${escapeXml(input.taxYearTo)}</RokPdDataDo>`);
  }
  lines.push(
    `    <DomyslnyKodWaluty>${escapeXml(input.defaultCurrency ?? 'PLN')}</DomyslnyKodWaluty>`,
  );
  lines.push(`    <KodUrzedu>${escapeXml(input.taxOfficeCode)}</KodUrzedu>`);
  lines.push('  </Naglowek>');

  lines.push(
    ...renderCorporatePodmiot1Xml({
      nip: input.companyNip,
      fullName: input.companyFullName,
      regon: input.companyRegon,
      address: input.address,
    }),
  );

  input.assets.forEach((asset, idx) => {
    assertValidIsoDate(asset.acquisitionDate, `ST_KR[${idx + 1}].acquisitionDate`);
    assertValidIsoDate(asset.acceptanceDate, `ST_KR[${idx + 1}].E_4`);
    lines.push('  <ST_KR>');
    lines.push(`    <E_1>${escapeXml(asset.inventoryNumber)}</E_1>`);
    const dateTag = asset.assetKind === 'tangible' ? 'E_2' : 'E_3';
    lines.push(`    <${dateTag}>${escapeXml(asset.acquisitionDate)}</${dateTag}>`);
    lines.push(`    <E_4>${escapeXml(asset.acceptanceDate)}</E_4>`);
    lines.push(`    <E_5>${escapeXml(asset.acceptanceDocumentNumber)}</E_5>`);
    lines.push(`    <E_6>${asset.acquisitionMode}</E_6>`);
    lines.push(`    <E_7>${escapeXml(asset.assetName)}</E_7>`);
    if (asset.kstSymbol) {
      lines.push(`    <E_8>${escapeXml(asset.kstSymbol)}</E_8>`);
    }
    lines.push(`    <E_9_1>${asset.depreciationMethod}</E_9_1>`);
    lines.push(`    <E_10A>${asset.taxRatePercent.toFixed(2)}</E_10A>`);
    lines.push(`    <E_10B>${formatGroszeDecimal(asset.taxAnnualAmountGrosze)}</E_10B>`);
    lines.push(`    <E_12>${formatGroszeDecimal(asset.taxInitialValueGrosze)}</E_12>`);
    lines.push(`    <E_17>${asset.depreciationFrequency}</E_17>`);
    lines.push(`    <E_19>${formatGroszeDecimal(asset.taxPeriodDepreciationGrosze)}</E_19>`);
    lines.push(`    <E_20>${formatGroszeDecimal(asset.taxCumulativeDepreciationGrosze)}</E_20>`);
    lines.push(`    <E_21>${formatGroszeDecimal(asset.accountingInitialValueGrosze)}</E_21>`);
    lines.push(`    <E_25A>${asset.accountingRatePercent.toFixed(2)}</E_25A>`);
    lines.push(`    <E_25B>${formatGroszeDecimal(asset.accountingAnnualAmountGrosze)}</E_25B>`);
    lines.push(`    <E_26>${formatGroszeDecimal(asset.accountingPeriodDepreciationGrosze)}</E_26>`);
    lines.push(
      `    <E_27>${formatGroszeDecimal(asset.accountingCumulativeDepreciationGrosze)}</E_27>`,
    );
    if (asset.disposal) {
      assertValidIsoDate(asset.disposal.disposalDate, `ST_KR[${idx + 1}].E_28`);
      lines.push(`    <E_28>${escapeXml(asset.disposal.disposalDate)}</E_28>`);
      lines.push(`    <E_29>${asset.disposal.reasonCode}</E_29>`);
      lines.push(`    <E_30>${escapeXml(asset.disposal.disposalDocumentNumber)}</E_30>`);
      if (asset.disposal.ksefNumbers && asset.disposal.ksefNumbers.length > 0) {
        lines.push('    <KSeF>');
        for (const ksefNo of asset.disposal.ksefNumbers) {
          const check = validateKsefNumber(ksefNo);
          if (!check.valid) {
            throw new Error(`Invalid E_31 NrKSeF "${ksefNo}": ${check.reason}`);
          }
          lines.push(`      <E_31>${escapeXml(ksefNo)}</E_31>`);
        }
        lines.push('    </KSeF>');
      }
    }
    lines.push(`    <E_32>${asset.kstReclassifiedInYear ?? 2}</E_32>`);
    lines.push('  </ST_KR>');
  });

  lines.push('</JPK>');
  return `${lines.join('\n')}\n`;
}
