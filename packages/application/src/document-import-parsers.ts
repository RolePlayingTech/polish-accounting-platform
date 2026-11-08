import type { DocumentLineItemContract, VatRateCodeContract } from '@pap/contracts/accounting';
import type { DocumentSourceFormatContract } from '@pap/contracts/api';
import { isRealIsoCalendarDate } from '@pap/contracts/mcp-tools';
import { formatPlnFromGrosze, multiplyGroszeByBps } from '@pap/domain';
import { AccountingWorkspaceError } from './accounting-workspace.js';

export const MAX_DOCUMENT_RAW_PAYLOAD_BYTES = 256 * 1024;

const POLISH_NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function normalizePolishNipDigits(rawNip: string): string {
  const trimmed = rawNip.trim().replace(/^PL/i, '').replace(/[\s-]/g, '');
  return trimmed;
}

export function validatePolishNipChecksum(rawNip: string): boolean {
  const digits = normalizePolishNipDigits(rawNip);
  if (!/^\d{10}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * (POLISH_NIP_WEIGHTS[i] ?? 0);
  }
  const check = sum % 11;
  if (check === 10) {
    return false;
  }
  return check === Number(digits[9]);
}

export function vatRateToBps(rate: VatRateCodeContract): number {
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

export function normalizeVatRateCode(rawRate: string): VatRateCodeContract {
  const cleaned = rawRate.trim().toLowerCase().replace(/%$/, '').trim();
  if (cleaned === '23' || cleaned === '22') {
    return '23';
  }
  if (cleaned === '8' || cleaned === '7') {
    return '8';
  }
  if (cleaned === '5') {
    return '5';
  }
  if (
    cleaned === '0' ||
    cleaned === '0 kr' ||
    cleaned === '0 wdt' ||
    cleaned === '0 ex' ||
    cleaned === '0.00'
  ) {
    return '0';
  }
  if (cleaned === 'zw' || cleaned === 'zw.') {
    return 'zw';
  }
  if (
    cleaned === 'np' ||
    cleaned === 'np.' ||
    cleaned === 'np i' ||
    cleaned === 'np ii' ||
    cleaned === 'oo'
  ) {
    return 'np';
  }
  throw new AccountingWorkspaceError(
    422,
    'invalid_vat_rate',
    `Nieobsługiwana lub nieprawidłowa stawka VAT: "${rawRate}". Dozwolone wartości: 23, 8, 5, 0, zw, np.`,
  );
}

export function parseDecimalPlnToGroszeStrict(rawValue: string, fieldName: string): number {
  const normalized = rawValue.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_amount',
      `Pole kwotowe "${fieldName}" zawiera nieprawidłową wartość "${rawValue}". Wymagana nieujemna kwota dziesiętna PLN (maksymalnie 2 miejsca po przecinku).`,
    );
  }
  const [wholePart = '0', fracPart = ''] = normalized.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const grosze = Number(wholePart) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(grosze) || grosze < 0) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_amount',
      `Pole kwotowe "${fieldName}" przekracza bezpieczny zakres groszy.`,
    );
  }
  return grosze;
}

export interface ParsedDocumentImportResult {
  readonly sourceFormat: DocumentSourceFormatContract;
  readonly ksefSchemaVersion?: 'FA(2)' | 'FA(3)';
  readonly documentNumber: string;
  readonly direction: 'sales' | 'purchase';
  readonly issueDate: string;
  readonly saleDate: string;
  readonly dueDate?: string;
  readonly counterpartyName: string;
  readonly counterpartyNip: string;
  readonly counterpartyAddress?: string;
  readonly counterpartyIban?: string;
  readonly ksefReferenceNumber?: string;
  readonly ksefMarker?: 'NrKSeF' | 'OFF' | 'BFK' | 'DI';
  readonly lines: readonly DocumentLineItemContract[];
  readonly totalNetGrosze: number;
  readonly totalVatGrosze: number;
  readonly totalGrossGrosze: number;
  readonly expenseCategoryHint?:
    | 'towary_handlowe'
    | 'uslugi_obce'
    | 'inne_wydatki'
    | 'paliwo_eksploatacja_mieszana'
    | 'reprezentacja_nkup';
}

function decodeSafeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function extractXmlTagContent(xmlBlock: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tagName}>`,
    'i',
  );
  const match = regex.exec(xmlBlock);
  if (!match || match[1] === undefined) {
    return undefined;
  }
  const value = decodeSafeXmlEntities(match[1]);
  return value.length > 0 ? value : undefined;
}

function extractAllXmlTagBlocks(xmlBlock: string, tagName: string): string[] {
  const regex = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tagName}>`,
    'gi',
  );
  const blocks: string[] = [];
  let match: RegExpExecArray | null = regex.exec(xmlBlock);
  while (match !== null) {
    if (match[1] !== undefined) {
      blocks.push(match[1]);
    }
    match = regex.exec(xmlBlock);
  }
  return blocks;
}

export function assertPayloadSizeWithinLimit(rawPayload: string): void {
  const byteLength = Buffer.byteLength(rawPayload, 'utf8');
  if (byteLength === 0) {
    throw new AccountingWorkspaceError(
      400,
      'empty_document_payload',
      'Przekazany ładunek dokumentu (rawPayload) jest pusty.',
    );
  }
  if (byteLength > MAX_DOCUMENT_RAW_PAYLOAD_BYTES) {
    throw new AccountingWorkspaceError(
      422,
      'document_payload_too_large',
      `Ładunek dokumentu przekracza maksymalny dozwolony rozmiar (${MAX_DOCUMENT_RAW_PAYLOAD_BYTES} bajtów).`,
    );
  }
}

