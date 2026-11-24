import { assertValidIsoCalendarDate } from '../legal-rules/index.js';
import {
  addGrosze,
  assertNonNegativeGrosze,
  formatPlnFromGrosze,
  parsePlnToGrosze,
  subtractGrosze,
  validatePolishIban,
  validatePolishNip,
} from '../money.js';

export interface BankStatementTransaction {
  readonly transactionId: string;
  readonly bookingDate: string;
  readonly valueDate?: string;
  readonly direction: 'credit' | 'debit';
  readonly amountGrosze: number;
  readonly amountFormatted: string;
  readonly currency: 'PLN';
  readonly counterpartyName: string;
  readonly counterpartyIban?: string;
  readonly counterpartyNip?: string;
  readonly title: string;
  readonly rawReference?: string;
}

export interface Mt940ParsedStatement {
  readonly statementReference?: string;
  readonly accountIdentification?: string;
  readonly openingBalanceGrosze?: number;
  readonly closingBalanceGrosze?: number;
  readonly transactions: readonly BankStatementTransaction[];
}

export interface ParsePolishBankCsvOptions {
  readonly delimiter?: ';' | ',' | undefined;
  readonly statementContext?: string | undefined;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Czysty, deterministyczny skrót SHA-256 (FIPS 180-4) działający identycznie w Node.js i przeglądarce
 * bez zależności od `node:crypto`.
 */
export function sha256HexPure(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLenHi = Math.floor(bytes.length / 0x20000000);
  const bitLenLo = (bytes.length << 3) >>> 0;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

function splitCsvLine(line: string, delimiter: ';' | ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch ?? '';
    }
  }
  if (inQuotes) {
    throw new Error(
      'Nieprawidłowy format CSV: niezamknięty cudzysłów w wierszu wyciągu bankowego.',
    );
  }
  fields.push(current.trim());
  return fields;
}

function buildBankTxContentSignature(params: {
  readonly bookingDate: string;
  readonly valueDate?: string | undefined;
  readonly direction: 'credit' | 'debit';
  readonly amountGrosze: number;
  readonly currency: string;
  readonly counterpartyIban?: string | undefined;
  readonly counterpartyName: string;
  readonly title: string;
}): string {
  return [
    params.bookingDate,
    params.valueDate ?? '',
    params.direction,
    String(params.amountGrosze),
    params.currency,
    params.counterpartyIban ?? '',
    params.counterpartyName.trim().toUpperCase().replace(/\s+/g, ' '),
    params.title.trim().replace(/\s+/g, ' '),
  ].join('|');
}

function extractNipFromText(text: string): string | undefined {
  const candidates = text.match(/\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b|\b\d{10}\b/g);
  if (!candidates) {
    return undefined;
  }
  for (const raw of candidates) {
    const check = validatePolishNip(raw);
    if (check.valid && check.normalizedNip !== undefined) {
      return check.normalizedNip;
    }
  }
  return undefined;
}

/**
 * Parsuje polski wyciąg bankowy CSV rozdzielany średnikiem `;` lub przecinkiem `,` (z obsługą RFC-4180 quoting
 * dla polskich kwot dziesiętnych np. `"123,45"`, z nagłówkiem lub układem kolumn:
 * `Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny`).
 */
