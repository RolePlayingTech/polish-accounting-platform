import {
  X509Certificate,
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { validateKsefNumber, validatePolishNip } from '@pap/domain';

import { AccountingWorkspaceError } from '../accounting-workspace.js';

import {
  parseOfficialKsefFaXml,
  parseSafeXmlDomTree,
  type ParsedDocumentImportResult,
  type SafeXmlElementNode,
} from '../document-import-parsers.js';
import type { ImmutableSourceDocumentArchive } from '../source-archive/index.js';
import { validateOfficialMfXml, type XsdValidationResult } from '../xsd/index.js';

export type KsefNonProductionEnvironment = 'test' | 'demo' | 'local_mock';

export const OFFICIAL_KSEF2_BASE_URLS: Readonly<
  Record<Exclude<KsefNonProductionEnvironment, 'local_mock'>, string>
> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
};

const FORBIDDEN_PRODUCTION_HOSTS = new Set([
  'ksef.mf.gov.pl',
  'api.ksef.mf.gov.pl',
  'prd.ksef.mf.gov.pl',
  'ksef-prod.mf.gov.pl',
  'www.podatki.gov.pl',
  'e-deklaracje.mf.gov.pl',
  'klient-eformularz.mf.gov.pl',
  'pue.zus.pl',
]);

const ALLOWED_LOCAL_MOCK_HOSTS = new Set(['127.0.0.1', 'localhost', 'ksef-mock.local']);

export class KsefProductionEndpointBlockedError extends Error {
  readonly code = 'ksef_production_endpoint_blocked' as const;
  readonly attemptedUrl: string;

  constructor(attemptedUrl: string, detail: string) {
    super(`Blocked KSeF endpoint "${attemptedUrl}": ${detail}`);
    this.name = 'KsefProductionEndpointBlockedError';
    this.attemptedUrl = attemptedUrl;
  }
}

export class KsefXmlPreValidationError extends Error {
  readonly code = 'ksef_xml_prevalidation_failed' as const;
  readonly validation: XsdValidationResult | undefined;

  constructor(message: string, validation?: XsdValidationResult) {
    super(message);
    this.name = 'KsefXmlPreValidationError';
    this.validation = validation;
  }
}

export class KsefTransportError extends Error {
  readonly code:
    'ksef_transport_timeout' | 'ksef_rate_limited' | 'ksef_upstream_5xx' | 'ksef_http_error';
  readonly statusCode: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly responseBody: string | undefined;

  constructor(params: {
    code: 'ksef_transport_timeout' | 'ksef_rate_limited' | 'ksef_upstream_5xx' | 'ksef_http_error';
    message: string;
    statusCode?: number;
    retryAfterSeconds?: number;
    responseBody?: string;
  }) {
    super(params.message);
    this.name = 'KsefTransportError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.responseBody = params.responseBody;
  }

  get isRetryable(): boolean {
    return (
      this.code === 'ksef_transport_timeout' ||
      this.code === 'ksef_rate_limited' ||
      this.code === 'ksef_upstream_5xx'
    );
  }
}

