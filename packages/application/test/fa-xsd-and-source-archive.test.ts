import { buildSyntheticTestKsefNumber, generateKsefFaXml } from '@pap/domain';
import { describe, expect, it } from 'vitest';

import {
  AccountingWorkspaceError,
  ImmutableSourceDocumentArchive,
  parseOfficialKsefFaXml,
  validateOfficialMfXml,
  verifyOfficialMfXsdIntegrity,
} from '../src/index.js';

const SELLER_NIP = '5261040828';
const BUYER_NIP = '9542752600';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const COMPANY_A1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const COMPANY_B1 = 'bbbbbbbb-2222-4222-8222-222222222222';
const ACTOR_A = '00000000-0000-4000-8000-000000000001';
const ACTOR_B = '00000000-0000-4000-8000-000000000002';

describe('Official MF FA(2) & FA(3) XSD Validation, XXE Hardening, and WORM Source Archive (#82, #99, GLD-09)', () => {
  it('verifies cryptographic SHA-256 integrity of all 11 official MF XSDs and 10 base dictionary XSDs offline', () => {
    const integrity = verifyOfficialMfXsdIntegrity();
    expect(integrity.verifiedSchemasCount).toBe(11);
    expect(integrity.verifiedDependenciesCount).toBe(10);
  });

  it('validates generated FA(3) multi-rate B2B invoice, B2C BrakID invoice, EU VAT invoice, KOR credit note, and archival FA(2) against official MF XSDs', () => {
    // 1. Multi-rate B2B FA(3) with MPP + IBAN
    const b2bFa3 = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-20T12:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Księga Współczesna Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
        email: 'faktury@ksiega.example.pl',
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Odbiorca Przemysłowy Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Chorzowska 50, 40-121 Katowice' },
      },
      invoiceNumber: 'FV/2026/03/105',
      issueDate: '2026-03-20',
      saleDate: '2026-03-19',
      dueDate: '2026-04-03',
      sellerBankAccountIban: 'PL61109010140000071219812874',
      splitPaymentMppP18A: true,
      lines: [
        {
          description: 'Wdrożenie systemu ERP (23%)',
          unit: 'usł.',
          quantity: '1',
          netGrosze: 2_000_000,
          vatRate: '23',
          annex15Item: true,
          gtuCode: 'GTU_12',
        },
        {
          description: 'Publikacja specjalistyczna z ISBN (8%)',
          unit: 'szt.',
          quantity: '5',
          netGrosze: 50_000,
          vatRate: '8',
        },
      ],
    });

    const xsdFa3 = validateOfficialMfXml(b2bFa3.xml, 'FA(3)');
    expect(xsdFa3.valid).toBe(true);

    const parsedB2b = parseOfficialKsefFaXml(b2bFa3.xml, { companyNip: SELLER_NIP });
    expect(parsedB2b.ksefSchemaVersion).toBe('FA(3)');
    expect(parsedB2b.schemaComplianceStatus).toBe('official_xsd_valid');
    expect(parsedB2b.direction).toBe('sales');
    expect(parsedB2b.sellerNip).toBe(SELLER_NIP);
    expect(parsedB2b.buyerNip).toBe(BUYER_NIP);
    expect(parsedB2b.lines).toHaveLength(2);
    expect(parsedB2b.totalNetGrosze).toBe(2_050_000);
    expect(parsedB2b.totalVatGrosze).toBe(464_000);
    expect(parsedB2b.totalGrossGrosze).toBe(2_514_000);

    // 2. B2C consumer invoice with BrakID=1 strictly in Podmiot2
    const b2cFa3 = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-21T09:15:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Księga Współczesna Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'brak_id' },
        name: 'Anna Kowalska',
        address: { countryCode: 'PL', addressLine1: 'ul. Kwiatowa 7, 02-500 Warszawa' },
      },
      invoiceNumber: 'FV/B2C/2026/03/01',
      issueDate: '2026-03-21',
      lines: [
        {
          description: 'Konsultacja księgowa online',
          netGrosze: 30_000,
          vatRate: '23',
        },
      ],
    });
    expect(validateOfficialMfXml(b2cFa3.xml, 'FA(3)').valid).toBe(true);
    const parsedB2c = parseOfficialKsefFaXml(b2cFa3.xml, { companyNip: SELLER_NIP });
    expect(parsedB2c.buyerIdentifierKind).toBe('brak_id');
    expect(parsedB2c.counterpartyNip).toBeUndefined();

    // 3. EU buyer (KodUE + NrVatUE)
    const euFa3 = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-22T10:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Księga Współczesna Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'vat_ue', euCountryCode: 'DE', euVatNumber: '123456789' },
        name: 'Berlin Tech GmbH',
        address: { countryCode: 'DE', addressLine1: 'Friedrichstrasse 10, 10117 Berlin' },
      },
      invoiceNumber: 'FV/UE/2026/03/02',
      issueDate: '2026-03-22',
      reverseChargeP18: true,
      lines: [
        {
          description: 'Usługa programistyczna art. 28b VAT',
          netGrosze: 1_000_000,
          vatRate: 'np',
          vatRateXmlCode: 'np I',
        },
      ],
    });
    expect(validateOfficialMfXml(euFa3.xml, 'FA(3)').valid).toBe(true);
    expect(parseOfficialKsefFaXml(euFa3.xml).buyerIdentifierKind).toBe('vat_ue');

    // 4. Credit note (KOR) referencing original KSeF invoice
    const origKsefNo = buildSyntheticTestKsefNumber(SELLER_NIP, '20260320', 'AA0011223344');
    const korFa3 = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-25T14:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Księga Współczesna Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Odbiorca Przemysłowy Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Chorzowska 50, 40-121 Katowice' },
      },
      invoiceNumber: 'FKOR/2026/03/01',
      issueDate: '2026-03-25',
      invoiceKind: 'KOR',
      correction: {
        reason: 'Rabat potransakcyjny 10%',
        correctionType: '2',
        correctedInvoices: [
          {
            originalIssueDate: '2026-03-20',
            originalInvoiceNumber: 'FV/2026/03/105',
            originalKsefNumber: origKsefNo,
          },
        ],
      },
      lines: [
        {
          description: 'Wdrożenie systemu ERP (przed korektą)',
          netGrosze: 2_000_000,
          vatRate: '23',
          beforeCorrectionState: true,
        },
        {
          description: 'Wdrożenie systemu ERP (po rabacie 10%)',
          netGrosze: 1_800_000,
          vatRate: '23',
        },
      ],
    });
    expect(validateOfficialMfXml(korFa3.xml, 'FA(3)').valid).toBe(true);
    const parsedKor = parseOfficialKsefFaXml(korFa3.xml, { companyNip: SELLER_NIP });
    expect(parsedKor.isCorrectionInvoice).toBe(true);
    expect(parsedKor.correctedKsefNumber).toBe(origKsefNo);

    // 5. Archival FA(2) XSD validation
    const archivalFa2 = generateKsefFaXml({
      schemaVersion: 'FA(2)',
      createdAtIsoUtc: '2026-01-15T08:30:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Księga Współczesna Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Odbiorca Przemysłowy Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Chorzowska 50, 40-121 Katowice' },
      },
      invoiceNumber: 'FV/2026/01/010',
      issueDate: '2026-01-15',
      lines: [
        {
          description: 'Obsługa księgowa styczeń 2026',
          netGrosze: 150_000,
          vatRate: '23',
        },
      ],
    });
    expect(validateOfficialMfXml(archivalFa2.xml, 'FA(2)').valid).toBe(true);
    expect(parseOfficialKsefFaXml(archivalFa2.xml).ksefSchemaVersion).toBe('FA(2)');

    // 6. [P0-4] Reverse-charge ('oo' -> <P_13_10>) + 'np I' (<P_13_8>) + 'np II' (<P_13_9>) round-trip on FA(3) and FA(2)
    for (const version of ['FA(3)', 'FA(2)'] as const) {
      const mixedRc = generateKsefFaXml({
        schemaVersion: version,
        createdAtIsoUtc: '2026-03-26T11:00:00Z',
        seller: {
          nip: SELLER_NIP,
          name: 'Księga Współczesna Sp. z o.o.',
          address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 100, 00-026 Warszawa' },
        },
        buyer: {
          identifier: { kind: 'nip', nip: BUYER_NIP },
          name: 'Odbiorca Przemysłowy Sp. z o.o.',
          address: { countryCode: 'PL', addressLine1: 'ul. Chorzowska 50, 40-121 Katowice' },
        },
        invoiceNumber: `FV/OO/${version}/01`,
        issueDate: '2026-03-26',
        reverseChargeP18: true,
        lines: [
          {
            description: 'Odwrotne obciążenie krajowe',
            netGrosze: 200_000,
            vatRate: 'np',
            vatRateXmlCode: 'oo',
          },
          {
            description: 'Usługa poza terytorium kraju (np I)',
            netGrosze: 100_000,
            vatRate: 'np',
            vatRateXmlCode: 'np I',
          },
          {
            description: 'Usługa art. 100 ust. 1 pkt 4 (np II)',
            netGrosze: 50_000,
            vatRate: 'np',
            vatRateXmlCode: 'np II',
          },
        ],
      });
      expect(mixedRc.xml).toContain('<P_13_8>1000.00</P_13_8>');
      expect(mixedRc.xml).toContain('<P_13_9>500.00</P_13_9>');
      expect(mixedRc.xml).toContain('<P_13_10>2000.00</P_13_10>');
      expect(validateOfficialMfXml(mixedRc.xml, version).valid).toBe(true);
      const parsedMixedRc = parseOfficialKsefFaXml(mixedRc.xml, { companyNip: SELLER_NIP });
      expect(parsedMixedRc.totalNetGrosze).toBe(350_000);
      expect(parsedMixedRc.totalVatGrosze).toBe(0);
      expect(parsedMixedRc.totalGrossGrosze).toBe(350_000);
    }
  });

  it('rejects PL-prefixed NIP, BrakID in Podmiot1, missing/mismatched Naglowek/WariantFormularza, wrong xmlns, comma decimals, and XXE/entity expansion (GLD-09)', () => {
    const validBase = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-20T12:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Sprzedawca Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Prosta 1, 00-850 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Nabywca Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Długa 2, 40-001 Katowice' },
      },
      invoiceNumber: 'FV/NEG/01',
      issueDate: '2026-03-20',
      lines: [{ description: 'Usługa', netGrosze: 100_000, vatRate: '23' }],
    }).xml;

    // 1. PL-prefixed NIP in Podmiot1 (etd:TNrNIP strictly forbids PL prefix)
    const plSellerXml = validBase.replace(`<NIP>${SELLER_NIP}</NIP>`, `<NIP>PL${SELLER_NIP}</NIP>`);
    expect(validateOfficialMfXml(plSellerXml, 'FA(3)').valid).toBe(false);
    expect(() => parseOfficialKsefFaXml(plSellerXml)).toThrowError(AccountingWorkspaceError);

    // 2. PL-prefixed NIP in Podmiot2
    const plBuyerXml = validBase.replace(`<NIP>${BUYER_NIP}</NIP>`, `<NIP>PL${BUYER_NIP}</NIP>`);
    expect(validateOfficialMfXml(plBuyerXml, 'FA(3)').valid).toBe(false);
    expect(() => parseOfficialKsefFaXml(plBuyerXml)).toThrowError(AccountingWorkspaceError);

    // 3. BrakID=1 injected into Podmiot1 (Sprzedawca) — forbidden by TPodmiot1
    const sellerBrakIdXml = validBase.replace(`<NIP>${SELLER_NIP}</NIP>`, '<BrakID>1</BrakID>');
    expect(validateOfficialMfXml(sellerBrakIdXml, 'FA(3)').valid).toBe(false);
    expect(() => parseOfficialKsefFaXml(sellerBrakIdXml)).toThrowError(/Podmiot1|BrakID/);

    // 4. Mismatched WariantFormularza (2 inside FA(3) namespace)
    const mismatchedVariantXml = validBase.replace(
      '<WariantFormularza>3</WariantFormularza>',
      '<WariantFormularza>2</WariantFormularza>',
    );
    expect(() => parseOfficialKsefFaXml(mismatchedVariantXml)).toThrowError(
      AccountingWorkspaceError,
    );

    // 5. Missing <Naglowek> completely in strict official mode
    const missingHeaderXml = validBase.replace(/<Naglowek>[\s\S]*?<\/Naglowek>/, '');
    expect(() => parseOfficialKsefFaXml(missingHeaderXml)).toThrowError(AccountingWorkspaceError);

    // 6. Wrong XML namespace
    const wrongNsXml = validBase.replace(
      'http://crd.gov.pl/wzor/2025/06/25/13775/',
      'http://crd.gov.pl/wzor/9999/01/01/00000/',
    );
    expect(() => parseOfficialKsefFaXml(wrongNsXml)).toThrowError(/przestrzeń nazw|xmlns/);

    // 7. Comma decimal in TKwotowy (<P_15>1230,00</P_15>)
    const commaDecimalXml = validBase.replace('<P_15>1230.00</P_15>', '<P_15>1230,00</P_15>');
    expect(validateOfficialMfXml(commaDecimalXml, 'FA(3)').valid).toBe(false);
    expect(() => parseOfficialKsefFaXml(commaDecimalXml)).toThrowError(AccountingWorkspaceError);

    // 8. XXE / DOCTYPE / ENTITY / custom entity / Processing Instruction attacks
    const xxeSystemXml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Faktura [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n${validBase.replace('<?xml version="1.0" encoding="UTF-8"?>', '').replace('FV/NEG/01', '&xxe;')}`;
    expect(() => parseOfficialKsefFaXml(xxeSystemXml)).toThrowError(/XXE|DTD|ENTITY/);
    expect(validateOfficialMfXml(xxeSystemXml, 'FA(3)').valid).toBe(false);

    const customEntityXml = validBase.replace('FV/NEG/01', 'FV/&customEntity;/01');
    expect(() => parseOfficialKsefFaXml(customEntityXml)).toThrowError(/XXE|encj/);

    const procInstructionXml = validBase.replace('<Podmiot1>', '<?php echo 1; ?><Podmiot1>');
    expect(() => parseOfficialKsefFaXml(procInstructionXml)).toThrowError(
      /Processing Instruction|instrukcj/i,
    );
  });

  it('enforces WORM immutability, SHA-256 409 deduplication, binary signature checks, 2-tenant isolation, and OCR human approval in ImmutableSourceDocumentArchive (#99)', () => {
    const archive = new ImmutableSourceDocumentArchive({
      authorizer: ({ actorUserId, tenantId }) => {
        if (actorUserId === ACTOR_A && tenantId === TENANT_A) {
          return { allowed: true };
        }
        if (actorUserId === ACTOR_B && tenantId === TENANT_B) {
          return { allowed: true };
        }
        return { allowed: false, reasonCode: 'cross_tenant_denied' };
      },
    });

    const pdfBytes = Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
      'utf8',
    );
    const storedPdf = archive.storeOriginal({
      actorUserId: ACTOR_A,
      tenantId: TENANT_A,
      legalEntityId: COMPANY_A1,
      fileName: 'faktura-zakup-03-2026.pdf',
      declaredMimeType: 'application/pdf',
      content: pdfBytes,
      ocrProposal: {
        extractorId: 'ocr-tesseract-pl-v1',
        extractedAtIso: '2026-03-22T10:00:00Z',
        overallConfidenceBps: 9150,
        documentNumber: { value: 'FZ/2026/03/77', confidenceBps: 9600 },
        grossGrosze: { value: 246_000, confidenceBps: 8900 },
        warningsPl: ['Zweryfikuj datę sprzedaży przed zaksięgowaniem.'],
      },
    });

    expect(storedPdf.immutable).toBe(true);
    expect(storedPdf.kind).toBe('pdf');
    expect(storedPdf.ocrProposal?.requiresHumanApproval).toBe(true);

    // Mutating caller's input buffer after upload MUST NOT corrupt WORM archive
    pdfBytes[0] = 0x00;
    const verifiedRead = archive.readOriginalBytesVerified({
      actorUserId: ACTOR_A,
      tenantId: TENANT_A,
      legalEntityId: COMPANY_A1,
      artifactId: storedPdf.artifactId,
    });
    expect(verifiedRead.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const splitPreview = archive.buildSplitVerificationPreview({
      actorUserId: ACTOR_A,
      tenantId: TENANT_A,
      legalEntityId: COMPANY_A1,
      artifactId: storedPdf.artifactId,
    });
    expect(splitPreview.previewMode).toBe('pdf_embed');
    expect(splitPreview.requiresHumanApproval).toBe(true);

    // Exact same raw bytes uploaded again to same company -> 409 duplicate_source_artifact_sha256
    expect(() =>
      archive.storeOriginal({
        actorUserId: ACTOR_A,
        tenantId: TENANT_A,
        legalEntityId: COMPANY_A1,
        fileName: 'duplikat.pdf',
        declaredMimeType: 'application/pdf',
        content: verifiedRead.bytes,
      }),
    ).toThrowError(/duplicate_source_artifact_sha256|SHA-256/);

    // Spoofed binary header (plain text declared as JPEG) -> 422
    expect(() =>
      archive.storeOriginal({
        actorUserId: ACTOR_A,
        tenantId: TENANT_A,
        legalEntityId: COMPANY_A1,
        fileName: 'fake.jpg',
        declaredMimeType: 'image/jpeg',
        content: Buffer.from('NOT_A_JPEG_FILE', 'utf8'),
      }),
    ).toThrowError(AccountingWorkspaceError);

    // Cross-tenant isolation: Actor B cannot read Tenant A's artifact (403) and Tenant B cannot see Tenant A's ID (404)
    expect(() =>
      archive.readOriginalBytesVerified({
        actorUserId: ACTOR_B,
        tenantId: TENANT_A,
        legalEntityId: COMPANY_A1,
        artifactId: storedPdf.artifactId,
      }),
    ).toThrowError(AccountingWorkspaceError);

    expect(() =>
      archive.readOriginalBytesVerified({
        actorUserId: ACTOR_B,
        tenantId: TENANT_B,
        legalEntityId: COMPANY_B1,
        artifactId: storedPdf.artifactId,
      }),
    ).toThrowError(AccountingWorkspaceError);
  });
});
