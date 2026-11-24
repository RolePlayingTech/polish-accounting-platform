import { assertValidIsoCalendarDate } from '../legal-rules/index.js';
import {
  addGrosze,
  assertSafeGrosze,
  multiplyGroszeByBps,
  sumGrosze,
  validatePolishNip,
} from '../money.js';
import type { VatRateCode } from '../money.js';

export const KSEF_FA2_NAMESPACE = 'http://crd.gov.pl/wzor/2023/06/29/12648/' as const;
export const KSEF_FA3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/' as const;
export const KSEF_UPO_V4_3_NAMESPACE = 'http://upo.schematy.mf.gov.pl/KSeF/v4-3' as const;

export type KsefFaSchemaVersion = 'FA(2)' | 'FA(3)';
export type KsefInvoiceKindCode = 'VAT' | 'KOR' | 'ZAL' | 'ROZ' | 'UPR' | 'KOR_ZAL' | 'KOR_ROZ';

/**
 * Oblicza 2-znakową sumę kontrolną HEX algorytmem CRC-8 (wielomian 0x07, wartość początkowa 0x00)
 * zgodnie ze specyfikacją Ministerstwa Finansów KSeF 2.0 (`CIRFMF/ksef-docs/faktury/numer-ksef.md`).
 */
export function computeKsefNumberCrc8Hex(dataPrefix32Chars: string): string {
  const bytes = new TextEncoder().encode(dataPrefix32Chars);
  let crc = 0x00;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(2, '0');
}

export interface KsefNumberValidationResult {
  readonly valid: boolean;
  readonly ksefVersion?: '2.0_35char' | '1.0_compat_36char';
  readonly sellerNip?: string;
  readonly datePart?: string;
  readonly reason?: string;
}

const KSEF_V2_35_REGEX =
  /^([1-9](?:\d[1-9]|[1-9]\d)\d{7})-(20[2-9]\d|2[1-9]\d{2}|[3-9]\d{3})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-([0-9A-F]{12})-([0-9A-F]{2})$/;

const KSEF_V1_36_REGEX =
  /^([1-9](?:\d[1-9]|[1-9]\d)\d{7})-(20[2-9]\d|2[1-9]\d{2}|[3-9]\d{3})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-([0-9A-F]{6})-([0-9A-F]{6})-([0-9A-F]{2})$/;

/**
 * Waliduje 35-znakowy numer KSeF 2.0 (wraz z sumą kontrolną CRC-8 oraz sumą kontrolną NIP sprzedawcy)
 * lub opcjonalnie 36-znakowy format kompatybilności KSeF 1.0 wg XSD `TNumerKSeF`.
 */
export function validateKsefNumber(
  rawKsefNumber: string,
  options?: { readonly verifyCrc8?: boolean; readonly allowV1Compat36Char?: boolean },
): KsefNumberValidationResult {
  const trimmed = rawKsefNumber.trim();
  const v2Match = KSEF_V2_35_REGEX.exec(trimmed);
  if (v2Match) {
    const nip = v2Match[1]!;
    const year = v2Match[2]!;
    const month = v2Match[3]!;
    const day = v2Match[4]!;
    const crcProvided = v2Match[6]!;
    const isoDate = `${year}-${month}-${day}`;
    try {
      assertValidIsoCalendarDate(isoDate, 'ksefNumberDate');
    } catch {
      return { valid: false, reason: `Nieprawidłowa data kalendarzowa w numerze KSeF: ${isoDate}` };
    }
    const nipCheck = validatePolishNip(nip);
    if (!nipCheck.valid) {
      return { valid: false, reason: `Nieprawidłowy NIP sprzedawcy w numerze KSeF: ${nip}` };
    }
    if (options?.verifyCrc8 !== false) {
      const dataPart = trimmed.slice(0, 32);
      const expectedCrc = computeKsefNumberCrc8Hex(dataPart);
      if (crcProvided !== expectedCrc) {
        return {
          valid: false,
          reason: `Niezgodna suma kontrolna CRC-8 numeru KSeF: oczekiwano ${expectedCrc}, otrzymano ${crcProvided}`,
        };
      }
    }
    return {
      valid: true,
      ksefVersion: '2.0_35char',
      sellerNip: nip,
      datePart: isoDate,
    };
  }

  if (options?.allowV1Compat36Char !== false) {
    const v1Match = KSEF_V1_36_REGEX.exec(trimmed);
    if (v1Match) {
      const nip = v1Match[1]!;
      const isoDate = `${v1Match[2]!}-${v1Match[3]!}-${v1Match[4]!}`;
      try {
        assertValidIsoCalendarDate(isoDate, 'ksefNumberDate');
      } catch {
        return {
          valid: false,
          reason: `Nieprawidłowa data kalendarzowa w numerze KSeF: ${isoDate}`,
        };
      }
      const nipCheck = validatePolishNip(nip);
      if (!nipCheck.valid) {
        return { valid: false, reason: `Nieprawidłowy NIP sprzedawcy w numerze KSeF: ${nip}` };
      }
      return {
        valid: true,
        ksefVersion: '1.0_compat_36char',
        sellerNip: nip,
        datePart: isoDate,
      };
    }
  }

  return {
    valid: false,
    reason:
      'Numer KSeF nie spełnia wzorca XSD TNumerKSeF (wymagane 35 znaków RRRRMMDD + 12 HEX + 2 HEX CRC-8).',
  };
}