export function parsePolishBankCsv(
  csvContent: string,
  options?: ParsePolishBankCsvOptions,
): readonly BankStatementTransaction[] {
  const delimiter: ';' | ',' = options?.delimiter ?? ';';
  const lines = csvContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const firstRow = splitCsvLine(lines[0]!, delimiter);
  const hasHeader =
    firstRow.some((cell) => /data|kwota|tytu|kontrahent/i.test(cell)) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(firstRow[0] ?? '');

  if (delimiter === ',' && firstRow.length < 6) {
    throw new Error(
      'Nieprawidłowy format wyciągu CSV rozdzielanego przecinkami (zbyt mało kolumn — sprawdź separator kolumn).',
    );
  }

  const headerMap = new Map<string, number>();
  if (hasHeader) {
    firstRow.forEach((col, idx) => {
      headerMap.set(col.toLowerCase(), idx);
    });
  }

  const findIndex = (patterns: readonly RegExp[], fallbackIndex: number): number => {
    if (!hasHeader) {
      return fallbackIndex;
    }
    for (const [colName, idx] of headerMap.entries()) {
      if (patterns.some((rx) => rx.test(colName))) {
        return idx;
      }
    }
    return fallbackIndex;
  };

  const bookingIdx = findIndex([/data.*ksi|booking|data operacji|^data$/i], 0);
  const valueIdx = findIndex([/data.*waluty|value/i], 1);
  const counterpartyIdx = findIndex([/kontrahent|nadawca|odbiorca|counterparty/i], 2);
  const ibanIdx = findIndex([/rachunek|iban|konto/i], 3);
  const titleIdx = findIndex([/tytu|opis|title/i], 4);
  const amountIdx = findIndex([/kwota|amount/i], 5);
  const currencyIdx = findIndex([/waluta|currency/i], 6);
  const refIdx = findIndex([/referenc|id/i], 7);

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const occurrenceCounts = new Map<string, number>();
  const explicitRefSignatures = new Map<string, string>();

  return dataLines.map((line, index) => {
    const cols = splitCsvLine(line, delimiter);
    if (delimiter === ',') {
      const expectedColCount = hasHeader ? firstRow.length : 8;
      if (cols.length !== expectedColCount) {
        throw new Error(
          `Niezgodna liczba kolumn CSV w wierszu ${String(index + 1)} (oczekiwano ${String(expectedColCount)}, otrzymano ${String(cols.length)}) — w trybie delimiter=',' kwoty z przecinkiem dziesiętnym (np. "123,45") oraz teksty zawierające przecinki muszą być ujęte w cudzysłów.`,
        );
      }
    }

    const bookingDate = assertValidIsoCalendarDate(
      cols[bookingIdx] ?? '',
      `csv[${String(index)}].bookingDate`,
    );
    const rawValueDate = cols[valueIdx] ?? '';
    const valueDate =
      rawValueDate.length > 0
        ? assertValidIsoCalendarDate(rawValueDate, `csv[${String(index)}].valueDate`)
        : undefined;

    const counterpartyName = (cols[counterpartyIdx] ?? '').trim() || 'Nieznany kontrahent';
    const rawIban = (cols[ibanIdx] ?? '').trim();
    const ibanValidation = rawIban.length > 0 ? validatePolishIban(rawIban) : undefined;
    const normalizedIban =
      ibanValidation?.valid === true ? ibanValidation.normalizedIban : undefined;

    const title = (cols[titleIdx] ?? '').trim() || 'Bez tytułu';
    const signedGrosze = parsePlnToGrosze(cols[amountIdx] ?? '');
    if (signedGrosze === 0) {
      throw new Error(`Transakcja CSV w wierszu ${String(index + 1)} ma zerową kwotę.`);
    }

    const currency = (cols[currencyIdx] ?? 'PLN').trim().toUpperCase() || 'PLN';
    if (currency !== 'PLN') {
      throw new Error(
        `Nieobsługiwana waluta wyciągu CSV w wierszu ${String(index + 1)}: "${currency}" (wymagane PLN).`,
      );
    }

    const direction: 'credit' | 'debit' = signedGrosze >= 0 ? 'credit' : 'debit';
    const amountGrosze = Math.abs(signedGrosze);
    const rawRef = (cols[refIdx] ?? '').trim();
    const detectedNip = extractNipFromText(`${title} ${counterpartyName}`);

    const contentSig = buildBankTxContentSignature({
      bookingDate,
      valueDate,
      direction,
      amountGrosze,
      currency,
      counterpartyIban: normalizedIban,
      counterpartyName,
      title,
    });

    let transactionId: string;
    if (rawRef.length > 0 && rawRef.toUpperCase() !== 'NONREF') {
      const prevSig = explicitRefSignatures.get(rawRef);
      if (prevSig !== undefined && prevSig !== contentSig) {
        throw new Error(
          `Kolizja identyfikatora referencyjnego transakcji CSV "${rawRef}" z różną zawartością wewnątrz jednego wyciągu.`,
        );
      }
      explicitRefSignatures.set(rawRef, contentSig);
      transactionId = rawRef;
    } else {
      const occ = (occurrenceCounts.get(contentSig) ?? 0) + 1;
      occurrenceCounts.set(contentSig, occ);
      const txHash = sha256HexPure(
        `pap-csv-tx:v1|${options?.statementContext ?? ''}|${contentSig}|occ=${String(occ)}`,
      ).slice(0, 24);
      transactionId = `csv-tx-${txHash}`;
    }

    return {
      transactionId,
      bookingDate,
      ...(valueDate !== undefined ? { valueDate } : {}),
      direction,
      amountGrosze,
      amountFormatted: formatPlnFromGrosze(amountGrosze),
      currency: 'PLN',
      counterpartyName,
      ...(normalizedIban !== undefined ? { counterpartyIban: normalizedIban } : {}),
      ...(detectedNip !== undefined ? { counterpartyNip: detectedNip } : {}),
      title,
      ...(rawRef.length > 0 ? { rawReference: rawRef } : {}),
    };
  });
}

