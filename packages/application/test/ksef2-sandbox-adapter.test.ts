import { generateKeyPairSync } from 'node:crypto';
import { buildSyntheticTestKsefNumber, generateKsefFaXml } from '@pap/domain';
import { describe, expect, it } from 'vitest';

import {
  ImmutableSourceDocumentArchive,
  Ksef2SandboxAdapterService,
  KsefIdempotencyConflictError,
  KsefIdempotentOutbox,
  KsefProductionEndpointBlockedError,
  KsefXmlPreValidationError,
  assertAllowedKsefNonProductionEndpoint,
  computeKsefBase64Sha256,
  createKsefSessionEncryptionMaterial,
  decryptKsefInvoiceAes256Cbc,
  decryptKsefRsaOaepSha256,
  encryptKsefInvoiceAes256Cbc,
  encryptKsefTokenRsaOaepSha256,
  validateAndParseKsefUpoXml,
  type KsefHttpRequest,
  type KsefHttpResponse,
} from '../src/index.js';

const { publicKey: TEST_RSA_PUBLIC_PEM, privateKey: TEST_RSA_PRIVATE_PEM } = generateKeyPairSync(
  'rsa',
  {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  },
);

const SELLER_NIP = '5261040828';
const BUYER_NIP = '9542752600';

function buildSampleValidKsefUpoXml(params: {
  sessionRef: string;
  sellerNip: string;
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  documentHashBase64: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Potwierdzenie xmlns="http://upo.schematy.mf.gov.pl/KSeF/v4-3" wersjaSchemy="v4-3">',
    '  <NazwaPodmiotuPrzyjmujacego>Ministerstwo Finansów</NazwaPodmiotuPrzyjmujacego>',
    `  <NumerReferencyjnySesji>${params.sessionRef}</NumerReferencyjnySesji>`,
    '  <Uwierzytelnienie>',
    '    <IdKontekstu>',
    `      <Nip>${params.sellerNip}</Nip>`,
    '    </IdKontekstu>',
    '    <NumerReferencyjnyTokenaKSeF>20260320-EC-1A2B3C4D5E-6F708192A3-B4</NumerReferencyjnyTokenaKSeF>',
    '  </Uwierzytelnienie>',
    '  <NazwaStrukturyLogicznej>Schemat_FA(3)_v1-0E.xsd</NazwaStrukturyLogicznej>',
    '  <KodFormularza>FA (3)</KodFormularza>',
    '  <Dokument>',
    `    <NipSprzedawcy>${params.sellerNip}</NipSprzedawcy>`,
    `    <NumerKSeFDokumentu>${params.ksefNumber}</NumerKSeFDokumentu>`,
    `    <NumerFaktury>${params.invoiceNumber}</NumerFaktury>`,
    `    <DataWystawieniaFaktury>${params.issueDate}</DataWystawieniaFaktury>`,
    '    <DataPrzeslaniaDokumentu>2026-03-20T12:01:02.000+01:00</DataPrzeslaniaDokumentu>',
    '    <DataNadaniaNumeruKSeF>2026-03-20T12:01:03.000+01:00</DataNadaniaNumeruKSeF>',
    `    <SkrotDokumentu>${params.documentHashBase64}</SkrotDokumentu>`,
    '    <TrybWysylki>Online</TrybWysylki>',
    '  </Dokument>',
    '</Potwierdzenie>',
  ].join('\n');
}