export function parseSafeKsefXml(
  rawXml: string,
  options?: {
    readonly companyNip?: string;
    readonly fallbackDirection?: 'sales' | 'purchase';
  },
): ParsedDocumentImportResult {
  assertPayloadSizeWithinLimit(rawXml);
  const trimmed = rawXml.trim();

  // Ochrona przed XXE / DTD / encjami zewnętrznymi
  if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed)) {
    throw new AccountingWorkspaceError(
      400,
      'ksef_xml_xxe_forbidden',
      'Dokument XML zawiera zabronione deklaracje DTD/ENTITY (ochrona przed XXE).',
    );
  }

  if (!/<(?:[A-Za-z0-9_]+:)?Faktura[\s>]/i.test(trimmed)) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_ksef_xml_structure',
      'Brak głównego elementu <Faktura> wymaganego przez schemę KSeF FA(2)/FA(3).',
    );
  }

  let ksefSchemaVersion: 'FA(2)' | 'FA(3)' = 'FA(3)';
  const kodFormularzaMatch =
    /<(?:[A-Za-z0-9_]+:)?KodFormularza([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?KodFormularza>/i.exec(
      trimmed,
    );
  if (kodFormularzaMatch) {
    const attrs = kodFormularzaMatch[1] ?? '';
    const formCode = decodeSafeXmlEntities(kodFormularzaMatch[2] ?? '');
    if (formCode && formCode.toUpperCase() !== 'FA') {
      throw new AccountingWorkspaceError(
        422,
        'unsupported_ksef_form_code',
        `Nieobsługiwany kod formularza KSeF: "${formCode}". Obsługiwane są wyłącznie faktury ustrukturyzowane FA(2) oraz FA(3).`,
      );
    }
    const systemCodeMatch = /kodSystemowy\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (systemCodeMatch?.[1]) {
      const normalizedSys = systemCodeMatch[1].replace(/\s+/g, '').toUpperCase();
      if (normalizedSys === 'FA(2)') {
        ksefSchemaVersion = 'FA(2)';
      } else if (normalizedSys === 'FA(3)') {
        ksefSchemaVersion = 'FA(3)';
      } else {
        throw new AccountingWorkspaceError(
          422,
          'unsupported_ksef_schema_version',
          `Nieobsługiwana wersja schemy KSeF: "${systemCodeMatch[1]}". Wymagana schema FA (2) lub FA (3).`,
        );
      }
    }
  }

  const podmiot1Block = extractXmlTagContent(trimmed, 'Podmiot1');
  const podmiot2Block = extractXmlTagContent(trimmed, 'Podmiot2');
  const faBlock = extractXmlTagContent(trimmed, 'Fa');

  if (!podmiot1Block || !podmiot2Block || !faBlock) {
    throw new AccountingWorkspaceError(
      422,
      'incomplete_ksef_xml',
      'Dokument KSeF XML musi zawierać kompletną strukturę sekcji <Podmiot1>, <Podmiot2> oraz <Fa>.',
    );
  }

  const sellerNipRaw = extractXmlTagContent(podmiot1Block, 'NIP');
  const sellerName = extractXmlTagContent(podmiot1Block, 'Nazwa');
  const buyerNipRaw = extractXmlTagContent(podmiot2Block, 'NIP');
  const buyerName = extractXmlTagContent(podmiot2Block, 'Nazwa');

  if (!sellerNipRaw || !sellerName) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_seller_identity',
      'Sekcja <Podmiot1> (Sprzedawca) w KSeF XML musi zawierać pola <NIP> oraz <Nazwa>.',
    );
  }
  if (!buyerNipRaw || !buyerName) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_buyer_identity',
      'Sekcja <Podmiot2> (Nabywca) w KSeF XML musi zawierać pola <NIP> oraz <Nazwa>.',
    );
  }

  const sellerNip = normalizePolishNipDigits(sellerNipRaw);
  const buyerNip = normalizePolishNipDigits(buyerNipRaw);

  if (!/^\d{10}$/.test(sellerNip)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_seller_nip',
      `Nieprawidłowy format numeru NIP sprzedawcy (<Podmiot1><NIP>${sellerNipRaw}</NIP>) — wymagane 10 cyfr.`,
    );
  }
  if (!/^\d{10}$/.test(buyerNip)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_buyer_nip',
      `Nieprawidłowy format numeru NIP nabywcy (<Podmiot2><NIP>${buyerNipRaw}</NIP>) — wymagane 10 cyfr.`,
    );
  }

  const normalizedCompanyNip = options?.companyNip
    ? normalizePolishNipDigits(options.companyNip)
    : undefined;

  let direction: 'sales' | 'purchase' = options?.fallbackDirection ?? 'purchase';
  if (normalizedCompanyNip) {
    if (sellerNip === normalizedCompanyNip && buyerNip !== normalizedCompanyNip) {
      direction = 'sales';
    } else if (buyerNip === normalizedCompanyNip && sellerNip !== normalizedCompanyNip) {
      direction = 'purchase';
    }
  }

  const counterpartyNip = direction === 'sales' ? buyerNip : sellerNip;
  if (!validatePolishNipChecksum(counterpartyNip)) {
    throw new AccountingWorkspaceError(
      422,
      direction === 'sales' ? 'invalid_ksef_buyer_nip' : 'invalid_ksef_seller_nip',
      `Nieprawidłowy numer NIP kontrahenta (${counterpartyNip}) — niezgodna suma kontrolna modulo 11.`,
    );
  }
  const counterpartyName = direction === 'sales' ? buyerName : sellerName;
  const counterpartyBlock = direction === 'sales' ? podmiot2Block : podmiot1Block;
  const counterpartyAddress =
    extractXmlTagContent(counterpartyBlock, 'AdresL1') ??
    extractXmlTagContent(counterpartyBlock, 'Adres');

  const currency = extractXmlTagContent(faBlock, 'KodWaluty') ?? 'PLN';
  if (currency.toUpperCase() !== 'PLN') {
    throw new AccountingWorkspaceError(
      422,
      'unsupported_document_currency',
      `Nieobsługiwana waluta faktury KSeF: "${currency}". Obecnie obsługiwana jest wyłącznie waluta PLN.`,
    );
  }

  const issueDate = extractXmlTagContent(faBlock, 'P_1');
  if (!issueDate || !isRealIsoCalendarDate(issueDate)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_issue_date',
      `Brak lub nieprawidłowa data wystawienia faktury (<P_1>${issueDate ?? ''}</P_1>). Wymagany format RRRR-MM-DD.`,
    );
  }

  const documentNumber = extractXmlTagContent(faBlock, 'P_2');
  if (!documentNumber) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_document_number',
      'Brak numeru faktury w polu <P_2> sekcji <Fa>.',
    );
  }

  const saleDateRaw = extractXmlTagContent(faBlock, 'P_6');
  if (saleDateRaw !== undefined && !isRealIsoCalendarDate(saleDateRaw)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_sale_date',
      `Nieprawidłowa data sprzedaży/wykonania usługi (<P_6>${saleDateRaw}</P_6>). Wymagany format RRRR-MM-DD.`,
    );
  }
  const saleDate = saleDateRaw ?? issueDate;

  const dueDate =
    extractXmlTagContent(faBlock, 'Termin') ?? extractXmlTagContent(faBlock, 'TerminPlatnosci');
  if (dueDate !== undefined && !isRealIsoCalendarDate(dueDate)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_due_date',
      `Nieprawidłowy termin płatności (<Termin>${dueDate}</Termin>). Wymagany format RRRR-MM-DD.`,
    );
  }
  if (dueDate !== undefined && dueDate < issueDate) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_due_date',
      `Termin płatności (<Termin>${dueDate}</Termin>) nie może być wcześniejszy niż data wystawienia (<P_1>${issueDate}</P_1>).`,
    );
  }

  const ksefReferenceNumber =
    extractXmlTagContent(faBlock, 'NrKSeF') ?? extractXmlTagContent(trimmed, 'NrKSeF');
  const ksefMarker: 'NrKSeF' | 'OFF' = ksefReferenceNumber ? 'NrKSeF' : 'OFF';

  const wierszeBlocks = extractAllXmlTagBlocks(faBlock, 'FaWiersz');
  if (wierszeBlocks.length === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_line_items',
      'Faktura KSeF XML musi zawierać co najmniej jeden wiersz pozycji <FaWiersz>.',
    );
  }

  const globalP18A = extractXmlTagContent(faBlock, 'P_18A');
  const globalAnnex15 = globalP18A === '1' || globalP18A?.toLowerCase() === 'true';

  const lines: DocumentLineItemContract[] = wierszeBlocks.map((wiersz, idx) => {
    const lineNoRaw = extractXmlTagContent(wiersz, 'NrWierszaFa');
    const lineNumber =
      lineNoRaw && /^\d+$/.test(lineNoRaw) && Number(lineNoRaw) > 0 ? Number(lineNoRaw) : idx + 1;
    const description = extractXmlTagContent(wiersz, 'P_7');
    if (!description) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_description',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera nazwy towaru lub usługi w polu <P_7>.`,
      );
    }

    const unit = extractXmlTagContent(wiersz, 'P_8A') ?? 'szt.';
    const quantity = extractXmlTagContent(wiersz, 'P_8B') ?? '1';
    if (!/^\d+(?:[.,]\d+)?$/.test(quantity) || Number(quantity.replace(',', '.')) <= 0) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_line_quantity',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} ma nieprawidłową ilość (<P_8B>${quantity}</P_8B>).`,
      );
    }

    const vatRateRaw = extractXmlTagContent(wiersz, 'P_12');
    if (!vatRateRaw) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_vat_rate',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera stawki VAT w polu <P_12>.`,
      );
    }
    const vatRate = normalizeVatRateCode(vatRateRaw);
    const rateBps = vatRateToBps(vatRate);

    const p11NetRaw = extractXmlTagContent(wiersz, 'P_11');
    const p9aUnitNetRaw = extractXmlTagContent(wiersz, 'P_9A');
    let netGrosze: number;
    if (p11NetRaw !== undefined) {
      netGrosze = parseDecimalPlnToGroszeStrict(p11NetRaw, `FaWiersz[${lineNumber}].P_11`);
    } else if (p9aUnitNetRaw !== undefined) {
      const unitNetGrosze = parseDecimalPlnToGroszeStrict(
        p9aUnitNetRaw,
        `FaWiersz[${lineNumber}].P_9A`,
      );
      const qtyNumber = Number(quantity.replace(',', '.'));
      netGrosze = Math.round(unitNetGrosze * qtyNumber);
    } else {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_net_amount',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera kwoty netto (<P_11> ani <P_9A>).`,
      );
    }

    const expectedVatGrosze = multiplyGroszeByBps(netGrosze, rateBps, 'half_up');
    const p11VatRaw = extractXmlTagContent(wiersz, 'P_11Vat');
    let vatGrosze = expectedVatGrosze;
    if (p11VatRaw !== undefined) {
      vatGrosze = parseDecimalPlnToGroszeStrict(p11VatRaw, `FaWiersz[${lineNumber}].P_11Vat`);
      if (Math.abs(vatGrosze - expectedVatGrosze) > 1) {
        throw new AccountingWorkspaceError(
          422,
          'ksef_line_vat_mismatch',
          `Kwota VAT (<P_11Vat>${p11VatRaw}</P_11Vat>) w wierszu nr ${lineNumber} nie zgadza się ze stawką ${vatRate}% od kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN.`,
        );
      }
    }

    const p11GrossRaw =
      extractXmlTagContent(wiersz, 'P_11A') ?? extractXmlTagContent(wiersz, 'P_11Brutto');
    const grossGrosze =
      p11GrossRaw !== undefined
        ? parseDecimalPlnToGroszeStrict(p11GrossRaw, `FaWiersz[${lineNumber}].P_11A`)
        : netGrosze + vatGrosze;

    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Niezgodność kwot w wierszu nr ${lineNumber}: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
      );
    }

    const lineAnnex15Raw = extractXmlTagContent(wiersz, 'Zalacznik15');
    const annex15Item =
      globalAnnex15 || lineAnnex15Raw === '1' || lineAnnex15Raw?.toLowerCase() === 'true';

    return {
      lineNumber,
      description,
      quantity,
      unit,
      netGrosze,
      vatRate,
      vatGrosze,
      grossGrosze,
      annex15Item,
    };
  });

  // Walidacja podsumowań stawek P_13_* / P_14_* w <Fa>, jeśli zostały podane w XML
  const rateSummaryMappings: ReadonlyArray<{
    readonly rate: VatRateCodeContract;
    readonly netTags: readonly string[];
    readonly vatTags: readonly string[];
  }> = [
    { rate: '23', netTags: ['P_13_1'], vatTags: ['P_14_1'] },
    { rate: '8', netTags: ['P_13_2'], vatTags: ['P_14_2'] },
    { rate: '5', netTags: ['P_13_3'], vatTags: ['P_14_3'] },
    { rate: '0', netTags: ['P_13_6_1', 'P_13_6_2', 'P_13_6_3'], vatTags: [] },
    { rate: 'zw', netTags: ['P_13_7'], vatTags: [] },
    { rate: 'np', netTags: ['P_13_8', 'P_13_9'], vatTags: [] },
  ];

  for (const mapping of rateSummaryMappings) {
    const presentNetValues: number[] = [];
    for (const tag of mapping.netTags) {
      const raw = extractXmlTagContent(faBlock, tag);
      if (raw !== undefined) {
        presentNetValues.push(parseDecimalPlnToGroszeStrict(raw, tag));
      }
    }
    if (presentNetValues.length > 0) {
      const summaryNet = presentNetValues.reduce((acc, v) => acc + v, 0);
      const linesNet = lines
        .filter((line) => line.vatRate === mapping.rate)
        .reduce((acc, line) => acc + line.netGrosze, 0);
      if (summaryNet !== linesNet) {
        throw new AccountingWorkspaceError(
          422,
          'ksef_summary_net_mismatch',
          `Suma netto w podsumowaniu KSeF dla stawki "${mapping.rate}" (${formatPlnFromGrosze(summaryNet)} PLN) nie zgadza się z sumą wierszy <FaWiersz> (${formatPlnFromGrosze(linesNet)} PLN).`,
        );
      }
    }

    for (const vatTag of mapping.vatTags) {
      const rawVat = extractXmlTagContent(faBlock, vatTag);
      if (rawVat !== undefined) {
        const summaryVat = parseDecimalPlnToGroszeStrict(rawVat, vatTag);
        const linesForRate = lines.filter((line) => line.vatRate === mapping.rate);
        const linesVat = linesForRate.reduce((acc, line) => acc + line.vatGrosze, 0);
        const tolerance = Math.max(1, linesForRate.length);
        if (Math.abs(summaryVat - linesVat) > tolerance) {
          throw new AccountingWorkspaceError(
            422,
            'ksef_summary_vat_mismatch',
            `Suma VAT w polu <${vatTag}> (${formatPlnFromGrosze(summaryVat)} PLN) nie zgadza się z sumą VAT wierszy <FaWiersz> (${formatPlnFromGrosze(linesVat)} PLN).`,
          );
        }
        // Jeżeli w wierszach nie było jawnego P_11Vat, a P_14_* różni się o grosz zaokrąglenia na sumie,
        // sprawdzamy też spójność z P_15.
      }
    }
  }

  const totalNetGrosze = lines.reduce((sum, l) => sum + l.netGrosze, 0);
  const totalVatGrosze = lines.reduce((sum, l) => sum + l.vatGrosze, 0);
  const totalGrossGrosze = lines.reduce((sum, l) => sum + l.grossGrosze, 0);

  const p15GrossRaw = extractXmlTagContent(faBlock, 'P_15');
  if (p15GrossRaw !== undefined) {
    const p15GrossGrosze = parseDecimalPlnToGroszeStrict(p15GrossRaw, 'P_15');
    if (p15GrossGrosze !== totalGrossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Kwota należności ogółem <P_15> (${formatPlnFromGrosze(p15GrossGrosze)} PLN) nie zgadza się z sumą brutto pozycji (netto ${formatPlnFromGrosze(totalNetGrosze)} + VAT ${formatPlnFromGrosze(totalVatGrosze)} = ${formatPlnFromGrosze(totalGrossGrosze)} PLN).`,
      );
    }
  }

  return {
    sourceFormat: 'ksef_xml',
    ksefSchemaVersion,
    documentNumber,
    direction,
    issueDate,
    saleDate,
    ...(dueDate ? { dueDate } : {}),
    counterpartyName,
    counterpartyNip,
    ...(counterpartyAddress ? { counterpartyAddress } : {}),
    ...(ksefReferenceNumber ? { ksefReferenceNumber } : {}),
    ksefMarker,
    lines,
    totalNetGrosze,
    totalVatGrosze,
    totalGrossGrosze,
  };
}

function splitCsvRow(line: string, delimiter: ';' | ','): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (inQuotes) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_csv',
      'Niezamknięty cudzysłów w wierszu pliku CSV.',
    );
  }
  cells.push(current.trim());
  return cells;
}

function normalizeCsvHeaderName(rawHeader: string): string {
  return rawHeader
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDirectionValue(
  raw: string | undefined,
  fallback: 'sales' | 'purchase',
): 'sales' | 'purchase' {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'sales' || normalized === 'sprzedaz' || normalized === 'sprzedaż') {
    return 'sales';
  }
  if (normalized === 'purchase' || normalized === 'zakup' || normalized === 'koszt') {
    return 'purchase';
  }
  throw new AccountingWorkspaceError(
    422,
    'invalid_document_direction',
    `Nieprawidłowy kierunek dokumentu: "${raw}". Dozwolone: sales/purchase (lub sprzedaż/zakup).`,
  );
}

function parseExpenseCategoryHint(
  raw: string | undefined,
): ParsedDocumentImportResult['expenseCategoryHint'] {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'towary_handlowe' ||
    normalized === 'uslugi_obce' ||
    normalized === 'inne_wydatki' ||
    normalized === 'paliwo_eksploatacja_mieszana' ||
    normalized === 'reprezentacja_nkup'
  ) {
    return normalized;
  }
  throw new AccountingWorkspaceError(
    422,
    'invalid_expense_category',
    `Nieobsługiwana kategoria kosztu: "${raw}".`,
  );
}

function inferExactVatRateFromAmounts(netGrosze: number, vatGrosze: number): VatRateCodeContract {
  if (vatGrosze === 0) {
    return '0';
  }
  for (const candidate of ['23', '8', '5'] as const) {
    const expected = multiplyGroszeByBps(netGrosze, vatRateToBps(candidate), 'half_up');
    if (Math.abs(expected - vatGrosze) <= 1) {
      return candidate;
    }
  }
  throw new AccountingWorkspaceError(
    422,
    'document_amount_mismatch',
    `Kwota VAT (${formatPlnFromGrosze(vatGrosze)} PLN) nie odpowiada żadnej stawce podstawowej (23%, 8%, 5%, 0%) dla kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN. Podaj jawną stawkę VAT i poprawne kwoty.`,
  );
}

export function parseSafeDocumentCsv(
  rawCsv: string,
  options?: {
    readonly fallbackDirection?: 'sales' | 'purchase';
  },
): ParsedDocumentImportResult {
  assertPayloadSizeWithinLimit(rawCsv);
  const nonEmptyLines = rawCsv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length < 2) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_csv',
      'Plik CSV musi zawierać wiersz nagłówka oraz co najmniej jeden wiersz danych faktury.',
    );
  }

  const headerLine = nonEmptyLines[0]!;
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  if (semicolonCount === 0 && commaCount === 0) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_csv',
      'Brak rozpoznawalnego separatora kolumn CSV (średnik ";" lub przecinek ",").',
    );
  }
  const delimiter: ';' | ',' = semicolonCount >= commaCount ? ';' : ',';
  const headers = splitCsvRow(headerLine, delimiter).map(normalizeCsvHeaderName);

  const findColumn = (aliases: readonly string[]): number =>
    headers.findIndex((h) => aliases.includes(h));

  const docNoIdx = findColumn([
    'document_number',
    'invoice_number',
    'numer_faktury',
    'nr_faktury',
    'numer_dokumentu',
    'nr_dokumentu',
  ]);
  const directionIdx = findColumn(['direction', 'kierunek', 'typ', 'rodzaj']);
  const issueDateIdx = findColumn(['issue_date', 'data_wystawienia', 'data']);
  const saleDateIdx = findColumn(['sale_date', 'data_sprzedazy', 'event_date']);
  const dueDateIdx = findColumn(['due_date', 'termin_platnosci', 'termin']);
  const counterpartyNameIdx = findColumn([
    'counterparty_name',
    'kontrahent',
    'nazwa_kontrahenta',
    'sprzedawca',
    'nabywca',
  ]);
  const counterpartyNipIdx = findColumn([
    'counterparty_nip',
    'nip',
    'nip_kontrahenta',
    'seller_nip',
    'buyer_nip',
  ]);
  const descriptionIdx = findColumn(['description', 'opis', 'pozycja', 'nazwa_pozycji', 'tytul']);
  const quantityIdx = findColumn(['quantity', 'ilosc']);
  const unitIdx = findColumn(['unit', 'jednostka', 'jm']);
  const vatRateIdx = findColumn(['vat_rate', 'stawka_vat', 'stawka', 'vat_stawka']);
  const netIdx = findColumn(['net_amount_pln', 'net_pln', 'netto', 'kwota_netto', 'net']);
  const vatIdx = findColumn(['vat_amount_pln', 'vat_pln', 'vat', 'kwota_vat']);
  const grossIdx = findColumn(['gross_amount_pln', 'gross_pln', 'brutto', 'kwota_brutto', 'gross']);
  const categoryIdx = findColumn(['expense_category', 'kategoria', 'kategoria_kosztu']);
  const ksefRefIdx = findColumn(['ksef_reference_number', 'nr_ksef', 'ksef_ref']);

  if (
    docNoIdx === -1 ||
    issueDateIdx === -1 ||
    counterpartyNameIdx === -1 ||
    counterpartyNipIdx === -1 ||
    netIdx === -1 ||
    vatIdx === -1 ||
    grossIdx === -1
  ) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_csv_headers',
      'Plik CSV musi zawierać wymagane kolumny: numer_faktury (document_number), data_wystawienia (issue_date), kontrahent (counterparty_name), nip (counterparty_nip), netto (net_amount_pln), vat (vat_amount_pln) oraz brutto (gross_amount_pln).',
    );
  }

  let documentNumber = '';
  let direction: 'sales' | 'purchase' = options?.fallbackDirection ?? 'purchase';
  let issueDate = '';
  let saleDate = '';
  let dueDate: string | undefined;
  let counterpartyName = '';
  let counterpartyNip = '';
  let ksefReferenceNumber: string | undefined;
  let expenseCategoryHint: ParsedDocumentImportResult['expenseCategoryHint'];
  const lines: DocumentLineItemContract[] = [];

  for (let rowIndex = 1; rowIndex < nonEmptyLines.length; rowIndex += 1) {
    const cells = splitCsvRow(nonEmptyLines[rowIndex]!, delimiter);
    if (cells.length !== headers.length) {
      throw new AccountingWorkspaceError(
        400,
        'invalid_document_csv_row',
        `Wiersz CSV nr ${rowIndex + 1} ma ${cells.length} kolumn, oczekiwano ${headers.length}.`,
      );
    }

    const rowDocNo = (cells[docNoIdx] ?? '').trim();
    const rowIssueDate = (cells[issueDateIdx] ?? '').trim();
    const rowCounterpartyName = (cells[counterpartyNameIdx] ?? '').trim();
    const rowNipRaw = (cells[counterpartyNipIdx] ?? '').trim();
    const rowNetRaw = (cells[netIdx] ?? '').trim();
    const rowVatRaw = (cells[vatIdx] ?? '').trim();
    const rowGrossRaw = (cells[grossIdx] ?? '').trim();

    if (!rowDocNo || !rowIssueDate || !rowCounterpartyName || !rowNipRaw) {
      throw new AccountingWorkspaceError(
        422,
        'missing_csv_required_fields',
        `Wiersz CSV nr ${rowIndex + 1} ma puste wymagane pola identyfikujące fakturę lub kontrahenta.`,
      );
    }

    if (!isRealIsoCalendarDate(rowIssueDate)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_document_date',
        `Wiersz CSV nr ${rowIndex + 1} zawiera nieprawidłową datę wystawienia "${rowIssueDate}" (wymagany format RRRR-MM-DD).`,
      );
    }

    const normalizedNip = normalizePolishNipDigits(rowNipRaw);
    if (!validatePolishNipChecksum(normalizedNip)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_counterparty_nip',
        `Wiersz CSV nr ${rowIndex + 1} zawiera nieprawidłowy NIP kontrahenta "${rowNipRaw}" (błędna suma kontrolna modulo 11).`,
      );
    }

    const rowSaleDateRaw = saleDateIdx >= 0 ? (cells[saleDateIdx] ?? '').trim() : '';
    if (rowSaleDateRaw && !isRealIsoCalendarDate(rowSaleDateRaw)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_document_date',
        `Wiersz CSV nr ${rowIndex + 1} zawiera nieprawidłową datę sprzedaży "${rowSaleDateRaw}".`,
      );
    }

    const rowDueDateRaw = dueDateIdx >= 0 ? (cells[dueDateIdx] ?? '').trim() : '';
    if (rowDueDateRaw && !isRealIsoCalendarDate(rowDueDateRaw)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_document_date',
        `Wiersz CSV nr ${rowIndex + 1} zawiera nieprawidłowy termin płatności "${rowDueDateRaw}".`,
      );
    }
    if (rowDueDateRaw && rowDueDateRaw < rowIssueDate) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_due_date',
        `Wiersz CSV nr ${rowIndex + 1}: termin płatności (${rowDueDateRaw}) nie może być wcześniejszy niż data wystawienia (${rowIssueDate}).`,
      );
    }

    if (rowIndex === 1) {
      documentNumber = rowDocNo;
      issueDate = rowIssueDate;
      saleDate = rowSaleDateRaw || rowIssueDate;
      dueDate = rowDueDateRaw || undefined;
      counterpartyName = rowCounterpartyName;
      counterpartyNip = normalizedNip;
      if (directionIdx >= 0 && cells[directionIdx]) {
        direction = parseDirectionValue(cells[directionIdx], direction);
      }
      if (categoryIdx >= 0 && cells[categoryIdx]) {
        expenseCategoryHint = parseExpenseCategoryHint(cells[categoryIdx]);
      }
      if (ksefRefIdx >= 0 && cells[ksefRefIdx]) {
        ksefReferenceNumber = cells[ksefRefIdx]!.trim() || undefined;
      }
    } else if (rowDocNo !== documentNumber || normalizedNip !== counterpartyNip) {
      throw new AccountingWorkspaceError(
        422,
        'multiple_documents_in_single_csv_import',
        `Pojedynczy import dokumentu CSV może zawierać wiele pozycji wyłącznie dla jednej faktury ("${documentNumber}"), wykryto niespójny wiersz dla "${rowDocNo}".`,
      );
    }

    const netGrosze = parseDecimalPlnToGroszeStrict(rowNetRaw, `CSV[${rowIndex}].netto`);
    const vatGrosze = parseDecimalPlnToGroszeStrict(rowVatRaw, `CSV[${rowIndex}].vat`);
    const grossGrosze = parseDecimalPlnToGroszeStrict(rowGrossRaw, `CSV[${rowIndex}].brutto`);

    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Niezgodność kwot w wierszu CSV nr ${rowIndex + 1}: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
      );
    }

    const rawVatRateCell = vatRateIdx >= 0 ? (cells[vatRateIdx] ?? '').trim() : '';
    const vatRate: VatRateCodeContract = rawVatRateCell
      ? normalizeVatRateCode(rawVatRateCell)
      : inferExactVatRateFromAmounts(netGrosze, vatGrosze);

    const expectedVatGrosze = multiplyGroszeByBps(netGrosze, vatRateToBps(vatRate), 'half_up');
    if (Math.abs(vatGrosze - expectedVatGrosze) > 1) {
      throw new AccountingWorkspaceError(
        422,
        'document_vat_rate_amount_mismatch',
        `Wiersz CSV nr ${rowIndex + 1}: kwota VAT (${formatPlnFromGrosze(vatGrosze)} PLN) nie zgadza się ze stawką ${vatRate}% od kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN.`,
      );
    }

    const description =
      (descriptionIdx >= 0 ? (cells[descriptionIdx] ?? '').trim() : '') ||
      `Pozycja ${rowIndex} dokumentu ${documentNumber}`;
    const quantity = (quantityIdx >= 0 ? (cells[quantityIdx] ?? '').trim() : '') || '1';
    const unit = (unitIdx >= 0 ? (cells[unitIdx] ?? '').trim() : '') || 'szt.';

    lines.push({
      lineNumber: rowIndex,
      description,
      quantity,
      unit,
      netGrosze,
      vatRate,
      vatGrosze,
      grossGrosze,
      annex15Item: false,
    });
  }

  const totalNetGrosze = lines.reduce((sum, l) => sum + l.netGrosze, 0);
  const totalVatGrosze = lines.reduce((sum, l) => sum + l.vatGrosze, 0);
  const totalGrossGrosze = lines.reduce((sum, l) => sum + l.grossGrosze, 0);

  return {
    sourceFormat: 'csv',
    documentNumber,
    direction,
    issueDate,
    saleDate,
    ...(dueDate ? { dueDate } : {}),
    counterpartyName,
    counterpartyNip,
    ...(ksefReferenceNumber ? { ksefReferenceNumber, ksefMarker: 'NrKSeF' as const } : {}),
    lines,
    totalNetGrosze,
    totalVatGrosze,
    totalGrossGrosze,
    ...(expenseCategoryHint ? { expenseCategoryHint } : {}),
  };
}

export function parseSafeDocumentJson(
  rawJson: string,
  options?: {
    readonly fallbackDirection?: 'sales' | 'purchase';
  },
): ParsedDocumentImportResult {
  assertPayloadSizeWithinLimit(rawJson);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_json',
      'Przekazany ładunek JSON (rawPayload) zawiera błąd składniowy i nie może zostać sparsowany.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_json',
      'Ładunek JSON dokumentu musi być obiektem JSON.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const documentNumberRaw = obj['documentNumber'] ?? obj['invoiceNumber'] ?? obj['numerFaktury'];
  if (typeof documentNumberRaw !== 'string' || documentNumberRaw.trim().length === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_json_document_number',
      'Obiekt JSON dokumentu musi zawierać niepuste pole "documentNumber" (lub "invoiceNumber").',
    );
  }
  const documentNumber = documentNumberRaw.trim();

  const issueDateRaw = obj['issueDate'] ?? obj['dataWystawienia'];
  if (typeof issueDateRaw !== 'string' || !isRealIsoCalendarDate(issueDateRaw.trim())) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_date',
      'Obiekt JSON dokumentu musi zawierać prawidłową datę "issueDate" w formacie RRRR-MM-DD.',
    );
  }
  const issueDate = issueDateRaw.trim();

  const saleDateRaw = obj['saleDate'] ?? obj['eventDate'] ?? obj['dataSprzedazy'];
  if (
    saleDateRaw !== undefined &&
    (typeof saleDateRaw !== 'string' || !isRealIsoCalendarDate(saleDateRaw.trim()))
  ) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_date',
      'Pole "saleDate" w JSON zawiera nieprawidłową datę kalendarzową RRRR-MM-DD.',
    );
  }
  const saleDate = typeof saleDateRaw === 'string' ? saleDateRaw.trim() : issueDate;

  const dueDateRaw = obj['dueDate'] ?? obj['terminPlatnosci'];
  if (
    dueDateRaw !== undefined &&
    (typeof dueDateRaw !== 'string' || !isRealIsoCalendarDate(dueDateRaw.trim()))
  ) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_date',
      'Pole "dueDate" w JSON zawiera nieprawidłową datę kalendarzową RRRR-MM-DD.',
    );
  }
  const dueDate = typeof dueDateRaw === 'string' ? dueDateRaw.trim() : undefined;
  if (dueDate !== undefined && dueDate < issueDate) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_due_date',
      'Termin płatności (dueDate) w JSON nie może być wcześniejszy niż data wystawienia (issueDate).',
    );
  }

  const counterpartyNameRaw = obj['counterpartyName'] ?? obj['kontrahent'];
  if (typeof counterpartyNameRaw !== 'string' || counterpartyNameRaw.trim().length === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_json_counterparty_name',
      'Obiekt JSON dokumentu musi zawierać niepuste pole "counterpartyName".',
    );
  }
  const counterpartyName = counterpartyNameRaw.trim();

  const counterpartyNipRaw = obj['counterpartyNip'] ?? obj['nip'];
  if (typeof counterpartyNipRaw !== 'string' || counterpartyNipRaw.trim().length === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_json_counterparty_nip',
      'Obiekt JSON dokumentu musi zawierać pole "counterpartyNip".',
    );
  }
  const counterpartyNip = normalizePolishNipDigits(counterpartyNipRaw);
  if (!validatePolishNipChecksum(counterpartyNip)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_counterparty_nip',
      `Nieprawidłowy NIP kontrahenta w JSON ("${counterpartyNipRaw}") — błędna suma kontrolna modulo 11.`,
    );
  }

  const direction = parseDirectionValue(
    typeof obj['direction'] === 'string' ? obj['direction'] : undefined,
    options?.fallbackDirection ?? 'purchase',
  );

  const expenseCategoryHint = parseExpenseCategoryHint(
    typeof obj['expenseCategory'] === 'string' ? obj['expenseCategory'] : undefined,
  );

  const ksefReferenceNumber =
    typeof obj['ksefReferenceNumber'] === 'string' && obj['ksefReferenceNumber'].trim().length > 0
      ? obj['ksefReferenceNumber'].trim()
      : undefined;

  const parseJsonMoneyField = (
    record: Record<string, unknown>,
    plnKey: string,
    groszeKey: string,
    label: string,
  ): number | undefined => {
    const groszeVal = record[groszeKey];
    if (typeof groszeVal === 'number') {
      if (!Number.isSafeInteger(groszeVal) || groszeVal < 0) {
        throw new AccountingWorkspaceError(
          422,
          'invalid_document_amount',
          `Pole "${groszeKey}" musi być nieujemną liczbą całkowitą groszy.`,
        );
      }
      return groszeVal;
    }
    const plnVal = record[plnKey];
    if (typeof plnVal === 'string') {
      return parseDecimalPlnToGroszeStrict(plnVal, label);
    }
    if (typeof plnVal === 'number' && Number.isFinite(plnVal) && plnVal >= 0) {
      return parseDecimalPlnToGroszeStrict(plnVal.toFixed(2), label);
    }
    return undefined;
  };

  const linesRaw = obj['lines'];
  const lines: DocumentLineItemContract[] = [];

  if (Array.isArray(linesRaw) && linesRaw.length > 0) {
    for (let i = 0; i < linesRaw.length; i += 1) {
      const item = linesRaw[i];
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new AccountingWorkspaceError(
          422,
          'invalid_json_line_item',
          `Pozycja lines[${i}] w JSON musi być obiektem.`,
        );
      }
      const lineObj = item as Record<string, unknown>;
      const description =
        typeof lineObj['description'] === 'string' && lineObj['description'].trim().length > 0
          ? lineObj['description'].trim()
          : '';
      if (!description) {
        throw new AccountingWorkspaceError(
          422,
          'invalid_json_line_item',
          `Pozycja lines[${i}] w JSON musi zawierać niepuste pole "description".`,
        );
      }

      const netGrosze = parseJsonMoneyField(
        lineObj,
        'netAmountPln',
        'netGrosze',
        `lines[${i}].net`,
      );
      const vatGrosze = parseJsonMoneyField(
        lineObj,
        'vatAmountPln',
        'vatGrosze',
        `lines[${i}].vat`,
      );
      const grossGrosze = parseJsonMoneyField(
        lineObj,
        'grossAmountPln',
        'grossGrosze',
        `lines[${i}].gross`,
      );

      if (netGrosze === undefined || vatGrosze === undefined || grossGrosze === undefined) {
        throw new AccountingWorkspaceError(
          422,
          'missing_json_line_amounts',
          `Pozycja lines[${i}] w JSON musi zawierać kwoty netto, VAT i brutto.`,
        );
      }
      if (netGrosze + vatGrosze !== grossGrosze) {
        throw new AccountingWorkspaceError(
          422,
          'document_amount_mismatch',
          `Niezgodność kwot w pozycji lines[${i}]: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
        );
      }

      const rawVatRate =
        typeof lineObj['vatRate'] === 'string'
          ? lineObj['vatRate']
          : typeof lineObj['vatRate'] === 'number'
            ? String(lineObj['vatRate'])
            : '';
      const vatRate = rawVatRate
        ? normalizeVatRateCode(rawVatRate)
        : inferExactVatRateFromAmounts(netGrosze, vatGrosze);

      const expectedVat = multiplyGroszeByBps(netGrosze, vatRateToBps(vatRate), 'half_up');
      if (Math.abs(vatGrosze - expectedVat) > 1) {
        throw new AccountingWorkspaceError(
          422,
          'document_vat_rate_amount_mismatch',
          `Pozycja lines[${i}]: kwota VAT (${formatPlnFromGrosze(vatGrosze)} PLN) nie zgadza się ze stawką ${vatRate}% od kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN.`,
        );
      }

      lines.push({
        lineNumber: i + 1,
        description,
        quantity: typeof lineObj['quantity'] === 'string' ? lineObj['quantity'].trim() || '1' : '1',
        unit: typeof lineObj['unit'] === 'string' ? lineObj['unit'].trim() || 'szt.' : 'szt.',
        netGrosze,
        vatRate,
        vatGrosze,
        grossGrosze,
        annex15Item: lineObj['annex15Item'] === true,
      });
    }
  } else {
    const netGrosze =
      parseJsonMoneyField(obj, 'netAmountPln', 'totalNetGrosze', 'netAmountPln') ??
      parseJsonMoneyField(obj, 'netPln', 'netGrosze', 'netGrosze');
    if (netGrosze === undefined) {
      throw new AccountingWorkspaceError(
        422,
        'missing_json_document_amounts',
        'Obiekt JSON dokumentu musi zawierać tablicę "lines" albo pola kwotowe "netAmountPln", "vatAmountPln" i "grossAmountPln".',
      );
    }
    const rawVatRate =
      typeof obj['vatRate'] === 'string'
        ? obj['vatRate']
        : typeof obj['vatRate'] === 'number'
          ? String(obj['vatRate'])
          : '';
    const explicitVatGrosze =
      parseJsonMoneyField(obj, 'vatAmountPln', 'totalVatGrosze', 'vatAmountPln') ??
      parseJsonMoneyField(obj, 'vatPln', 'vatGrosze', 'vatGrosze');
    const explicitGrossGrosze =
      parseJsonMoneyField(obj, 'grossAmountPln', 'totalGrossGrosze', 'grossAmountPln') ??
      parseJsonMoneyField(obj, 'grossPln', 'grossGrosze', 'grossGrosze');

    let vatRate: VatRateCodeContract;
    let vatGrosze: number;
    if (rawVatRate) {
      vatRate = normalizeVatRateCode(rawVatRate);
      const expectedVat = multiplyGroszeByBps(netGrosze, vatRateToBps(vatRate), 'half_up');
      vatGrosze = explicitVatGrosze ?? expectedVat;
      if (Math.abs(vatGrosze - expectedVat) > 1) {
        throw new AccountingWorkspaceError(
          422,
          'document_vat_rate_amount_mismatch',
          `Kwota VAT (${formatPlnFromGrosze(vatGrosze)} PLN) w JSON nie zgadza się ze stawką ${vatRate}% od kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN.`,
        );
      }
    } else if (explicitVatGrosze !== undefined) {
      vatGrosze = explicitVatGrosze;
      vatRate = inferExactVatRateFromAmounts(netGrosze, vatGrosze);
    } else {
      throw new AccountingWorkspaceError(
        422,
        'missing_json_document_amounts',
        'Obiekt JSON dokumentu musi zawierać kwotę VAT ("vatAmountPln") lub stawkę VAT ("vatRate").',
      );
    }

    const grossGrosze = explicitGrossGrosze ?? netGrosze + vatGrosze;
    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Niezgodność kwot w JSON: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
      );
    }
    const description =
      typeof obj['description'] === 'string' && obj['description'].trim().length > 0
        ? obj['description'].trim()
        : `Pozycja dokumentu ${documentNumber}`;

    lines.push({
      lineNumber: 1,
      description,
      quantity: '1',
      unit: 'szt.',
      netGrosze,
      vatRate,
      vatGrosze,
      grossGrosze,
      annex15Item: obj['annex15Item'] === true,
    });
  }

  const totalNetGrosze = lines.reduce((sum, l) => sum + l.netGrosze, 0);
  const totalVatGrosze = lines.reduce((sum, l) => sum + l.vatGrosze, 0);
  const totalGrossGrosze = lines.reduce((sum, l) => sum + l.grossGrosze, 0);

  const declaredTotalGross = parseJsonMoneyField(
    obj,
    'grossAmountPln',
    'totalGrossGrosze',
    'grossAmountPln',
  );
  if (declaredTotalGross !== undefined && declaredTotalGross !== totalGrossGrosze) {
    throw new AccountingWorkspaceError(
      422,
      'document_amount_mismatch',
      `Suma brutto pozycji (${formatPlnFromGrosze(totalGrossGrosze)} PLN) nie zgadza się ze zadeklarowaną kwotą brutto dokumentu (${formatPlnFromGrosze(declaredTotalGross)} PLN).`,
    );
  }

  return {
    sourceFormat: 'json',
    documentNumber,
    direction,
    issueDate,
    saleDate,
    ...(dueDate ? { dueDate } : {}),
    counterpartyName,
    counterpartyNip,
    ...(ksefReferenceNumber ? { ksefReferenceNumber, ksefMarker: 'NrKSeF' as const } : {}),
    lines,
    totalNetGrosze,
    totalVatGrosze,
    totalGrossGrosze,
    ...(expenseCategoryHint ? { expenseCategoryHint } : {}),
  };
}
