import { calculateInvoiceLineFromNet, validatePolishNip, type VatRateCode } from '@pap/domain';

export const CANONICAL_DOCUMENT_CSV_HEADERS = [
  'numer_faktury',
  'kierunek',
  'data_wystawienia',
  'termin_platnosci',
  'kontrahent',
  'nip',
  'opis',
  'ilosc',
  'jm',
  'stawka_vat',
  'netto',
  'vat',
  'brutto',
] as const;

export interface SampleDocumentCsvLineSpec {
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly vatRate: VatRateCode;
  readonly netGrosze: number;
}

export interface SampleDocumentCsvSpec {
  readonly documentNumber: string;
  readonly direction: 'purchase' | 'sales';
  readonly issueDate: string;
  readonly dueDate: string;
  readonly counterpartyName: string;
  readonly counterpartyNip: string;
  readonly lines: readonly SampleDocumentCsvLineSpec[];
}

function formatGroszeDotDecimal(grosze: number): string {
  const sign = grosze < 0 ? '-' : '';
  const abs = Math.abs(grosze);
  const zl = Math.floor(abs / 100);
  const gr = String(abs % 100).padStart(2, '0');
  return `${sign}${String(zl)}.${gr}`;
}

/**
 * Typowany generator kanonicznego pliku CSV zgodnego 1:1 z `parseSafeDocumentCsv` w `@pap/application` (#114).
 * Waliduje sumę kontrolną NIP oraz wylicza dokładne kwoty VAT i brutto co do grosza.
 */
export function buildCanonicalDocumentCsv(spec: SampleDocumentCsvSpec): string {
  const nipCheck = validatePolishNip(spec.counterpartyNip);
  if (!nipCheck.valid || !nipCheck.normalizedNip) {
    throw new Error(`Nieprawidłowy NIP w szablonie CSV: ${spec.counterpartyNip}`);
  }
  const header = CANONICAL_DOCUMENT_CSV_HEADERS.join(';');
  const rows = spec.lines.map((line) => {
    const calc = calculateInvoiceLineFromNet(line.netGrosze, line.vatRate);
    return [
      spec.documentNumber,
      spec.direction,
      spec.issueDate,
      spec.dueDate,
      spec.counterpartyName,
      nipCheck.normalizedNip!,
      line.description.replace(/;/g, ','),
      line.quantity,
      line.unit,
      line.vatRate,
      formatGroszeDotDecimal(calc.netGrosze),
      formatGroszeDotDecimal(calc.vatGrosze),
      formatGroszeDotDecimal(calc.grossGrosze),
    ].join(';');
  });
  return [header, ...rows].join('\n');
}

export function buildEmptyDocumentCsvTemplate(period = '2026-03'): string {
  return [
    CANONICAL_DOCUMENT_CSV_HEADERS.join(';'),
    `FV/${period}/001;purchase;${period}-15;${period}-29;Nazwa Kontrahenta Sp. z o.o.;5213004125;Opis towaru lub usługi;1;usł.;23;1000.00;230.00;1230.00`,
  ].join('\n');
}

export function buildSampleSingleRateDocumentCsv(period = '2026-03'): string {
  return buildCanonicalDocumentCsv({
    documentNumber: `FV-DEMO/${period}/019`,
    direction: 'purchase',
    issueDate: `${period}-18`,
    dueDate: `${period}-28`,
    counterpartyName: 'Innowacje Bałtyckie Syntetyk Sp. z o.o. [DEMO]',
    counterpartyNip: '7792301205',
    lines: [
      {
        description: '[DANE SYNTETYCZNE DEMO] Projekt makiety produktu cyfrowego UX/UI',
        quantity: '1',
        unit: 'usł.',
        vatRate: '23',
        netGrosze: 850_000,
      },
    ],
  });
}

export function buildSampleMultiRateDocumentCsv(period = '2026-03'): string {
  return buildCanonicalDocumentCsv({
    documentNumber: `FV-DEMO-MIX/${period}/024`,
    direction: 'purchase',
    issueDate: `${period}-19`,
    dueDate: `${period}-29`,
    counterpartyName: 'Centrum Konferencyjno-Szkoleniowe Syntetyk Sp. z o.o. [DEMO]',
    counterpartyNip: '5213004125',
    lines: [
      {
        description: '[DANE SYNTETYCZNE DEMO] Wynajem sali warsztatowej i sprzętu AV (stawka 23%)',
        quantity: '1',
        unit: 'usł.',
        vatRate: '23',
        netGrosze: 200_000,
      },
      {
        description: '[DANE SYNTETYCZNE DEMO] Podręczniki branżowe ISBN dla zespołu (stawka 5%)',
        quantity: '4',
        unit: 'egz.',
        vatRate: '5',
        netGrosze: 40_000,
      },
      {
        description:
          '[DANE SYNTETYCZNE DEMO] Usługa gastronomiczna serwis kawowy (stawka 8% — uwaga art. 88 VAT)',
        quantity: '1',
        unit: 'usł.',
        vatRate: '8',
        netGrosze: 50_000,
      },
    ],
  });
}

export function buildSampleDocumentJson(period = '2026-03'): string {
  const line23 = calculateInvoiceLineFromNet(240_000, '23');
  const line8 = calculateInvoiceLineFromNet(50_000, '8');
  return JSON.stringify(
    {
      documentNumber: `FV-JSON-DEMO/${period}/012`,
      direction: 'purchase',
      issueDate: `${period}-19`,
      saleDate: `${period}-19`,
      dueDate: `${period}-29`,
      counterpartyName: 'Audyt Systemowy Syntetyk Sp. z o.o. [DEMO]',
      counterpartyNip: '5250004007',
      lines: [
        {
          description: '[DANE SYNTETYCZNE DEMO] Audyt bezpieczeństwa aplikacji i konfiguracji KSeF',
          quantity: '1',
          unit: 'usł.',
          vatRate: '23',
          netGrosze: line23.netGrosze,
          vatGrosze: line23.vatGrosze,
          grossGrosze: line23.grossGrosze,
        },
        {
          description:
            '[DANE SYNTETYCZNE DEMO] Dokumentacja techniczna drukowana objęta stawką obniżoną',
          quantity: '1',
          unit: 'kpl.',
          vatRate: '8',
          netGrosze: line8.netGrosze,
          vatGrosze: line8.vatGrosze,
          grossGrosze: line8.grossGrosze,
        },
      ],
    },
    null,
    2,
  );
}