describe('KSeF 2.0 Test/Demo Sandbox Adapter, Crypto, Production Blocker & Idempotent Outbox (GLD-10)', () => {
  it('hard-blocks all production KSeF, e-Deklaracje, ZUS, and non-allowlisted hosts at construction and per-request', () => {
    const blockedUrls = [
      'https://ksef.mf.gov.pl/v2',
      'https://api.ksef.mf.gov.pl/v2',
      'https://prd.ksef.mf.gov.pl/v2',
      'https://ksef-prod.mf.gov.pl/v2',
      'https://e-deklaracje.mf.gov.pl/ws',
      'https://pue.zus.pl/api',
      'http://api-test.ksef.mf.gov.pl/v2', // insecure http blocked on test!
      'https://attacker:pass@api-test.ksef.mf.gov.pl/v2', // [P1-3] URL userinfo blocked!
      'https://api-test.ksef.mf.gov.pl:8443/v2', // [P1-3] non-443 port blocked!
    ];

    for (const badUrl of blockedUrls) {
      expect(() => assertAllowedKsefNonProductionEndpoint(badUrl, 'test')).toThrowError(
        KsefProductionEndpointBlockedError,
      );
      expect(
        () => new Ksef2SandboxAdapterService({ environment: 'test', baseUrl: badUrl }),
      ).toThrowError(KsefProductionEndpointBlockedError);
    }

    // local_mock rejects non-loopback domains too
    expect(() =>
      assertAllowedKsefNonProductionEndpoint('https://api.ksef.mf.gov.pl/v2', 'local_mock'),
    ).toThrowError(KsefProductionEndpointBlockedError);

    // Official TE and DEMO pass
    expect(
      assertAllowedKsefNonProductionEndpoint('https://api-test.ksef.mf.gov.pl/v2', 'test').hostname,
    ).toBe('api-test.ksef.mf.gov.pl');
    expect(
      assertAllowedKsefNonProductionEndpoint('https://api-demo.ksef.mf.gov.pl/v2', 'demo').hostname,
    ).toBe('api-demo.ksef.mf.gov.pl');
  });

  it('performs KSeF 2.0 RSA-OAEP SHA-256 token encryption and AES-256-CBC invoice encryption round-trips accurately', () => {
    const challengeTs = '2026-03-20T12:00:00.250Z';
    const expectedMs = Date.parse(challengeTs);
    const cipherToken = encryptKsefTokenRsaOaepSha256(
      'ksef-sandbox-secret-token',
      challengeTs,
      TEST_RSA_PUBLIC_PEM,
    );
    const decryptedToken = decryptKsefRsaOaepSha256(cipherToken, TEST_RSA_PRIVATE_PEM).toString(
      'utf8',
    );
    expect(decryptedToken).toBe(`ksef-sandbox-secret-token|${expectedMs}`);

    const sessionMat = createKsefSessionEncryptionMaterial(TEST_RSA_PUBLIC_PEM);
    const unwrappedAesKey = decryptKsefRsaOaepSha256(
      sessionMat.encryptionInfo.encryptedSymmetricKey,
      TEST_RSA_PRIVATE_PEM,
    );
    expect(Buffer.compare(unwrappedAesKey, sessionMat.symmetricKey)).toBe(0);

    const sampleXml = '<Faktura>Test</Faktura>';
    const enc = encryptKsefInvoiceAes256Cbc(
      sampleXml,
      sessionMat.symmetricKey,
      sessionMat.initializationVector,
    );
    expect(enc.invoiceSize).toBe(Buffer.byteLength(sampleXml, 'utf8'));
    const dec = decryptKsefInvoiceAes256Cbc(
      enc.encryptedInvoiceContent,
      sessionMat.symmetricKey,
      sessionMat.initializationVector,
    );
    expect(dec).toBe(sampleXml);
  });

  it('executes full KSeF 2.0 auth, pre-validated FA(3) issue, official UPO v4-3 XSD verification, retry on 429/503, outbox idempotency, and duplicate 440 reconciliation', async () => {
    const fa3Doc = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-20T12:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Nadawca Sandbox Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Prosta 10, 00-850 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Nabywca Sandbox Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Długa 4, 40-001 Katowice' },
      },
      invoiceNumber: 'FV/KSEF2/2026/03/01',
      issueDate: '2026-03-20',
      lines: [
        { description: 'Subskrypcja platformy księgowej', netGrosze: 400_000, vatRate: '23' },
      ],
    });

    const expectedHashBase64 = computeKsefBase64Sha256(Buffer.from(fa3Doc.xml, 'utf8'));
    const assignedKsefNo = buildSyntheticTestKsefNumber(SELLER_NIP, '20260320', 'A1B2C3D4E5F6');
    const sessionRef = '20260320-SE-1122334455-66778899AA-01';
    const upoRef = '20260320-UP-1122334455-66778899AA-02';

    const upoXml = buildSampleValidKsefUpoXml({
      sessionRef,
      sellerNip: SELLER_NIP,
      ksefNumber: assignedKsefNo,
      invoiceNumber: 'FV/KSEF2/2026/03/01',
      issueDate: '2026-03-20',
      documentHashBase64: expectedHashBase64,
    });

    // Verify standalone UPO v4-3 XSD validation + tamper detection
    const parsedUpo = validateAndParseKsefUpoXml(upoXml, {
      ksefNumber: assignedKsefNo,
      invoiceHashBase64: expectedHashBase64,
    });
    expect(parsedUpo.sessionReferenceNumber).toBe(sessionRef);
    expect(() =>
      validateAndParseKsefUpoXml(upoXml, {
        ksefNumber: assignedKsefNo,
        invoiceHashBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).toThrow(/SkrotDokumentu mismatch/);
    expect(() =>
      validateAndParseKsefUpoXml(upoXml, {
        ksefNumber: assignedKsefNo,
        invoiceHashBase64: expectedHashBase64,
        sessionReferenceNumber: '20260320-SE-0000000000-0000000000-99',
      }),
    ).toThrow(/NumerReferencyjnySesji mismatch/);

    const calls: KsefHttpRequest[] = [];
    let authPollCount = 0;
    let status429Injected = false;

    const outbox = new KsefIdempotentOutbox();
    const service = new Ksef2SandboxAdapterService({
      environment: 'local_mock',
      baseUrl: 'http://127.0.0.1:18080/v2',
      outbox,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        sleep: async () => {},
      },
      transport: {
        async send(req): Promise<KsefHttpResponse> {
          calls.push(req);
          const u = new URL(req.url);
          const p = u.pathname;

          if (req.method === 'GET' && p === '/v2/security/public-key-certificates') {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify([
                {
                  certificate: TEST_RSA_PUBLIC_PEM,
                  validFrom: '2026-01-01T00:00:00Z',
                  validTo: '2027-12-31T23:59:59Z',
                  usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
                },
              ]),
            };
          }

          if (req.method === 'POST' && p === '/v2/auth/challenge') {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                challenge: '20260320-CR-AABBCCDDEE-1122334455-01',
                timestamp: '2026-03-20T12:00:00.000Z',
                timestampMs: 1773998400000,
              }),
            };
          }

          if (req.method === 'POST' && p === '/v2/auth/ksef-token') {
            const body = JSON.parse(req.body ?? '{}') as { encryptedToken: string };
            const plain = decryptKsefRsaOaepSha256(
              body.encryptedToken,
              TEST_RSA_PRIVATE_PEM,
            ).toString('utf8');
            expect(plain).toBe('test-token-xyz|1773998400000');
            return {
              status: 202,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260320-AU-1111111111-2222222222-01',
                authenticationToken: {
                  token: 'auth-op-jwt',
                  validUntil: '2026-03-20T12:15:00Z',
                },
              }),
            };
          }

          if (req.method === 'GET' && p.startsWith('/v2/auth/20260320-AU-')) {
            authPollCount += 1;
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                status:
                  authPollCount === 1
                    ? { code: 100, description: 'Uwierzytelnianie w toku' }
                    : { code: 200, description: 'Uwierzytelnianie zakończone sukcesem' },
              }),
            };
          }

          if (req.method === 'POST' && p === '/v2/auth/token/redeem') {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                accessToken: { token: 'access-jwt-1', validUntil: '2026-03-20T13:00:00Z' },
                refreshToken: { token: 'refresh-jwt-1', validUntil: '2026-03-27T12:00:00Z' },
              }),
            };
          }

          if (req.method === 'POST' && p === '/v2/sessions/online') {
            return {
              status: 201,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: sessionRef,
                validUntil: '2026-03-20T14:00:00Z',
              }),
            };
          }

          if (req.method === 'POST' && p === `/v2/sessions/online/${sessionRef}/invoices`) {
            return {
              status: 202,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260320-EE-9988776655-4433221100-09',
              }),
            };
          }

          if (
            req.method === 'GET' &&
            p === `/v2/sessions/${sessionRef}/invoices/20260320-EE-9988776655-4433221100-09`
          ) {
            if (!status429Injected) {
              status429Injected = true;
              return {
                status: 429,
                headers: { 'retry-after': '0.001' },
                bodyText: JSON.stringify({ exception: 'Too Many Requests' }),
              };
            }
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260320-EE-9988776655-4433221100-09',
                ksefNumber: assignedKsefNo,
                acquisitionDate: '2026-03-20T12:01:03Z',
                status: { code: 200, description: 'Sukces' },
              }),
            };
          }

          if (req.method === 'POST' && p === `/v2/sessions/online/${sessionRef}/close`) {
            return { status: 204, headers: {}, bodyText: '' };
          }

          if (req.method === 'GET' && p === `/v2/sessions/${sessionRef}`) {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                status: { code: 200, description: 'Sesja zamknięta' },
                upo: {
                  pages: [
                    {
                      referenceNumber: upoRef,
                      downloadUrl: `http://127.0.0.1:18080/v2/sessions/${sessionRef}/upo/${upoRef}`,
                    },
                  ],
                },
              }),
            };
          }

          if (req.method === 'GET' && p === `/v2/sessions/${sessionRef}/upo/${upoRef}`) {
            return { status: 200, headers: {}, bodyText: upoXml };
          }

          throw new Error(`Unexpected mock KSeF route: ${req.method} ${req.url}`);
        },
      },
    });

    // 1. Read-only probe honestly reports auth not configured
    const probe = await service.probeEnvironmentReadOnly();
    expect(probe.reachable).toBe(true);
    expect(probe.hasKsefTokenEncryptionKey).toBe(true);
    expect(probe.verificationMode).toBe('live_readonly_probe_ok_auth_not_configured');

    // 2. [P1-3] Invalid FA(3) XML is rejected offline BEFORE making any KSeF session call AND without poisoning idempotencyKey!
    const callsBeforeInvalid = calls.length;
    await expect(
      service.issueFa3InvoiceOnline({
        tenantId: '11111111-1111-4111-8111-111111111111',
        legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
        idempotencyKey: 'idem-inv-001',
        sellerNip: SELLER_NIP,
        accessToken: 'access-jwt-1',
        fa3Xml: '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Bad/></Faktura>',
        symmetricKeyEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
      }),
    ).rejects.toThrow(KsefXmlPreValidationError);
    expect(calls.length).toBe(callsBeforeInvalid);

    // [P1-1] Invalid modulo-11 NIP is rejected before any network call
    await expect(
      service.authenticateWithKsefToken({
        contextNip: '5260001009',
        ksefToken: 'test-token-xyz',
        tokenEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
      }),
    ).rejects.toThrow(/modulo-11/);

    // 3. Token auth flow
    const tokens = await service.authenticateWithKsefToken({
      contextNip: SELLER_NIP,
      ksefToken: 'test-token-xyz',
      tokenEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
      pollIntervalMs: 1,
    });
    expect(tokens.accessToken.token).toBe('access-jwt-1');

    // 4. Online FA(3) submission + automatic HTTP 429 retry + official UPO v4-3 XSD validation
    const issued = await service.issueFa3InvoiceOnline({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
      idempotencyKey: 'idem-inv-001',
      sellerNip: SELLER_NIP,
      accessToken: tokens.accessToken.token,
      fa3Xml: fa3Doc.xml,
      symmetricKeyEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
      pollIntervalMs: 1,
    });
    expect(issued.outcome).toBe('accepted_ksef_number_assigned');
    expect(issued.ksefNumber).toBe(assignedKsefNo);
    expect(issued.upoStatus).toBe('validated_v4_3');
    expect(issued.replayedFromOutbox).toBe(false);

    // 5. Replaying same idempotencyKey returns cached result with ZERO new HTTP calls; divergent XML throws 409
    const callsBeforeReplay = calls.length;
    const replayed = await service.issueFa3InvoiceOnline({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
      idempotencyKey: 'idem-inv-001',
      sellerNip: SELLER_NIP,
      accessToken: tokens.accessToken.token,
      fa3Xml: fa3Doc.xml,
      symmetricKeyEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
    });
    expect(replayed.replayedFromOutbox).toBe(true);
    expect(calls.length).toBe(callsBeforeReplay);

    await expect(
      service.issueFa3InvoiceOnline({
        tenantId: '11111111-1111-4111-8111-111111111111',
        legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
        idempotencyKey: 'idem-inv-001',
        sellerNip: SELLER_NIP,
        accessToken: tokens.accessToken.token,
        fa3Xml: `${fa3Doc.xml}\n`,
        symmetricKeyEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
      }),
    ).rejects.toThrow(KsefIdempotencyConflictError);
  });

  it('reconciles KSeF 440 duplicate invoice status and syncs incoming Subject2 purchase invoices into ImmutableSourceDocumentArchive', async () => {
    const incomingXml = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-22T08:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Dostawca Energii Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Energetyczna 1, 00-001 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: BUYER_NIP },
        name: 'Moja Firma Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Przemysłowa 8, 40-002 Katowice' },
      },
      invoiceNumber: 'FV/ENERGIA/2026/03/88',
      issueDate: '2026-03-22',
      lines: [
        { description: 'Energia elektryczna marzec 2026', netGrosze: 250_000, vatRate: '23' },
      ],
    });

    const incomingKsefNo = buildSyntheticTestKsefNumber(SELLER_NIP, '20260322', '556677889900');
    const incomingHash = computeKsefBase64Sha256(Buffer.from(incomingXml.xml, 'utf8'));

    const archive = new ImmutableSourceDocumentArchive({
      authorizer: () => ({ allowed: true }),
    });

    const adapter = new Ksef2SandboxAdapterService({
      environment: 'local_mock',
      baseUrl: 'http://127.0.0.1:18081/v2',
      transport: {
        async send(req): Promise<KsefHttpResponse> {
          const p = new URL(req.url).pathname;
          if (req.method === 'POST' && p === '/v2/sessions/online') {
            return {
              status: 201,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260322-SE-0000000001-0000000001-01',
                validUntil: '2026-03-22T12:00:00Z',
              }),
            };
          }
          if (req.method === 'POST' && p.endsWith('/invoices')) {
            return {
              status: 202,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260322-EE-0000000001-0000000002-02',
              }),
            };
          }
          if (req.method === 'GET' && p.includes('/invoices/20260322-EE-')) {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                referenceNumber: '20260322-EE-0000000001-0000000002-02',
                status: {
                  code: 440,
                  description: 'Duplikat faktury',
                  extensions: { originalKsefNumber: incomingKsefNo },
                },
              }),
            };
          }
          if (req.method === 'POST' && p.endsWith('/close')) {
            return { status: 204, headers: {}, bodyText: '' };
          }
          if (req.method === 'POST' && p === '/v2/invoices/query/metadata') {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                hasMore: false,
                isTruncated: false,
                permanentStorageHwmDate: '2026-03-22T08:05:00Z',
                invoices: [
                  {
                    ksefNumber: incomingKsefNo,
                    invoiceNumber: 'FV/ENERGIA/2026/03/88',
                    issueDate: '2026-03-22',
                    invoicingDate: '2026-03-22T08:00:00Z',
                    seller: { nip: SELLER_NIP, name: 'Dostawca Energii Sp. z o.o.' },
                    buyer: {
                      identifier: { type: 'Nip', value: BUYER_NIP },
                      name: 'Moja Firma Sp. z o.o.',
                    },
                    netAmount: 2500,
                    grossAmount: 3075,
                    vatAmount: 575,
                    currency: 'PLN',
                    invoiceHash: incomingHash,
                  },
                ],
              }),
            };
          }
          if (req.method === 'GET' && p === `/v2/invoices/ksef/${incomingKsefNo}`) {
            return { status: 200, headers: {}, bodyText: incomingXml.xml };
          }
          throw new Error(`Unhandled route ${req.method} ${req.url}`);
        },
      },
    });

    // Duplicate 440 reconciliation
    const dupRes = await adapter.issueFa3InvoiceOnline({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
      idempotencyKey: 'idem-dup-440',
      sellerNip: SELLER_NIP,
      accessToken: 'tok',
      fa3Xml: incomingXml.xml,
      symmetricKeyEncryptionCertOrPem: TEST_RSA_PUBLIC_PEM,
    });
    expect(dupRes.outcome).toBe('duplicate_reconciled');
    expect(dupRes.ksefNumber).toBe(incomingKsefNo);
    expect(dupRes.upoXml).toBeNull();

    // First incoming sync -> stores in archive
    const sync1 = await adapter.syncIncomingInvoices({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
      buyerNip: BUYER_NIP,
      accessToken: 'tok',
      fromIso: '2026-03-01T00:00:00Z',
      toIso: '2026-03-31T23:59:59Z',
      archive,
    });
    expect(sync1.fetchedCount).toBe(1);
    expect(sync1.items[0]?.deduplicatedInArchive).toBe(false);
    expect(sync1.items[0]?.grossAmountGrosze).toBe(307_500);

    // Second incoming sync -> deduplicates cleanly against existing SHA-256 in archive
    const sync2 = await adapter.syncIncomingInvoices({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
      buyerNip: BUYER_NIP,
      accessToken: 'tok',
      fromIso: '2026-03-01T00:00:00Z',
      toIso: '2026-03-31T23:59:59Z',
      archive,
    });
    expect(sync2.items[0]?.deduplicatedInArchive).toBe(true);
    expect(sync2.items[0]?.archivedArtifactId).toBe(sync1.items[0]?.archivedArtifactId);

    // [P1-1] Subject2 sync MUST reject B2C <BrakID>1</BrakID> invoices where buyerNip is absent!
    const b2cIncomingXml = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-22T09:00:00Z',
      seller: {
        nip: SELLER_NIP,
        name: 'Dostawca Energii Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Energetyczna 1, 00-001 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'brak_id' },
        name: 'Konsument Prywatny',
      },
      invoiceNumber: 'FV/B2C-SPOOF/01',
      issueDate: '2026-03-22',
      lines: [{ description: 'Usługa B2C', netGrosze: 10_000, vatRate: '23' }],
    }).xml;
    const b2cKsefNo = buildSyntheticTestKsefNumber(SELLER_NIP, '2026-03-22', 'FFEEDDCCBBAA');
    const b2cAdapter = new Ksef2SandboxAdapterService({
      environment: 'local_mock',
      baseUrl: 'http://127.0.0.1:18082/v2',
      transport: {
        async send(req): Promise<KsefHttpResponse> {
          const p = new URL(req.url).pathname;
          if (req.method === 'POST' && p === '/v2/invoices/query/metadata') {
            return {
              status: 200,
              headers: {},
              bodyText: JSON.stringify({
                hasMore: false,
                isTruncated: false,
                invoices: [
                  {
                    ksefNumber: b2cKsefNo,
                    invoiceNumber: 'FV/B2C-SPOOF/01',
                    issueDate: '2026-03-22',
                    invoicingDate: '2026-03-22T09:00:00Z',
                    seller: { nip: SELLER_NIP },
                    buyer: { identifier: { type: 'None', value: null } },
                    netAmount: 100,
                    grossAmount: 123,
                    vatAmount: 23,
                    currency: 'PLN',
                  },
                ],
              }),
            };
          }
          if (req.method === 'GET' && p === `/v2/invoices/ksef/${b2cKsefNo}`) {
            return { status: 200, headers: {}, bodyText: b2cIncomingXml };
          }
          throw new Error(`Unexpected route ${req.url}`);
        },
      },
    });
    await expect(
      b2cAdapter.syncIncomingInvoices({
        tenantId: '11111111-1111-4111-8111-111111111111',
        legalEntityId: 'aaaaaaaa-1111-4111-8111-111111111111',
        buyerNip: BUYER_NIP,
        accessToken: 'tok',
        fromIso: '2026-03-01T00:00:00Z',
        toIso: '2026-03-31T23:59:59Z',
        archive,
      }),
    ).rejects.toThrow(/Subject2 invoice/);
  });
});