function parseYyMmDdToIso(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) {
    throw new Error(`Nieprawidłowa data MT940 YYMMDD: "${yymmdd}"`);
  }
  const yy = Number(yymmdd.slice(0, 2));
  const year = 2000 + yy;
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return assertValidIsoCalendarDate(`${String(year)}-${mm}-${dd}`, 'mt940Date');
}

/**
 * Wyznacza pełną datę księgowania (`bookingDate`) dla pola `:61:YYMMDD[MMDD]` standardu MT940,
 * uwzględniając przełom roku kalendarzowego pomiędzy `valueDate` (`YYMMDD`) a `entryDate` (`MMDD`):
 * - `valueDate` w grudniu (`12`) + `entryDate` w styczniu (`01`) -> rok `valueYear + 1`
 * - `valueDate` w styczniu (`01`) + `entryDate` w grudniu (`12`) -> rok `valueYear - 1`.
 */
function resolveMt940EntryBookingDate(valueDateIso: string, entryMmDd: string): string {
  const valueYear = Number(valueDateIso.slice(0, 4));
  const valueMonth = Number(valueDateIso.slice(5, 7));
  const entryMonthStr = entryMmDd.slice(0, 2);
  const entryDayStr = entryMmDd.slice(2, 4);
  const entryMonth = Number(entryMonthStr);

  let bookingYear = valueYear;
  if (valueMonth === 12 && entryMonth === 1) {
    bookingYear = valueYear + 1;
  } else if (valueMonth === 1 && entryMonth === 12) {
    bookingYear = valueYear - 1;
  }

  return assertValidIsoCalendarDate(
    `${String(bookingYear).padStart(4, '0')}-${entryMonthStr}-${entryDayStr}`,
    'mt940BookingDate',
  );
}