/**
 * Buduje deterministyczny, poprawny składniowo i względem CRC-8 numer KSeF 2.0
 * wyłącznie dla testów kontraktowych / mocka (NIGDY nie używany jako potwierdzenie produkcyjne!).
 */
export function buildSyntheticTestKsefNumber(
  sellerNip: string,
  acquisitionDateIso: string,
  technicalHex12: string,
): string {
  const nipCheck = validatePolishNip(sellerNip);
  if (!nipCheck.valid || !nipCheck.normalizedNip) {
    throw new Error(`Nieprawidłowy NIP sprzedawcy dla testowego numeru KSeF: "${sellerNip}"`);
  }
  const normalizedDateIso = /^\d{8}$/.test(acquisitionDateIso)
    ? `${acquisitionDateIso.slice(0, 4)}-${acquisitionDateIso.slice(4, 6)}-${acquisitionDateIso.slice(6, 8)}`
    : acquisitionDateIso;
  assertValidIsoCalendarDate(normalizedDateIso, 'acquisitionDateIso');
  const normalizedHex = technicalHex12.toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalizedHex)) {
    throw new Error(
      `Część techniczna testowego numeru KSeF musi składać się z 12 znaków HEX [0-9A-F], otrzymano "${technicalHex12}".`,
    );
  }
  const compactDate = normalizedDateIso.replace(/-/g, '');
  const prefix32 = `${nipCheck.normalizedNip}-${compactDate}-${normalizedHex}`;
  const crc = computeKsefNumberCrc8Hex(prefix32);
  return `${prefix32}-${crc}`;
}

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatGroszeForXsdDecimal(grosze: number): string {
  assertSafeGrosze(grosze, 'grosze');
  const sign = grosze < 0 ? '-' : '';
  const abs = Math.abs(grosze);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${String(whole)}.${frac}`;
}

export type KsefBuyerIdentifierInput =
  | { readonly kind: 'nip'; readonly nip: string }
  | { readonly kind: 'vat_ue'; readonly euCountryCode: string; readonly euVatNumber: string }
  | { readonly kind: 'foreign_id'; readonly countryCode?: string; readonly taxId: string }
  | { readonly kind: 'brak_id' };

export interface KsefFaAddressInput {
  readonly countryCode?: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
}

export interface KsefFaLineItemInput {
  readonly lineNumber?: number;
  readonly description: string;
  readonly unit?: string;
  readonly quantity?: string;
  readonly unitNetGrosze?: number;
  readonly netGrosze: number;
  readonly vatRate: VatRateCode;
  readonly vatRateXmlCode?: '0 KR' | '0 WDT' | '0 EX' | 'np I' | 'np II' | 'oo';
  readonly vatGrosze?: number;
  readonly annex15Item?: boolean;
  readonly gtuCode?:
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
  readonly procedureCode?:
    'WSTO_EE' | 'IED' | 'TT_D' | 'I_42' | 'I_63' | 'B_SPV' | 'B_SPV_DOSTAWA' | 'B_MPV_PROWIZJA';
  readonly beforeCorrectionState?: boolean;
}

export interface KsefCorrectedInvoiceReferenceInput {
  readonly originalIssueDate: string;
  readonly originalInvoiceNumber: string;
  readonly originalKsefNumber?: string;
}

export interface GenerateKsefFaXmlInput {
  readonly schemaVersion?: KsefFaSchemaVersion;
  readonly createdAtIsoUtc: string;
  readonly systemInfo?: string;
  readonly seller: {
    readonly nip: string;
    readonly name: string;
    readonly address: KsefFaAddressInput;
    readonly email?: string;
  };
  readonly buyer: {
    readonly identifier: KsefBuyerIdentifierInput;
    readonly name?: string;
    readonly address?: KsefFaAddressInput;
    readonly jstSubordinateUnit?: boolean;
    readonly vatGroupMember?: boolean;
  };
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly saleDate?: string;
  readonly dueDate?: string;
  readonly sellerBankAccountIban?: string;
  readonly paymentMethodCode?: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  readonly invoiceKind?: KsefInvoiceKindCode;
  readonly cashAccountingMethodP16?: boolean;
  readonly selfBillingP17?: boolean;
  readonly reverseChargeP18?: boolean;
  readonly splitPaymentMppP18A?: boolean;
  readonly vatExemptionLegalBasisP19A?: string;
  readonly relatedPartyTransactionTp?: boolean;
  readonly correction?: {
    readonly reason: string;
    readonly correctionType?: '1' | '2' | '3';
    readonly correctedInvoices: readonly KsefCorrectedInvoiceReferenceInput[];
  };
  readonly lines: readonly KsefFaLineItemInput[];
}

export interface GeneratedKsefFaXmlResult {
  readonly xml: string;
  readonly schemaVersion: KsefFaSchemaVersion;
  readonly targetNamespace: string;
  readonly totalNetGrosze: number;
  readonly totalVatGrosze: number;
  readonly totalGrossGrosze: number;
}

function vatRateToBpsDomain(rate: VatRateCode): number {
  switch (rate) {
    case '23':
      return 2300;
    case '8':
      return 800;
    case '5':
      return 500;
    case '0':
    case 'zw':
    case 'np':
      return 0;
  }
}

function assertStrictRawTenDigitNip(rawNip: string, fieldLabel: string): string {
  if (!/^[1-9](?:\d[1-9]|[1-9]\d)\d{7}$/.test(rawNip)) {
    throw new Error(
      `Pole ${fieldLabel} wymaga dokładnie 10 cyfr polskiego NIP zgodnego z XSD etd:TNrNIP (bez prefiksu PL, spacji i myślników); otrzymano "${rawNip}".`,
    );
  }
  const check = validatePolishNip(rawNip);
  if (!check.valid || !check.normalizedNip) {
    throw new Error(
      `Nieprawidłowa suma kontrolna NIP w polu ${fieldLabel} ("${rawNip}"): ${check.reason ?? 'błąd modulo 11'}.`,
    );
  }
  return check.normalizedNip;
}

/**
 * Deterministycznie generuje dokument XML faktury ustrukturyzowanej FA(3) lub FA(2)
 * w 100% zgodny z oficjalną schemą XSD Ministerstwa Finansów (`crd.gov.pl/wzor/2025/06/25/13775/` lub `.../12648/`).
 */
export function generateKsefFaXml(input: GenerateKsefFaXmlInput): GeneratedKsefFaXmlResult {
  const schemaVersion: KsefFaSchemaVersion = input.schemaVersion ?? 'FA(3)';
  const targetNamespace = schemaVersion === 'FA(3)' ? KSEF_FA3_NAMESPACE : KSEF_FA2_NAMESPACE;
  const variantNumber = schemaVersion === 'FA(3)' ? '3' : '2';

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.createdAtIsoUtc)) {
    throw new Error(
      `DataWytworzeniaFa musi być prawidłowym znacznikiem czasu UTC ISO-8601 (np. 2026-03-20T09:30:00Z), otrzymano "${input.createdAtIsoUtc}".`,
    );
  }
  assertValidIsoCalendarDate(input.issueDate, 'issueDate');
  if (input.saleDate !== undefined) {
    assertValidIsoCalendarDate(input.saleDate, 'saleDate');
  }
  if (input.dueDate !== undefined) {
    assertValidIsoCalendarDate(input.dueDate, 'dueDate');
  }
  if (input.invoiceNumber.trim().length === 0) {
    throw new Error('Numer faktury (<P_2>) nie może być pusty.');
  }
  if (input.lines.length === 0) {
    throw new Error('Faktura FA(2)/FA(3) musi zawierać co najmniej jeden wiersz <FaWiersz>.');
  }

  const sellerNip = assertStrictRawTenDigitNip(input.seller.nip, 'Podmiot1.NIP');
  const sellerCountry = (input.seller.address.countryCode ?? 'PL').toUpperCase();
  if (!/^[A-Z]{2}$/.test(sellerCountry)) {
    throw new Error(`Nieprawidłowy kod kraju sprzedawcy: "${sellerCountry}".`);
  }

  const invoiceKind: KsefInvoiceKindCode = input.invoiceKind ?? 'VAT';
  const isCorrection =
    invoiceKind === 'KOR' || invoiceKind === 'KOR_ZAL' || invoiceKind === 'KOR_ROZ';

  if (isCorrection && (!input.correction || input.correction.correctedInvoices.length === 0)) {
    throw new Error(
      `Faktura korygująca (${invoiceKind}) wymaga podania sekcji correction.correctedInvoices (<DaneFaKorygowanej>).`,
    );
  }

  // Walidacja nabywcy (<Podmiot2>) zgodnie z XSD (choice: NIP | KodUE+NrVatUE | KodKraju?+NrID | BrakID)
  let buyerIdXml = '';
  const buyerId = input.buyer.identifier;
  switch (buyerId.kind) {
    case 'nip': {
      const validBuyerNip = assertStrictRawTenDigitNip(buyerId.nip, 'Podmiot2.NIP');
      buyerIdXml = `<NIP>${validBuyerNip}</NIP>`;
      break;
    }
    case 'vat_ue': {
      const cc = buyerId.euCountryCode.trim().toUpperCase();
      const vatUe = buyerId.euVatNumber.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc) || cc === 'PL') {
        throw new Error(
          `Pole Podmiot2.KodUE wymaga 2-literowego kodu kraju UE innego niż PL (dla polskiego NIP użyj <NIP>), otrzymano "${cc}".`,
        );
      }
      if (!/^[0-9A-Z+*]{1,12}$/.test(vatUe)) {
        throw new Error(`Nieprawidłowy numer NrVatUE nabywcy unijnego: "${vatUe}".`);
      }
      buyerIdXml = `<KodUE>${escapeXmlText(cc)}</KodUE><NrVatUE>${escapeXmlText(vatUe)}</NrVatUE>`;
      break;
    }
    case 'foreign_id': {
      const taxId = buyerId.taxId.trim();
      if (!/^[a-zA-Z0-9]{1,50}$/.test(taxId)) {
        throw new Error(`Nieprawidłowy identyfikator zagraniczny <NrID>: "${taxId}".`);
      }
      const ccXml = buyerId.countryCode
        ? `<KodKraju>${escapeXmlText(buyerId.countryCode.trim().toUpperCase())}</KodKraju>`
        : '';
      buyerIdXml = `${ccXml}<NrID>${escapeXmlText(taxId)}</NrID>`;
      break;
    }
    case 'brak_id': {
      buyerIdXml = '<BrakID>1</BrakID>';
      break;
    }
  }

  // Obliczenie pozycji oraz podsumowań stawek P_13_* / P_14_*
  const computedLines = input.lines.map((line, idx) => {
    const lineNo = line.lineNumber ?? idx + 1;
    assertSafeGrosze(line.netGrosze, `lines[${String(idx)}].netGrosze`);
    if (!isCorrection && line.netGrosze < 0) {
      throw new Error(
        `Ujemna kwota netto w wierszu ${String(lineNo)} jest niedozwolona na fakturze podstawowej (${invoiceKind}).`,
      );
    }
    const bps = vatRateToBpsDomain(line.vatRate);
    const computedVat =
      line.vatGrosze !== undefined
        ? assertSafeGrosze(line.vatGrosze, `lines[${String(idx)}].vatGrosze`)
        : multiplyGroszeByBps(line.netGrosze, bps, 'half_up');

    const effectiveNetContribution =
      line.beforeCorrectionState === true ? -line.netGrosze : line.netGrosze;
    const effectiveVatContribution =
      line.beforeCorrectionState === true ? -computedVat : computedVat;

    let xmlRateCode: string;
    if (line.vatRate === '0') {
      if (schemaVersion === 'FA(3)') {
        xmlRateCode =
          line.vatRateXmlCode === '0 WDT' || line.vatRateXmlCode === '0 EX'
            ? line.vatRateXmlCode
            : '0 KR';
      } else {
        xmlRateCode = '0';
      }
    } else if (line.vatRate === 'np') {
      if (schemaVersion === 'FA(3)') {
        xmlRateCode =
          line.vatRateXmlCode === 'np II' || line.vatRateXmlCode === 'oo'
            ? line.vatRateXmlCode
            : 'np I';
      } else {
        xmlRateCode = line.vatRateXmlCode === 'oo' ? 'oo' : 'np';
      }
    } else {
      xmlRateCode = line.vatRate;
    }

    return {
      lineNo,
      line,
      vatGrosze: computedVat,
      effectiveNetContribution,
      effectiveVatContribution,
      xmlRateCode,
    };
  });

  const net23 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '23').map((l) => l.effectiveNetContribution),
  );
  const vat23 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '23').map((l) => l.effectiveVatContribution),
  );
  const has23 = computedLines.some((l) => l.line.vatRate === '23');

  const net8 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '8').map((l) => l.effectiveNetContribution),
  );
  const vat8 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '8').map((l) => l.effectiveVatContribution),
  );
  const has8 = computedLines.some((l) => l.line.vatRate === '8');

  const net5 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '5').map((l) => l.effectiveNetContribution),
  );
  const vat5 = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === '5').map((l) => l.effectiveVatContribution),
  );
  const has5 = computedLines.some((l) => l.line.vatRate === '5');

  const net0Kr = sumGrosze(
    computedLines
      .filter(
        (l) =>
          l.line.vatRate === '0' &&
          l.line.vatRateXmlCode !== '0 WDT' &&
          l.line.vatRateXmlCode !== '0 EX',
      )
      .map((l) => l.effectiveNetContribution),
  );
  const has0Kr = computedLines.some(
    (l) =>
      l.line.vatRate === '0' &&
      l.line.vatRateXmlCode !== '0 WDT' &&
      l.line.vatRateXmlCode !== '0 EX',
  );

  const net0Wdt = sumGrosze(
    computedLines
      .filter((l) => l.line.vatRate === '0' && l.line.vatRateXmlCode === '0 WDT')
      .map((l) => l.effectiveNetContribution),
  );
  const has0Wdt = computedLines.some(
    (l) => l.line.vatRate === '0' && l.line.vatRateXmlCode === '0 WDT',
  );

  const net0Ex = sumGrosze(
    computedLines
      .filter((l) => l.line.vatRate === '0' && l.line.vatRateXmlCode === '0 EX')
      .map((l) => l.effectiveNetContribution),
  );
  const has0Ex = computedLines.some(
    (l) => l.line.vatRate === '0' && l.line.vatRateXmlCode === '0 EX',
  );

  const netZw = sumGrosze(
    computedLines.filter((l) => l.line.vatRate === 'zw').map((l) => l.effectiveNetContribution),
  );
  const hasZw = computedLines.some((l) => l.line.vatRate === 'zw');

  const netNp1 = sumGrosze(
    computedLines
      .filter(
        (l) =>
          l.line.vatRate === 'np' &&
          l.line.vatRateXmlCode !== 'np II' &&
          l.line.vatRateXmlCode !== 'oo',
      )
      .map((l) => l.effectiveNetContribution),
  );
  const hasNp1 = computedLines.some(
    (l) =>
      l.line.vatRate === 'np' &&
      l.line.vatRateXmlCode !== 'np II' &&
      l.line.vatRateXmlCode !== 'oo',
  );

  const netNp2 = sumGrosze(
    computedLines
      .filter((l) => l.line.vatRate === 'np' && l.line.vatRateXmlCode === 'np II')
      .map((l) => l.effectiveNetContribution),
  );
  const hasNp2 = computedLines.some(
    (l) => l.line.vatRate === 'np' && l.line.vatRateXmlCode === 'np II',
  );

  const totalNetGrosze = sumGrosze(computedLines.map((l) => l.effectiveNetContribution));
  const totalVatGrosze = sumGrosze(computedLines.map((l) => l.effectiveVatContribution));
  const totalGrossGrosze = addGrosze(totalNetGrosze, totalVatGrosze);

  const anyAnnex15 = computedLines.some((l) => l.line.annex15Item === true);
  const autoMpp =
    input.splitPaymentMppP18A ?? (anyAnnex15 && Math.abs(totalGrossGrosze) > 1_500_000);

  const exemptionXml =
    hasZw || input.vatExemptionLegalBasisP19A
      ? [
          '<Zwolnienie>',
          '  <P_19>1</P_19>',
          `  <P_19A>${escapeXmlText(
            input.vatExemptionLegalBasisP19A ??
              'Zwolnienie podmiotowe z podatku od towarów i usług na podstawie art. 113 ust. 1 i 9 ustawy o VAT',
          )}</P_19A>`,
          '</Zwolnienie>',
        ].join('')
      : '<Zwolnienie><P_19N>1</P_19N></Zwolnienie>';

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Faktura xmlns="${targetNamespace}">`,
    '  <Naglowek>',
    `    <KodFormularza kodSystemowy="${schemaVersion === 'FA(3)' ? 'FA (3)' : 'FA (2)'}" wersjaSchemy="1-0E">FA</KodFormularza>`,
    `    <WariantFormularza>${variantNumber}</WariantFormularza>`,
    `    <DataWytworzeniaFa>${escapeXmlText(input.createdAtIsoUtc)}</DataWytworzeniaFa>`,
    ...(input.systemInfo
      ? [`    <SystemInfo>${escapeXmlText(input.systemInfo)}</SystemInfo>`]
      : []),
    '  </Naglowek>',
    '  <Podmiot1>',
    '    <DaneIdentyfikacyjne>',
    `      <NIP>${sellerNip}</NIP>`,
    `      <Nazwa>${escapeXmlText(input.seller.name.trim())}</Nazwa>`,
    '    </DaneIdentyfikacyjne>',
    '    <Adres>',
    `      <KodKraju>${escapeXmlText(sellerCountry)}</KodKraju>`,
    `      <AdresL1>${escapeXmlText(input.seller.address.addressLine1.trim())}</AdresL1>`,
    ...(input.seller.address.addressLine2
      ? [`      <AdresL2>${escapeXmlText(input.seller.address.addressLine2.trim())}</AdresL2>`]
      : []),
    '    </Adres>',
    ...(input.seller.email
      ? [
          '    <DaneKontaktowe>',
          `      <Email>${escapeXmlText(input.seller.email.trim())}</Email>`,
          '    </DaneKontaktowe>',
        ]
      : []),
    '  </Podmiot1>',
    '  <Podmiot2>',
    '    <DaneIdentyfikacyjne>',
    `      ${buyerIdXml}`,
    ...(input.buyer.name && input.buyer.name.trim().length > 0
      ? [`      <Nazwa>${escapeXmlText(input.buyer.name.trim())}</Nazwa>`]
      : []),
    '    </DaneIdentyfikacyjne>',
    ...(input.buyer.address
      ? [
          '    <Adres>',
          `      <KodKraju>${escapeXmlText((input.buyer.address.countryCode ?? 'PL').toUpperCase())}</KodKraju>`,
          `      <AdresL1>${escapeXmlText(input.buyer.address.addressLine1.trim())}</AdresL1>`,
          ...(input.buyer.address.addressLine2
            ? [`      <AdresL2>${escapeXmlText(input.buyer.address.addressLine2.trim())}</AdresL2>`]
            : []),
          '    </Adres>',
        ]
      : []),
    ...(schemaVersion === 'FA(3)'
      ? [
          `    <JST>${input.buyer.jstSubordinateUnit ? '1' : '2'}</JST>`,
          `    <GV>${input.buyer.vatGroupMember ? '1' : '2'}</GV>`,
        ]
      : []),
    '  </Podmiot2>',
    '  <Fa>',
    '    <KodWaluty>PLN</KodWaluty>',
    `    <P_1>${escapeXmlText(input.issueDate)}</P_1>`,
    `    <P_2>${escapeXmlText(input.invoiceNumber.trim())}</P_2>`,
    ...(input.saleDate ? [`    <P_6>${escapeXmlText(input.saleDate)}</P_6>`] : []),
    ...(has23
      ? [
          `    <P_13_1>${formatGroszeForXsdDecimal(net23)}</P_13_1>`,
          `    <P_14_1>${formatGroszeForXsdDecimal(vat23)}</P_14_1>`,
        ]
      : []),
    ...(has8
      ? [
          `    <P_13_2>${formatGroszeForXsdDecimal(net8)}</P_13_2>`,
          `    <P_14_2>${formatGroszeForXsdDecimal(vat8)}</P_14_2>`,
        ]
      : []),
    ...(has5
      ? [
          `    <P_13_3>${formatGroszeForXsdDecimal(net5)}</P_13_3>`,
          `    <P_14_3>${formatGroszeForXsdDecimal(vat5)}</P_14_3>`,
        ]
      : []),
    ...(has0Kr ? [`    <P_13_6_1>${formatGroszeForXsdDecimal(net0Kr)}</P_13_6_1>`] : []),
    ...(has0Wdt ? [`    <P_13_6_2>${formatGroszeForXsdDecimal(net0Wdt)}</P_13_6_2>`] : []),
    ...(has0Ex ? [`    <P_13_6_3>${formatGroszeForXsdDecimal(net0Ex)}</P_13_6_3>`] : []),
    ...(hasZw ? [`    <P_13_7>${formatGroszeForXsdDecimal(netZw)}</P_13_7>`] : []),
    ...(hasNp1 ? [`    <P_13_8>${formatGroszeForXsdDecimal(netNp1)}</P_13_8>`] : []),
    ...(hasNp2 ? [`    <P_13_9>${formatGroszeForXsdDecimal(netNp2)}</P_13_9>`] : []),
    `    <P_15>${formatGroszeForXsdDecimal(totalGrossGrosze)}</P_15>`,
    '    <Adnotacje>',
    `      <P_16>${input.cashAccountingMethodP16 ? '1' : '2'}</P_16>`,
    `      <P_17>${input.selfBillingP17 ? '1' : '2'}</P_17>`,
    `      <P_18>${input.reverseChargeP18 ? '1' : '2'}</P_18>`,
    `      <P_18A>${autoMpp ? '1' : '2'}</P_18A>`,
    `      ${exemptionXml}`,
    '      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>',
    '      <P_23>2</P_23>',
    '      <PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>',
    '    </Adnotacje>',
    `    <RodzajFaktury>${invoiceKind}</RodzajFaktury>`,
  ];

  if (isCorrection && input.correction) {
    parts.push(
      `    <PrzyczynaKorekty>${escapeXmlText(input.correction.reason.trim())}</PrzyczynaKorekty>`,
    );
    if (input.correction.correctionType) {
      parts.push(`    <TypKorekty>${input.correction.correctionType}</TypKorekty>`);
    }
    for (const corrRef of input.correction.correctedInvoices) {
      assertValidIsoCalendarDate(corrRef.originalIssueDate, 'originalIssueDate');
      parts.push('    <DaneFaKorygowanej>');
      parts.push(
        `      <DataWystFaKorygowanej>${escapeXmlText(corrRef.originalIssueDate)}</DataWystFaKorygowanej>`,
      );
      parts.push(
        `      <NrFaKorygowanej>${escapeXmlText(corrRef.originalInvoiceNumber.trim())}</NrFaKorygowanej>`,
      );
      if (corrRef.originalKsefNumber) {
        const ksefCheck = validateKsefNumber(corrRef.originalKsefNumber, { verifyCrc8: false });
        if (!ksefCheck.valid) {
          throw new Error(
            `Nieprawidłowy NrKSeFFaKorygowanej ("${corrRef.originalKsefNumber}"): ${ksefCheck.reason ?? 'błąd formatu'}`,
          );
        }
        parts.push('      <NrKSeF>1</NrKSeF>');
        parts.push(
          `      <NrKSeFFaKorygowanej>${escapeXmlText(corrRef.originalKsefNumber.trim())}</NrKSeFFaKorygowanej>`,
        );
      } else {
        parts.push('      <NrKSeFN>1</NrKSeFN>');
      }
      parts.push('    </DaneFaKorygowanej>');
    }
  }

  if (input.relatedPartyTransactionTp) {
    parts.push('    <TP>1</TP>');
  }

  for (const item of computedLines) {
    const qty = (item.line.quantity ?? '1').trim().replace(',', '.');
    if (!/^-?(?:[1-9]\d{0,15}|0)(?:\.\d{1,6})?$/.test(qty)) {
      throw new Error(`Nieprawidłowa ilość P_8B w wierszu ${String(item.lineNo)}: "${qty}".`);
    }
    parts.push('    <FaWiersz>');
    parts.push(`      <NrWierszaFa>${String(item.lineNo)}</NrWierszaFa>`);
    parts.push(`      <P_7>${escapeXmlText(item.line.description.trim())}</P_7>`);
    parts.push(`      <P_8A>${escapeXmlText((item.line.unit ?? 'szt.').trim())}</P_8A>`);
    parts.push(`      <P_8B>${escapeXmlText(qty)}</P_8B>`);
    if (item.line.unitNetGrosze !== undefined) {
      parts.push(`      <P_9A>${formatGroszeForXsdDecimal(item.line.unitNetGrosze)}</P_9A>`);
    }
    parts.push(`      <P_11>${formatGroszeForXsdDecimal(item.line.netGrosze)}</P_11>`);
    parts.push(`      <P_11Vat>${formatGroszeForXsdDecimal(item.vatGrosze)}</P_11Vat>`);
    parts.push(`      <P_12>${escapeXmlText(item.xmlRateCode)}</P_12>`);
    if (item.line.annex15Item) {
      parts.push('      <P_12_Zal_15>1</P_12_Zal_15>');
    }
    if (item.line.gtuCode) {
      parts.push(`      <GTU>${item.line.gtuCode}</GTU>`);
    }
    if (item.line.procedureCode) {
      parts.push(`      <Procedura>${item.line.procedureCode}</Procedura>`);
    }
    if (item.line.beforeCorrectionState) {
      parts.push('      <StanPrzed>1</StanPrzed>');
    }
    parts.push('    </FaWiersz>');
  }

  if (input.dueDate || input.sellerBankAccountIban || input.paymentMethodCode) {
    parts.push('    <Platnosc>');
    if (input.dueDate) {
      parts.push('      <TerminPlatnosci>');
      parts.push(`        <Termin>${escapeXmlText(input.dueDate)}</Termin>`);
      parts.push('      </TerminPlatnosci>');
    }
    if (input.paymentMethodCode) {
      parts.push(`      <FormaPlatnosci>${input.paymentMethodCode}</FormaPlatnosci>`);
    }
    if (input.sellerBankAccountIban) {
      const cleanedRb = input.sellerBankAccountIban.replace(/\s+/g, '').toUpperCase();
      if (!/^[0-9A-Z]{10,34}$/.test(cleanedRb)) {
        throw new Error(`Nieprawidłowy rachunek bankowy NrRB: "${input.sellerBankAccountIban}".`);
      }
      parts.push('      <RachunekBankowy>');
      parts.push(`        <NrRB>${escapeXmlText(cleanedRb)}</NrRB>`);
      parts.push('      </RachunekBankowy>');
    }
    parts.push('    </Platnosc>');
  }

  parts.push('  </Fa>');
  parts.push('</Faktura>');

  return {
    xml: parts.join('\n'),
    schemaVersion,
    targetNamespace,
    totalNetGrosze,
    totalVatGrosze,
    totalGrossGrosze,
  };
}
