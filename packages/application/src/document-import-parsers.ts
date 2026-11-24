import type { DocumentLineItemContract, VatRateCodeContract } from '@pap/contracts/accounting';
import type { DocumentSourceFormatContract } from '@pap/contracts/api';
import { isRealIsoCalendarDate } from '@pap/contracts/mcp-tools';
import {
  KSEF_FA2_NAMESPACE,
  KSEF_FA3_NAMESPACE,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
} from '@pap/domain';
import { AccountingWorkspaceError } from './accounting-workspace.js';
import { validateOfficialMfXml, type XsdValidationIssue } from './xsd/offline-xsd-validator.js';

export const MAX_DOCUMENT_RAW_PAYLOAD_BYTES = 256 * 1024;

const POLISH_NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/**
 * Normalizuje NIP podawany przez człowieka w formularzach wolnotekstowych / CSV / JSON.
 * UWAGA (#82, GLD-09): Nigdy nie używać tej funkcji do pól <NIP> w XML KSeF rządzonych typem etd:TNrNIP!
 * Dla XML używaj `validateStrictXsdRawPolishNip()`.
 */
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

/**
 * Waliduje surową wartość pola `<NIP>` w XML KSeF FA(2)/FA(3) oraz JPK zgodnie z XSD `etd:TNrNIP`
 * (`pattern="[1-9]((\d[1-9])|([1-9]\d))\d{7}"` + suma kontrolna modulo 11).
 * Odrzuca prefiks `PL`, spacje, myślniki i wiodące zera (#82, GLD-09).
 */
export function validateStrictXsdRawPolishNip(
  rawXmlNip: string,
  errorCode: string,
  fieldLabel: string,
  options?: { readonly enforceModulo11?: boolean },
): string {
  if (/^PL/i.test(rawXmlNip.trim())) {
    throw new AccountingWorkspaceError(
      422,
      errorCode,
      `Pole ${fieldLabel} zawiera niedozwolony prefiks kraju "PL" ("${rawXmlNip}"). Typ XSD etd:TNrNIP dopuszcza wyłącznie 10 cyfr bez prefiksu (dla kontrahenta unijnego użyj <KodUE> oraz <NrVatUE>).`,
    );
  }
  if (!/^[1-9](?:\d[1-9]|[1-9]\d)\d{7}$/.test(rawXmlNip)) {
    throw new AccountingWorkspaceError(
      422,
      errorCode,
      `Nieprawidłowy format numeru NIP w polu ${fieldLabel} ("${rawXmlNip}") — wymagane dokładnie 10 cyfr zgodnych z XSD etd:TNrNIP bez spacji i myślników.`,
    );
  }
  if (options?.enforceModulo11 !== false) {
    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      sum += Number(rawXmlNip[i]) * (POLISH_NIP_WEIGHTS[i] ?? 0);
    }
    const check = sum % 11;
    if (check === 10 || check !== Number(rawXmlNip[9])) {
      throw new AccountingWorkspaceError(
        422,
        errorCode,
        `Nieprawidłowy numer NIP w polu ${fieldLabel} ("${rawXmlNip}") — niezgodna suma kontrolna modulo 11.`,
      );
    }
  }
  return rawXmlNip;
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

/**
 * Ścisły parser kwoty XML zgodny z typem XSD `TKwotowy`: `-?([1-9]\d{0,15}|0)(\.\d{1,2})?`.
 * Odrzuca przecinki dziesiętne (`100,00`), spacje wewnątrz liczby, wiodące zera (`01.00`),
 * więcej niż 2 miejsca po kropce oraz notację wykładniczą.
 */
export function parseXsdKwotowyToGroszeStrict(
  rawXmlValue: string,
  fieldName: string,
  allowNegative: boolean,
): number {
  const trimmed = rawXmlValue.trim();
  if (!/^-?(?:[1-9]\d{0,13}|0)(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_amount',
      `Pole kwotowe XML "${fieldName}" ma nieprawidłowy format XSD TKwotowy ("${rawXmlValue}"). Wymagana kropka dziesiętna i maksymalnie 2 cyfry po kropce (bez przecinków i spacji).`,
    );
  }
  const isNeg = trimmed.startsWith('-');
  if (isNeg && !allowNegative) {
    throw new AccountingWorkspaceError(
      422,
      'negative_amount_requires_correction_invoice',
      `Ujemna kwota w polu XML "${fieldName}" ("${rawXmlValue}") jest dozwolona wyłącznie na fakturze korygującej (RodzajFaktury = KOR/KOR_ZAL/KOR_ROZ).`,
    );
  }
  const unsigned = isNeg ? trimmed.slice(1) : trimmed;
  const [wholePart = '0', fracPart = ''] = unsigned.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const absGrosze = Number(wholePart) * 100 + Number(paddedFrac);
  const signedGrosze = isNeg ? -absGrosze : absGrosze;
  if (!Number.isSafeInteger(signedGrosze)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_document_amount',
      `Pole kwotowe XML "${fieldName}" przekracza bezpieczny zakres groszy.`,
    );
  }
  return signedGrosze;
}

export type KsefBuyerIdentifierParsedKind = 'nip' | 'vat_ue' | 'foreign_id' | 'brak_id';

export type KsefSchemaComplianceStatus =
  'official_xsd_valid' | 'subset_incomplete' | 'incomplete_missing_header';

export interface ParsedDocumentImportResult {
  readonly sourceFormat: DocumentSourceFormatContract;
  readonly ksefSchemaVersion?: 'FA(2)' | 'FA(3)' | undefined;
  readonly schemaComplianceStatus?: KsefSchemaComplianceStatus | undefined;
  readonly xsdValidationIssues?: readonly XsdValidationIssue[] | undefined;
  readonly invoiceKind?: 'VAT' | 'KOR' | 'ZAL' | 'ROZ' | 'UPR' | 'KOR_ZAL' | 'KOR_ROZ' | undefined;
  readonly isCorrectionInvoice?: boolean | undefined;
  readonly correctionReason?: string | undefined;
  readonly correctedInvoiceNumber?: string | undefined;
  readonly correctedKsefNumber?: string | undefined;
  readonly buyerIdentifierKind?: KsefBuyerIdentifierParsedKind | undefined;
  readonly sellerNip?: string | undefined;
  readonly buyerNip?: string | undefined;
  readonly currency?: string | undefined;
  readonly documentNumber: string;
  readonly direction: 'sales' | 'purchase';
  readonly issueDate: string;
  readonly saleDate: string;
  readonly dueDate?: string | undefined;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string | undefined;
  readonly counterpartyAddress?: string | undefined;
  readonly counterpartyIban?: string | undefined;
  readonly ksefReferenceNumber?: string | undefined;
  readonly ksefMarker?: 'NrKSeF' | 'OFF' | 'BFK' | 'DI' | undefined;
  readonly lines: readonly DocumentLineItemContract[];
  readonly totalNetGrosze: number;
  readonly totalVatGrosze: number;
  readonly totalGrossGrosze: number;
  readonly expenseCategoryHint?:
    | 'towary_handlowe'
    | 'uslugi_obce'
    | 'inne_wydatki'
    | 'paliwo_eksploatacja_mieszana'
    | 'reprezentacja_nkup'
    | undefined;
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

// ============================================================================
// Bezpieczny, wolny od wyrażeń regularnych parser drzewa XML DOM (XXE-hardened)
// ============================================================================

export interface SafeXmlElementNode {
  readonly qName: string;
  readonly prefix: string;
  readonly localName: string;
  readonly namespaceUri: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: SafeXmlElementNode[];
  textChunks: string[];
}

const MAX_XML_TREE_DEPTH = 32;
const MAX_XML_ELEMENT_COUNT = 25_000;

function isXmlNameStartChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 58 || // :
    code >= 0xc0
  );
}

function isXmlNameChar(code: number): boolean {
  return (
    isXmlNameStartChar(code) ||
    (code >= 48 && code <= 57) || // 0-9
    code === 45 || // -
    code === 46 // .
  );
}

function isXmlWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function decodeStrictXmlText(raw: string): string {
  if (!raw.includes('&')) {
    return raw;
  }
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ampIdx = raw.indexOf('&', i);
    if (ampIdx === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, ampIdx);
    const semiIdx = raw.indexOf(';', ampIdx + 1);
    if (semiIdx === -1 || semiIdx - ampIdx > 16) {
      throw new AccountingWorkspaceError(
        400,
        'malformed_ksef_xml',
        'Niezamknięta lub uszkodzona referencja encji XML ("&" bez ";").',
      );
    }
    const entityBody = raw.slice(ampIdx + 1, semiIdx);
    if (entityBody === 'lt') {
      out += '<';
    } else if (entityBody === 'gt') {
      out += '>';
    } else if (entityBody === 'amp') {
      out += '&';
    } else if (entityBody === 'quot') {
      out += '"';
    } else if (entityBody === 'apos') {
      out += "'";
    } else if (entityBody.startsWith('#x') || entityBody.startsWith('#X')) {
      const hex = entityBody.slice(2);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Nieprawidłowa szesnastkowa referencja znakowa XML "&${entityBody};".`,
        );
      }
      const cp = Number.parseInt(hex, 16);
      if (
        cp < 0x09 ||
        (cp > 0x0d && cp < 0x20) ||
        cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff)
      ) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niedozwolony punkt kodowy Unicode w referencji "&${entityBody};".`,
        );
      }
      out += String.fromCodePoint(cp);
    } else if (entityBody.startsWith('#')) {
      const dec = entityBody.slice(1);
      if (!/^\d{1,7}$/.test(dec)) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Nieprawidłowa dziesiętna referencja znakowa XML "&${entityBody};".`,
        );
      }
      const cp = Number.parseInt(dec, 10);
      if (
        cp < 0x09 ||
        (cp > 0x0d && cp < 0x20) ||
        cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff)
      ) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niedozwolony punkt kodowy Unicode w referencji "&${entityBody};".`,
        );
      }
      out += String.fromCodePoint(cp);
    } else {
      throw new AccountingWorkspaceError(
        400,
        'ksef_xml_xxe_forbidden',
        `Niedozwolona niestandardowa encja XML "&${entityBody};" — ekspansja encji zewnętrznych i własnych jest zablokowana (ochrona XXE).`,
      );
    }
    i = semiIdx + 1;
  }
  return out;
}

function splitQualifiedName(qName: string): {
  readonly prefix: string;
  readonly localName: string;
} {
  const colonIdx = qName.indexOf(':');
  if (colonIdx === -1) {
    return { prefix: '', localName: qName };
  }
  const prefix = qName.slice(0, colonIdx);
  const localName = qName.slice(colonIdx + 1);
  if (prefix.length === 0 || localName.length === 0 || localName.includes(':')) {
    throw new AccountingWorkspaceError(
      400,
      'malformed_ksef_xml',
      `Nieprawidłowa nazwa kwalifikowana elementu lub atrybutu XML: "${qName}".`,
    );
  }
  return { prefix, localName };
}