function parseMt940BalanceTag(value: string): {
  readonly currency: string;
  readonly signedGrosze: number;
} {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Nieprawidłowy format pola salda MT940 (:60F:/:62F:): "${value}"`);
  }
  const mark = match[1]!;
  parseYyMmDdToIso(match[2]!);
  const currency = match[3]!;
  const amountStr = match[4]!;
  const absGrosze = parsePlnToGrosze(amountStr);
  return {
    currency,
    signedGrosze: mark === 'D' ? -absGrosze : absGrosze,
  };
}

function parseMt940Field86Details(raw86: string): {
  readonly title: string;
  readonly counterpartyName: string;
  readonly counterpartyIban?: string;
} {
  const joined = raw86.replace(/\r?\n/g, ' ').trim();

  if (joined.includes('~')) {
    const subfields = joined.split('~');
    const titleParts: string[] = [];
    const nameParts: string[] = [];
    let rawAccount = '';

    for (const part of subfields) {
      if (part.length < 2) {
        continue;
      }
      const code = part.slice(0, 2);
      const val = part.slice(2).trim();
      if (code >= '20' && code <= '29' && val.length > 0) {
        titleParts.push(val);
      } else if ((code === '32' || code === '33') && val.length > 0) {
        nameParts.push(val);
      } else if ((code === '38' || code === '31') && val.length > 0) {
        rawAccount += val;
      }
    }

    const ibanCheck = rawAccount.length > 0 ? validatePolishIban(rawAccount) : undefined;
    return {
      title: titleParts.join(' ').trim() || joined,
      counterpartyName: nameParts.join(' ').trim() || 'Kontrahent MT940',
      ...(ibanCheck?.valid === true && ibanCheck.normalizedIban !== undefined
        ? { counterpartyIban: ibanCheck.normalizedIban }
        : {}),
    };
  }

  const ibanMatch = joined.match(/\b(?:PL)?\d{26}\b/i);
  const ibanCheck = ibanMatch ? validatePolishIban(ibanMatch[0]) : undefined;

  return {
    title: joined || 'Operacja MT940',
    counterpartyName: 'Kontrahent MT940',
    ...(ibanCheck?.valid === true && ibanCheck.normalizedIban !== undefined
      ? { counterpartyIban: ibanCheck.normalizedIban }
      : {}),
  };
}

/**
 * Parsuje wyciąg bankowy w standardzie MT940 (pola `:20:`, `:25:`, `:60F:`, `:61:`, `:86:`, `:62F:`),
 * weryfikując uzgodnienie salda początkowego i końcowego, gdy oba pola występują.
 */
export function parseMt940Statement(mt940Content: string): Mt940ParsedStatement {
  const normalized = mt940Content.replace(/\r\n/g, '\n');
  const tagRegex = /^:(\d{2}[A-Z]?):(.*)$/gm;
  const blocks: { tag: string; value: string }[] = [];

  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let prevBlock: { tag: string; value: string } | undefined;

  while ((match = tagRegex.exec(normalized)) !== null) {
    if (prevBlock !== undefined) {
      const trailingLines = normalized.slice(lastIndex, match.index).trim();
      if (trailingLines.length > 0 && !trailingLines.startsWith('-}')) {
        prevBlock.value = `${prevBlock.value}\n${trailingLines}`;
      }
    }
    const block = { tag: match[1]!, value: match[2]!.trim() };
    blocks.push(block);
    prevBlock = block;
    lastIndex = match.index + match[0].length;
  }

  if (prevBlock !== undefined && lastIndex < normalized.length) {
    const rest = normalized
      .slice(lastIndex)
      .replace(/-\}\s*$/, '')
      .trim();
    if (rest.length > 0) {
      prevBlock.value = `${prevBlock.value}\n${rest}`;
    }
  }

  let statementReference: string | undefined;
  let accountIdentification: string | undefined;
  let openingBalanceGrosze: number | undefined;
  let closingBalanceGrosze: number | undefined;
  const transactions: BankStatementTransaction[] = [];
  const occurrenceCounts = new Map<string, number>();
  const explicitRefSignatures = new Map<string, string>();

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (block.tag === '20') {
      statementReference = block.value;
    } else if (block.tag === '25') {
      accountIdentification = block.value.replace(/\s+/g, '');
    } else if (block.tag === '60F' || block.tag === '60M') {
      const bal = parseMt940BalanceTag(block.value);
      if (bal.currency !== 'PLN') {
        throw new Error(`Wyciąg MT940 w nieobsługiwanej walucie "${bal.currency}" (wymagane PLN).`);
      }
      openingBalanceGrosze = bal.signedGrosze;
    } else if (block.tag === '62F' || block.tag === '62M') {
      const bal = parseMt940BalanceTag(block.value);
      closingBalanceGrosze = bal.signedGrosze;
    } else if (block.tag === '61') {
      const line61 = block.value.split('\n')[0]!.trim();
      const txMatch =
        /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([A-Z][A-Z0-9]{3})([^\n/]*)(?:\/\/(.*))?$/.exec(
          line61,
        );
      if (!txMatch) {
        throw new Error(`Nieprawidłowy format linii transakcyjnej MT940 :61:: "${line61}"`);
      }
      const valueDate = parseYyMmDdToIso(txMatch[1]!);
      const entryMmDd = txMatch[2];
      const bookingDate =
        entryMmDd !== undefined ? resolveMt940EntryBookingDate(valueDate, entryMmDd) : valueDate;
      const dcMark = txMatch[3]!;
      const amountStr = txMatch[5]!;
      const customerRef = (txMatch[7] ?? '').trim();
      const bankServicingRef = (txMatch[8] ?? '').trim();

      const amountGrosze = parsePlnToGrosze(amountStr);
      // C = uznanie (credit), D = obciążenie (debit), RC = storno uznania (debit), RD = storno obciążenia (credit)
      const direction: 'credit' | 'debit' = dcMark === 'C' || dcMark === 'RD' ? 'credit' : 'debit';

      let raw86 = '';
      if (blocks[i + 1]?.tag === '86') {
        raw86 = blocks[i + 1]!.value;
        i += 1;
      }

      const details = parseMt940Field86Details(raw86);
      const detectedNip = extractNipFromText(`${details.title} ${details.counterpartyName}`);

      const contentSig = buildBankTxContentSignature({
        bookingDate,
        valueDate,
        direction,
        amountGrosze,
        currency: 'PLN',
        counterpartyIban: details.counterpartyIban,
        counterpartyName: details.counterpartyName,
        title: details.title,
      });

      const explicitRef =
        customerRef.length > 0 && customerRef !== 'NONREF'
          ? customerRef
          : bankServicingRef.length > 0 && bankServicingRef !== 'NONREF'
            ? bankServicingRef
            : '';

      let transactionId: string;
      if (explicitRef.length > 0) {
        const prevSig = explicitRefSignatures.get(explicitRef);
        if (prevSig !== undefined && prevSig !== contentSig) {
          throw new Error(
            `Kolizja identyfikatora referencyjnego MT940 "${explicitRef}" z różną zawartością wewnątrz jednego wyciągu.`,
          );
        }
        explicitRefSignatures.set(explicitRef, contentSig);
        transactionId = explicitRef;
      } else {
        const occ = (occurrenceCounts.get(contentSig) ?? 0) + 1;
        occurrenceCounts.set(contentSig, occ);
        const stmtCtx = `${accountIdentification ?? ''}|${statementReference ?? ''}`;
        const txHash = sha256HexPure(
          `pap-mt940-tx:v1|${stmtCtx}|${contentSig}|occ=${String(occ)}`,
        ).slice(0, 24);
        transactionId = `mt940-tx-${txHash}`;
      }

      const effectiveRawRef = explicitRef || customerRef;

      transactions.push({
        transactionId,
        bookingDate,
        valueDate,
        direction,
        amountGrosze,
        amountFormatted: formatPlnFromGrosze(amountGrosze),
        currency: 'PLN',
        counterpartyName: details.counterpartyName,
        ...(details.counterpartyIban !== undefined
          ? { counterpartyIban: details.counterpartyIban }
          : {}),
        ...(detectedNip !== undefined ? { counterpartyNip: detectedNip } : {}),
        title: details.title,
        ...(effectiveRawRef.length > 0 ? { rawReference: effectiveRawRef } : {}),
      });
    }
  }

  if (openingBalanceGrosze !== undefined && closingBalanceGrosze !== undefined) {
    let running = openingBalanceGrosze;
    for (const tx of transactions) {
      running =
        tx.direction === 'credit'
          ? addGrosze(running, tx.amountGrosze)
          : subtractGrosze(running, tx.amountGrosze);
    }
    if (running !== closingBalanceGrosze) {
      throw new Error(
        `Niezgodność kontrolna wyciągu MT940: saldo początkowe (${formatPlnFromGrosze(openingBalanceGrosze)}) + obroty != saldo końcowe (${formatPlnFromGrosze(closingBalanceGrosze)}, wyliczono ${formatPlnFromGrosze(running)}).`,
      );
    }
  }

  return {
    ...(statementReference !== undefined ? { statementReference } : {}),
    ...(accountIdentification !== undefined ? { accountIdentification } : {}),
    ...(openingBalanceGrosze !== undefined ? { openingBalanceGrosze } : {}),
    ...(closingBalanceGrosze !== undefined ? { closingBalanceGrosze } : {}),
    transactions,
  };
}

export interface OpenInvoiceSettlementItem {
  readonly documentId: string;
  readonly documentNumber: string;
  readonly direction: 'sales' | 'purchase';
  readonly counterpartyNip?: string;
  readonly counterpartyIban?: string;
  readonly remainingAmountGrosze: number;
}

export type BankReconciliationStatus =
  'matched_exact' | 'matched_partial' | 'overpaid' | 'ambiguous_manual_review' | 'unmatched';

export interface BankReconciliationMatch {
  readonly transactionId: string;
  readonly status: BankReconciliationStatus;
  readonly matchedDocumentId?: string;
  readonly matchedDocumentNumber?: string;
  readonly candidateDocumentIds: readonly string[];
  readonly matchedCriterion:
    | 'invoice_number_and_amount'
    | 'invoice_number_partial_or_overpaid'
    | 'nip_or_iban_and_exact_amount'
    | 'ambiguous_candidates'
    | 'none';
  readonly transactionAmountGrosze: number;
  readonly settledAmountGrosze: number;
  readonly remainingDocumentAmountGrosze: number;
  readonly overpaymentGrosze: number;
  readonly notes: string;
}

function titleContainsDocumentNumber(title: string, documentNumber: string): boolean {
  const normDoc = documentNumber.trim().toUpperCase().replace(/\s+/g, '');
  if (normDoc.length < 3) {
    return false;
  }
  const escaped = normDoc
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\s*/\\s*')
    .replace(/-/g, '\\s*-\\s*');
  const boundaryRegex = new RegExp(`(^|[^A-Z0-9ĄĆĘŁŃÓŚŹŻ])${escaped}($|[^A-Z0-9ĄĆĘŁŃÓŚŹŻ])`);
  return boundaryRegex.test(title.toUpperCase());
}

/**
 * Deterministycznie paruje transakcje bankowe z otwartymi rozrachunkami (fakturami sprzedaży i zakupu):
 * - uznania (`credit`) paruje z fakturami sprzedaży (`sales`), obciążenia (`debit`) z fakturami zakupu (`purchase`)
 * - priorytet 1: jednoznaczny numer faktury w tytule przelewu (obsługuje płatność pełną, częściową i nadpłatę, aktualizując saldo otwarte!)
 * - priorytet 2: zgodność NIP lub IBAN kontrahenta + dokładna kwota otwartego rozrachunku
 * - przy więcej niż jednym kandydacie nie zgaduje — zwraca `ambiguous_manual_review`.
 */
export function reconcileBankTransactions(
  transactions: readonly BankStatementTransaction[],
  openItems: readonly OpenInvoiceSettlementItem[],
): readonly BankReconciliationMatch[] {
  const remainingByDoc = new Map<string, number>();
  for (const item of openItems) {
    assertNonNegativeGrosze(item.remainingAmountGrosze, `openItem(${item.documentId})`);
    remainingByDoc.set(item.documentId, item.remainingAmountGrosze);
  }

  return transactions.map((tx): BankReconciliationMatch => {
    const expectedDocDirection = tx.direction === 'credit' ? 'sales' : 'purchase';
    const activeItems = openItems.filter(
      (item) =>
        item.direction === expectedDocDirection && (remainingByDoc.get(item.documentId) ?? 0) > 0,
    );

    // Krok 1: Wyszukanie po numerze dokumentu w tytule przelewu
    const byNumber = activeItems.filter((item) =>
      titleContainsDocumentNumber(tx.title, item.documentNumber),
    );

    if (byNumber.length > 1) {
      return {
        transactionId: tx.transactionId,
        status: 'ambiguous_manual_review',
        candidateDocumentIds: byNumber.map((i) => i.documentId),
        matchedCriterion: 'ambiguous_candidates',
        transactionAmountGrosze: tx.amountGrosze,
        settledAmountGrosze: 0,
        remainingDocumentAmountGrosze: 0,
        overpaymentGrosze: 0,
        notes: `Tytuł przelewu pasuje do wielu otwartych dokumentów (${byNumber.map((i) => i.documentNumber).join(', ')}) — wymagana decyzja człowieka.`,
      };
    }

    if (byNumber.length === 1) {
      const target = byNumber[0]!;
      const docRemaining = remainingByDoc.get(target.documentId)!;

      if (tx.amountGrosze === docRemaining) {
        remainingByDoc.set(target.documentId, 0);
        return {
          transactionId: tx.transactionId,
          status: 'matched_exact',
          matchedDocumentId: target.documentId,
          matchedDocumentNumber: target.documentNumber,
          candidateDocumentIds: [target.documentId],
          matchedCriterion: 'invoice_number_and_amount',
          transactionAmountGrosze: tx.amountGrosze,
          settledAmountGrosze: tx.amountGrosze,
          remainingDocumentAmountGrosze: 0,
          overpaymentGrosze: 0,
          notes: `Rozliczono w całości fakturę ${target.documentNumber} po numerze w tytule i dokładnej kwocie.`,
        };
      }

      if (tx.amountGrosze < docRemaining) {
        const left = subtractGrosze(docRemaining, tx.amountGrosze);
        remainingByDoc.set(target.documentId, left);
        return {
          transactionId: tx.transactionId,
          status: 'matched_partial',
          matchedDocumentId: target.documentId,
          matchedDocumentNumber: target.documentNumber,
          candidateDocumentIds: [target.documentId],
          matchedCriterion: 'invoice_number_partial_or_overpaid',
          transactionAmountGrosze: tx.amountGrosze,
          settledAmountGrosze: tx.amountGrosze,
          remainingDocumentAmountGrosze: left,
          overpaymentGrosze: 0,
          notes: `Częściowa wpłata do faktury ${target.documentNumber} — pozostało do zapłaty ${formatPlnFromGrosze(left)}.`,
        };
      }

      const overpaid = subtractGrosze(tx.amountGrosze, docRemaining);
      remainingByDoc.set(target.documentId, 0);
      return {
        transactionId: tx.transactionId,
        status: 'overpaid',
        matchedDocumentId: target.documentId,
        matchedDocumentNumber: target.documentNumber,
        candidateDocumentIds: [target.documentId],
        matchedCriterion: 'invoice_number_partial_or_overpaid',
        transactionAmountGrosze: tx.amountGrosze,
        settledAmountGrosze: docRemaining,
        remainingDocumentAmountGrosze: 0,
        overpaymentGrosze: overpaid,
        notes: `Nadpłata do faktury ${target.documentNumber} w kwocie ${formatPlnFromGrosze(overpaid)}.`,
      };
    }

    // Krok 2: Dopasowanie po NIP lub znormalizowanym IBAN kontrahenta + dokładnej kwocie
    const normalizedTxIban =
      tx.counterpartyIban !== undefined
        ? validatePolishIban(tx.counterpartyIban).normalizedIban
        : undefined;
    const normalizedTxNip =
      tx.counterpartyNip !== undefined
        ? validatePolishNip(tx.counterpartyNip).normalizedNip
        : undefined;

    const byCounterpartyAndAmount = activeItems.filter((item) => {
      const rem = remainingByDoc.get(item.documentId) ?? 0;
      if (rem !== tx.amountGrosze) {
        return false;
      }
      const itemIban =
        item.counterpartyIban !== undefined
          ? validatePolishIban(item.counterpartyIban).normalizedIban
          : undefined;
      const itemNip =
        item.counterpartyNip !== undefined
          ? validatePolishNip(item.counterpartyNip).normalizedNip
          : undefined;

      const ibanMatch =
        normalizedTxIban !== undefined && itemIban !== undefined && normalizedTxIban === itemIban;
      const nipMatch =
        normalizedTxNip !== undefined && itemNip !== undefined && normalizedTxNip === itemNip;

      return ibanMatch || nipMatch;
    });

    if (byCounterpartyAndAmount.length > 1) {
      return {
        transactionId: tx.transactionId,
        status: 'ambiguous_manual_review',
        candidateDocumentIds: byCounterpartyAndAmount.map((i) => i.documentId),
        matchedCriterion: 'ambiguous_candidates',
        transactionAmountGrosze: tx.amountGrosze,
        settledAmountGrosze: 0,
        remainingDocumentAmountGrosze: 0,
        overpaymentGrosze: 0,
        notes:
          'Wykryto więcej niż jedną otwartą fakturę tego samego kontrahenta na identyczną kwotę — wymagane ręczne wskazanie.',
      };
    }

    if (byCounterpartyAndAmount.length === 1) {
      const target = byCounterpartyAndAmount[0]!;
      remainingByDoc.set(target.documentId, 0);
      return {
        transactionId: tx.transactionId,
        status: 'matched_exact',
        matchedDocumentId: target.documentId,
        matchedDocumentNumber: target.documentNumber,
        candidateDocumentIds: [target.documentId],
        matchedCriterion: 'nip_or_iban_and_exact_amount',
        transactionAmountGrosze: tx.amountGrosze,
        settledAmountGrosze: tx.amountGrosze,
        remainingDocumentAmountGrosze: 0,
        overpaymentGrosze: 0,
        notes: `Dopasowano fakturę ${target.documentNumber} po identyfikatorze kontrahenta (IBAN/NIP) i dokładnej kwocie.`,
      };
    }

    return {
      transactionId: tx.transactionId,
      status: 'unmatched',
      candidateDocumentIds: [],
      matchedCriterion: 'none',
      transactionAmountGrosze: tx.amountGrosze,
      settledAmountGrosze: 0,
      remainingDocumentAmountGrosze: 0,
      overpaymentGrosze: 0,
      notes: 'Brak jednoznacznego rozrachunku pasującego do transakcji bankowej.',
    };
  });
}