export class KsefIdempotencyConflictError extends Error {
  readonly code = 'ksef_idempotency_conflict' as const;
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string, message: string) {
    super(message);
    this.name = 'KsefIdempotencyConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * Hard runtime guard enforcing that NO production KSeF, e-Deklaracje, or ZUS endpoint
 * can ever be contacted by this adapter.
 */
export function assertAllowedKsefNonProductionEndpoint(
  rawUrl: string,
  environment: KsefNonProductionEnvironment,
): URL {
  if (environment !== 'test' && environment !== 'demo' && environment !== 'local_mock') {
    throw new KsefProductionEndpointBlockedError(
      rawUrl,
      `Unsupported or production KSeF environment "${String(environment)}". Only "test", "demo", or "local_mock" are permitted.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new KsefProductionEndpointBlockedError(rawUrl, 'Malformed KSeF endpoint URL.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new KsefProductionEndpointBlockedError(
      rawUrl,
      'Embedded URL credentials (username/password) are strictly forbidden on KSeF endpoints.',
    );
  }

  const host = parsed.hostname.toLowerCase();

  if (FORBIDDEN_PRODUCTION_HOSTS.has(host)) {
    throw new KsefProductionEndpointBlockedError(
      rawUrl,
      `Host "${host}" is an official production government endpoint and is strictly hard-blocked.`,
    );
  }

  if (
    host.endsWith('.mf.gov.pl') &&
    host !== 'api-test.ksef.mf.gov.pl' &&
    host !== 'api-demo.ksef.mf.gov.pl'
  ) {
    throw new KsefProductionEndpointBlockedError(
      rawUrl,
      `Host "${host}" under *.mf.gov.pl is not on the non-production KSeF 2.0 allowlist.`,
    );
  }

  if (environment === 'test') {
    if (
      parsed.protocol !== 'https:' ||
      host !== 'api-test.ksef.mf.gov.pl' ||
      (parsed.port !== '' && parsed.port !== '443')
    ) {
      throw new KsefProductionEndpointBlockedError(
        rawUrl,
        'Environment "test" may only connect to https://api-test.ksef.mf.gov.pl on standard port 443.',
      );
    }
    if (!parsed.pathname.startsWith('/v2') && !parsed.pathname.startsWith('/docs/v2')) {
      throw new KsefProductionEndpointBlockedError(
        rawUrl,
        'Environment "test" path must start with /v2 or /docs/v2.',
      );
    }
    return parsed;
  }

  if (environment === 'demo') {
    if (
      parsed.protocol !== 'https:' ||
      host !== 'api-demo.ksef.mf.gov.pl' ||
      (parsed.port !== '' && parsed.port !== '443')
    ) {
      throw new KsefProductionEndpointBlockedError(
        rawUrl,
        'Environment "demo" may only connect to https://api-demo.ksef.mf.gov.pl on standard port 443.',
      );
    }
    if (!parsed.pathname.startsWith('/v2') && !parsed.pathname.startsWith('/docs/v2')) {
      throw new KsefProductionEndpointBlockedError(
        rawUrl,
        'Environment "demo" path must start with /v2 or /docs/v2.',
      );
    }
    return parsed;
  }

  if (!ALLOWED_LOCAL_MOCK_HOSTS.has(host)) {
    throw new KsefProductionEndpointBlockedError(
      rawUrl,
      `Environment "local_mock" may only target loopback/mock hosts (${[...ALLOWED_LOCAL_MOCK_HOSTS].join(', ')}), got "${host}".`,
    );
  }

  return parsed;
}

function resolvePublicKeyObject(publicKeyPemOrCertificateBase64: string) {
  const trimmed = publicKeyPemOrCertificateBase64.trim();
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) {
    return new X509Certificate(trimmed).publicKey;
  }
  if (
    trimmed.includes('-----BEGIN PUBLIC KEY-----') ||
    trimmed.includes('-----BEGIN RSA PUBLIC KEY-----')
  ) {
    return createPublicKey(trimmed);
  }
  const der = Buffer.from(trimmed, 'base64');
  try {
    return new X509Certificate(der).publicKey;
  } catch {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
}

export function normalizeChallengeTimestampMs(timestampIsoOrMs: string | number): number {
  if (typeof timestampIsoOrMs === 'number') {
    if (!Number.isInteger(timestampIsoOrMs) || timestampIsoOrMs <= 0) {
      throw new Error(`Invalid KSeF challenge timestampMs: ${timestampIsoOrMs}`);
    }
    return timestampIsoOrMs;
  }
  const parsedMs = Date.parse(timestampIsoOrMs);
  if (!Number.isFinite(parsedMs) || parsedMs <= 0) {
    throw new Error(`Invalid KSeF challenge timestamp ISO string: "${timestampIsoOrMs}"`);
  }
  return parsedMs;
}

/**
 * KSeF 2.0 `POST /auth/ksef-token` encryption:
 * Plaintext `${ksefToken}|${timestampMs}` encrypted with RSA-OAEP (SHA-256 + MGF1-SHA-256).
 */
export function encryptKsefTokenRsaOaepSha256(
  ksefToken: string,
  challengeTimestampIsoOrMs: string | number,
  publicKeyPemOrCertificateBase64: string,
): string {
  if (ksefToken.trim().length === 0) {
    throw new Error('KSeF token must not be empty.');
  }
  const timestampMs = normalizeChallengeTimestampMs(challengeTimestampIsoOrMs);
  const plaintext = Buffer.from(`${ksefToken}|${timestampMs}`, 'utf8');
  const publicKey = resolvePublicKeyObject(publicKeyPemOrCertificateBase64);
  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    plaintext,
  );
  return encrypted.toString('base64');
}

export function decryptKsefRsaOaepSha256(ciphertextBase64: string, privateKeyPem: string): Buffer {
  const privateKey = createPrivateKey(privateKeyPem);
  return privateDecrypt(
    {
      key: privateKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(ciphertextBase64, 'base64'),
  );
}

export interface KsefSessionEncryptionMaterial {
  symmetricKey: Buffer;
  initializationVector: Buffer;
  encryptionInfo: {
    encryptedSymmetricKey: string;
    initializationVector: string;
  };
}

export function createKsefSessionEncryptionMaterial(
  symmetricKeyPublicKeyPemOrCertBase64: string,
  deterministicSeed?: { symmetricKey: Buffer; initializationVector: Buffer },
): KsefSessionEncryptionMaterial {
  const symmetricKey = deterministicSeed
    ? Buffer.from(deterministicSeed.symmetricKey)
    : randomBytes(32);
  const initializationVector = deterministicSeed
    ? Buffer.from(deterministicSeed.initializationVector)
    : randomBytes(16);

  if (symmetricKey.byteLength !== 32) {
    throw new Error(
      `KSeF 2.0 AES-256 symmetric key must be 32 bytes, got ${symmetricKey.byteLength}.`,
    );
  }
  if (initializationVector.byteLength !== 16) {
    throw new Error(
      `KSeF 2.0 AES-256-CBC IV must be 16 bytes, got ${initializationVector.byteLength}.`,
    );
  }

  const publicKey = resolvePublicKeyObject(symmetricKeyPublicKeyPemOrCertBase64);
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    symmetricKey,
  );

  return {
    symmetricKey,
    initializationVector,
    encryptionInfo: {
      encryptedSymmetricKey: encryptedKey.toString('base64'),
      initializationVector: initializationVector.toString('base64'),
    },
  };
}

export interface KsefEncryptedInvoicePayload {
  invoiceHash: string;
  invoiceSize: number;
  encryptedInvoiceHash: string;
  encryptedInvoiceSize: number;
  encryptedInvoiceContent: string;
  offlineMode: boolean;
}

export function computeKsefBase64Sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64');
}

export function computeKsefHexSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function encryptKsefInvoiceAes256Cbc(
  xmlContent: string,
  symmetricKey: Buffer,
  initializationVector: Buffer,
  offlineMode = false,
): KsefEncryptedInvoicePayload {
  const plainBytes = Buffer.from(xmlContent, 'utf8');
  const cipher = createCipheriv('aes-256-cbc', symmetricKey, initializationVector);
  const encryptedBytes = Buffer.concat([cipher.update(plainBytes), cipher.final()]);

  return {
    invoiceHash: computeKsefBase64Sha256(plainBytes),
    invoiceSize: plainBytes.byteLength,
    encryptedInvoiceHash: computeKsefBase64Sha256(encryptedBytes),
    encryptedInvoiceSize: encryptedBytes.byteLength,
    encryptedInvoiceContent: encryptedBytes.toString('base64'),
    offlineMode,
  };
}

export function decryptKsefInvoiceAes256Cbc(
  encryptedInvoiceContentBase64: string,
  symmetricKey: Buffer,
  initializationVector: Buffer,
): string {
  const encryptedBytes = Buffer.from(encryptedInvoiceContentBase64, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', symmetricKey, initializationVector);
  const plainBytes = Buffer.concat([decipher.update(encryptedBytes), decipher.final()]);
  return plainBytes.toString('utf8');
}

export interface KsefHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export interface KsefHttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface KsefHttpTransport {
  send(request: KsefHttpRequest): Promise<KsefHttpResponse>;
}

export function createFetchKsefHttpTransport(options?: { timeoutMs?: number }): KsefHttpTransport {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  return {
    async send(request: KsefHttpRequest): Promise<KsefHttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
          signal: controller.signal,
        };
        if (request.body !== undefined) {
          init.body = request.body;
        }
        const response = await fetch(request.url, init);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        const bodyText = await response.text();
        return {
          status: response.status,
          headers,
          bodyText,
        };
      } catch (error) {
        const isAbort =
          error instanceof Error &&
          (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
        if (isAbort) {
          throw new KsefTransportError({
            code: 'ksef_transport_timeout',
            message: `KSeF HTTP request timed out after ${timeoutMs}ms (${request.method} ${request.url}).`,
          });
        }
        throw new KsefTransportError({
          code: 'ksef_upstream_5xx',
          message: `KSeF network error (${request.method} ${request.url}): ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface KsefPublicKeyCertificateDto {
  certificate: string;
  validFrom: string;
  validTo: string;
  usage: ReadonlyArray<'KsefTokenEncryption' | 'SymmetricKeyEncryption'>;
}

export interface KsefAuthChallengeDto {
  challenge: string;
  timestamp: string;
  timestampMs?: number;
}

export interface KsefTokenInfoDto {
  token: string;
  validUntil: string;
}

export interface KsefAuthInitResponseDto {
  referenceNumber: string;
  authenticationToken: KsefTokenInfoDto;
}

export interface KsefStatusInfoDto {
  code: number;
  description: string;
  details?: ReadonlyArray<string>;
  extensions?: Record<string, string | null>;
}

export interface KsefAuthStatusResponseDto {
  startDate?: string;
  authenticationMethod?: string;
  status: KsefStatusInfoDto;
}

export interface KsefTokensResponseDto {
  accessToken: KsefTokenInfoDto;
  refreshToken: KsefTokenInfoDto;
}

export interface KsefOpenOnlineSessionResponseDto {
  referenceNumber: string;
  validUntil: string;
}

export interface KsefSendInvoiceResponseDto {
  referenceNumber: string;
}

export interface KsefSessionInvoiceStatusDto {
  ordinalNumber?: number;
  invoiceNumber?: string | null;
  ksefNumber?: string | null;
  referenceNumber: string;
  invoiceHash?: string;
  invoicingDate?: string;
  acquisitionDate?: string | null;
  permanentStorageDate?: string | null;
  upoDownloadUrl?: string | null;
  status: KsefStatusInfoDto;
}

export interface KsefSessionStatusDto {
  status: KsefStatusInfoDto;
  invoiceCount?: number | null;
  successfulInvoiceCount?: number | null;
  failedInvoiceCount?: number | null;
  upo?: {
    pages: ReadonlyArray<{
      referenceNumber: string;
      downloadUrl: string;
    }>;
  } | null;
}

export interface KsefInvoiceMetadataItemDto {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  acquisitionDate?: string;
  permanentStorageDate?: string;
  seller: {
    nip: string;
    name?: string | null;
  };
  buyer: {
    identifier: {
      type: 'Nip' | 'VatUe' | 'Other' | 'None';
      value?: string | null;
    };
    name?: string | null;
  };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoiceType?: string;
  formCode?: {
    systemCode: string;
    schemaVersion: string;
    value: string;
  };
  invoiceHash?: string;
}

export interface KsefQueryInvoicesMetadataResponseDto {
  hasMore: boolean;
  isTruncated: boolean;
  permanentStorageHwmDate?: string | null;
  invoices: ReadonlyArray<KsefInvoiceMetadataItemDto>;
}

export interface ValidatedKsefUpoDocumentItem {
  sellerNip: string;
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  submissionTimestamp: string;
  ksefAssignmentTimestamp: string;
  documentHashBase64: string;
  submissionMode: 'Online' | 'Offline';
}

export interface ValidatedKsefUpoSummary {
  receivingAuthorityName: string;
  sessionReferenceNumber: string;
  contextNip: string | null;
  logicalStructureName: string;
  formCode: string;
  documents: ReadonlyArray<ValidatedKsefUpoDocumentItem>;
  upoSha256Hex: string;
}

function findDirectChild(
  parent: SafeXmlElementNode,
  localName: string,
): SafeXmlElementNode | undefined {
  return parent.children.find((child) => child.localName === localName);
}

function findDirectChildren(parent: SafeXmlElementNode, localName: string): SafeXmlElementNode[] {
  return parent.children.filter((child) => child.localName === localName);
}

function getNodeTrimmedText(node: SafeXmlElementNode | undefined): string {
  return node ? node.textChunks.join('').trim() : '';
}

function requireChildText(parent: SafeXmlElementNode, localName: string): string {
  const child = findDirectChild(parent, localName);
  const value = getNodeTrimmedText(child);
  if (!value) {
    throw new Error(`Missing required element <${localName}> in KSeF UPO XML.`);
  }
  return value;
}

/**
 * Validates an official KSeF UPO v4-3 XML document against `ksef_upo_v4-3.xsd`
 * and optionally verifies that a specific invoice's `NumerKSeFDokumentu` and `SkrotDokumentu`
 * match the submitted FA(3) XML bytes.
 */
export function validateAndParseKsefUpoXml(
  upoXml: string,
  expectedInvoice?: {
    ksefNumber: string;
    invoiceHashBase64: string;
    sessionReferenceNumber?: string;
  },
): ValidatedKsefUpoSummary {
  const xsdResult = validateOfficialMfXml(upoXml, 'KSEF_UPO(4-3)');
  if (!xsdResult.valid) {
    const firstIssue =
      xsdResult.issues[0]?.message ?? 'UPO XML failed official KSeF v4-3 XSD validation.';
    throw new Error(`Invalid KSeF UPO v4-3 XML: ${firstIssue}`);
  }

  const root = parseSafeXmlDomTree(upoXml);
  if (root.localName !== 'Potwierdzenie') {
    throw new Error(`Unexpected UPO root element <${root.localName}>.`);
  }

  const receivingAuthorityName = requireChildText(root, 'NazwaPodmiotuPrzyjmujacego');
  const sessionReferenceNumber = requireChildText(root, 'NumerReferencyjnySesji');
  const authNode = findDirectChild(root, 'Uwierzytelnienie');
  const contextNode = authNode ? findDirectChild(authNode, 'IdKontekstu') : undefined;
  const contextNip = contextNode
    ? getNodeTrimmedText(findDirectChild(contextNode, 'Nip')) || null
    : null;
  const logicalStructureName = requireChildText(root, 'NazwaStrukturyLogicznej');
  const formCode = requireChildText(root, 'KodFormularza');

  const documents: ValidatedKsefUpoDocumentItem[] = findDirectChildren(root, 'Dokument').map(
    (doc) => {
      const ksefNumber = requireChildText(doc, 'NumerKSeFDokumentu');
      const modeRaw = requireChildText(doc, 'TrybWysylki');
      if (modeRaw !== 'Online' && modeRaw !== 'Offline') {
        throw new Error(`Unsupported UPO TrybWysylki "${modeRaw}".`);
      }
      return {
        sellerNip: requireChildText(doc, 'NipSprzedawcy'),
        ksefNumber,
        invoiceNumber: requireChildText(doc, 'NumerFaktury'),
        issueDate: requireChildText(doc, 'DataWystawieniaFaktury'),
        submissionTimestamp: requireChildText(doc, 'DataPrzeslaniaDokumentu'),
        ksefAssignmentTimestamp: requireChildText(doc, 'DataNadaniaNumeruKSeF'),
        documentHashBase64: requireChildText(doc, 'SkrotDokumentu'),
        submissionMode: modeRaw,
      };
    },
  );

  if (expectedInvoice) {
    if (
      expectedInvoice.sessionReferenceNumber !== undefined &&
      sessionReferenceNumber !== expectedInvoice.sessionReferenceNumber
    ) {
      throw new Error(
        `KSeF UPO NumerReferencyjnySesji mismatch: expected "${expectedInvoice.sessionReferenceNumber}", got "${sessionReferenceNumber}".`,
      );
    }
    const matched = documents.find((d) => d.ksefNumber === expectedInvoice.ksefNumber);
    if (!matched) {
      throw new Error(
        `KSeF UPO XML does not contain expected KSeF number "${expectedInvoice.ksefNumber}".`,
      );
    }
    if (matched.documentHashBase64 !== expectedInvoice.invoiceHashBase64) {
      throw new Error(
        `KSeF UPO SkrotDokumentu mismatch for "${expectedInvoice.ksefNumber}": expected "${expectedInvoice.invoiceHashBase64}", got "${matched.documentHashBase64}".`,
      );
    }
  }

  return {
    receivingAuthorityName,
    sessionReferenceNumber,
    contextNip,
    logicalStructureName,
    formCode,
    documents,
    upoSha256Hex: computeKsefHexSha256(Buffer.from(upoXml, 'utf8')),
  };
}

export interface KsefRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export const DEFAULT_KSEF_RETRY_POLICY: KsefRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
};

export function computeKsefRetryDelayMs(
  attemptIndexZeroBased: number,
  policy: KsefRetryPolicy,
  retryAfterSeconds?: number,
): number {
  if (
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    return Math.min(policy.maxDelayMs, Math.round(retryAfterSeconds * 1000));
  }
  const exp = policy.baseDelayMs * Math.pow(2, attemptIndexZeroBased);
  return Math.min(policy.maxDelayMs, exp);
}

async function defaultSleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface KsefReadOnlyProbeResult {
  environment: KsefNonProductionEnvironment;
  baseUrl: string;
  reachable: boolean;
  httpStatus: number | null;
  certificatesCount: number;
  hasKsefTokenEncryptionKey: boolean;
  hasSymmetricKeyEncryptionKey: boolean;
  liveAuthCredentialsConfigured: boolean;
  verificationMode:
    | 'live_readonly_probe_ok_auth_not_configured'
    | 'live_readonly_probe_ok_auth_configured'
    | 'probe_unreachable';
  detail: string;
}

export interface KsefIssueFa3InvoiceInput {
  tenantId: string;
  legalEntityId: string;
  idempotencyKey: string;
  sellerNip: string;
  accessToken: string;
  fa3Xml: string;
  symmetricKeyEncryptionCertOrPem: string;
  deterministicEncryptionSeed?: {
    symmetricKey: Buffer;
    initializationVector: Buffer;
  };
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
}

export type KsefIssueFa3InvoiceOutcomeStatus =
  | 'accepted_ksef_number_assigned'
  | 'accepted_pending_upo'
  | 'duplicate_reconciled'
  | 'rejected_by_ksef';

export interface KsefIssueFa3InvoiceResult {
  outcome: KsefIssueFa3InvoiceOutcomeStatus;
  idempotencyKey: string;
  replayedFromOutbox: boolean;
  sessionReferenceNumber: string;
  invoiceReferenceNumber: string;
  ksefNumber: string | null;
  invoiceSha256Base64: string;
  invoiceSha256Hex: string;
  acquisitionDate: string | null;
  upoStatus: 'validated_v4_3' | 'pending_external_upo' | 'not_applicable';
  upoXml: string | null;
  validatedUpo: ValidatedKsefUpoSummary | null;
  ksefStatusCode: number;
  ksefStatusDescription: string;
}

export interface KsefSyncedIncomingInvoiceItem {
  ksefNumber: string;
  invoiceNumber: string;
  sellerNip: string;
  buyerNip: string | null;
  grossAmountGrosze: number;
  netAmountGrosze: number;
  vatAmountGrosze: number;
  currency: string;
  schemaVersion: 'FA(2)' | 'FA(3)';
  parsedXml: ParsedDocumentImportResult;
  archivedArtifactId: string | null;
  deduplicatedInArchive: boolean;
}

export interface KsefSyncIncomingInvoicesResult {
  fetchedCount: number;
  hasMore: boolean;
  isTruncated: boolean;
  permanentStorageHwmDate: string | null;
  items: ReadonlyArray<KsefSyncedIncomingInvoiceItem>;
}

interface OutboxRecordState {
  tenantId: string;
  legalEntityId: string;
  idempotencyKey: string;
  payloadSha256Hex: string;
  sellerNip: string;
  sessionReferenceNumber?: string;
  invoiceReferenceNumber?: string;
  encryptionMaterial?: KsefSessionEncryptionMaterial;
  sessionClosed?: boolean;
  completedResult?: KsefIssueFa3InvoiceResult;
}

export class KsefIdempotentOutbox {
  private readonly records = new Map<string, OutboxRecordState>();

  private buildScopeKey(tenantId: string, legalEntityId: string, idempotencyKey: string): string {
    return `${tenantId}::${legalEntityId}::${idempotencyKey}`;
  }

  peekOrVerifyExisting(params: {
    tenantId: string;
    legalEntityId: string;
    idempotencyKey: string;
    payloadSha256Hex: string;
    sellerNip: string;
  }): OutboxRecordState | undefined {
    const scopeKey = this.buildScopeKey(
      params.tenantId,
      params.legalEntityId,
      params.idempotencyKey,
    );
    const existing = this.records.get(scopeKey);
    if (!existing) {
      return undefined;
    }
    if (
      existing.payloadSha256Hex !== params.payloadSha256Hex ||
      existing.sellerNip !== params.sellerNip
    ) {
      throw new KsefIdempotencyConflictError(
        params.idempotencyKey,
        `Idempotency key "${params.idempotencyKey}" was already used with a different FA(3) XML payload or seller NIP (${existing.payloadSha256Hex} !== ${params.payloadSha256Hex}).`,
      );
    }
    return existing;
  }

  acquireOrVerify(params: {
    tenantId: string;
    legalEntityId: string;
    idempotencyKey: string;
    payloadSha256Hex: string;
    sellerNip: string;
  }): OutboxRecordState {
    const existing = this.peekOrVerifyExisting(params);
    if (existing) {
      return existing;
    }

    const scopeKey = this.buildScopeKey(
      params.tenantId,
      params.legalEntityId,
      params.idempotencyKey,
    );
    const created: OutboxRecordState = {
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      idempotencyKey: params.idempotencyKey,
      payloadSha256Hex: params.payloadSha256Hex,
      sellerNip: params.sellerNip,
    };
    this.records.set(scopeKey, created);
    return created;
  }
}

export interface Ksef2SandboxAdapterOptions {
  environment: KsefNonProductionEnvironment;
  baseUrl?: string;
  transport?: KsefHttpTransport;
  retryPolicy?: Partial<KsefRetryPolicy>;
  outbox?: KsefIdempotentOutbox;
  liveAuthConfigured?: boolean;
}

export class Ksef2SandboxAdapterService {
  readonly environment: KsefNonProductionEnvironment;
  readonly baseUrl: string;
  private readonly transport: KsefHttpTransport;
  private readonly retryPolicy: KsefRetryPolicy;
  private readonly outbox: KsefIdempotentOutbox;
  private readonly liveAuthConfigured: boolean;

  constructor(options: Ksef2SandboxAdapterOptions) {
    this.environment = options.environment;
    const resolvedBaseUrl =
      options.baseUrl ??
      (options.environment === 'local_mock'
        ? 'http://127.0.0.1:18080/v2'
        : OFFICIAL_KSEF2_BASE_URLS[options.environment]);
    const validatedUrl = assertAllowedKsefNonProductionEndpoint(
      resolvedBaseUrl,
      options.environment,
    );
    this.baseUrl = validatedUrl.toString().replace(/\/+$/, '');
    this.transport = options.transport ?? createFetchKsefHttpTransport();
    this.retryPolicy = {
      ...DEFAULT_KSEF_RETRY_POLICY,
      ...options.retryPolicy,
    };
    this.outbox = options.outbox ?? new KsefIdempotentOutbox();
    this.liveAuthConfigured = Boolean(options.liveAuthConfigured);
  }

  private buildEndpointUrl(relativePath: string): string {
    const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    const fullUrl = `${this.baseUrl}${normalizedPath}`;
    assertAllowedKsefNonProductionEndpoint(fullUrl, this.environment);
    return fullUrl;
  }

  private async requestWithRetry(params: {
    method: 'GET' | 'POST';
    pathOrUrl: string;
    accessToken?: string;
    accept?: string;
    contentType?: string;
    body?: string;
    idempotentOperation: boolean;
  }): Promise<KsefHttpResponse> {
    const url =
      params.pathOrUrl.startsWith('http://') || params.pathOrUrl.startsWith('https://')
        ? assertAllowedKsefNonProductionEndpoint(params.pathOrUrl, this.environment).toString()
        : this.buildEndpointUrl(params.pathOrUrl);

    const headers: Record<string, string> = {
      Accept: params.accept ?? 'application/json',
    };
    if (params.accessToken) {
      headers.Authorization = `Bearer ${params.accessToken}`;
    }
    if (params.body !== undefined) {
      headers['Content-Type'] = params.contentType ?? 'application/json';
    }

    const maxAttempts = params.idempotentOperation ? this.retryPolicy.maxAttempts : 1;
    const sleepFn = this.retryPolicy.sleep ?? defaultSleep;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await this.transport.send({
          method: params.method,
          url,
          headers,
          body: params.body,
        });

        if (response.status === 429) {
          const retryAfterRaw = response.headers['retry-after'];
          const retryAfterSec = retryAfterRaw !== undefined ? Number(retryAfterRaw) : undefined;
          throw new KsefTransportError({
            code: 'ksef_rate_limited',
            message: `KSeF rate limit HTTP 429 on ${params.method} ${url}.`,
            statusCode: 429,
            ...(retryAfterSec !== undefined && Number.isFinite(retryAfterSec)
              ? { retryAfterSeconds: retryAfterSec }
              : {}),
            responseBody: response.bodyText,
          });
        }

        if (response.status >= 500) {
          throw new KsefTransportError({
            code: 'ksef_upstream_5xx',
            message: `KSeF upstream error HTTP ${response.status} on ${params.method} ${url}.`,
            statusCode: response.status,
            responseBody: response.bodyText,
          });
        }

        if (response.status >= 400) {
          throw new KsefTransportError({
            code: 'ksef_http_error',
            message: `KSeF client/validation error HTTP ${response.status} on ${params.method} ${url}: ${response.bodyText.slice(0, 300)}`,
            statusCode: response.status,
            responseBody: response.bodyText,
          });
        }

        return response;
      } catch (error) {
        lastError = error;
        const canRetry =
          attempt + 1 < maxAttempts && error instanceof KsefTransportError && error.isRetryable;
        if (!canRetry) {
          throw error;
        }
        const delayMs = computeKsefRetryDelayMs(
          attempt,
          this.retryPolicy,
          error instanceof KsefTransportError ? error.retryAfterSeconds : undefined,
        );
        await sleepFn(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('KSeF request failed.');
  }

  private parseJsonResponse<T>(response: KsefHttpResponse, context: string): T {
    try {
      return JSON.parse(response.bodyText) as T;
    } catch {
      throw new Error(`Invalid JSON from KSeF (${context}): ${response.bodyText.slice(0, 200)}`);
    }
  }

  /**
   * Read-only probe against official MF KSeF 2.0 Test/Demo public-key endpoint.
   * Zero company data, zero NIPs, zero tokens transmitted.
   */
  async probeEnvironmentReadOnly(): Promise<KsefReadOnlyProbeResult> {
    try {
      const response = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: '/security/public-key-certificates',
        idempotentOperation: true,
      });
      const certs = this.parseJsonResponse<ReadonlyArray<KsefPublicKeyCertificateDto>>(
        response,
        'GET /security/public-key-certificates',
      );
      const hasKsefTokenEncryptionKey = certs.some((c) => c.usage.includes('KsefTokenEncryption'));
      const hasSymmetricKeyEncryptionKey = certs.some((c) =>
        c.usage.includes('SymmetricKeyEncryption'),
      );
      return {
        environment: this.environment,
        baseUrl: this.baseUrl,
        reachable: true,
        httpStatus: response.status,
        certificatesCount: certs.length,
        hasKsefTokenEncryptionKey,
        hasSymmetricKeyEncryptionKey,
        liveAuthCredentialsConfigured: this.liveAuthConfigured,
        verificationMode: this.liveAuthConfigured
          ? 'live_readonly_probe_ok_auth_configured'
          : 'live_readonly_probe_ok_auth_not_configured',
        detail: this.liveAuthConfigured
          ? 'Public KSeF 2.0 endpoint reachable and sandbox credentials configured.'
          : 'Public KSeF 2.0 endpoint reachable; authenticated E2E NOT RUN because owner sandbox NIP/token is not configured.',
      };
    } catch (error) {
      return {
        environment: this.environment,
        baseUrl: this.baseUrl,
        reachable: false,
        httpStatus: error instanceof KsefTransportError ? (error.statusCode ?? null) : null,
        certificatesCount: 0,
        hasKsefTokenEncryptionKey: false,
        hasSymmetricKeyEncryptionKey: false,
        liveAuthCredentialsConfigured: this.liveAuthConfigured,
        verificationMode: 'probe_unreachable',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async fetchPublicKeyCertificates(): Promise<ReadonlyArray<KsefPublicKeyCertificateDto>> {
    const response = await this.requestWithRetry({
      method: 'GET',
      pathOrUrl: '/security/public-key-certificates',
      idempotentOperation: true,
    });
    return this.parseJsonResponse<ReadonlyArray<KsefPublicKeyCertificateDto>>(
      response,
      'GET /security/public-key-certificates',
    );
  }

  async authenticateWithKsefToken(params: {
    contextNip: string;
    ksefToken: string;
    tokenEncryptionCertOrPem: string;
    pollMaxAttempts?: number;
    pollIntervalMs?: number;
  }): Promise<KsefTokensResponseDto> {
    if (
      !/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(params.contextNip) ||
      !validatePolishNip(params.contextNip).valid
    ) {
      throw new Error(
        `Invalid Polish 10-digit NIP (or modulo-11 checksum) for KSeF context: "${params.contextNip}".`,
      );
    }

    const challengeResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: '/auth/challenge',
      idempotentOperation: true,
    });
    const challenge = this.parseJsonResponse<KsefAuthChallengeDto>(
      challengeResp,
      'POST /auth/challenge',
    );

    const encryptedToken = encryptKsefTokenRsaOaepSha256(
      params.ksefToken,
      challenge.timestampMs ?? challenge.timestamp,
      params.tokenEncryptionCertOrPem,
    );

    const initResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: '/auth/ksef-token',
      body: JSON.stringify({
        challenge: challenge.challenge,
        contextIdentifier: {
          type: 'Nip',
          value: params.contextNip,
        },
        encryptedToken,
      }),
      idempotentOperation: false,
    });
    const initDto = this.parseJsonResponse<KsefAuthInitResponseDto>(
      initResp,
      'POST /auth/ksef-token',
    );

    await this.pollAuthenticationUntilSucceeded({
      referenceNumber: initDto.referenceNumber,
      authenticationToken: initDto.authenticationToken.token,
      pollMaxAttempts: params.pollMaxAttempts ?? 10,
      pollIntervalMs: params.pollIntervalMs ?? 50,
    });

    const redeemResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: '/auth/token/redeem',
      accessToken: initDto.authenticationToken.token,
      idempotentOperation: false,
    });
    return this.parseJsonResponse<KsefTokensResponseDto>(redeemResp, 'POST /auth/token/redeem');
  }

  async authenticateWithXadesSignature(params: {
    signedAuthTokenRequestXml: string;
    verifyCertificateChain?: boolean;
    pollMaxAttempts?: number;
    pollIntervalMs?: number;
  }): Promise<KsefTokensResponseDto> {
    parseSafeXmlDomTree(params.signedAuthTokenRequestXml);
    const query =
      params.verifyCertificateChain !== undefined
        ? `?verifyCertificateChain=${params.verifyCertificateChain ? 'true' : 'false'}`
        : '';
    const initResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: `/auth/xades-signature${query}`,
      contentType: 'application/xml',
      body: params.signedAuthTokenRequestXml,
      idempotentOperation: false,
    });
    const initDto = this.parseJsonResponse<KsefAuthInitResponseDto>(
      initResp,
      'POST /auth/xades-signature',
    );

    await this.pollAuthenticationUntilSucceeded({
      referenceNumber: initDto.referenceNumber,
      authenticationToken: initDto.authenticationToken.token,
      pollMaxAttempts: params.pollMaxAttempts ?? 10,
      pollIntervalMs: params.pollIntervalMs ?? 50,
    });

    const redeemResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: '/auth/token/redeem',
      accessToken: initDto.authenticationToken.token,
      idempotentOperation: false,
    });
    return this.parseJsonResponse<KsefTokensResponseDto>(redeemResp, 'POST /auth/token/redeem');
  }

  async refreshAccessToken(refreshToken: string): Promise<KsefTokenInfoDto> {
    const resp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: '/auth/token/refresh',
      accessToken: refreshToken,
      idempotentOperation: true,
    });
    const parsed = this.parseJsonResponse<{ accessToken: KsefTokenInfoDto }>(
      resp,
      'POST /auth/token/refresh',
    );
    return parsed.accessToken;
  }

  private async pollAuthenticationUntilSucceeded(params: {
    referenceNumber: string;
    authenticationToken: string;
    pollMaxAttempts: number;
    pollIntervalMs: number;
  }): Promise<void> {
    const sleepFn = this.retryPolicy.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < params.pollMaxAttempts; attempt += 1) {
      const statusResp = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: `/auth/${encodeURIComponent(params.referenceNumber)}`,
        accessToken: params.authenticationToken,
        idempotentOperation: true,
      });
      const statusDto = this.parseJsonResponse<KsefAuthStatusResponseDto>(
        statusResp,
        'GET /auth/{referenceNumber}',
      );
      if (statusDto.status.code === 200) {
        return;
      }
      if (statusDto.status.code >= 400) {
        throw new Error(
          `KSeF authentication rejected (${statusDto.status.code}): ${statusDto.status.description}`,
        );
      }
      await sleepFn(params.pollIntervalMs);
    }
    throw new Error(
      `KSeF authentication polling exceeded ${params.pollMaxAttempts} attempts for ${params.referenceNumber}.`,
    );
  }

  /**
   * Pre-validates FA(3) XML against official MF `FA(3)` XSD (`13775`), opens an encrypted
   * KSeF 2.0 interactive session, submits the AES-256-CBC encrypted invoice, reconciles
   * retries/duplicates via `KsefIdempotentOutbox`, closes the session, and validates any
   * returned UPO XML against official `ksef_upo_v4-3.xsd` (NEVER fabricating UPOs).
   */
  async issueFa3InvoiceOnline(input: KsefIssueFa3InvoiceInput): Promise<KsefIssueFa3InvoiceResult> {
    if (
      !/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(input.sellerNip) ||
      !validatePolishNip(input.sellerNip).valid
    ) {
      throw new KsefXmlPreValidationError(
        `Invalid KSeF session seller NIP "${input.sellerNip}" (must be 10 digits with valid modulo-11 checksum).`,
      );
    }

    const xmlBytes = Buffer.from(input.fa3Xml, 'utf8');
    const payloadSha256Hex = computeKsefHexSha256(xmlBytes);
    const payloadSha256Base64 = computeKsefBase64Sha256(xmlBytes);

    // Check existing outbox record first without poisoning idempotencyKey on invalid XML
    const existingRecord = this.outbox.peekOrVerifyExisting({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      idempotencyKey: input.idempotencyKey,
      payloadSha256Hex,
      sellerNip: input.sellerNip,
    });

    if (existingRecord?.completedResult) {
      return {
        ...existingRecord.completedResult,
        replayedFromOutbox: true,
      };
    }

    // Fail-closed pre-validation against official MF FA(3) XSD BEFORE acquiring outbox slot or touching network!
    const xsdValidation = validateOfficialMfXml(input.fa3Xml, 'FA(3)');
    if (!xsdValidation.valid) {
      throw new KsefXmlPreValidationError(
        `Refusing to send FA(3) XML to KSeF: official MF XSD validation failed (${xsdValidation.issues[0]?.message ?? 'unknown XSD error'}).`,
        xsdValidation,
      );
    }
    const parsedInvoice = parseOfficialKsefFaXml(input.fa3Xml, { expectedVariant: 'FA(3)' });
    if (parsedInvoice.sellerNip !== input.sellerNip) {
      throw new KsefXmlPreValidationError(
        `FA(3) Podmiot1 NIP (${parsedInvoice.sellerNip}) does not match KSeF session seller NIP (${input.sellerNip}).`,
      );
    }

    const record = this.outbox.acquireOrVerify({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      idempotencyKey: input.idempotencyKey,
      payloadSha256Hex,
      sellerNip: input.sellerNip,
    });

    if (!record.encryptionMaterial) {
      record.encryptionMaterial = createKsefSessionEncryptionMaterial(
        input.symmetricKeyEncryptionCertOrPem,
        input.deterministicEncryptionSeed,
      );
    }

    if (!record.sessionReferenceNumber) {
      const openSessionResp = await this.requestWithRetry({
        method: 'POST',
        pathOrUrl: '/sessions/online',
        accessToken: input.accessToken,
        body: JSON.stringify({
          formCode: {
            systemCode: 'FA (3)',
            schemaVersion: '1-0E',
            value: 'FA',
          },
          encryption: record.encryptionMaterial.encryptionInfo,
        }),
        idempotentOperation: true,
      });
      const openDto = this.parseJsonResponse<KsefOpenOnlineSessionResponseDto>(
        openSessionResp,
        'POST /sessions/online',
      );
      record.sessionReferenceNumber = openDto.referenceNumber;
    }

    if (!record.invoiceReferenceNumber) {
      const encryptedPayload = encryptKsefInvoiceAes256Cbc(
        input.fa3Xml,
        record.encryptionMaterial.symmetricKey,
        record.encryptionMaterial.initializationVector,
        false,
      );
      const sendResp = await this.requestWithRetry({
        method: 'POST',
        pathOrUrl: `/sessions/online/${encodeURIComponent(record.sessionReferenceNumber)}/invoices`,
        accessToken: input.accessToken,
        body: JSON.stringify(encryptedPayload),
        // Do NOT blind-retry POST /invoices without recording invoiceReferenceNumber;
        // caller retries via outbox if transport times out.
        idempotentOperation: false,
      });
      const sendDto = this.parseJsonResponse<KsefSendInvoiceResponseDto>(
        sendResp,
        'POST /sessions/online/{referenceNumber}/invoices',
      );
      record.invoiceReferenceNumber = sendDto.referenceNumber;
    }

    const invoiceStatus = await this.pollInvoiceStatus({
      accessToken: input.accessToken,
      sessionReferenceNumber: record.sessionReferenceNumber,
      invoiceReferenceNumber: record.invoiceReferenceNumber,
      pollMaxAttempts: input.pollMaxAttempts ?? 10,
      pollIntervalMs: input.pollIntervalMs ?? 50,
    });

    if (!record.sessionClosed) {
      await this.requestWithRetry({
        method: 'POST',
        pathOrUrl: `/sessions/online/${encodeURIComponent(record.sessionReferenceNumber)}/close`,
        accessToken: input.accessToken,
        idempotentOperation: true,
      });
      record.sessionClosed = true;
    }

    const statusCode = invoiceStatus.status.code;
    const statusDescription = invoiceStatus.status.description;

    // Duplicate invoice reconciliation (KSeF 2.0 code 440 + extensions.originalKsefNumber)
    if (statusCode === 440) {
      const originalKsefNumber = invoiceStatus.status.extensions?.originalKsefNumber ?? null;
      if (originalKsefNumber && !validateKsefNumber(originalKsefNumber).valid) {
        throw new Error(
          `KSeF returned invalid originalKsefNumber "${originalKsefNumber}" on duplicate 440.`,
        );
      }
      const duplicateResult: KsefIssueFa3InvoiceResult = {
        outcome: 'duplicate_reconciled',
        idempotencyKey: input.idempotencyKey,
        replayedFromOutbox: false,
        sessionReferenceNumber: record.sessionReferenceNumber,
        invoiceReferenceNumber: record.invoiceReferenceNumber,
        ksefNumber: originalKsefNumber,
        invoiceSha256Base64: payloadSha256Base64,
        invoiceSha256Hex: payloadSha256Hex,
        acquisitionDate: invoiceStatus.acquisitionDate ?? null,
        upoStatus: 'not_applicable',
        upoXml: null,
        validatedUpo: null,
        ksefStatusCode: statusCode,
        ksefStatusDescription: statusDescription,
      };
      record.completedResult = duplicateResult;
      return duplicateResult;
    }

    if (statusCode !== 200) {
      const rejectedResult: KsefIssueFa3InvoiceResult = {
        outcome: 'rejected_by_ksef',
        idempotencyKey: input.idempotencyKey,
        replayedFromOutbox: false,
        sessionReferenceNumber: record.sessionReferenceNumber,
        invoiceReferenceNumber: record.invoiceReferenceNumber,
        ksefNumber: null,
        invoiceSha256Base64: payloadSha256Base64,
        invoiceSha256Hex: payloadSha256Hex,
        acquisitionDate: null,
        upoStatus: 'not_applicable',
        upoXml: null,
        validatedUpo: null,
        ksefStatusCode: statusCode,
        ksefStatusDescription: statusDescription,
      };
      record.completedResult = rejectedResult;
      return rejectedResult;
    }

    const assignedKsefNumber = invoiceStatus.ksefNumber ?? null;
    if (!assignedKsefNumber) {
      throw new Error('KSeF returned status 200 without assigning a ksefNumber.');
    }
    const ksefNumberCheck = validateKsefNumber(assignedKsefNumber);
    if (!ksefNumberCheck.valid) {
      throw new Error(
        `KSeF returned malformed 35-char ksefNumber "${assignedKsefNumber}": ${ksefNumberCheck.reason}`,
      );
    }

    // Attempt to retrieve official UPO XML from closed session (NEVER invent UPO if pending!)
    const upoResolution = await this.tryFetchValidatedSessionUpo({
      accessToken: input.accessToken,
      sessionReferenceNumber: record.sessionReferenceNumber,
      expectedKsefNumber: assignedKsefNumber,
      expectedInvoiceHashBase64: payloadSha256Base64,
      directUpoDownloadUrl: invoiceStatus.upoDownloadUrl ?? undefined,
    });

    const acceptedResult: KsefIssueFa3InvoiceResult = {
      outcome: upoResolution.validatedUpo
        ? 'accepted_ksef_number_assigned'
        : 'accepted_pending_upo',
      idempotencyKey: input.idempotencyKey,
      replayedFromOutbox: false,
      sessionReferenceNumber: record.sessionReferenceNumber,
      invoiceReferenceNumber: record.invoiceReferenceNumber,
      ksefNumber: assignedKsefNumber,
      invoiceSha256Base64: payloadSha256Base64,
      invoiceSha256Hex: payloadSha256Hex,
      acquisitionDate: invoiceStatus.acquisitionDate ?? null,
      upoStatus: upoResolution.validatedUpo ? 'validated_v4_3' : 'pending_external_upo',
      upoXml: upoResolution.upoXml,
      validatedUpo: upoResolution.validatedUpo,
      ksefStatusCode: statusCode,
      ksefStatusDescription: statusDescription,
    };
    record.completedResult = acceptedResult;
    return acceptedResult;
  }

  private async pollInvoiceStatus(params: {
    accessToken: string;
    sessionReferenceNumber: string;
    invoiceReferenceNumber: string;
    pollMaxAttempts: number;
    pollIntervalMs: number;
  }): Promise<KsefSessionInvoiceStatusDto> {
    const sleepFn = this.retryPolicy.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < params.pollMaxAttempts; attempt += 1) {
      const resp = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: `/sessions/${encodeURIComponent(params.sessionReferenceNumber)}/invoices/${encodeURIComponent(params.invoiceReferenceNumber)}`,
        accessToken: params.accessToken,
        idempotentOperation: true,
      });
      const dto = this.parseJsonResponse<KsefSessionInvoiceStatusDto>(
        resp,
        'GET /sessions/{referenceNumber}/invoices/{invoiceReferenceNumber}',
      );
      if (dto.status.code === 200 || dto.status.code >= 400) {
        return dto;
      }
      await sleepFn(params.pollIntervalMs);
    }
    throw new KsefTransportError({
      code: 'ksef_transport_timeout',
      message: `KSeF invoice processing remained pending after ${params.pollMaxAttempts} status polls (${params.invoiceReferenceNumber}).`,
    });
  }

  private async tryFetchValidatedSessionUpo(params: {
    accessToken: string;
    sessionReferenceNumber: string;
    expectedKsefNumber: string;
    expectedInvoiceHashBase64: string;
    directUpoDownloadUrl?: string | undefined;
  }): Promise<{ upoXml: string | null; validatedUpo: ValidatedKsefUpoSummary | null }> {
    const sessionResp = await this.requestWithRetry({
      method: 'GET',
      pathOrUrl: `/sessions/${encodeURIComponent(params.sessionReferenceNumber)}`,
      accessToken: params.accessToken,
      idempotentOperation: true,
    });
    const sessionDto = this.parseJsonResponse<KsefSessionStatusDto>(
      sessionResp,
      'GET /sessions/{referenceNumber}',
    );

    const firstPage = sessionDto.upo?.pages[0];
    let upoXml: string | null = null;

    if (firstPage) {
      const upoResp = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: `/sessions/${encodeURIComponent(params.sessionReferenceNumber)}/upo/${encodeURIComponent(firstPage.referenceNumber)}`,
        accessToken: params.accessToken,
        accept: 'application/xml',
        idempotentOperation: true,
      });
      upoXml = upoResp.bodyText;
    } else if (params.directUpoDownloadUrl) {
      const upoResp = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: params.directUpoDownloadUrl,
        accept: 'application/xml',
        idempotentOperation: true,
      });
      upoXml = upoResp.bodyText;
    }

    if (!upoXml) {
      return { upoXml: null, validatedUpo: null };
    }

    const validatedUpo = validateAndParseKsefUpoXml(upoXml, {
      ksefNumber: params.expectedKsefNumber,
      invoiceHashBase64: params.expectedInvoiceHashBase64,
      sessionReferenceNumber: params.sessionReferenceNumber,
    });

    return { upoXml, validatedUpo };
  }

  /**
   * Queries incoming purchase invoices (`Subject2` — mandatory receipt obligation for all
   * NIP holders from 2026-02-01), fetches each XML, verifies SHA-256 + official FA(2)/FA(3)
   * XSD compliance, checks buyer NIP ownership, and stores immutable raw XML bytes in
   * `ImmutableSourceDocumentArchive` when provided.
   */
  async syncIncomingInvoices(params: {
    tenantId: string;
    legalEntityId: string;
    buyerNip: string;
    accessToken: string;
    fromIso: string;
    toIso: string;
    dateType?: 'PermanentStorage' | 'Invoicing' | 'Issue';
    pageOffset?: number;
    pageSize?: number;
    archive?: ImmutableSourceDocumentArchive;
    actorUserId?: string;
  }): Promise<KsefSyncIncomingInvoicesResult> {
    if (
      !/^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(params.buyerNip) ||
      !validatePolishNip(params.buyerNip).valid
    ) {
      throw new Error(
        `Invalid Polish 10-digit buyer NIP (or modulo-11 checksum): "${params.buyerNip}".`,
      );
    }

    const pageOffset = params.pageOffset ?? 0;
    const pageSize = params.pageSize ?? 50;

    const queryResp = await this.requestWithRetry({
      method: 'POST',
      pathOrUrl: `/invoices/query/metadata?pageOffset=${pageOffset}&pageSize=${pageSize}&sortOrder=Asc`,
      accessToken: params.accessToken,
      body: JSON.stringify({
        subjectType: 'Subject2',
        dateRange: {
          dateType: params.dateType ?? 'PermanentStorage',
          from: params.fromIso,
          to: params.toIso,
        },
      }),
      idempotentOperation: true,
    });

    const queryDto = this.parseJsonResponse<KsefQueryInvoicesMetadataResponseDto>(
      queryResp,
      'POST /invoices/query/metadata',
    );

    const items: KsefSyncedIncomingInvoiceItem[] = [];

    for (const meta of queryDto.invoices) {
      const ksefCheck = validateKsefNumber(meta.ksefNumber);
      if (!ksefCheck.valid) {
        throw new Error(
          `Incoming KSeF metadata contains invalid ksefNumber "${meta.ksefNumber}": ${ksefCheck.reason}`,
        );
      }

      const xmlResp = await this.requestWithRetry({
        method: 'GET',
        pathOrUrl: `/invoices/ksef/${encodeURIComponent(meta.ksefNumber)}`,
        accessToken: params.accessToken,
        accept: 'application/xml',
        idempotentOperation: true,
      });
      const rawXml = xmlResp.bodyText;

      if (meta.invoiceHash) {
        const computedHash = computeKsefBase64Sha256(Buffer.from(rawXml, 'utf8'));
        if (computedHash !== meta.invoiceHash) {
          throw new Error(
            `Incoming KSeF XML SHA-256 mismatch for ${meta.ksefNumber}: expected ${meta.invoiceHash}, got ${computedHash}.`,
          );
        }
      }

      const parsedXml = parseOfficialKsefFaXml(rawXml, {
        companyNip: params.buyerNip,
        fallbackDirection: 'purchase',
      });
      if (parsedXml.ksefSchemaVersion !== 'FA(2)' && parsedXml.ksefSchemaVersion !== 'FA(3)') {
        throw new Error(`Unexpected KSeF schema version for ${meta.ksefNumber}.`);
      }

      if (parsedXml.buyerIdentifierKind !== 'nip' || parsedXml.buyerNip !== params.buyerNip) {
        throw new Error(
          `Incoming KSeF Subject2 invoice ${meta.ksefNumber} buyer identity (${parsedXml.buyerIdentifierKind ?? 'none'}:${parsedXml.buyerNip ?? 'missing'}) does not match Polish company NIP (${params.buyerNip}).`,
        );
      }

      let archivedArtifactId: string | null = null;
      let deduplicatedInArchive = false;

      if (params.archive) {
        const actorUserId = params.actorUserId ?? '00000000-0000-4000-8000-000000000099';
        try {
          const stored = params.archive.storeOriginal({
            actorUserId,
            tenantId: params.tenantId,
            legalEntityId: params.legalEntityId,
            fileName: `${meta.ksefNumber}.xml`,
            declaredMimeType: 'application/xml',
            content: rawXml,
            ksefReferenceNumber: meta.ksefNumber,
          });
          archivedArtifactId = stored.artifactId;
        } catch (error) {
          if (
            error instanceof AccountingWorkspaceError &&
            error.reasonCode === 'duplicate_source_artifact_sha256'
          ) {
            deduplicatedInArchive = true;
            const sha = computeKsefHexSha256(Buffer.from(rawXml, 'utf8'));
            const existing = params.archive
              .listCompanyArtifacts({
                actorUserId,
                tenantId: params.tenantId,
                legalEntityId: params.legalEntityId,
              })
              .find((a) => a.sha256Hex === sha);
            archivedArtifactId = existing?.artifactId ?? null;
          } else {
            throw error;
          }
        }
      }

      items.push({
        ksefNumber: meta.ksefNumber,
        invoiceNumber: parsedXml.documentNumber,
        sellerNip: parsedXml.sellerNip ?? meta.seller.nip,
        buyerNip: parsedXml.buyerNip ?? null,
        grossAmountGrosze: parsedXml.totalGrossGrosze,
        netAmountGrosze: parsedXml.totalNetGrosze,
        vatAmountGrosze: parsedXml.totalVatGrosze,
        currency: parsedXml.currency ?? meta.currency,
        schemaVersion: parsedXml.ksefSchemaVersion,
        parsedXml,
        archivedArtifactId,
        deduplicatedInArchive,
      });
    }

    return {
      fetchedCount: items.length,
      hasMore: queryDto.hasMore,
      isTruncated: queryDto.isTruncated,
      permanentStorageHwmDate: queryDto.permanentStorageHwmDate ?? null,
      items,
    };
  }
}