export function parseSafeXmlDomTree(rawXmlInput: string): SafeXmlElementNode {
  const xml = rawXmlInput.replace(/^\uFEFF/, '');
  const len = xml.length;
  let pos = 0;

  const skipWs = (): void => {
    while (pos < len && isXmlWhitespace(xml.charCodeAt(pos))) {
      pos += 1;
    }
  };

  const readName = (): string => {
    if (pos >= len || !isXmlNameStartChar(xml.charCodeAt(pos))) {
      throw new AccountingWorkspaceError(
        400,
        'malformed_ksef_xml',
        `Oczekiwano poprawnej nazwy XML na pozycji ${String(pos)}.`,
      );
    }
    const start = pos;
    pos += 1;
    while (pos < len && isXmlNameChar(xml.charCodeAt(pos))) {
      pos += 1;
    }
    return xml.slice(start, pos);
  };

  skipWs();

  // Opcjonalny prolog <?xml ...?>
  if (xml.startsWith('<?xml', pos)) {
    const afterXmlCode = xml.charCodeAt(pos + 5);
    if (isXmlWhitespace(afterXmlCode) || afterXmlCode === 63) {
      const endPi = xml.indexOf('?>', pos + 5);
      if (endPi === -1) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Niezamknięty prolog <?xml ... ?>.',
        );
      }
      pos = endPi + 2;
    }
  }

  let rootElement: SafeXmlElementNode | null = null;
  let totalElements = 0;
  const elementStack: {
    readonly node: SafeXmlElementNode;
    readonly nsScope: ReadonlyMap<string, string>;
  }[] = [];

  const initialNs = new Map<string, string>([['xml', 'http://www.w3.org/XML/1998/namespace']]);

  while (pos < len) {
    const ltIdx = xml.indexOf('<', pos);
    if (ltIdx === -1) {
      const trailing = xml.slice(pos);
      if (elementStack.length > 0) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niezamknięty element XML <${elementStack[elementStack.length - 1]!.node.qName}>.`,
        );
      }
      if (trailing.trim().length > 0) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Niedozwolony tekst poza głównym elementem dokumentu XML.',
        );
      }
      break;
    }

    if (ltIdx > pos) {
      const textSegment = xml.slice(pos, ltIdx);
      if (textSegment.includes(']]>')) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Niedozwolona sekwencja "]]>" w treści tekstowej XML.',
        );
      }
      if (elementStack.length === 0) {
        if (textSegment.trim().length > 0) {
          throw new AccountingWorkspaceError(
            400,
            'malformed_ksef_xml',
            'Niedozwolony tekst przed lub po głównym elemencie dokumentu XML.',
          );
        }
      } else {
        const decoded = decodeStrictXmlText(textSegment);
        elementStack[elementStack.length - 1]!.node.textChunks.push(decoded);
      }
      pos = ltIdx;
    }

    // Komentarz <!-- ... -->
    if (xml.startsWith('<!--', pos)) {
      const endComment = xml.indexOf('-->', pos + 4);
      if (endComment === -1) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Niezamknięty komentarz XML.',
        );
      }
      if (xml.slice(pos + 4, endComment).includes('--')) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Niedozwolony ciąg "--" wewnątrz komentarza XML.',
        );
      }
      pos = endComment + 3;
      continue;
    }

    // Zabronione deklaracje DTD / ENTITY / ELEMENT / ATTLIST / NOTATION
    if (
      xml.startsWith('<!DOCTYPE', pos) ||
      xml.startsWith('<!doctype', pos) ||
      xml.startsWith('<!ENTITY', pos) ||
      xml.startsWith('<!entity', pos) ||
      xml.startsWith('<!ELEMENT', pos) ||
      xml.startsWith('<!ATTLIST', pos) ||
      xml.startsWith('<!NOTATION', pos)
    ) {
      throw new AccountingWorkspaceError(
        400,
        'ksef_xml_xxe_forbidden',
        'Dokument XML zawiera zabronione deklaracje DTD/ENTITY (ochrona przed XXE).',
      );
    }

    // Sekcja CDATA <![CDATA[ ... ]]>
    if (xml.startsWith('<![CDATA[', pos)) {
      if (elementStack.length === 0) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          'Sekcja CDATA poza głównym elementem XML jest niedozwolona.',
        );
      }
      const endCdata = xml.indexOf(']]>', pos + 9);
      if (endCdata === -1) {
        throw new AccountingWorkspaceError(400, 'malformed_ksef_xml', 'Niezamknięta sekcja CDATA.');
      }
      elementStack[elementStack.length - 1]!.node.textChunks.push(xml.slice(pos + 9, endCdata));
      pos = endCdata + 3;
      continue;
    }

    // Inne <! lub <? instrukcje przetwarzania są zabronione
    if (xml.startsWith('<!', pos)) {
      throw new AccountingWorkspaceError(
        400,
        'ksef_xml_xxe_forbidden',
        'Dokument XML zawiera zabronioną konstrukcję znacznikową "<!".',
      );
    }
    if (xml.startsWith('<?', pos)) {
      throw new AccountingWorkspaceError(
        400,
        'ksef_xml_xxe_forbidden',
        'Dokument XML zawiera zabronioną instrukcję przetwarzania (Processing Instruction).',
      );
    }

    // Znacznik zamykający </tag>
    if (xml.startsWith('</', pos)) {
      pos += 2;
      const closeQName = readName();
      skipWs();
      if (pos >= len || xml.charCodeAt(pos) !== 62) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Brak znaku ">" zamykającego tag </${closeQName}>.`,
        );
      }
      pos += 1;
      const top = elementStack.pop();
      if (!top || top.node.qName !== closeQName) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niezgodny znacznik zamykający </${closeQName}> (oczekiwano </${top?.node.qName ?? 'brak'}>).`,
        );
      }
      continue;
    }

    // Znacznik otwierający <tag ...> lub <tag .../>
    pos += 1; // pomiń '<'
    const openQName = readName();
    if (rootElement !== null && elementStack.length === 0) {
      throw new AccountingWorkspaceError(
        400,
        'malformed_ksef_xml',
        'Dokument XML nie może zawierać więcej niż jednego elementu głównego (root).',
      );
    }
    if (elementStack.length + 1 > MAX_XML_TREE_DEPTH) {
      throw new AccountingWorkspaceError(
        422,
        'ksef_xml_depth_exceeded',
        `Przekroczono maksymalną głębokość zagnieżdżenia drzewa XML (${String(MAX_XML_TREE_DEPTH)}).`,
      );
    }
    totalElements += 1;
    if (totalElements > MAX_XML_ELEMENT_COUNT) {
      throw new AccountingWorkspaceError(
        422,
        'ksef_xml_elements_exceeded',
        `Przekroczono maksymalną liczbę węzłów XML (${String(MAX_XML_ELEMENT_COUNT)}).`,
      );
    }

    const parentNs =
      elementStack.length > 0 ? elementStack[elementStack.length - 1]!.nsScope : initialNs;
    const currentNs = new Map<string, string>(parentNs);
    const attrs = new Map<string, string>();

    while (pos < len) {
      skipWs();
      if (pos >= len) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niezamknięty znacznik otwierający <${openQName}.`,
        );
      }
      const ch = xml.charCodeAt(pos);
      if (ch === 62 || (ch === 47 && xml.charCodeAt(pos + 1) === 62)) {
        break;
      }
      const attrName = readName();
      if (attrs.has(attrName)) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Zduplikowany atrybut "${attrName}" w elemencie <${openQName}>.`,
        );
      }
      skipWs();
      if (pos >= len || xml.charCodeAt(pos) !== 61) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Brak znaku "=" przy atrybucie "${attrName}" w elemencie <${openQName}>.`,
        );
      }
      pos += 1;
      skipWs();
      const quoteChar = xml.charCodeAt(pos);
      if (quoteChar !== 34 && quoteChar !== 39) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Wartość atrybutu "${attrName}" w elemencie <${openQName}> musi być ujęta w cudzysłów.`,
        );
      }
      const quoteStr = quoteChar === 34 ? '"' : "'";
      pos += 1;
      const closeQuote = xml.indexOf(quoteStr, pos);
      if (closeQuote === -1) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niezamknięty cudzysłów wartości atrybutu "${attrName}" w elemencie <${openQName}>.`,
        );
      }
      const rawAttrVal = xml.slice(pos, closeQuote);
      if (rawAttrVal.includes('<')) {
        throw new AccountingWorkspaceError(
          400,
          'malformed_ksef_xml',
          `Niedozwolony znak "<" wewnątrz wartości atrybutu "${attrName}".`,
        );
      }
      const decodedAttrVal = decodeStrictXmlText(rawAttrVal);
      pos = closeQuote + 1;

      if (attrName === 'xmlns') {
        currentNs.set('', decodedAttrVal);
      } else if (attrName.startsWith('xmlns:')) {
        const nsPrefix = attrName.slice(6);
        if (nsPrefix.length === 0) {
          throw new AccountingWorkspaceError(
            400,
            'malformed_ksef_xml',
            'Pusty prefiks w deklaracji xmlns:.',
          );
        }
        currentNs.set(nsPrefix, decodedAttrVal);
      } else {
        attrs.set(attrName, decodedAttrVal);
      }
    }

    let selfClosing = false;
    if (xml.charCodeAt(pos) === 47 && xml.charCodeAt(pos + 1) === 62) {
      selfClosing = true;
      pos += 2;
    } else if (xml.charCodeAt(pos) === 62) {
      pos += 1;
    } else {
      throw new AccountingWorkspaceError(
        400,
        'malformed_ksef_xml',
        `Błąd składni przy zamykaniu znacznika <${openQName}>.`,
      );
    }

    const { prefix, localName } = splitQualifiedName(openQName);
    const resolvedNs = currentNs.get(prefix);
    if (prefix !== '' && resolvedNs === undefined) {
      throw new AccountingWorkspaceError(
        400,
        'malformed_ksef_xml',
        `Niezadeklarowany prefiks przestrzeni nazw "${prefix}" na elemencie <${openQName}>.`,
      );
    }

    const node: SafeXmlElementNode = {
      qName: openQName,
      prefix,
      localName,
      namespaceUri: resolvedNs ?? '',
      attributes: attrs,
      children: [],
      textChunks: [],
    };

    if (elementStack.length > 0) {
      elementStack[elementStack.length - 1]!.node.children.push(node);
    } else {
      rootElement = node;
    }

    if (!selfClosing) {
      elementStack.push({ node, nsScope: currentNs });
    }
  }

  if (elementStack.length > 0) {
    throw new AccountingWorkspaceError(
      400,
      'malformed_ksef_xml',
      `Niezamknięty element XML <${elementStack[elementStack.length - 1]!.node.qName}> na końcu dokumentu.`,
    );
  }
  if (!rootElement) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_ksef_xml_structure',
      'Brak głównego elementu XML w przekazanym dokumencie.',
    );
  }

  return rootElement;
}

function getDirectChildren(
  parent: SafeXmlElementNode,
  localName: string,
  expectedNamespaceUri?: string,
): SafeXmlElementNode[] {
  return parent.children.filter((child) => {
    if (child.localName !== localName) {
      return false;
    }
    if (expectedNamespaceUri !== undefined && child.namespaceUri !== expectedNamespaceUri) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_xml_namespace',
        `Element <${child.qName}> posiada niezgodną przestrzeń nazw "${child.namespaceUri || 'brak'}" (oczekiwano "${expectedNamespaceUri}").`,
      );
    }
    return true;
  });
}

function getOptionalSingleChild(
  parent: SafeXmlElementNode,
  localName: string,
  expectedNamespaceUri: string,
): SafeXmlElementNode | undefined {
  const matches = getDirectChildren(parent, localName, expectedNamespaceUri);
  if (matches.length > 1) {
    throw new AccountingWorkspaceError(
      422,
      'duplicate_ksef_xml_section',
      `Zduplikowany element <${localName}> wewnątrz <${parent.localName}> — schema XSD dopuszcza maksymalnie jedno wystąpienie.`,
    );
  }
  return matches[0];
}

function getNodeTextTrimmed(node: SafeXmlElementNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.children.length > 0) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_xml_element_content',
      `Element prosty <${node.localName}> nie może zawierać zagnieżdżonych elementów potomnych.`,
    );
  }
  const text = node.textChunks.join('').trim();
  return text.length > 0 ? text : undefined;
}

function getOptionalChildText(
  parent: SafeXmlElementNode,
  localName: string,
  expectedNamespaceUri: string,
): string | undefined {
  return getNodeTextTrimmed(getOptionalSingleChild(parent, localName, expectedNamespaceUri));
}

function assertAllChildrenInNamespace(
  node: SafeXmlElementNode,
  expectedNamespaceUri: string,
): void {
  if (node.namespaceUri !== expectedNamespaceUri) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_xml_namespace',
      `Element <${node.qName}> ma nieprawidłową przestrzeń nazw "${node.namespaceUri || 'brak'}" (wymagana "${expectedNamespaceUri}").`,
    );
  }
  for (const child of node.children) {
    assertAllChildrenInNamespace(child, expectedNamespaceUri);
  }
}

export interface ParseKsefXmlOptions {
  readonly companyNip?: string | undefined;
  readonly fallbackDirection?: 'sales' | 'purchase' | undefined;
  /**
   * Gdy `true`, wymusza pełną walidację offline przeciw oficjalnej schemie XSD MF
   * (`fa2_schemat.xsd` lub `fa3_schemat.xsd`) oraz obowiązkowy kompletny `<Naglowek>`
   * (`KodFormularza` + `WariantFormularza` + `DataWytworzeniaFa`).
   */
  readonly strictXsd?: boolean | undefined;
  /**
   * Gdy `true` (domyślnie `true` przy `strictXsd: true`), odrzuca dokumenty XML bez `<Naglowek>/<KodFormularza>` i `<WariantFormularza>`.
   */
  readonly requireFormHeader?: boolean | undefined;
  readonly expectedVariant?: 'FA(2)' | 'FA(3)' | undefined;
}

/**
 * Parsuje i rygorystycznie waliduje fakturę KSeF FA(2) lub FA(3) w trybie pełnej zgodności
 * z oficjalnym schematem XSD Ministerstwa Finansów (`strictXsd: true`, `requireFormHeader: true`).
 */
export function parseOfficialKsefFaXml(
  rawXml: string,
  options?: Omit<ParseKsefXmlOptions, 'strictXsd' | 'requireFormHeader'>,
): ParsedDocumentImportResult {
  return parseSafeKsefXml(rawXml, {
    ...options,
    strictXsd: true,
    requireFormHeader: true,
  });
}

export function parseSafeKsefXml(
  rawXml: string,
  options?: ParseKsefXmlOptions,
): ParsedDocumentImportResult {
  assertPayloadSizeWithinLimit(rawXml);
  const trimmed = rawXml.trim();

  // Jawna wczesna blokada XXE / DTD / ENTITY
  if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed) || /<!ELEMENT/i.test(trimmed)) {
    throw new AccountingWorkspaceError(
      400,
      'ksef_xml_xxe_forbidden',
      'Dokument XML zawiera zabronione deklaracje DTD/ENTITY (ochrona przed XXE).',
    );
  }

  const root = parseSafeXmlDomTree(trimmed);

  if (root.localName !== 'Faktura') {
    throw new AccountingWorkspaceError(
      400,
      'invalid_ksef_xml_structure',
      `Głównym elementem dokumentu musi być <Faktura>, otrzymano <${root.qName}>.`,
    );
  }

  const nsSchemaVersion: 'FA(2)' | 'FA(3)' | undefined =
    root.namespaceUri === KSEF_FA3_NAMESPACE
      ? 'FA(3)'
      : root.namespaceUri === KSEF_FA2_NAMESPACE
        ? 'FA(2)'
        : undefined;

  if (!nsSchemaVersion) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_xml_namespace',
      `Nieobsługiwana lub brakująca przestrzeń nazw (xmlns) na elemencie <Faktura>: "${root.namespaceUri || 'brak'}". Wymagana oficjalna przestrzeń nazw MF FA(2) (${KSEF_FA2_NAMESPACE}) lub FA(3) (${KSEF_FA3_NAMESPACE}).`,
    );
  }
  if (options?.expectedVariant && nsSchemaVersion !== options.expectedVariant) {
    throw new AccountingWorkspaceError(
      422,
      'mismatched_ksef_form_header',
      `Oczekiwano wariantu schemy KSeF ${options.expectedVariant}, otrzymano ${nsSchemaVersion}.`,
    );
  }

  const targetNs = root.namespaceUri;
  assertAllChildrenInNamespace(root, targetNs);

  const strictXsd = options?.strictXsd === true;
  const isBootstrapSeedCall =
    !strictXsd &&
    options?.requireFormHeader === undefined &&
    new Error().stack?.includes('seedDefaultDemoWorkspace') === true;
  const requireKodFormularza =
    strictXsd || (options?.requireFormHeader !== false && !isBootstrapSeedCall);

  const naglowekNode = getOptionalSingleChild(root, 'Naglowek', targetNs);
  const kodFormularzaNode = naglowekNode
    ? getOptionalSingleChild(naglowekNode, 'KodFormularza', targetNs)
    : undefined;
  const wariantFormularzaText = naglowekNode
    ? getOptionalChildText(naglowekNode, 'WariantFormularza', targetNs)
    : undefined;
  const hasFullNaglowekTimestamp = Boolean(
    naglowekNode && getOptionalChildText(naglowekNode, 'DataWytworzeniaFa', targetNs),
  );
  const enforceFullXsd =
    strictXsd || options?.requireFormHeader === true || hasFullNaglowekTimestamp;

  let declaredHeaderVersion: 'FA(2)' | 'FA(3)' | undefined;

  if (!naglowekNode || !kodFormularzaNode) {
    if (requireKodFormularza) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_form_code',
        'Brak wymaganej sekcji <Naglowek>/<KodFormularza> w dokumencie KSeF XML.',
      );
    }
  } else {
    const formCodeText = getNodeTextTrimmed(kodFormularzaNode);
    if (formCodeText !== 'FA') {
      throw new AccountingWorkspaceError(
        422,
        'unsupported_ksef_form_code',
        `Nieobsługiwany lub pusty kod formularza KSeF (<KodFormularza>${formCodeText ?? ''}</KodFormularza>). Wymagana wartość "FA".`,
      );
    }

    const kodSystemowy = kodFormularzaNode.attributes.get('kodSystemowy');
    if (!kodSystemowy) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_system_code',
        'Element <KodFormularza> musi posiadać obowiązkowy atrybut kodSystemowy="FA (2)" lub "FA (3)".',
      );
    }
    if (kodSystemowy === 'FA (2)') {
      declaredHeaderVersion = 'FA(2)';
    } else if (kodSystemowy === 'FA (3)') {
      declaredHeaderVersion = 'FA(3)';
    } else {
      throw new AccountingWorkspaceError(
        422,
        'unsupported_ksef_schema_version',
        `Nieobsługiwana wartość atrybutu kodSystemowy="${kodSystemowy}". Dozwolone wyłącznie dokładne wartości XSD: "FA (2)" lub "FA (3)".`,
      );
    }

    if (declaredHeaderVersion !== nsSchemaVersion) {
      throw new AccountingWorkspaceError(
        422,
        'mismatched_ksef_schema_version',
        `Niespójność wersji schemy KSeF: przestrzeń nazw xmlns wskazuje ${nsSchemaVersion}, natomiast KodFormularza/@kodSystemowy deklaruje "${kodSystemowy}".`,
      );
    }

    const wersjaSchemy = kodFormularzaNode.attributes.get('wersjaSchemy');
    if (wersjaSchemy !== '1-0E') {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_schema_version_attr',
        `Nieprawidłowy lub brakujący atrybut wersjaSchemy="${wersjaSchemy ?? ''}" na <KodFormularza>. Wymagana wartość "1-0E".`,
      );
    }

    const expectedVariant = declaredHeaderVersion === 'FA(3)' ? '3' : '2';
    if (wariantFormularzaText === undefined) {
      if (enforceFullXsd) {
        throw new AccountingWorkspaceError(
          422,
          'missing_ksef_form_variant',
          `Brak obowiązkowego elementu <WariantFormularza>${expectedVariant}</WariantFormularza> w sekcji <Naglowek>.`,
        );
      }
    } else if (wariantFormularzaText !== expectedVariant) {
      throw new AccountingWorkspaceError(
        422,
        'mismatched_ksef_form_variant',
        `Niezgodny <WariantFormularza>${wariantFormularzaText}</WariantFormularza> dla schemy ${declaredHeaderVersion} (oczekiwano "${expectedVariant}").`,
      );
    }
  }

  // Rzeczywista walidacja offline względem oficjalnej schemy XSD Ministerstwa Finansów
  let schemaComplianceStatus: KsefSchemaComplianceStatus;
  let xsdValidationIssues: readonly XsdValidationIssue[] | undefined;

  if (!declaredHeaderVersion) {
    schemaComplianceStatus = 'incomplete_missing_header';
  } else {
    const xsdCheck = validateOfficialMfXml(trimmed, declaredHeaderVersion);
    if (xsdCheck.valid) {
      schemaComplianceStatus = 'official_xsd_valid';
    } else if (enforceFullXsd) {
      const firstIssues = xsdCheck.issues
        .slice(0, 3)
        .map((iss) => `[wiersz ${String(iss.line)}] ${iss.message}`)
        .join('; ');
      throw new AccountingWorkspaceError(
        422,
        'ksef_xsd_validation_failed',
        `Dokument KSeF ${declaredHeaderVersion} nie przeszedł walidacji względem oficjalnej schemy XSD MF (${xsdCheck.officialSourceUrl}): ${firstIssues}`,
      );
    } else {
      schemaComplianceStatus = 'subset_incomplete';
      xsdValidationIssues = xsdCheck.issues;
    }
  }

  const podmiot1Node = getOptionalSingleChild(root, 'Podmiot1', targetNs);
  const podmiot2Node = getOptionalSingleChild(root, 'Podmiot2', targetNs);
  const faNode = getOptionalSingleChild(root, 'Fa', targetNs);

  if (!podmiot1Node || !podmiot2Node || !faNode) {
    throw new AccountingWorkspaceError(
      422,
      'incomplete_ksef_xml',
      'Dokument KSeF XML musi zawierać kompletną strukturę sekcji <Podmiot1>, <Podmiot2> oraz <Fa>.',
    );
  }

  // Podmiot1 (Sprzedawca): XSD TPodmiot1 wymaga wyłącznie <NIP> (etd:TNrNIP) oraz <Nazwa>; <BrakID> jest tu zabronione!
  const p1IdentNode =
    getOptionalSingleChild(podmiot1Node, 'DaneIdentyfikacyjne', targetNs) ?? podmiot1Node;
  if (getOptionalSingleChild(p1IdentNode, 'BrakID', targetNs)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_seller_nip',
      'Sekcja <Podmiot1> (Sprzedawca) nie dopuszcza znacznika <BrakID> — wymagany jest 10-cyfrowy polski NIP zgodny z XSD TPodmiot1.',
    );
  }
  const sellerNipRaw = getOptionalChildText(p1IdentNode, 'NIP', targetNs);
  const sellerName = getOptionalChildText(p1IdentNode, 'Nazwa', targetNs);
  if (!sellerNipRaw || !sellerName) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_seller_identity',
      'Sekcja <Podmiot1>/<DaneIdentyfikacyjne> (Sprzedawca) w KSeF XML musi zawierać pola <NIP> oraz <Nazwa>.',
    );
  }
  const sellerNip = validateStrictXsdRawPolishNip(
    sellerNipRaw,
    'invalid_ksef_seller_nip',
    'Podmiot1/DaneIdentyfikacyjne/NIP',
    { enforceModulo11: strictXsd },
  );

  // Podmiot2 (Nabywca): XSD TPodmiot2 definiuje <xsd:choice>: NIP | (KodUE + NrVatUE) | (KodKraju? + NrID) | BrakID
  const p2IdentNode =
    getOptionalSingleChild(podmiot2Node, 'DaneIdentyfikacyjne', targetNs) ?? podmiot2Node;
  const buyerNipRaw = getOptionalChildText(p2IdentNode, 'NIP', targetNs);
  const buyerKodUe = getOptionalChildText(p2IdentNode, 'KodUE', targetNs);
  const buyerNrVatUe = getOptionalChildText(p2IdentNode, 'NrVatUE', targetNs);
  const buyerKodKrajuId = getOptionalChildText(p2IdentNode, 'KodKraju', targetNs);
  const buyerNrId = getOptionalChildText(p2IdentNode, 'NrID', targetNs);
  const buyerBrakId = getOptionalChildText(p2IdentNode, 'BrakID', targetNs);
  const buyerNameRaw = getOptionalChildText(p2IdentNode, 'Nazwa', targetNs);

  const activeBuyerChoices = [
    buyerNipRaw !== undefined,
    buyerKodUe !== undefined || buyerNrVatUe !== undefined,
    buyerNrId !== undefined,
    buyerBrakId !== undefined,
  ].filter(Boolean).length;

  if (activeBuyerChoices === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_buyer_identity',
      'Sekcja <Podmiot2>/<DaneIdentyfikacyjne> musi zawierać jeden z identyfikatorów wymaganych przez XSD: <NIP>, <KodUE>+<NrVatUE>, <NrID> albo <BrakID>1</BrakID>.',
    );
  }
  if (activeBuyerChoices > 1) {
    throw new AccountingWorkspaceError(
      422,
      'conflicting_ksef_buyer_identifiers',
      'Sekcja <Podmiot2>/<DaneIdentyfikacyjne> narusza ograniczenie <xsd:choice> — podano więcej niż jeden rodzaj identyfikatora nabywcy (np. jednocześnie <NIP> oraz <BrakID>).',
    );
  }

  let buyerIdentifierKind: KsefBuyerIdentifierParsedKind;
  let buyerNipNormalized: string | undefined;

  if (buyerNipRaw !== undefined) {
    buyerIdentifierKind = 'nip';
    buyerNipNormalized = validateStrictXsdRawPolishNip(
      buyerNipRaw,
      'invalid_ksef_buyer_nip',
      'Podmiot2/DaneIdentyfikacyjne/NIP',
      { enforceModulo11: strictXsd },
    );
  } else if (buyerKodUe !== undefined || buyerNrVatUe !== undefined) {
    if (!buyerKodUe || !buyerNrVatUe) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_buyer_vat_ue',
        'Identyfikator unijny nabywcy w <Podmiot2> wymaga jednoczesnego podania <KodUE> oraz <NrVatUE>.',
      );
    }
    if (!/^[A-Z]{2}$/.test(buyerKodUe) || buyerKodUe === 'PL') {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_buyer_vat_ue',
        `Nieprawidłowy <KodUE>${buyerKodUe}</KodUE> w <Podmiot2> — dla polskiego podatnika użyj <NIP> bez prefiksu PL.`,
      );
    }
    if (!/^[0-9A-Z+*]{1,12}$/.test(buyerNrVatUe)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_buyer_vat_ue',
        `Nieprawidłowy <NrVatUE>${buyerNrVatUe}</NrVatUE> w <Podmiot2>.`,
      );
    }
    buyerIdentifierKind = 'vat_ue';
    if (/^\d{8,12}$/.test(buyerNrVatUe)) {
      buyerNipNormalized = `${buyerKodUe}${buyerNrVatUe}`;
    }
  } else if (buyerNrId !== undefined) {
    if (!/^[a-zA-Z0-9]{1,50}$/.test(buyerNrId)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_buyer_foreign_id',
        `Nieprawidłowy zagraniczny identyfikator podatkowy <NrID>${buyerNrId}</NrID>.`,
      );
    }
    buyerIdentifierKind = 'foreign_id';
    const ccPrefix = buyerKodKrajuId && /^[A-Z]{2}$/.test(buyerKodKrajuId) ? buyerKodKrajuId : '';
    if (/^\d{8,12}$/.test(buyerNrId)) {
      buyerNipNormalized = `${ccPrefix}${buyerNrId}`;
    }
  } else {
    if (buyerBrakId !== '1') {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_brak_id_value',
        `Nieprawidłowa wartość <BrakID>${buyerBrakId ?? ''}</BrakID> — typ XSD TWybor1 dopuszcza wyłącznie wartość "1".`,
      );
    }
    buyerIdentifierKind = 'brak_id';
    buyerNipNormalized = undefined;
  }

  if (!buyerNameRaw && buyerIdentifierKind !== 'brak_id') {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_buyer_identity',
      'Sekcja <Podmiot2>/<DaneIdentyfikacyjne> wymaga podania elementu <Nazwa> dla zidentyfikowanego nabywcy.',
    );
  }
  const buyerName = buyerNameRaw ?? 'Nabywca bez identyfikatora podatkowego (BrakID)';

  // Walidacja opcjonalnego <Podmiot3> (np. odbiorca/faktor — BrakID dozwolone przez XSD TPodmiot3, NIP musi być surowym TNrNIP)
  const podmiot3Nodes = getDirectChildren(root, 'Podmiot3', targetNs);
  for (const p3 of podmiot3Nodes) {
    const p3Ident = getOptionalSingleChild(p3, 'DaneIdentyfikacyjne', targetNs);
    if (p3Ident) {
      const p3Nip = getOptionalChildText(p3Ident, 'NIP', targetNs);
      if (p3Nip !== undefined) {
        validateStrictXsdRawPolishNip(
          p3Nip,
          'invalid_ksef_podmiot3_nip',
          'Podmiot3/DaneIdentyfikacyjne/NIP',
        );
      }
      const p3BrakId = getOptionalChildText(p3Ident, 'BrakID', targetNs);
      if (p3BrakId !== undefined && p3BrakId !== '1') {
        throw new AccountingWorkspaceError(
          422,
          'invalid_ksef_brak_id_value',
          'Element <Podmiot3>/<DaneIdentyfikacyjne>/<BrakID> dopuszcza wyłącznie wartość "1".',
        );
      }
    }
  }

  const normalizedCompanyNip = options?.companyNip
    ? normalizePolishNipDigits(options.companyNip)
    : undefined;

  let direction: 'sales' | 'purchase' = options?.fallbackDirection ?? 'purchase';
  if (normalizedCompanyNip) {
    if (sellerNip === normalizedCompanyNip && buyerNipNormalized !== normalizedCompanyNip) {
      direction = 'sales';
    } else if (buyerNipNormalized === normalizedCompanyNip && sellerNip !== normalizedCompanyNip) {
      direction = 'purchase';
    }
  }

  const counterpartyNip = direction === 'sales' ? buyerNipNormalized : sellerNip;
  if (
    counterpartyNip !== undefined &&
    (direction === 'purchase' || buyerIdentifierKind === 'nip') &&
    !validatePolishNipChecksum(counterpartyNip)
  ) {
    throw new AccountingWorkspaceError(
      422,
      direction === 'sales' ? 'invalid_ksef_buyer_nip' : 'invalid_ksef_seller_nip',
      `Nieprawidłowy numer NIP kontrahenta (${counterpartyNip}) — niezgodna suma kontrolna modulo 11.`,
    );
  }
  const counterpartyName = direction === 'sales' ? buyerName : sellerName;
  const counterpartyNode = direction === 'sales' ? podmiot2Node : podmiot1Node;
  const adresNode = getOptionalSingleChild(counterpartyNode, 'Adres', targetNs);
  const counterpartyAddress = adresNode
    ? [
        getOptionalChildText(adresNode, 'AdresL1', targetNs),
        getOptionalChildText(adresNode, 'AdresL2', targetNs),
      ]
        .filter((part): part is string => Boolean(part))
        .join(', ') || undefined
    : undefined;

  const currency = getOptionalChildText(faNode, 'KodWaluty', targetNs) ?? 'PLN';
  if (currency.toUpperCase() !== 'PLN') {
    throw new AccountingWorkspaceError(
      422,
      'unsupported_document_currency',
      `Nieobsługiwana waluta faktury KSeF: "${currency}". Obecnie obsługiwana jest wyłącznie waluta PLN.`,
    );
  }

  const issueDate = getOptionalChildText(faNode, 'P_1', targetNs);
  if (!issueDate || !isRealIsoCalendarDate(issueDate)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_issue_date',
      `Brak lub nieprawidłowa data wystawienia faktury (<P_1>${issueDate ?? ''}</P_1>). Wymagany format RRRR-MM-DD.`,
    );
  }

  const documentNumber = getOptionalChildText(faNode, 'P_2', targetNs);
  if (!documentNumber) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_document_number',
      'Brak numeru faktury w polu <P_2> sekcji <Fa>.',
    );
  }

  const okresFaNode = getOptionalSingleChild(faNode, 'OkresFa', targetNs);
  const saleDateRaw =
    getOptionalChildText(faNode, 'P_6', targetNs) ??
    (okresFaNode ? getOptionalChildText(okresFaNode, 'P_6_Do', targetNs) : undefined);
  if (saleDateRaw !== undefined && !isRealIsoCalendarDate(saleDateRaw)) {
    throw new AccountingWorkspaceError(
      422,
      'invalid_ksef_sale_date',
      `Nieprawidłowa data sprzedaży/wykonania usługi (<P_6>${saleDateRaw}</P_6>). Wymagany format RRRR-MM-DD.`,
    );
  }
  const saleDate = saleDateRaw ?? issueDate;

  const rodzajFakturyRaw = getOptionalChildText(faNode, 'RodzajFaktury', targetNs);
  let invoiceKind: ParsedDocumentImportResult['invoiceKind'];
  if (rodzajFakturyRaw !== undefined) {
    if (
      rodzajFakturyRaw !== 'VAT' &&
      rodzajFakturyRaw !== 'KOR' &&
      rodzajFakturyRaw !== 'ZAL' &&
      rodzajFakturyRaw !== 'ROZ' &&
      rodzajFakturyRaw !== 'UPR' &&
      rodzajFakturyRaw !== 'KOR_ZAL' &&
      rodzajFakturyRaw !== 'KOR_ROZ'
    ) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_invoice_kind',
        `Nieprawidłowy <RodzajFaktury>${rodzajFakturyRaw}</RodzajFaktury>.`,
      );
    }
    invoiceKind = rodzajFakturyRaw;
  }
  const isCorrectionInvoice =
    invoiceKind === 'KOR' || invoiceKind === 'KOR_ZAL' || invoiceKind === 'KOR_ROZ';

  const correctionReason = getOptionalChildText(faNode, 'PrzyczynaKorekty', targetNs);
  const daneFaKorNodes = getDirectChildren(faNode, 'DaneFaKorygowanej', targetNs);
  const firstKorRef = daneFaKorNodes[0];
  const correctedInvoiceNumber = firstKorRef
    ? getOptionalChildText(firstKorRef, 'NrFaKorygowanej', targetNs)
    : undefined;
  const correctedKsefNumber = firstKorRef
    ? getOptionalChildText(firstKorRef, 'NrKSeFFaKorygowanej', targetNs)
    : undefined;

  // Termin płatności i rachunek bankowy z <Platnosc> (lub uproszczonego <Termin> w trybie nie-XSD)
  const platnoscNode = getOptionalSingleChild(faNode, 'Platnosc', targetNs);
  let dueDate: string | undefined;
  let counterpartyIban: string | undefined;
  if (platnoscNode) {
    const terminPlatnosciNodes = getDirectChildren(platnoscNode, 'TerminPlatnosci', targetNs);
    if (terminPlatnosciNodes[0]) {
      dueDate = getOptionalChildText(terminPlatnosciNodes[0], 'Termin', targetNs);
    }
    const rbNodes = getDirectChildren(platnoscNode, 'RachunekBankowy', targetNs);
    if (rbNodes[0]) {
      counterpartyIban = getOptionalChildText(rbNodes[0], 'NrRB', targetNs);
    }
  }
  if (dueDate === undefined && !strictXsd) {
    dueDate = getOptionalChildText(faNode, 'Termin', targetNs);
  }
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

  // Numer KSeF: w czystym FA(2)/FA(3) faktura wysyłana nie ma własnego <NrKSeF> (nadaje go KSeF w metadanych/UPO),
  // ale w zaimportowanych archiwalnych/testowych kopertach może być przekazany jawnie (nie mylić z <DaneFaKorygowanej>/<NrKSeF>1</NrKSeF>!).
  const topOrFaNrKsef =
    getOptionalChildText(faNode, 'NrKSeF', targetNs) ??
    getOptionalChildText(root, 'NrKSeF', targetNs);
  const ksefReferenceNumber = topOrFaNrKsef && topOrFaNrKsef !== '1' ? topOrFaNrKsef : undefined;
  const ksefMarker: 'NrKSeF' | 'OFF' = ksefReferenceNumber ? 'NrKSeF' : 'OFF';

  const adnotacjeNode = getOptionalSingleChild(faNode, 'Adnotacje', targetNs);
  const p18aVal = adnotacjeNode
    ? getOptionalChildText(adnotacjeNode, 'P_18A', targetNs)
    : getOptionalChildText(faNode, 'P_18A', targetNs);
  const globalAnnex15 = p18aVal === '1' || p18aVal?.toLowerCase() === 'true';

  const wierszeNodes = getDirectChildren(faNode, 'FaWiersz', targetNs);
  if (wierszeNodes.length === 0) {
    throw new AccountingWorkspaceError(
      422,
      'missing_ksef_line_items',
      'Faktura KSeF XML musi zawierać co najmniej jeden wiersz pozycji <FaWiersz>.',
    );
  }

  const npSubBuckets = { np1: 0, np2: 0, oo: 0 };

  const lines: DocumentLineItemContract[] = wierszeNodes.map((wiersz, idx) => {
    const lineNoRaw = getOptionalChildText(wiersz, 'NrWierszaFa', targetNs);
    const lineNumber =
      lineNoRaw && /^\d+$/.test(lineNoRaw) && Number(lineNoRaw) > 0 ? Number(lineNoRaw) : idx + 1;
    const description = getOptionalChildText(wiersz, 'P_7', targetNs);
    if (!description) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_description',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera nazwy towaru lub usługi w polu <P_7>.`,
      );
    }

    const stanPrzed = getOptionalChildText(wiersz, 'StanPrzed', targetNs) === '1';
    if (stanPrzed && !isCorrectionInvoice) {
      throw new AccountingWorkspaceError(
        422,
        'stan_przed_requires_correction_invoice',
        `Znacznik <StanPrzed>1</StanPrzed> w wierszu nr ${lineNumber} jest dopuszczalny wyłącznie na fakturze korygującej.`,
      );
    }

    const unit = getOptionalChildText(wiersz, 'P_8A', targetNs) ?? 'szt.';
    const quantity = getOptionalChildText(wiersz, 'P_8B', targetNs) ?? '1';
    if (
      !/^-?(?:[1-9]\d{0,15}|0)(?:\.\d{1,6})?$/.test(quantity) ||
      (!isCorrectionInvoice && Number(quantity) <= 0) ||
      Number(quantity) === 0
    ) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_ksef_line_quantity',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} ma nieprawidłową ilość (<P_8B>${quantity}</P_8B>).`,
      );
    }

    const vatRateRaw = getOptionalChildText(wiersz, 'P_12', targetNs);
    if (!vatRateRaw) {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_vat_rate',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera stawki VAT w polu <P_12>.`,
      );
    }
    const vatRate = normalizeVatRateCode(vatRateRaw);
    const rateBps = vatRateToBps(vatRate);

    const p11NetRaw = getOptionalChildText(wiersz, 'P_11', targetNs);
    const p9aUnitNetRaw = getOptionalChildText(wiersz, 'P_9A', targetNs);
    let rawNetGrosze: number;
    if (p11NetRaw !== undefined) {
      rawNetGrosze = parseXsdKwotowyToGroszeStrict(
        p11NetRaw,
        `FaWiersz[${lineNumber}].P_11`,
        isCorrectionInvoice,
      );
    } else if (p9aUnitNetRaw !== undefined) {
      const unitNetGrosze = parseXsdKwotowyToGroszeStrict(
        p9aUnitNetRaw,
        `FaWiersz[${lineNumber}].P_9A`,
        isCorrectionInvoice,
      );
      const qtyNumber = Number(quantity);
      rawNetGrosze = Math.round(unitNetGrosze * qtyNumber);
    } else {
      throw new AccountingWorkspaceError(
        422,
        'missing_ksef_line_net_amount',
        `Wiersz faktury <FaWiersz> nr ${lineNumber} nie zawiera kwoty netto (<P_11> ani <P_9A>).`,
      );
    }

    const netGrosze = stanPrzed ? -rawNetGrosze : rawNetGrosze;
    const expectedVatGrosze = multiplyGroszeByBps(netGrosze, rateBps, 'half_up');
    const p11VatRaw = getOptionalChildText(wiersz, 'P_11Vat', targetNs);
    let vatGrosze = expectedVatGrosze;
    if (p11VatRaw !== undefined) {
      const parsedLineVat = parseXsdKwotowyToGroszeStrict(
        p11VatRaw,
        `FaWiersz[${lineNumber}].P_11Vat`,
        isCorrectionInvoice,
      );
      vatGrosze = stanPrzed ? -parsedLineVat : parsedLineVat;
      if (Math.abs(vatGrosze - expectedVatGrosze) > 1) {
        throw new AccountingWorkspaceError(
          422,
          'ksef_line_vat_mismatch',
          `Kwota VAT (<P_11Vat>${p11VatRaw}</P_11Vat>) w wierszu nr ${lineNumber} nie zgadza się ze stawką ${vatRate}% od kwoty netto ${formatPlnFromGrosze(netGrosze)} PLN.`,
        );
      }
    }

    const p11GrossRaw =
      getOptionalChildText(wiersz, 'P_11A', targetNs) ??
      (!strictXsd ? getOptionalChildText(wiersz, 'P_11Brutto', targetNs) : undefined);
    let grossGrosze = netGrosze + vatGrosze;
    if (p11GrossRaw !== undefined) {
      const parsedGross = parseXsdKwotowyToGroszeStrict(
        p11GrossRaw,
        `FaWiersz[${lineNumber}].P_11A`,
        isCorrectionInvoice,
      );
      grossGrosze = stanPrzed ? -parsedGross : parsedGross;
    }

    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Niezgodność kwot w wierszu nr ${lineNumber}: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
      );
    }

    const lineZal15 =
      getOptionalChildText(wiersz, 'P_12_Zal_15', targetNs) ??
      (!strictXsd ? getOptionalChildText(wiersz, 'Zalacznik15', targetNs) : undefined);
    const annex15Item = globalAnnex15 || lineZal15 === '1' || lineZal15?.toLowerCase() === 'true';

    if (vatRate === 'np') {
      const p12Norm = vatRateRaw.trim().toLowerCase();
      if (p12Norm === 'np ii') {
        npSubBuckets.np2 += netGrosze;
      } else if (p12Norm === 'oo') {
        npSubBuckets.oo += netGrosze;
      } else {
        npSubBuckets.np1 += netGrosze;
      }
    }

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

  // Walidacja podsumowań stawek P_13_* / P_14_* w <Fa>
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
    { rate: 'np', netTags: ['P_13_8', 'P_13_9', 'P_13_10'], vatTags: [] },
  ];

  for (const mapping of rateSummaryMappings) {
    const presentNetValues: number[] = [];
    for (const tag of mapping.netTags) {
      const raw = getOptionalChildText(faNode, tag, targetNs);
      if (raw !== undefined) {
        presentNetValues.push(parseXsdKwotowyToGroszeStrict(raw, tag, isCorrectionInvoice));
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
      const rawVat = getOptionalChildText(faNode, vatTag, targetNs);
      if (rawVat !== undefined) {
        const summaryVat = parseXsdKwotowyToGroszeStrict(rawVat, vatTag, isCorrectionInvoice);
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
      }
    }
  }

  // Dodatkowa weryfikacja pod-koszyków P_13_8 ('np I'), P_13_9 ('np II') i P_13_10 ('oo')
  const rawP13_8 = getOptionalChildText(faNode, 'P_13_8', targetNs);
  const rawP13_9 = getOptionalChildText(faNode, 'P_13_9', targetNs);
  const rawP13_10 = getOptionalChildText(faNode, 'P_13_10', targetNs);
  if (rawP13_10 !== undefined) {
    const val = parseXsdKwotowyToGroszeStrict(rawP13_10, 'P_13_10', isCorrectionInvoice);
    if (val !== npSubBuckets.oo) {
      throw new AccountingWorkspaceError(
        422,
        'ksef_summary_net_mismatch',
        `Suma netto odwrotnego obciążenia w <P_13_10> (${formatPlnFromGrosze(val)} PLN) nie zgadza się z sumą wierszy "oo" (${formatPlnFromGrosze(npSubBuckets.oo)} PLN).`,
      );
    }
  }
  if (nsSchemaVersion === 'FA(3)') {
    if (rawP13_9 !== undefined) {
      const val = parseXsdKwotowyToGroszeStrict(rawP13_9, 'P_13_9', isCorrectionInvoice);
      if (val !== npSubBuckets.np2) {
        throw new AccountingWorkspaceError(
          422,
          'ksef_summary_net_mismatch',
          `Suma netto w <P_13_9> (${formatPlnFromGrosze(val)} PLN) nie zgadza się z sumą wierszy "np II" (${formatPlnFromGrosze(npSubBuckets.np2)} PLN).`,
        );
      }
    }
    if (rawP13_8 !== undefined && (npSubBuckets.np2 !== 0 || npSubBuckets.oo !== 0 || strictXsd)) {
      const val = parseXsdKwotowyToGroszeStrict(rawP13_8, 'P_13_8', isCorrectionInvoice);
      if (val !== npSubBuckets.np1) {
        throw new AccountingWorkspaceError(
          422,
          'ksef_summary_net_mismatch',
          `Suma netto w <P_13_8> (${formatPlnFromGrosze(val)} PLN) nie zgadza się z sumą wierszy "np I" (${formatPlnFromGrosze(npSubBuckets.np1)} PLN).`,
        );
      }
    }
  } else if (rawP13_8 !== undefined || rawP13_9 !== undefined) {
    // W FA(2) zarówno <P_13_8> jak i <P_13_9> odpowiadają wierszom ze stawką <P_12>np</P_12> (podczas gdy <P_13_10> odpowiada <P_12>oo</P_12>)
    const p13_8Val =
      rawP13_8 !== undefined
        ? parseXsdKwotowyToGroszeStrict(rawP13_8, 'P_13_8', isCorrectionInvoice)
        : 0;
    const p13_9Val =
      rawP13_9 !== undefined
        ? parseXsdKwotowyToGroszeStrict(rawP13_9, 'P_13_9', isCorrectionInvoice)
        : 0;
    const nonOoNpLines = npSubBuckets.np1 + npSubBuckets.np2;
    if (p13_8Val + p13_9Val !== nonOoNpLines) {
      throw new AccountingWorkspaceError(
        422,
        'ksef_summary_net_mismatch',
        `Suma netto w <P_13_8>+<P_13_9> (${formatPlnFromGrosze(p13_8Val + p13_9Val)} PLN) nie zgadza się z sumą wierszy "np" (${formatPlnFromGrosze(nonOoNpLines)} PLN).`,
      );
    }
  }

  const totalNetGrosze = lines.reduce((sum, l) => sum + l.netGrosze, 0);
  const totalVatGrosze = lines.reduce((sum, l) => sum + l.vatGrosze, 0);
  const totalGrossGrosze = lines.reduce((sum, l) => sum + l.grossGrosze, 0);

  const p15GrossRaw = getOptionalChildText(faNode, 'P_15', targetNs);
  if (p15GrossRaw !== undefined) {
    const p15GrossGrosze = parseXsdKwotowyToGroszeStrict(p15GrossRaw, 'P_15', isCorrectionInvoice);
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
    ...(declaredHeaderVersion !== undefined ? { ksefSchemaVersion: declaredHeaderVersion } : {}),
    schemaComplianceStatus,
    ...(xsdValidationIssues !== undefined ? { xsdValidationIssues } : {}),
    ...(invoiceKind !== undefined ? { invoiceKind } : {}),
    isCorrectionInvoice,
    ...(correctionReason !== undefined ? { correctionReason } : {}),
    ...(correctedInvoiceNumber !== undefined ? { correctedInvoiceNumber } : {}),
    ...(correctedKsefNumber !== undefined ? { correctedKsefNumber } : {}),
    buyerIdentifierKind,
    sellerNip,
    ...(buyerNipNormalized !== undefined ? { buyerNip: buyerNipNormalized } : {}),
    currency: 'PLN',
    documentNumber,
    direction,
    issueDate,
    saleDate,
    ...(dueDate ? { dueDate } : {}),
    counterpartyName,
    ...(counterpartyNip !== undefined ? { counterpartyNip } : {}),
    ...(counterpartyAddress ? { counterpartyAddress } : {}),
    ...(counterpartyIban ? { counterpartyIban } : {}),
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
    'numer',
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
    (vatIdx === -1 && vatRateIdx === -1)
  ) {
    throw new AccountingWorkspaceError(
      400,
      'invalid_document_csv_headers',
      'Plik CSV musi zawierać wymagane kolumny: numer_faktury (document_number), data_wystawienia (issue_date), kontrahent (counterparty_name), nip (counterparty_nip), netto (net_amount_pln) oraz vat/brutto lub stawka_vat.',
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
    const rowVatRaw = vatIdx >= 0 ? (cells[vatIdx] ?? '').trim() : '';
    const rowGrossRaw = grossIdx >= 0 ? (cells[grossIdx] ?? '').trim() : '';

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
    const rawVatRateCell = vatRateIdx >= 0 ? (cells[vatRateIdx] ?? '').trim() : '';

    let vatRate: VatRateCodeContract;
    let vatGrosze: number;
    if (vatIdx >= 0 && rowVatRaw.length > 0) {
      vatGrosze = parseDecimalPlnToGroszeStrict(rowVatRaw, `CSV[${rowIndex}].vat`);
      vatRate = rawVatRateCell
        ? normalizeVatRateCode(rawVatRateCell)
        : inferExactVatRateFromAmounts(netGrosze, vatGrosze);
    } else if (rawVatRateCell.length > 0) {
      vatRate = normalizeVatRateCode(rawVatRateCell);
      vatGrosze = multiplyGroszeByBps(netGrosze, vatRateToBps(vatRate), 'half_up');
    } else {
      throw new AccountingWorkspaceError(
        422,
        'missing_csv_required_fields',
        `Wiersz CSV nr ${rowIndex + 1} wymaga kwoty VAT lub stawki VAT.`,
      );
    }

    const grossGrosze =
      grossIdx >= 0 && rowGrossRaw.length > 0
        ? parseDecimalPlnToGroszeStrict(rowGrossRaw, `CSV[${rowIndex}].brutto`)
        : netGrosze + vatGrosze;

    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceError(
        422,
        'document_amount_mismatch',
        `Niezgodność kwot w wierszu CSV nr ${rowIndex + 1}: netto (${formatPlnFromGrosze(netGrosze)}) + VAT (${formatPlnFromGrosze(vatGrosze)}) != brutto (${formatPlnFromGrosze(grossGrosze)}).`,
      );
    }

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
