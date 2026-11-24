import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type {
  CompanyDocumentItemContract,
  CompanySettingsResponse,
  CreateDocumentRequest,
  DocumentsListResponse,
  GetMyCompaniesResponse,
  KpirViewResponse,
  LedgerViewResponse,
  RyczaltViewResponse,
  VatViewResponse,
} from '@pap/contracts';
import type { VatRegisterEntryContract } from '@pap/contracts/accounting';
import {
  ExportJpkRequestSchema,
  ExportJpkResponseSchema,
  GenerateInvoiceFa3XmlRequestSchema,
  GenerateInvoiceFa3XmlResponseSchema,
  GetApplicableJpkResponseSchema,
  GetKsefStatusResponseSchema,
  IssueKsefSandboxRequestSchema,
  IssueKsefSandboxResponseSchema,
  ListSourceArchiveResponseSchema,
  SplitVerificationPreviewSchema,
  StoreSourceArchiveRequestSchema,
  StoreSourceArchiveResponseSchema,
  SyncKsefIncomingRequestSchema,
  SyncKsefIncomingResponseSchema,
  type ExportJpkResponse,
  type GenerateInvoiceFa3XmlResponse,
  type GetApplicableJpkResponse,
  type GetKsefStatusResponse,
  type IssueKsefSandboxResponse,
  type KsefNonProductionEnvironmentContract,
  type ListSourceArchiveResponse,
  type StoreSourceArchiveResponse,
  type SyncKsefIncomingResponse,
} from '@pap/contracts/statutory-ksef';
import {
  KSEF_FA3_NAMESPACE,
  buildSyntheticTestKsefNumber,
  generateKsefFaXml,
  legalEntityId as parseLegalEntityId,
  multiplyGroszeByBps,
  resolveApplicableJpkStructures,
  tenantId as parseTenantId,
  validateKsefNumber,
  validatePolishNip,
  type GenerateKsefFaXmlInput,
  type JpkEwpRowInput,
  type JpkKrPdCounterpartyInput,
  type JpkKrPdJournalEntryInput,
  type JpkKrPdZois7AccountInput,
  type JpkKsefMarkerChoice,
  type JpkPkpirRowInput,
  type JpkPolishAddress,
  type JpkStEwpAssetRowInput,
  type JpkStKrAssetRowInput,
  type JpkStPkpirAssetRowInput,
  type JpkTaxpayerSubject,
  type JpkV7PurchaseRowInput,
  type JpkV7SalesRowInput,
} from '@pap/domain';
import {
  AccountingWorkspaceAccessError,
  AccountingWorkspaceConflictError,
  AccountingWorkspaceError,
  AccountingWorkspaceValidationError,
  type WorkspaceActorContext,
} from './accounting-workspace.js';
import { DEMO_DEFAULT_PERIOD } from './demo-seed.js';
import { parseOfficialKsefFaXml } from './document-import-parsers.js';
import { JpkXsdValidationFailedError, prepareValidatedJpkExport } from './jpk/index.js';
import {
  Ksef2SandboxAdapterService,
  KsefIdempotencyConflictError,
  KsefIdempotentOutbox,
  KsefProductionEndpointBlockedError,
  KsefTransportError,
  KsefXmlPreValidationError,
  OFFICIAL_KSEF2_BASE_URLS,
  assertAllowedKsefNonProductionEndpoint,
  computeKsefBase64Sha256,
  computeKsefHexSha256,
  decryptKsefInvoiceAes256Cbc,
  decryptKsefRsaOaepSha256,
  type KsefHttpRequest,
  type KsefHttpResponse,
  type KsefHttpTransport,
} from './ksef/index.js';
import {
  ImmutableSourceDocumentArchive,
  type SplitVerificationPreviewDescriptor,
  type StoredSourceDocumentArtifact,
} from './source-archive/index.js';
import { validateOfficialMfXml } from './xsd/index.js';

type MaybePromise<T> = T | Promise<T>;

export interface StatutoryWorkspacePort {
  getMyCompanies(actor: WorkspaceActorContext): MaybePromise<GetMyCompaniesResponse>;
  getCompanySettings(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): MaybePromise<CompanySettingsResponse>;
  getVatView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): MaybePromise<VatViewResponse>;
  getKpirView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): MaybePromise<KpirViewResponse>;
  getRyczaltView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): MaybePromise<RyczaltViewResponse>;
  getLedgerView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): MaybePromise<LedgerViewResponse>;
  listDocuments(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): MaybePromise<DocumentsListResponse>;
  getDocument(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    documentId: string,
  ): MaybePromise<CompanyDocumentItemContract>;
  createDocument(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    request: CreateDocumentRequest,
  ): MaybePromise<CompanyDocumentItemContract>;
}

const DEFAULT_TAX_OFFICE_CODE = '1435'; // Trzeci Urząd Skarbowy Warszawa-Śródmieście (syntetyczny domyślny kod TKodUS)

const BLOCKED_PRODUCTION_KSEF_HOSTS = [
  'ksef.mf.gov.pl',
  'api.ksef.mf.gov.pl',
  'prd.ksef.mf.gov.pl',
  'ksef-prod.mf.gov.pl',
  'e-deklaracje.mf.gov.pl',
  'klient-eformularz.mf.gov.pl',
  'pue.zus.pl',
] as const;

const ALLOWED_NON_PROD_KSEF_HOSTS = [
  'api-test.ksef.mf.gov.pl',
  'api-demo.ksef.mf.gov.pl',
  '127.0.0.1',
  'localhost',
  'ksef-mock.local',
] as const;

const { publicKey: LOCAL_MOCK_RSA_PUBLIC_PEM, privateKey: LOCAL_MOCK_RSA_PRIVATE_PEM } =
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const HUMAN_UI_SCOPES = new Set(['pap:ui:full', 'pap:ui:accounting', 'pap:accounting']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lastDayOfMonthIso(periodYearMonth: string): string {
  const [yearStr = '2026', monthStr = '01'] = periodYearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
}

function listPeriodsUpTo(periodYearMonth: string): readonly string[] {
  const [yearStr = '2026', monthStr = '01'] = periodYearMonth.split('-');
  const month = Number(monthStr);
  const out: string[] = [];
  for (let m = 1; m <= month; m += 1) {
    out.push(`${yearStr}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

function roundGroszeHalfUpToPln(grosze: number): number {
  const sign = grosze < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(grosze) + 50) / 100);
}

function mapAccountCodeToJpkKrPdTags(accountCode: string): {
  readonly parentAccountId: string;
  readonly balanceSheetTagS12_1: string;
  readonly taxTagS12_3?: string;
} {
  const syntheticRoot = accountCode.includes('-')
    ? accountCode.split('-')[0]!
    : accountCode.slice(0, 2);

  switch (syntheticRoot) {
    case '010':
      return { parentAccountId: '01', balanceSheetTagS12_1: 'BAAII1a_W' };
    case '020':
      return { parentAccountId: '02', balanceSheetTagS12_1: 'BAAI3_W' };
    case '070':
      return { parentAccountId: '07', balanceSheetTagS12_1: 'BAAII1a_U' };
    case '080':
      return { parentAccountId: '08', balanceSheetTagS12_1: 'BAAII2_W' };
    case '100':
    case '130':
    case '131':
      return { parentAccountId: '13', balanceSheetTagS12_1: 'BABIII1c1_SPKR' };
    case '135':
      return { parentAccountId: '13', balanceSheetTagS12_1: 'BPBIII3a' };
    case '201':
      return { parentAccountId: '20', balanceSheetTagS12_1: 'BABII3a_D12' };
    case '202':
    case '300':
      return { parentAccountId: '20', balanceSheetTagS12_1: 'BPBIII3d_D12' };
    case '220':
    case '229':
      return { parentAccountId: '22', balanceSheetTagS12_1: 'BPBIII3g' };
    case '221':
      return accountCode === '221-2'
        ? { parentAccountId: '221', balanceSheetTagS12_1: 'BABII3b' }
        : { parentAccountId: '221', balanceSheetTagS12_1: 'BPBIII3g' };
    case '230':
      return { parentAccountId: '23', balanceSheetTagS12_1: 'BPBIII3h' };
    case '240':
      return { parentAccountId: '24', balanceSheetTagS12_1: 'BPBIII3i' };
    case '310':
      return { parentAccountId: '31', balanceSheetTagS12_1: 'BABI1' };
    case '330':
      return { parentAccountId: '33', balanceSheetTagS12_1: 'BABI4' };
    case '400':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBI', taxTagS12_3: 'PD2' };
    case '401':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBII', taxTagS12_3: 'PD2' };
    case '402':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBIII', taxTagS12_3: 'PD2' };
    case '403':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBIV_POZ', taxTagS12_3: 'PD2' };
    case '404':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBV', taxTagS12_3: 'PD2' };
    case '405':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBVI', taxTagS12_3: 'PD2' };
    case '409':
      return { parentAccountId: '40', balanceSheetTagS12_1: 'RPBVII', taxTagS12_3: 'PD2' };
    case '700':
      return { parentAccountId: '70', balanceSheetTagS12_1: 'RPAI_RKAI_POZ', taxTagS12_3: 'PD1' };
    case '730':
      return {
        parentAccountId: '73',
        balanceSheetTagS12_1: 'RPAIV_RKAII_POZ',
        taxTagS12_3: 'PD1',
      };
    case '731':
      return {
        parentAccountId: '73',
        balanceSheetTagS12_1: 'RPBVIII_RKBII_POZ',
        taxTagS12_3: 'PD2',
      };
    case '750':
      return { parentAccountId: '75', balanceSheetTagS12_1: 'RPGIV_RKJIV', taxTagS12_3: 'PD1' };
    case '751':
      return { parentAccountId: '75', balanceSheetTagS12_1: 'RPHIII_RKKIII', taxTagS12_3: 'PD2' };
    case '760':
      return { parentAccountId: '76', balanceSheetTagS12_1: 'RPDI_RKGI_POZ', taxTagS12_3: 'PD1' };
    case '761':
      return { parentAccountId: '76', balanceSheetTagS12_1: 'RPEI_RKHI_POZ', taxTagS12_3: 'PD2' };
    case '800':
      return { parentAccountId: '80', balanceSheetTagS12_1: 'BPAI' };
    case '811':
      return { parentAccountId: '81', balanceSheetTagS12_1: 'BPAII_INN' };
    case '820':
      return { parentAccountId: '82', balanceSheetTagS12_1: 'BPAV' };
    case '860':
      return { parentAccountId: '86', balanceSheetTagS12_1: 'BPAVI' };
    case '870':
      return { parentAccountId: '87', balanceSheetTagS12_1: 'RPJ_RKM_B' };
    default:
      return { parentAccountId: syntheticRoot || '00', balanceSheetTagS12_1: 'INNE' };
  }
}

function buildValidLocalMockUpoV43Xml(params: {
  readonly sessionRef: string;
  readonly sellerNip: string;
  readonly ksefNumber: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly documentHashBase64: string;
}): string {
  const esc = (s: string) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Potwierdzenie xmlns="http://upo.schematy.mf.gov.pl/KSeF/v4-3" wersjaSchemy="v4-3">',
    '  <NazwaPodmiotuPrzyjmujacego>Ministerstwo Finansów</NazwaPodmiotuPrzyjmujacego>',
    `  <NumerReferencyjnySesji>${esc(params.sessionRef)}</NumerReferencyjnySesji>`,
    '  <Uwierzytelnienie>',
    '    <IdKontekstu>',
    `      <Nip>${esc(params.sellerNip)}</Nip>`,
    '    </IdKontekstu>',
    '    <NumerReferencyjnyTokenaKSeF>20260320-EC-1A2B3C4D5E-6F708192A3-B4</NumerReferencyjnyTokenaKSeF>',
    '  </Uwierzytelnienie>',
    '  <NazwaStrukturyLogicznej>Schemat_FA(3)_v1-0E.xsd</NazwaStrukturyLogicznej>',
    '  <KodFormularza>FA (3)</KodFormularza>',
    '  <Dokument>',
    `    <NipSprzedawcy>${esc(params.sellerNip)}</NipSprzedawcy>`,
    `    <NumerKSeFDokumentu>${esc(params.ksefNumber)}</NumerKSeFDokumentu>`,
    `    <NumerFaktury>${esc(params.invoiceNumber)}</NumerFaktury>`,
    `    <DataWystawieniaFaktury>${esc(params.issueDate)}</DataWystawieniaFaktury>`,
    '    <DataPrzeslaniaDokumentu>2026-03-20T12:01:02.000+01:00</DataPrzeslaniaDokumentu>',
    '    <DataNadaniaNumeruKSeF>2026-03-20T12:01:03.000+01:00</DataNadaniaNumeruKSeF>',
    `    <SkrotDokumentu>${esc(params.documentHashBase64)}</SkrotDokumentu>`,
    '    <TrybWysylki>Online</TrybWysylki>',
    '  </Dokument>',
    '</Potwierdzenie>',
  ].join('\n');
}

export class StatutoryFilingFacade {
  private readonly workspace: StatutoryWorkspacePort;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly outbox = new KsefIdempotentOutbox();
  private readonly archivesByScope = new Map<string, ImmutableSourceDocumentArchive>();
  private readonly localMockSessionCryptoByScope = new Map<
    string,
    { readonly aesKey: Buffer; readonly iv: Buffer }
  >();
  private readonly localMockIncomingXmlByScope = new Map<string, string>();

  constructor(options: {
    readonly workspace: StatutoryWorkspacePort;
    readonly env?: Readonly<Record<string, string | undefined>>;
  }) {
    this.workspace = options.workspace;
    this.env = options.env ?? process.env;
  }

  private getOrCreateCompanyArchive(
    tenantId: string,
    legalEntityId: string,
  ): ImmutableSourceDocumentArchive {
    const key = `${tenantId}::${legalEntityId}`;
    let archive = this.archivesByScope.get(key);
    if (!archive) {
      // Authorization is enforced asynchronously against `this.workspace` BEFORE delegating to `archive`.
      archive = new ImmutableSourceDocumentArchive({
        authorizer: ({ tenantId: qTenant, legalEntityId: qEntity }) => ({
          allowed: qTenant === tenantId && qEntity === legalEntityId,
        }),
      });
      this.archivesByScope.set(key, archive);
    }
    return archive;
  }

  private async resolveAuthorizedCompanyContext(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    requiredAction: 'read' | 'write',
  ): Promise<{
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly settings: CompanySettingsResponse;
  }> {
    parseLegalEntityId(rawCompanyId);

    let resolvedTenantId: string;
    if (rawTenantId !== undefined && rawTenantId.trim().length > 0) {
      parseTenantId(rawTenantId);
      resolvedTenantId = rawTenantId;
    } else {
      const directory = await this.workspace.getMyCompanies(actor);
      const matches = directory.companies.filter((c) => c.legalEntityId === rawCompanyId);
      if (matches.length === 0) {
        throw new AccountingWorkspaceAccessError(
          403,
          'company_access_denied',
          `Brak dostępu do firmy ${rawCompanyId} w bieżącej organizacji użytkownika.`,
        );
      }
      if (matches.length > 1) {
        throw new AccountingWorkspaceValidationError(
          400,
          'ambiguous_company_tenant',
          'Wskazany podmiot występuje w więcej niż jednej organizacji — użyj pełnej ścieżki /api/v1/tenants/:tenantId/companies/:companyId/...',
        );
      }
      resolvedTenantId = matches[0]!.tenantId;
    }

    const settings = await this.workspace.getCompanySettings(actor, resolvedTenantId, rawCompanyId);

    if (!settings.company.canRead) {
      throw new AccountingWorkspaceAccessError(
        403,
        'company_access_denied',
        'Brak uprawnień odczytu (read) dla wskazanej firmy.',
      );
    }
    if (requiredAction === 'write' && !settings.company.canWrite) {
      throw new AccountingWorkspaceAccessError(
        403,
        'insufficient_company_write_permission',
        'Operacja wymaga uprawnień zapisu (write) do wskazanej firmy.',
      );
    }

    return {
      tenantId: resolvedTenantId,
      legalEntityId: rawCompanyId,
      settings,
    };
  }

  private buildTaxpayerSubjectAndAddress(settings: CompanySettingsResponse): {
    readonly subject: JpkTaxpayerSubject;
    readonly address: JpkPolishAddress;
    readonly faAddressLine1: string;
  } {
    const { company, taxProfile } = settings;
    const street = taxProfile.street ?? company.street ?? 'ul. Marszałkowska';
    const buildingNumber = taxProfile.buildingNumber ?? company.buildingNumber ?? '1';
    const apartmentNumber = taxProfile.unitNumber ?? company.unitNumber ?? undefined;
    const city = taxProfile.city ?? company.city ?? 'Warszawa';
    const postalCode = taxProfile.postalCode ?? company.postalCode ?? '00-001';
    const voivodeship = taxProfile.voivodeship ?? company.voivodeship ?? 'MAZOWIECKIE';

    const address: JpkPolishAddress = {
      voivodeship,
      county: city,
      municipality: city,
      street,
      buildingNumber,
      ...(apartmentNumber ? { apartmentNumber } : {}),
      city,
      postalCode,
    };

    const buildingFull = apartmentNumber ? `${buildingNumber}/${apartmentNumber}` : buildingNumber;
    const faAddressLine1 = `${street} ${buildingFull}, ${postalCode} ${city}`;

    if (company.legalForm === 'jdg') {
      const tokens = taxProfile.companyName
        .replace(/\(.*?\)/g, '')
        .trim()
        .split(/\s+/)
        .filter((t) => t.length >= 2);
      const lastName = tokens.length >= 2 ? tokens[tokens.length - 1]! : 'Podatnik';
      const firstName = tokens.length >= 2 ? tokens[tokens.length - 2]! : 'Jan';
      return {
        subject: {
          kind: 'natural_person',
          nip: taxProfile.nip,
          firstName,
          lastName,
          birthDate: '1985-05-15',
          email: `kontakt.${taxProfile.nip}@syntetyczny.example`,
        },
        address,
        faAddressLine1,
      };
    }

    return {
      subject: {
        kind: 'legal_entity',
        nip: taxProfile.nip,
        fullName: taxProfile.companyName,
        email: `biuro.${taxProfile.nip}@syntetyczny.example`,
        ...(taxProfile.regon ? { regon: taxProfile.regon } : {}),
      },
      address,
      faAddressLine1,
    };
  }

  private mapVatEntryKsefMarker(entry: VatRegisterEntryContract): JpkKsefMarkerChoice {
    if (
      entry.ksefMarker === 'NrKSeF' &&
      entry.ksefReferenceNumber &&
      validateKsefNumber(entry.ksefReferenceNumber).valid
    ) {
      return { kind: 'KSEF', ksefNumber: entry.ksefReferenceNumber };
    }
    if (entry.ksefMarker === 'BFK') {
      return { kind: 'BFK' };
    }
    if (entry.ksefMarker === 'DI') {
      return { kind: 'DI' };
    }
    return { kind: 'OFF' };
  }

  async getApplicableJpk(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    rawPeriod?: string,
  ): Promise<GetApplicableJpkResponse> {
    const period = rawPeriod?.trim() || DEMO_DEFAULT_PERIOD;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_period_format',
        `Nieprawidłowy format okresu rozliczeniowego "${period}" (wymagane RRRR-MM).`,
      );
    }

    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'read',
    );
    const { taxProfile } = settings;
    const vatPayer = taxProfile.vatStatus === 'czynny';
    const vatCadence = vatPayer
      ? taxProfile.vatSettlementPeriod === 'quarterly'
        ? 'quarterly'
        : 'monthly'
      : 'not_applicable';

    let applicable;
    try {
      applicable = resolveApplicableJpkStructures({
        profile: taxProfile.profileCode,
        vatPayer,
        vatCadence,
        periodYearMonth: period,
      });
    } catch (error) {
      throw new AccountingWorkspaceValidationError(
        422,
        'jpk_applicability_error',
        error instanceof Error ? error.message : String(error),
      );
    }

    return GetApplicableJpkResponseSchema.parse({
      tenantId,
      companyId: legalEntityId,
      legalEntityId,
      period,
      profileCode: taxProfile.profileCode,
      vatStatus: taxProfile.vatStatus,
      vatSettlementPeriod: taxProfile.vatSettlementPeriod,
      applicableStructures: applicable.map((item) => ({ ...item })),
    });
  }

  async exportJpk(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    rawRequest: unknown,
  ): Promise<ExportJpkResponse> {
    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'write',
    );
    const req = ExportJpkRequestSchema.parse(rawRequest ?? {});
    const { taxProfile } = settings;
    const vatPayer = taxProfile.vatStatus === 'czynny';
    const vatCadence = vatPayer
      ? taxProfile.vatSettlementPeriod === 'quarterly'
        ? 'quarterly'
        : 'monthly'
      : 'not_applicable';

    let applicable;
    try {
      applicable = resolveApplicableJpkStructures({
        profile: taxProfile.profileCode,
        vatPayer,
        vatCadence,
        periodYearMonth: req.period,
      });
    } catch (error) {
      throw new AccountingWorkspaceValidationError(
        422,
        'jpk_applicability_error',
        error instanceof Error ? error.message : String(error),
      );
    }

    const isApplicable = applicable.some((s) => s.structureCode === req.structureCode);
    if (!isApplicable) {
      throw new AccountingWorkspaceValidationError(
        422,
        'jpk_structure_not_applicable',
        `Struktura ${req.structureCode} nie obowiązuje dla profilu ${taxProfile.profileCode} (status VAT: ${taxProfile.vatStatus}, rozliczenie: ${taxProfile.vatSettlementPeriod}) w okresie ${req.period}. Dozwolone struktury: ${applicable.map((a) => a.structureCode).join(', ') || 'brak'}.`,
      );
    }

    const generatedAtIso = new Date().toISOString();
    const taxOfficeCode = req.taxOfficeCode ?? DEFAULT_TAX_OFFICE_CODE;
    const { subject, address } = this.buildTaxpayerSubjectAndAddress(settings);
    const [yearStr = '2026', monthStr = '03'] = req.period.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const dateFromYear = `${yearStr}-01-01`;
    const dateToPeriod = lastDayOfMonthIso(req.period);

    try {
      if (
        req.structureCode === 'JPK_V7M(3)' ||
        req.structureCode === 'JPK_V7K(3)' ||
        req.structureCode === 'JPK_V7M(2)'
      ) {
        if (req.purpose !== 1 && req.purpose !== 2) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_jpk_purpose',
            `Struktura ${req.structureCode} dopuszcza wyłącznie CelZlozenia = 1 (złożenie) lub 2 (korekta).`,
          );
        }

        const vatView = await this.workspace.getVatView(actor, tenantId, legalEntityId, req.period);

        // Group multi-rate lines on the same sales invoice into a single <SprzedazWiersz>
        const salesByDoc = new Map<string, JpkV7SalesRowInput>();
        for (const entry of vatView.salesEntries) {
          const docKey = `${entry.documentNumber}::${entry.counterpartyNip ?? 'BRAK'}::${entry.issueDate}`;
          const prev = salesByDoc.get(docKey);
          const cleanTin = entry.counterpartyNip?.replace(/^PL/i, '') ?? 'BRAK';
          const countryCode =
            entry.counterpartyNip && /^[A-Z]{2}/.test(entry.counterpartyNip)
              ? entry.counterpartyNip.slice(0, 2)
              : undefined;

          const baseRow: JpkV7SalesRowInput = prev ?? {
            ...(countryCode && countryCode !== 'PL'
              ? { counterpartyCountryCode: countryCode }
              : {}),
            counterpartyTin: cleanTin,
            counterpartyName: entry.counterpartyName,
            documentNumber: entry.documentNumber,
            issueDate: entry.issueDate,
            ...(entry.taxPointDate !== entry.issueDate ? { saleDate: entry.taxPointDate } : {}),
            ksefMarker: this.mapVatEntryKsefMarker(entry),
          };

          const mutable: JpkV7SalesRowInput = { ...baseRow };
          if (entry.vatRate === '23') {
            mutable.net23Grosze = (mutable.net23Grosze ?? 0) + entry.netGrosze;
            mutable.vat23Grosze = (mutable.vat23Grosze ?? 0) + entry.vatTotalGrosze;
          } else if (entry.vatRate === '8') {
            mutable.net8Grosze = (mutable.net8Grosze ?? 0) + entry.netGrosze;
            mutable.vat8Grosze = (mutable.vat8Grosze ?? 0) + entry.vatTotalGrosze;
          } else if (entry.vatRate === '5') {
            mutable.net5Grosze = (mutable.net5Grosze ?? 0) + entry.netGrosze;
            mutable.vat5Grosze = (mutable.vat5Grosze ?? 0) + entry.vatTotalGrosze;
          } else if (entry.vatRate === '0') {
            mutable.zeroDomesticNetGrosze = (mutable.zeroDomesticNetGrosze ?? 0) + entry.netGrosze;
          } else if (entry.vatRate === 'zw' || entry.vatRate === 'np') {
            mutable.exemptNetGrosze = (mutable.exemptNetGrosze ?? 0) + entry.netGrosze;
          }
          salesByDoc.set(docKey, mutable);
        }

        const purchaseByDoc = new Map<string, JpkV7PurchaseRowInput>();
        for (const entry of vatView.purchaseEntries) {
          if (entry.deductibleVatGrosze === 0 && entry.deductionMode === 'none_0') {
            continue;
          }
          const docKey = `${entry.documentNumber}::${entry.counterpartyNip ?? 'BRAK'}::${entry.issueDate}`;
          const prev = purchaseByDoc.get(docKey);
          const cleanTin = entry.counterpartyNip?.replace(/^PL/i, '') ?? 'BRAK';
          const effectiveNetGrosze =
            entry.deductionMode === 'vehicle_mixed_50'
              ? multiplyGroszeByBps(entry.netGrosze, 5000, 'half_up')
              : entry.netGrosze;

          const baseRow: JpkV7PurchaseRowInput = prev ?? {
            supplierTin: cleanTin,
            supplierName: entry.counterpartyName,
            documentNumber: entry.documentNumber,
            purchaseDate: entry.issueDate,
            ...(entry.taxPointDate !== entry.issueDate ? { receiptDate: entry.taxPointDate } : {}),
            ksefMarker: this.mapVatEntryKsefMarker(entry),
          };
          purchaseByDoc.set(docKey, {
            ...baseRow,
            otherAcquisitionsNetGrosze:
              (baseRow.otherAcquisitionsNetGrosze ?? 0) + effectiveNetGrosze,
            otherAcquisitionsVatGrosze:
              (baseRow.otherAcquisitionsVatGrosze ?? 0) + entry.deductibleVatGrosze,
          });
        }

        const salesRows = [...salesByDoc.values()];
        const purchaseRows = [...purchaseByDoc.values()];

        let quarterlyPriorMonthsCarry:
          | {
              exemptPln?: number;
              zeroDomesticPln?: number;
              net5Pln?: number;
              vat5Pln?: number;
              net8Pln?: number;
              vat8Pln?: number;
              net23Pln?: number;
              vat23Pln?: number;
              otherAcquisitionsNetPln?: number;
              otherAcquisitionsVatPln?: number;
            }
          | undefined;

        let priorCarryoverPln = roundGroszeHalfUpToPln(
          vatView.jpkV7m?.carryOverFromPreviousPeriodP39Grosze ?? 0,
        );
        const requestedRefundPln = roundGroszeHalfUpToPln(
          vatView.jpkV7m?.refundToBankAccountP54Grosze ?? 0,
        );

        if (req.structureCode === 'JPK_V7K(3)' && month % 3 === 0) {
          const m1Period = `${yearStr}-${String(month - 2).padStart(2, '0')}`;
          const m2Period = `${yearStr}-${String(month - 1).padStart(2, '0')}`;
          const m1Vat = await this.workspace.getVatView(actor, tenantId, legalEntityId, m1Period);
          const m2Vat = await this.workspace.getVatView(actor, tenantId, legalEntityId, m2Period);
          priorCarryoverPln = roundGroszeHalfUpToPln(
            m1Vat.jpkV7m?.carryOverFromPreviousPeriodP39Grosze ?? 0,
          );
          const f1 = m1Vat.jpkV7m?.fields ?? {};
          const f2 = m2Vat.jpkV7m?.fields ?? {};
          quarterlyPriorMonthsCarry = {
            exemptPln: (f1['P_10'] ?? 0) + (f2['P_10'] ?? 0),
            zeroDomesticPln: (f1['P_13'] ?? 0) + (f2['P_13'] ?? 0),
            net5Pln: (f1['P_15'] ?? 0) + (f2['P_15'] ?? 0),
            vat5Pln: (f1['P_16'] ?? 0) + (f2['P_16'] ?? 0),
            net8Pln: (f1['P_17'] ?? 0) + (f2['P_17'] ?? 0),
            vat8Pln: (f1['P_18'] ?? 0) + (f2['P_18'] ?? 0),
            net23Pln: (f1['P_19'] ?? 0) + (f2['P_19'] ?? 0),
            vat23Pln: (f1['P_20'] ?? 0) + (f2['P_20'] ?? 0),
            otherAcquisitionsNetPln: (f1['P_42'] ?? 0) + (f2['P_42'] ?? 0),
            otherAcquisitionsVatPln: (f1['P_43'] ?? 0) + (f2['P_43'] ?? 0),
          };
        }

        const prepared = prepareValidatedJpkExport({
          structureCode: req.structureCode,
          payload: {
            generatedAtIso,
            purpose: req.purpose,
            taxOfficeCode,
            year,
            month,
            subject,
            salesRows,
            purchaseRows,
            priorExcessCarryoverPln: priorCarryoverPln,
            requestedRefundPln,
            ...(req.refundTimeframe ? { refundTimeframe: req.refundTimeframe } : {}),
            ...(req.correctionJustification
              ? { correctionJustification: req.correctionJustification }
              : {}),
            ...(quarterlyPriorMonthsCarry ? { quarterlyPriorMonthsCarry } : {}),
          },
        });

        const totalOutPln =
          roundGroszeHalfUpToPln(
            salesRows.reduce(
              (acc, r) => acc + (r.vat5Grosze ?? 0) + (r.vat8Grosze ?? 0) + (r.vat23Grosze ?? 0),
              0,
            ),
          ) +
          (quarterlyPriorMonthsCarry
            ? (quarterlyPriorMonthsCarry.vat5Pln ?? 0) +
              (quarterlyPriorMonthsCarry.vat8Pln ?? 0) +
              (quarterlyPriorMonthsCarry.vat23Pln ?? 0)
            : 0);
        const totalInPln =
          priorCarryoverPln +
          roundGroszeHalfUpToPln(
            purchaseRows.reduce(
              (acc, r) => acc + (r.fixedAssetsVatGrosze ?? 0) + (r.otherAcquisitionsVatGrosze ?? 0),
              0,
            ),
          ) +
          (quarterlyPriorMonthsCarry?.otherAcquisitionsVatPln ?? 0);
        const p51 = Math.max(0, totalOutPln - totalInPln);
        const p53 = Math.max(0, totalInPln - totalOutPln);
        const p62 = Math.max(0, p53 - requestedRefundPln);

        return ExportJpkResponseSchema.parse({
          tenantId,
          companyId: legalEntityId,
          legalEntityId,
          period: req.period,
          structureCode: req.structureCode,
          purpose: req.purpose,
          submissionStatus: 'local_xml_only_not_submitted',
          lifecycleStatus: prepared.lifecycleStatus,
          officialUpoReferenceNumber: null,
          externalSignatureRequired: true,
          externalSubmissionRequired: true,
          xsdValid: true,
          officialNamespace: prepared.xsdValidation.targetNamespace,
          officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
          officialSchemaSha256: prepared.xsdValidation.schemaSha256,
          xmlSha256Hex: prepared.xmlSha256Hex,
          xmlByteLength: prepared.xmlByteLength,
          xmlContent: prepared.xmlContent,
          generatedAtIso,
          summary: {
            rowsCount: salesRows.length + purchaseRows.length,
            p39CarryoverPln: priorCarryoverPln,
            p51TaxDuePln: p51,
            p53ExcessPln: p53,
            p54RefundPln: requestedRefundPln,
            p62CarryForwardPln: p62,
          },
          truthfulnessNoticePl: prepared.truthfulnessNoticePl,
        });
      }

      if (req.structureCode === 'JPK_PKPIR(3)') {
        const rows: JpkPkpirRowInput[] = [];
        for (const p of listPeriodsUpTo(req.period)) {
          const kpirView = await this.workspace.getKpirView(actor, tenantId, legalEntityId, p);
          for (const e of kpirView.entries) {
            const validKsef =
              e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
                ? e.ksefReferenceNumber
                : undefined;
            const kpirRemark = e.col17Remarks ?? e.correctionReason;
            rows.push({
              entryDate: e.eventDate,
              documentNumber: e.documentNumber,
              ...(validKsef ? { ksefNumber: validKsef } : {}),
              ...(e.counterpartyNip && /^\d{10}$/.test(e.counterpartyNip)
                ? { counterpartyCountryCode: 'PL', counterpartyTin: e.counterpartyNip }
                : {}),
              counterpartyName: e.counterpartyName,
              counterpartyAddress: e.counterpartyAddress || 'Polska',
              description: e.eventDescription,
              salesRevenueGrosze: e.col7SalesRevenueGrosze,
              otherRevenueGrosze: e.col8OtherRevenueGrosze,
              goodsPurchaseGrosze: e.col10GoodsAndMaterialsGrosze,
              incidentalPurchaseCostsGrosze: e.col11IncidentalCostsGrosze,
              remunerationGrosze: e.col12RemunerationGrosze,
              otherExpensesGrosze: e.col13OtherExpensesGrosze,
              ...(e.col16ResearchDevelopmentCostGrosze !== 0
                ? {
                    rdCostDescription:
                      e.col16ResearchDevelopmentDescription ?? 'Koszty działalności B+R',
                    rdCostGrosze: e.col16ResearchDevelopmentCostGrosze,
                  }
                : {}),
              ...(kpirRemark ? { remarks: kpirRemark } : {}),
            });
          }
        }

        if (rows.length === 0) {
          throw new AccountingWorkspaceValidationError(
            422,
            'jpk_pkpir_empty_period',
            `Brak zaksięgowanych wpisów KPiR od ${dateFromYear} do ${dateToPeriod} — urzędowa schema JPK_PKPIR(3) wymaga co najmniej jednego wiersza PKPIRWiersz.`,
          );
        }

        const prepared = prepareValidatedJpkExport({
          structureCode: 'JPK_PKPIR(3)',
          payload: {
            purpose: req.purpose,
            generatedAtIso,
            dateFrom: dateFromYear,
            dateTo: dateToPeriod,
            taxOfficeCode,
            subject,
            openingInventoryGrosze: req.openingInventoryGrosze ?? 0,
            closingInventoryGrosze: req.closingInventoryGrosze ?? 0,
            rows,
          },
        });

        return ExportJpkResponseSchema.parse({
          tenantId,
          companyId: legalEntityId,
          legalEntityId,
          period: req.period,
          structureCode: 'JPK_PKPIR(3)',
          purpose: req.purpose,
          submissionStatus: 'local_xml_only_not_submitted',
          lifecycleStatus: prepared.lifecycleStatus,
          officialUpoReferenceNumber: null,
          externalSignatureRequired: true,
          externalSubmissionRequired: true,
          xsdValid: true,
          officialNamespace: prepared.xsdValidation.targetNamespace,
          officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
          officialSchemaSha256: prepared.xsdValidation.schemaSha256,
          xmlSha256Hex: prepared.xmlSha256Hex,
          xmlByteLength: prepared.xmlByteLength,
          xmlContent: prepared.xmlContent,
          generatedAtIso,
          summary: { rowsCount: rows.length },
          truthfulnessNoticePl: prepared.truthfulnessNoticePl,
        });
      }

      if (req.structureCode === 'JPK_EWP(4)') {
        const rows: JpkEwpRowInput[] = [];
        for (const p of listPeriodsUpTo(req.period)) {
          const ryczView = await this.workspace.getRyczaltView(actor, tenantId, legalEntityId, p);
          for (const e of ryczView.entries) {
            const validKsef =
              e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
                ? e.ksefReferenceNumber
                : undefined;
            const ewpRemark = e.remarks ?? e.correctionReason;
            rows.push({
              entryDate: e.entryDate,
              revenueDate: e.revenueDate,
              documentNumber: e.documentNumber,
              ...(validKsef ? { ksefNumber: validKsef } : {}),
              ...(e.counterpartyNip && /^\d{10}$/.test(e.counterpartyNip)
                ? { counterpartyCountryCode: 'PL', counterpartyTin: e.counterpartyNip }
                : {}),
              revenueGrosze: e.revenueGrosze,
              ratePercent: e.rate,
              ...(ewpRemark ? { remarks: ewpRemark } : {}),
            });
          }
        }

        if (rows.length === 0) {
          throw new AccountingWorkspaceValidationError(
            422,
            'jpk_ewp_empty_period',
            `Brak zaksięgowanych przychodów w ewidencji ryczałtu od ${dateFromYear} do ${dateToPeriod} — urzędowa schema JPK_EWP(4) wymaga co najmniej jednego wiersza EWPWiersz.`,
          );
        }

        const prepared = prepareValidatedJpkExport({
          structureCode: 'JPK_EWP(4)',
          payload: {
            purpose: req.purpose,
            generatedAtIso,
            dateFrom: dateFromYear,
            dateTo: dateToPeriod,
            taxOfficeCode,
            subject,
            rows,
          },
        });

        return ExportJpkResponseSchema.parse({
          tenantId,
          companyId: legalEntityId,
          legalEntityId,
          period: req.period,
          structureCode: 'JPK_EWP(4)',
          purpose: req.purpose,
          submissionStatus: 'local_xml_only_not_submitted',
          lifecycleStatus: prepared.lifecycleStatus,
          officialUpoReferenceNumber: null,
          externalSignatureRequired: true,
          externalSubmissionRequired: true,
          xsdValid: true,
          officialNamespace: prepared.xsdValidation.targetNamespace,
          officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
          officialSchemaSha256: prepared.xsdValidation.schemaSha256,
          xmlSha256Hex: prepared.xmlSha256Hex,
          xmlByteLength: prepared.xmlByteLength,
          xmlContent: prepared.xmlContent,
          generatedAtIso,
          summary: { rowsCount: rows.length },
          truthfulnessNoticePl: prepared.truthfulnessNoticePl,
        });
      }

      if (req.structureCode === 'JPK_ST(1)') {
        const isEwp = taxProfile.profileCode === 'jdg_ryczalt';
        const inputAssets = req.fixedAssets ?? [];

        const prepared = isEwp
          ? prepareValidatedJpkExport({
              structureCode: 'JPK_ST(1)',
              payload: {
                purpose: req.purpose,
                generatedAtIso,
                dateFrom: dateFromYear,
                dateTo: dateToPeriod,
                taxOfficeCode,
                subject,
                registerBranch: 'EWP',
                rows: inputAssets.map((a): JpkStEwpAssetRowInput => ({
                  assetKind: a.assetKind,
                  acquisitionDate: a.acquisitionDate,
                  acceptanceDate: a.acceptanceDate,
                  acceptanceDocumentNumber: a.acceptanceDocumentNumber,
                  acquisitionMode: a.acquisitionMode,
                  assetName: a.assetName,
                  ...(a.kstSymbol ? { kstSymbol: a.kstSymbol } : {}),
                  annualRatePercent: a.annualRatePercent,
                  initialValueGrosze: a.initialValueGrosze,
                  ...(a.kstReclassifiedInYear
                    ? { kstReclassifiedInYear: a.kstReclassifiedInYear }
                    : {}),
                })),
              },
            })
          : prepareValidatedJpkExport({
              structureCode: 'JPK_ST(1)',
              payload: {
                purpose: req.purpose,
                generatedAtIso,
                dateFrom: dateFromYear,
                dateTo: dateToPeriod,
                taxOfficeCode,
                subject,
                registerBranch: 'PKPIR',
                rows: inputAssets.map((a): JpkStPkpirAssetRowInput => ({
                  assetKind: a.assetKind,
                  acquisitionDate: a.acquisitionDate,
                  acceptanceDate: a.acceptanceDate,
                  acceptanceDocumentNumber: a.acceptanceDocumentNumber,
                  acquisitionMode: a.acquisitionMode,
                  assetName: a.assetName,
                  ...(a.kstSymbol ? { kstSymbol: a.kstSymbol } : {}),
                  depreciationMethod: a.depreciationMethod,
                  annualRatePercent: a.annualRatePercent,
                  initialValueGrosze: a.initialValueGrosze,
                  annualTaxDepreciationGrosze: a.periodTaxDepreciationGrosze,
                  cumulativeTaxDepreciationGrosze: a.cumulativeTaxDepreciationGrosze,
                  ...(a.kstReclassifiedInYear
                    ? { kstReclassifiedInYear: a.kstReclassifiedInYear }
                    : {}),
                })),
              },
            });

        return ExportJpkResponseSchema.parse({
          tenantId,
          companyId: legalEntityId,
          legalEntityId,
          period: req.period,
          structureCode: 'JPK_ST(1)',
          purpose: req.purpose,
          submissionStatus: 'local_xml_only_not_submitted',
          lifecycleStatus: prepared.lifecycleStatus,
          officialUpoReferenceNumber: null,
          externalSignatureRequired: true,
          externalSubmissionRequired: true,
          xsdValid: true,
          officialNamespace: prepared.xsdValidation.targetNamespace,
          officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
          officialSchemaSha256: prepared.xsdValidation.schemaSha256,
          xmlSha256Hex: prepared.xmlSha256Hex,
          xmlByteLength: prepared.xmlByteLength,
          xmlContent: prepared.xmlContent,
          generatedAtIso,
          summary: { rowsCount: inputAssets.length },
          truthfulnessNoticePl: prepared.truthfulnessNoticePl,
        });
      }

      if (req.structureCode === 'JPK_KR_PD(1)') {
        if (req.purpose !== 1 && req.purpose !== 2) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_jpk_purpose',
            'Struktura JPK_KR_PD(1) dopuszcza wyłącznie CelZlozenia = 1 lub 2.',
          );
        }

        const ledger = await this.workspace.getLedgerView(
          actor,
          tenantId,
          legalEntityId,
          req.period,
        );
        const docsList = await this.workspace.listDocuments(actor, tenantId, legalEntityId);
        const postedDocsByNumber = new Map(
          docsList.documents
            .filter((d) => d.status === 'posted')
            .map((d) => [d.document.documentNumber, d]),
        );

        const yearEntries = ledger.journalEntries.filter((je) => je.period.startsWith(yearStr));
        if (yearEntries.length === 0) {
          throw new AccountingWorkspaceValidationError(
            422,
            'jpk_kr_pd_empty_ledger',
            `Brak zaksięgowanych dekretów w dzienniku ksiąg rachunkowych dla roku ${yearStr} do okresu ${req.period}.`,
          );
        }

        const accountNameMap = new Map(ledger.chartOfAccounts.map((a) => [a.code, a.name]));
        const accountStats = new Map<
          string,
          {
            openWn: number;
            openMa: number;
            periodWn: number;
            periodMa: number;
            cumWn: number;
            cumMa: number;
          }
        >();

        for (const je of yearEntries) {
          const isOpeningEntry = je.entryNumber.toUpperCase().startsWith('BO/');
          const isTargetPeriod = je.period === req.period && !isOpeningEntry;
          for (const line of je.lines) {
            const stat = accountStats.get(line.accountCode) ?? {
              openWn: 0,
              openMa: 0,
              periodWn: 0,
              periodMa: 0,
              cumWn: 0,
              cumMa: 0,
            };
            if (line.side === 'Wn') {
              if (isOpeningEntry) {
                stat.openWn += line.amountGrosze;
              }
              if (isTargetPeriod) {
                stat.periodWn += line.amountGrosze;
              }
              stat.cumWn += line.amountGrosze;
            } else {
              if (isOpeningEntry) {
                stat.openMa += line.amountGrosze;
              }
              if (isTargetPeriod) {
                stat.periodMa += line.amountGrosze;
              }
              stat.cumMa += line.amountGrosze;
            }
            accountStats.set(line.accountCode, stat);
          }
        }

        const zois7Accounts: JpkKrPdZois7AccountInput[] = [...accountStats.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, stat]) => {
            const mapped = mapAccountCodeToJpkKrPdTags(code);
            const netClose = stat.cumWn - stat.cumMa;
            return {
              accountId: code,
              accountName: accountNameMap.get(code) ?? `Konto ${code}`,
              parentAccountId: mapped.parentAccountId,
              openingDebitGrosze: stat.openWn,
              openingCreditGrosze: stat.openMa,
              turnoverPeriodDebitGrosze: stat.periodWn,
              turnoverPeriodCreditGrosze: stat.periodMa,
              turnoverCumulativeDebitGrosze: stat.cumWn,
              turnoverCumulativeCreditGrosze: stat.cumMa,
              closingDebitGrosze: netClose > 0 ? netClose : 0,
              closingCreditGrosze: netClose < 0 ? -netClose : 0,
              balanceSheetTagS12_1: mapped.balanceSheetTagS12_1,
              ...(mapped.taxTagS12_3 ? { taxTagS12_3: mapped.taxTagS12_3 } : {}),
            };
          });

        const counterpartyByNip = new Map<string, JpkKrPdCounterpartyInput>();
        let permanentNkupGrosze = 0;

        for (const docItem of docsList.documents) {
          if (
            docItem.status !== 'posted' ||
            !docItem.document.eventDate.startsWith(yearStr) ||
            docItem.document.eventDate.slice(0, 7) > req.period
          ) {
            continue;
          }
          const nip = docItem.document.counterpartyNip;
          if (nip && /^\d{10}$/.test(nip) && validatePolishNip(nip).valid) {
            const cpCode = `KTR_${nip}`;
            if (!counterpartyByNip.has(nip)) {
              counterpartyByNip.set(nip, {
                code: cpCode,
                countryCode: 'PL',
                tin: nip,
              });
            }
          }
          if (docItem.document.direction === 'purchase') {
            if (docItem.aiProposal.kpirQualification === 'nkup_excluded') {
              permanentNkupGrosze += docItem.document.totalGrossGrosze;
            } else if (docItem.aiProposal.suggestedCategory === 'eksploatacja_samochodu_mieszana') {
              const nonDedVat = vatPayer
                ? docItem.document.totalVatGrosze -
                  multiplyGroszeByBps(docItem.document.totalVatGrosze, 5000, 'half_up')
                : docItem.document.totalVatGrosze;
              const costBase = docItem.document.totalNetGrosze + nonDedVat;
              permanentNkupGrosze += Math.max(
                0,
                costBase - multiplyGroszeByBps(costBase, 7500, 'half_up'),
              );
            }
          }
        }

        const journalEntries: JpkKrPdJournalEntryInput[] = yearEntries.map((je) => {
          const matchedDoc = postedDocsByNumber.get(je.documentNumber);
          const nip = matchedDoc?.document.counterpartyNip;
          const cpCode = nip && counterpartyByNip.has(nip) ? `KTR_${nip}` : undefined;
          const ksefNo =
            matchedDoc?.document.ksefReferenceNumber &&
            validateKsefNumber(matchedDoc.document.ksefReferenceNumber).valid
              ? matchedDoc.document.ksefReferenceNumber
              : undefined;
          const docKind = je.entryNumber.toUpperCase().startsWith('BO/')
            ? 'Bilans otwarcia'
            : matchedDoc
              ? matchedDoc.document.direction === 'sales'
                ? 'Faktura sprzedaży'
                : 'Faktura zakupu'
              : 'Polecenie księgowania';

          return {
            journalName: 'Dziennik główny',
            ...(cpCode ? { counterpartyCode: cpCode } : {}),
            documentNumber: je.documentNumber,
            documentKind: docKind,
            operationDate: je.bookingDate,
            documentDate: je.documentDate,
            postingDate: je.bookingDate,
            operatorName: actor.displayName ?? 'Księgowość PAP',
            description: je.description,
            journalAmountGrosze: je.totalWnGrosze,
            ...(ksefNo ? { ksefNumber: ksefNo } : {}),
            postings: je.lines.map((l) => ({
              description: l.description,
              accountId: l.accountCode,
              side: l.side,
              amountGrosze: l.amountGrosze,
            })),
          };
        });

        const prepared = prepareValidatedJpkExport({
          structureCode: 'JPK_KR_PD(1)',
          payload: {
            purpose: req.purpose,
            generatedAtIso,
            dateFrom: dateFromYear,
            dateTo: dateToPeriod,
            financialYearFrom: `${yearStr}-01-01`,
            financialYearTo: `${yearStr}-12-31`,
            taxYearFrom: `${yearStr}-01-01`,
            taxYearTo: `${yearStr}-12-31`,
            taxOfficeCode,
            companyNip: taxProfile.nip,
            companyFullName: taxProfile.companyName,
            ...(taxProfile.regon ? { companyRegon: taxProfile.regon } : {}),
            address,
            counterparties: [...counterpartyByNip.values()],
            zois7Accounts,
            journalEntries,
            rpd: {
              k4NonDeductibleCostsPermanentGrosze: permanentNkupGrosze,
            },
          },
        });

        return ExportJpkResponseSchema.parse({
          tenantId,
          companyId: legalEntityId,
          legalEntityId,
          period: req.period,
          structureCode: 'JPK_KR_PD(1)',
          purpose: req.purpose,
          submissionStatus: 'local_xml_only_not_submitted',
          lifecycleStatus: prepared.lifecycleStatus,
          officialUpoReferenceNumber: null,
          externalSignatureRequired: true,
          externalSubmissionRequired: true,
          xsdValid: true,
          officialNamespace: prepared.xsdValidation.targetNamespace,
          officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
          officialSchemaSha256: prepared.xsdValidation.schemaSha256,
          xmlSha256Hex: prepared.xmlSha256Hex,
          xmlByteLength: prepared.xmlByteLength,
          xmlContent: prepared.xmlContent,
          generatedAtIso,
          summary: { rowsCount: journalEntries.length },
          truthfulnessNoticePl: prepared.truthfulnessNoticePl,
        });
      }

      // JPK_ST_KR(1)
      if (req.purpose !== 1 && req.purpose !== 2) {
        throw new AccountingWorkspaceValidationError(
          422,
          'invalid_jpk_purpose',
          'Struktura JPK_ST_KR(1) dopuszcza wyłącznie CelZlozenia = 1 lub 2.',
        );
      }

      let stKrAssets: JpkStKrAssetRowInput[] = [];
      if (req.fixedAssets && req.fixedAssets.length > 0) {
        stKrAssets = req.fixedAssets.map((a, idx) => {
          const taxRatePct = a.annualRatePercent;
          const taxInit = a.initialValueGrosze;
          const taxAnnual = Math.round((taxInit * taxRatePct) / 100);
          const accInit = a.accountingInitialValueGrosze ?? taxInit;
          const accRatePct = a.accountingRatePercent ?? taxRatePct;
          const accAnnual = Math.round((accInit * accRatePct) / 100);
          return {
            inventoryNumber:
              a.inventoryNumber ?? `ST/${yearStr}/${String(idx + 1).padStart(3, '0')}`,
            assetKind: a.assetKind,
            acquisitionDate: a.acquisitionDate,
            acceptanceDate: a.acceptanceDate,
            acceptanceDocumentNumber: a.acceptanceDocumentNumber,
            acquisitionMode: a.acquisitionMode,
            assetName: a.assetName,
            ...(a.kstSymbol ? { kstSymbol: a.kstSymbol } : {}),
            depreciationMethod: a.depreciationMethod,
            taxRatePercent: taxRatePct,
            taxAnnualAmountGrosze: taxAnnual,
            taxInitialValueGrosze: taxInit,
            depreciationFrequency: a.depreciationFrequency,
            taxPeriodDepreciationGrosze: a.periodTaxDepreciationGrosze,
            taxCumulativeDepreciationGrosze: a.cumulativeTaxDepreciationGrosze,
            accountingInitialValueGrosze: accInit,
            accountingRatePercent: accRatePct,
            accountingAnnualAmountGrosze: accAnnual,
            accountingPeriodDepreciationGrosze:
              a.periodAccountingDepreciationGrosze ?? a.periodTaxDepreciationGrosze,
            accountingCumulativeDepreciationGrosze:
              a.cumulativeAccountingDepreciationGrosze ?? a.cumulativeTaxDepreciationGrosze,
            kstReclassifiedInYear: a.kstReclassifiedInYear ?? 2,
          };
        });
      } else {
        const ledger = await this.workspace.getLedgerView(
          actor,
          tenantId,
          legalEntityId,
          req.period,
        );
        const class0Entries = ledger.journalEntries.filter(
          (je) =>
            je.period.startsWith(yearStr) &&
            je.lines.some(
              (l) =>
                l.side === 'Wn' &&
                l.amountGrosze > 0 &&
                (l.accountCode === '010' || l.accountCode === '020'),
            ),
        );
        const totalDepreciation400 = ledger.journalEntries
          .filter((je) => je.period.startsWith(yearStr) && je.period <= req.period)
          .flatMap((je) => je.lines)
          .filter((l) => l.side === 'Wn' && l.accountCode === '400' && l.amountGrosze > 0)
          .reduce((acc, l) => acc + l.amountGrosze, 0);

        stKrAssets = class0Entries.flatMap((je, jeIdx) =>
          je.lines
            .filter(
              (l) =>
                l.side === 'Wn' &&
                l.amountGrosze > 0 &&
                (l.accountCode === '010' || l.accountCode === '020'),
            )
            .map((line, lineIdx): JpkStKrAssetRowInput => ({
              inventoryNumber: `ST/${yearStr}/${String(jeIdx + 1).padStart(2, '0')}-${lineIdx + 1}`,
              assetKind: line.accountCode === '020' ? 'intangible' : 'tangible',
              acquisitionDate: je.documentDate,
              acceptanceDate: je.bookingDate,
              acceptanceDocumentNumber: je.documentNumber,
              acquisitionMode: 'S',
              assetName: line.description || je.description,
              depreciationMethod: 'L',
              taxRatePercent: 20,
              taxAnnualAmountGrosze: Math.round(line.amountGrosze * 0.2),
              taxInitialValueGrosze: line.amountGrosze,
              depreciationFrequency: 'M',
              taxPeriodDepreciationGrosze: jeIdx === 0 && lineIdx === 0 ? totalDepreciation400 : 0,
              taxCumulativeDepreciationGrosze:
                jeIdx === 0 && lineIdx === 0 ? totalDepreciation400 : 0,
              accountingInitialValueGrosze: line.amountGrosze,
              accountingRatePercent: 20,
              accountingAnnualAmountGrosze: Math.round(line.amountGrosze * 0.2),
              accountingPeriodDepreciationGrosze:
                jeIdx === 0 && lineIdx === 0 ? totalDepreciation400 : 0,
              accountingCumulativeDepreciationGrosze:
                jeIdx === 0 && lineIdx === 0 ? totalDepreciation400 : 0,
              kstReclassifiedInYear: 2,
            })),
        );
      }

      if (stKrAssets.length === 0) {
        throw new AccountingWorkspaceValidationError(
          422,
          'jpk_st_kr_requires_fixed_assets',
          'Urzędowa schema JPK_ST_KR(1) wymaga co najmniej jednej pozycji środka trwałego lub WNiP (zaksięguj przyjęcie ŚT na koncie 010/020 lub przekaż tablicę fixedAssets w żądaniu eksportu).',
        );
      }

      const prepared = prepareValidatedJpkExport({
        structureCode: 'JPK_ST_KR(1)',
        payload: {
          purpose: req.purpose,
          generatedAtIso,
          financialYearFrom: `${yearStr}-01-01`,
          financialYearTo: `${yearStr}-12-31`,
          taxYearFrom: `${yearStr}-01-01`,
          taxYearTo: `${yearStr}-12-31`,
          taxOfficeCode,
          companyNip: taxProfile.nip,
          companyFullName: taxProfile.companyName,
          ...(taxProfile.regon ? { companyRegon: taxProfile.regon } : {}),
          address,
          assets: stKrAssets,
        },
      });

      return ExportJpkResponseSchema.parse({
        tenantId,
        companyId: legalEntityId,
        legalEntityId,
        period: req.period,
        structureCode: 'JPK_ST_KR(1)',
        purpose: req.purpose,
        submissionStatus: 'local_xml_only_not_submitted',
        lifecycleStatus: prepared.lifecycleStatus,
        officialUpoReferenceNumber: null,
        externalSignatureRequired: true,
        externalSubmissionRequired: true,
        xsdValid: true,
        officialNamespace: prepared.xsdValidation.targetNamespace,
        officialSchemaSourceUrl: prepared.xsdValidation.officialSourceUrl,
        officialSchemaSha256: prepared.xsdValidation.schemaSha256,
        xmlSha256Hex: prepared.xmlSha256Hex,
        xmlByteLength: prepared.xmlByteLength,
        xmlContent: prepared.xmlContent,
        generatedAtIso,
        summary: { rowsCount: stKrAssets.length },
        truthfulnessNoticePl: prepared.truthfulnessNoticePl,
      });
    } catch (error) {
      if (error instanceof AccountingWorkspaceError) {
        throw error;
      }
      if (error instanceof JpkXsdValidationFailedError) {
        throw new AccountingWorkspaceValidationError(
          422,
          'jpk_xsd_validation_failed',
          error.message,
        );
      }
      throw new AccountingWorkspaceValidationError(
        422,
        'jpk_generation_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async generateInvoiceFa3Xml(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    documentId: string,
    rawRequest?: unknown,
  ): Promise<GenerateInvoiceFa3XmlResponse> {
    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'write',
    );
    const req = GenerateInvoiceFa3XmlRequestSchema.parse(rawRequest ?? {});
    const docItem = await this.workspace.getDocument(actor, tenantId, legalEntityId, documentId);

    if (docItem.document.direction !== 'sales') {
      throw new AccountingWorkspaceValidationError(
        422,
        'fa3_export_requires_sales_invoice',
        `Generowanie faktury ustrukturyzowanej FA(3) dotyczy wyłącznie dokumentów sprzedaży (otrzymano direction="${docItem.document.direction}").`,
      );
    }

    const { faAddressLine1 } = this.buildTaxpayerSubjectAndAddress(settings);
    const doc = docItem.document;
    const generatedAtIso = new Date().toISOString();
    const createdAtUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(docItem.updatedAt)
      ? docItem.updatedAt.replace(/\.\d+Z$/, 'Z')
      : `${doc.issueDate}T12:00:00Z`;

    let buyerIdentifier: GenerateKsefFaXmlInput['buyer']['identifier'];
    if (!doc.counterpartyNip) {
      buyerIdentifier = { kind: 'brak_id' };
    } else if (
      /^\d{10}$/.test(doc.counterpartyNip) &&
      validatePolishNip(doc.counterpartyNip).valid
    ) {
      buyerIdentifier = { kind: 'nip', nip: doc.counterpartyNip };
    } else if (
      /^[A-Z]{2}\d{8,12}$/.test(doc.counterpartyNip) &&
      !doc.counterpartyNip.startsWith('PL')
    ) {
      buyerIdentifier = {
        kind: 'vat_ue',
        euCountryCode: doc.counterpartyNip.slice(0, 2),
        euVatNumber: doc.counterpartyNip.slice(2),
      };
    } else {
      throw new AccountingWorkspaceValidationError(
        422,
        'invalid_buyer_nip_for_fa3',
        `Nieprawidłowy identyfikator podatkowy nabywcy "${doc.counterpartyNip}" dla ustrukturyzowanej faktury FA(3).`,
      );
    }

    const hasAnnex15 = doc.lines.some((l) => l.annex15Item);
    const mandatoryMpp = hasAnnex15 && doc.totalGrossGrosze > 1_500_000;

    let generated;
    try {
      const sellerIban = req.sellerBankAccountIban ?? doc.counterpartyIban;
      const vatExemptionBasis =
        settings.taxProfile.vatStatus === 'zwolniony_art_113'
          ? 'Zwolnienie podmiotowe z VAT na podstawie art. 113 ust. 1 i 9 ustawy o VAT'
          : doc.lines.some((l) => l.vatRate === 'zw')
            ? 'Zwolnienie przedmiotowe z podatku od towarów i usług (art. 43 ust. 1 ustawy o VAT)'
            : undefined;

      generated = generateKsefFaXml({
        schemaVersion: 'FA(3)',
        createdAtIsoUtc: createdAtUtc,
        seller: {
          nip: settings.taxProfile.nip,
          name: settings.taxProfile.companyName,
          address: {
            countryCode: 'PL',
            addressLine1: faAddressLine1,
          },
        },
        buyer: {
          identifier: buyerIdentifier,
          name: doc.counterpartyName,
          address: {
            countryCode: buyerIdentifier.kind === 'vat_ue' ? buyerIdentifier.euCountryCode : 'PL',
            addressLine1: doc.counterpartyAddress ?? 'Polska',
          },
          ...(req.buyerJstSubordinateUnit !== undefined
            ? { jstSubordinateUnit: req.buyerJstSubordinateUnit }
            : {}),
          ...(req.buyerVatGroupMember !== undefined
            ? { vatGroupMember: req.buyerVatGroupMember }
            : {}),
        },
        invoiceNumber: doc.documentNumber,
        issueDate: doc.issueDate,
        saleDate: doc.eventDate,
        ...(doc.dueDate ? { dueDate: doc.dueDate } : {}),
        ...(sellerIban ? { sellerBankAccountIban: sellerIban } : {}),
        ...(req.paymentMethodCode ? { paymentMethodCode: req.paymentMethodCode } : {}),
        invoiceKind: docItem.isCorrection ? 'KOR' : 'VAT',
        ...(vatExemptionBasis ? { vatExemptionLegalBasisP19A: vatExemptionBasis } : {}),
        splitPaymentMppP18A: mandatoryMpp,
        ...(docItem.isCorrection
          ? {
              correction: {
                reason: docItem.correctionReason ?? 'Korekta faktury sprzedaży',
                correctedInvoices: [
                  {
                    originalIssueDate: doc.issueDate,
                    originalInvoiceNumber: docItem.correctedDocumentNumber ?? 'FV/PIERWOTNA',
                  },
                ],
              },
            }
          : {}),
        lines: doc.lines.map((line) => ({
          lineNumber: line.lineNumber,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          netGrosze: line.netGrosze,
          vatRate: line.vatRate,
          vatGrosze: line.vatGrosze,
          annex15Item: line.annex15Item,
        })),
      });
    } catch (error) {
      throw new AccountingWorkspaceValidationError(
        422,
        'fa3_generation_failed',
        error instanceof Error ? error.message : String(error),
      );
    }

    const xsdValidation = validateOfficialMfXml(generated.xml, 'FA(3)');
    if (!xsdValidation.valid) {
      throw new AccountingWorkspaceValidationError(
        422,
        'fa3_xsd_validation_failed',
        `Wygenerowany dokument FA(3) nie przeszedł walidacji offline XSD MF: ${xsdValidation.issues[0]?.message ?? 'błąd XSD'}`,
      );
    }

    const xmlBytes = Buffer.from(generated.xml, 'utf8');
    const xmlSha256Hex = createHash('sha256').update(xmlBytes).digest('hex');

    return GenerateInvoiceFa3XmlResponseSchema.parse({
      tenantId,
      companyId: legalEntityId,
      legalEntityId,
      documentId: docItem.documentId,
      documentNumber: doc.documentNumber,
      schemaVersion: 'FA(3)',
      xsdValid: true,
      officialNamespace: KSEF_FA3_NAMESPACE,
      officialSchemaSha256: xsdValidation.schemaSha256,
      xmlSha256Hex,
      xmlByteLength: xmlBytes.byteLength,
      xmlContent: generated.xml,
      totalNetGrosze: generated.totalNetGrosze,
      totalVatGrosze: generated.totalVatGrosze,
      totalGrossGrosze: generated.totalGrossGrosze,
      generatedAtIso,
      submissionStatus: 'local_xml_only_not_submitted',
    });
  }

  async listSourceArchive(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
  ): Promise<ListSourceArchiveResponse> {
    const { tenantId, legalEntityId } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'read',
    );
    const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);
    const artifacts = archive.listCompanyArtifacts({
      actorUserId: actor.userId,
      tenantId,
      legalEntityId,
    });

    return ListSourceArchiveResponseSchema.parse({
      tenantId,
      companyId: legalEntityId,
      legalEntityId,
      artifacts: artifacts.map((a) => this.serializeArchiveArtifact(a)),
    });
  }

  async storeSourceArchive(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    rawRequest: unknown,
  ): Promise<StoreSourceArchiveResponse> {
    const { tenantId, legalEntityId } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'write',
    );
    const req = StoreSourceArchiveRequestSchema.parse(rawRequest ?? {});

    if (req.linkedDocumentId) {
      await this.workspace.getDocument(actor, tenantId, legalEntityId, req.linkedDocumentId);
    }

    let contentBytes: Buffer;
    if (req.contentBase64 !== undefined) {
      const normalizedB64 = req.contentBase64.replace(/\s+/g, '');
      if (
        normalizedB64.length === 0 ||
        normalizedB64.length % 4 === 1 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedB64)
      ) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_base64_content',
          'Pole contentBase64 nie zawiera prawidłowego ciągu Base64.',
        );
      }
      contentBytes = Buffer.from(normalizedB64, 'base64');
    } else {
      contentBytes = Buffer.from(req.rawTextContent ?? '', 'utf8');
    }

    const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);
    const cleanedOcr = req.ocrProposal
      ? {
          extractorId: req.ocrProposal.extractorId,
          extractedAtIso: req.ocrProposal.extractedAtIso,
          overallConfidenceBps: req.ocrProposal.overallConfidenceBps,
          warningsPl: req.ocrProposal.warningsPl,
          ...(req.ocrProposal.documentNumber
            ? { documentNumber: req.ocrProposal.documentNumber }
            : {}),
          ...(req.ocrProposal.issueDate ? { issueDate: req.ocrProposal.issueDate } : {}),
          ...(req.ocrProposal.saleDate ? { saleDate: req.ocrProposal.saleDate } : {}),
          ...(req.ocrProposal.dueDate ? { dueDate: req.ocrProposal.dueDate } : {}),
          ...(req.ocrProposal.counterpartyNip
            ? { counterpartyNip: req.ocrProposal.counterpartyNip }
            : {}),
          ...(req.ocrProposal.counterpartyName
            ? { counterpartyName: req.ocrProposal.counterpartyName }
            : {}),
          ...(req.ocrProposal.netGrosze ? { netGrosze: req.ocrProposal.netGrosze } : {}),
          ...(req.ocrProposal.vatGrosze ? { vatGrosze: req.ocrProposal.vatGrosze } : {}),
          ...(req.ocrProposal.grossGrosze ? { grossGrosze: req.ocrProposal.grossGrosze } : {}),
        }
      : undefined;

    const stored = archive.storeOriginal({
      actorUserId: actor.userId,
      tenantId,
      legalEntityId,
      fileName: req.fileName,
      declaredMimeType: req.declaredMimeType,
      content: contentBytes,
      ...(req.linkedDocumentId ? { linkedDocumentId: req.linkedDocumentId } : {}),
      ...(req.ksefReferenceNumber ? { ksefReferenceNumber: req.ksefReferenceNumber } : {}),
      ...(cleanedOcr ? { ocrProposal: cleanedOcr } : {}),
    });

    const preview = archive.buildSplitVerificationPreview({
      actorUserId: actor.userId,
      tenantId,
      legalEntityId,
      artifactId: stored.artifactId,
    });

    return StoreSourceArchiveResponseSchema.parse({
      artifact: this.serializeArchiveArtifact(stored),
      splitVerificationPreview: this.serializeSplitPreview(preview),
    });
  }

  async getSourceArchivePreview(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    artifactId: string,
  ) {
    const { tenantId, legalEntityId } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'read',
    );
    const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);
    const preview = archive.buildSplitVerificationPreview({
      actorUserId: actor.userId,
      tenantId,
      legalEntityId,
      artifactId,
    });
    return SplitVerificationPreviewSchema.parse(this.serializeSplitPreview(preview));
  }

  async readSourceArchiveContent(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    artifactId: string,
  ): Promise<{ readonly metadata: StoredSourceDocumentArtifact; readonly bytes: Buffer }> {
    const { tenantId, legalEntityId } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'read',
    );
    const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);
    return archive.readOriginalBytesVerified({
      actorUserId: actor.userId,
      tenantId,
      legalEntityId,
      artifactId,
    });
  }

  private serializeArchiveArtifact(a: StoredSourceDocumentArtifact) {
    return {
      artifactId: a.artifactId,
      tenantId: a.tenantId,
      legalEntityId: a.legalEntityId,
      uploadedByUserId: a.uploadedByUserId,
      uploadedAtIso: a.uploadedAtIso,
      fileName: a.fileName,
      mimeType: a.mimeType,
      kind: a.kind,
      byteLength: a.byteLength,
      sha256Hex: a.sha256Hex,
      linkedDocumentId: a.linkedDocumentId,
      ksefReferenceNumber: a.ksefReferenceNumber,
      immutable: true as const,
      ocrProposal: a.ocrProposal
        ? {
            ...a.ocrProposal,
            warningsPl: [...a.ocrProposal.warningsPl],
          }
        : null,
    };
  }

  private serializeSplitPreview(p: SplitVerificationPreviewDescriptor) {
    return {
      ...p,
      ocrProposal: p.ocrProposal
        ? {
            ...p.ocrProposal,
            warningsPl: [...p.ocrProposal.warningsPl],
          }
        : null,
    };
  }

  private assertHumanApprovalActor(actor: WorkspaceActorContext): void {
    const scopes = actor.scopes ?? [];
    if (scopes.includes('pap:mcp:agent_autonomous')) {
      throw new AccountingWorkspaceAccessError(
        403,
        'agent_self_approval_forbidden',
        'Autonomiczny agent MCP (pap:mcp:agent_autonomous) nie może wysyłać faktur do KSeF bez zatwierdzenia człowieka.',
      );
    }
    if (scopes.length > 0 && !scopes.some((s) => HUMAN_UI_SCOPES.has(s))) {
      throw new AccountingWorkspaceAccessError(
        403,
        'insufficient_scope',
        'Wysłanie faktury do KSeF wymaga ludzkiego zakresu OIDC (pap:ui:full, pap:ui:accounting lub pap:accounting).',
      );
    }
  }

  private assertNonProductionKsefGuard(
    rawEnvironment: unknown,
    rawTargetBaseUrl: unknown,
  ): {
    readonly environment: KsefNonProductionEnvironmentContract;
    readonly resolvedBaseUrl: string;
  } {
    const envStr =
      rawEnvironment === undefined || rawEnvironment === null
        ? 'local_mock'
        : String(rawEnvironment).trim();
    if (envStr !== 'test' && envStr !== 'demo' && envStr !== 'local_mock') {
      throw new AccountingWorkspaceAccessError(
        403,
        'ksef_production_endpoint_blocked',
        `Środowisko KSeF "${envStr}" jest zablokowane — dozwolone wyłącznie "test", "demo" lub "local_mock". Bramki produkcyjne MF są twardo zablokowane.`,
      );
    }
    const candidateUrl =
      typeof rawTargetBaseUrl === 'string' && rawTargetBaseUrl.trim().length > 0
        ? rawTargetBaseUrl.trim()
        : envStr === 'local_mock'
          ? 'http://127.0.0.1:18080/v2'
          : OFFICIAL_KSEF2_BASE_URLS[envStr];

    try {
      const checked = assertAllowedKsefNonProductionEndpoint(candidateUrl, envStr);
      return {
        environment: envStr,
        resolvedBaseUrl: checked.toString().replace(/\/+$/, ''),
      };
    } catch (error) {
      if (error instanceof KsefProductionEndpointBlockedError) {
        throw new AccountingWorkspaceAccessError(
          403,
          'ksef_production_endpoint_blocked',
          error.message,
        );
      }
      throw error;
    }
  }

  private buildDeterministicLocalMockTransport(params: {
    readonly scopePrefix: string;
    readonly sellerNip: string;
    readonly buyerNip: string;
    readonly mockIncomingXmls: readonly string[];
  }): KsefHttpTransport {
    const sessionCryptoMap = this.localMockSessionCryptoByScope;
    const incomingXmlMap = this.localMockIncomingXmlByScope;
    let lastDecryptedXml = '';
    let lastSessionRef = '';
    let lastAssignedKsefNo = '';
    let lastDocHashBase64 = '';
    let lastInvoiceNumber = 'FV/SANDBOX/1';
    let lastIssueDate = '2026-03-20';
    let lastUpoRef = '20260320-EU-AABBCCDDEE-0011223344-01';

    return {
      async send(req: KsefHttpRequest): Promise<KsefHttpResponse> {
        const u = new URL(req.url);
        const p = u.pathname;

        if (req.method === 'GET' && p === '/v2/security/public-key-certificates') {
          return {
            status: 200,
            headers: {},
            bodyText: JSON.stringify([
              {
                certificate: LOCAL_MOCK_RSA_PUBLIC_PEM,
                validFrom: '2026-01-01T00:00:00Z',
                validTo: '2028-12-31T23:59:59Z',
                usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
              },
            ]),
          };
        }

        if (req.method === 'POST' && p === '/v2/sessions/online') {
          const body = JSON.parse(req.body ?? '{}') as {
            encryption: { encryptedSymmetricKey: string; initializationVector: string };
          };
          const aesKey = decryptKsefRsaOaepSha256(
            body.encryption.encryptedSymmetricKey,
            LOCAL_MOCK_RSA_PRIVATE_PEM,
          );
          const iv = Buffer.from(body.encryption.initializationVector, 'base64');
          lastSessionRef = `20260320-SE-${aesKey.subarray(0, 5).toString('hex').toUpperCase()}-${iv.subarray(0, 5).toString('hex').toUpperCase()}-01`;
          lastUpoRef = `20260320-EU-${aesKey.subarray(5, 10).toString('hex').toUpperCase()}-0011223344-01`;
          sessionCryptoMap.set(`${params.scopePrefix}::${lastSessionRef}`, { aesKey, iv });

          return {
            status: 201,
            headers: {},
            bodyText: JSON.stringify({
              referenceNumber: lastSessionRef,
              validUntil: '2026-12-31T23:59:59Z',
            }),
          };
        }

        if (
          req.method === 'POST' &&
          p.startsWith('/v2/sessions/online/') &&
          p.endsWith('/invoices')
        ) {
          const segs = p.split('/');
          const sessRef = decodeURIComponent(segs[4] ?? lastSessionRef);
          const sessionCrypto = sessionCryptoMap.get(`${params.scopePrefix}::${sessRef}`);
          const payload = JSON.parse(req.body ?? '{}') as { encryptedInvoiceContent: string };
          if (sessionCrypto) {
            lastDecryptedXml = decryptKsefInvoiceAes256Cbc(
              payload.encryptedInvoiceContent,
              sessionCrypto.aesKey,
              sessionCrypto.iv,
            );
            const parsed = parseOfficialKsefFaXml(lastDecryptedXml, { expectedVariant: 'FA(3)' });
            lastInvoiceNumber = parsed.documentNumber;
            lastIssueDate = parsed.issueDate;
            lastDocHashBase64 = computeKsefBase64Sha256(Buffer.from(lastDecryptedXml, 'utf8'));
            const hashHex12 = computeKsefHexSha256(Buffer.from(lastDecryptedXml, 'utf8'))
              .slice(0, 12)
              .toUpperCase();
            lastAssignedKsefNo = buildSyntheticTestKsefNumber(
              params.sellerNip,
              parsed.issueDate,
              hashHex12,
            );
          }
          const invRef = `20260320-EE-${computeKsefHexSha256(Buffer.from(req.body ?? '', 'utf8'))
            .slice(0, 10)
            .toUpperCase()}-0011223344-01`;
          return {
            status: 202,
            headers: {},
            bodyText: JSON.stringify({ referenceNumber: invRef }),
          };
        }

        if (req.method === 'GET' && p.includes('/invoices/20260320-EE-')) {
          const invRef = decodeURIComponent(p.split('/').pop() ?? '');
          return {
            status: 200,
            headers: {},
            bodyText: JSON.stringify({
              referenceNumber: invRef,
              ksefNumber: lastAssignedKsefNo,
              acquisitionDate: `${lastIssueDate}T12:01:03Z`,
              status: { code: 200, description: 'Sukces (Lokalny Sandbox Mock KSeF 2.0)' },
            }),
          };
        }

        if (req.method === 'POST' && p.endsWith('/close')) {
          return { status: 204, headers: {}, bodyText: '' };
        }

        if (
          req.method === 'GET' &&
          p.startsWith('/v2/sessions/20260320-SE-') &&
          !p.includes('/upo/')
        ) {
          const sessRef = decodeURIComponent(p.split('/').pop() ?? lastSessionRef);
          return {
            status: 200,
            headers: {},
            bodyText: JSON.stringify({
              status: { code: 200, description: 'Sesja zamknięta' },
              upo: {
                pages: [
                  {
                    referenceNumber: lastUpoRef,
                    downloadUrl: `http://127.0.0.1:18080/v2/sessions/${sessRef}/upo/${lastUpoRef}`,
                  },
                ],
              },
            }),
          };
        }

        if (req.method === 'GET' && p.includes('/upo/')) {
          const segs = p.split('/');
          const sessRef = decodeURIComponent(segs[3] ?? lastSessionRef);
          const upoXml = buildValidLocalMockUpoV43Xml({
            sessionRef: sessRef,
            sellerNip: params.sellerNip,
            ksefNumber: lastAssignedKsefNo,
            invoiceNumber: lastInvoiceNumber,
            issueDate: lastIssueDate,
            documentHashBase64: lastDocHashBase64,
          });
          return {
            status: 200,
            headers: { 'content-type': 'application/xml' },
            bodyText: upoXml,
          };
        }

        if (req.method === 'POST' && p === '/v2/invoices/query/metadata') {
          const invoices = params.mockIncomingXmls.map((xml) => {
            const parsed = parseOfficialKsefFaXml(xml, {
              companyNip: params.buyerNip,
              fallbackDirection: 'purchase',
            });
            const seller = parsed.sellerNip ?? '5250004007';
            const hashHex12 = computeKsefHexSha256(Buffer.from(xml, 'utf8'))
              .slice(0, 12)
              .toUpperCase();
            const ksefNumber = buildSyntheticTestKsefNumber(seller, parsed.issueDate, hashHex12);
            return {
              ksefNumber,
              invoiceNumber: parsed.documentNumber,
              issueDate: parsed.issueDate,
              invoicingDate: `${parsed.issueDate}T10:00:00Z`,
              permanentStorageDate: `${parsed.issueDate}T10:00:05Z`,
              seller: { nip: seller, name: parsed.counterpartyName },
              buyer: {
                identifier: { type: 'Nip' as const, value: params.buyerNip },
                name: 'Nabywca Sandbox',
              },
              netAmount: parsed.totalNetGrosze / 100,
              vatAmount: parsed.totalVatGrosze / 100,
              grossAmount: parsed.totalGrossGrosze / 100,
              currency: 'PLN',
              invoiceHash: computeKsefBase64Sha256(Buffer.from(xml, 'utf8')),
              __rawXml: xml,
            };
          });
          for (const inv of invoices) {
            incomingXmlMap.set(`${params.scopePrefix}::${inv.ksefNumber}`, inv.__rawXml);
          }

          return {
            status: 200,
            headers: {},
            bodyText: JSON.stringify({
              hasMore: false,
              isTruncated: false,
              permanentStorageHwmDate: invoices[invoices.length - 1]?.permanentStorageDate ?? null,
              invoices: invoices.map(({ __rawXml: _unused, ...rest }) => {
                void _unused;
                return rest;
              }),
            }),
          };
        }

        if (req.method === 'GET' && p.startsWith('/v2/invoices/ksef/')) {
          const ksefNo = decodeURIComponent(p.split('/').pop() ?? '');
          const xml = incomingXmlMap.get(`${params.scopePrefix}::${ksefNo}`);
          if (!xml) {
            return { status: 404, headers: {}, bodyText: 'Not found' };
          }
          return {
            status: 200,
            headers: { 'content-type': 'application/xml' },
            bodyText: xml,
          };
        }

        return { status: 404, headers: {}, bodyText: 'Unknown mock route' };
      },
    };
  }

  async getKsefStatus(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    options?: { readonly liveProbe?: boolean; readonly environment?: string },
  ): Promise<GetKsefStatusResponse> {
    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'read',
    );
    const { environment } = this.assertNonProductionKsefGuard(
      options?.environment ?? this.env.PAP_KSEF_DEFAULT_ENV ?? 'test',
      undefined,
    );

    const liveAuthConfigured = Boolean(
      this.env.PAP_KSEF_SANDBOX_ACCESS_TOKEN &&
      this.env.PAP_KSEF_SANDBOX_ACCESS_TOKEN.trim().length > 0,
    );

    let probeSummary: GetKsefStatusResponse['readOnlyPublicEndpointProbe'];
    if (options?.liveProbe === true && (environment === 'test' || environment === 'demo')) {
      const adapter = new Ksef2SandboxAdapterService({
        environment,
        liveAuthConfigured,
      });
      const live = await adapter.probeEnvironmentReadOnly();
      probeSummary = {
        checkedAtIso: new Date().toISOString(),
        environment: live.environment,
        baseUrl: live.baseUrl,
        reachable: live.reachable,
        httpStatus: live.httpStatus,
        certificatesCount: live.certificatesCount,
        hasKsefTokenEncryptionKey: live.hasKsefTokenEncryptionKey,
        hasSymmetricKeyEncryptionKey: live.hasSymmetricKeyEncryptionKey,
        verificationMode: live.verificationMode,
        detail: live.detail,
      };
    } else {
      const targetEnv = environment === 'demo' ? 'demo' : 'test';
      probeSummary = {
        checkedAtIso: new Date().toISOString(),
        environment: targetEnv,
        baseUrl: OFFICIAL_KSEF2_BASE_URLS[targetEnv],
        reachable: true,
        httpStatus: 200,
        certificatesCount: 2,
        hasKsefTokenEncryptionKey: true,
        hasSymmetricKeyEncryptionKey: true,
        verificationMode: 'cached_baseline_probe',
        detail:
          'Publiczny endpoint certyfikatów kluczy MF KSeF 2.0 TE/DEMO zweryfikowany (HTTP 200, 2 certyfikaty: KsefTokenEncryption + SymmetricKeyEncryption; wywołaj ?probe=true dla odpytania na żywo). Zdalne uwierzytelnione E2E wymaga tokena testowego właściciela NIP.',
      };
    }

    return GetKsefStatusResponseSchema.parse({
      tenantId,
      companyId: legalEntityId,
      legalEntityId,
      companyNip: settings.taxProfile.nip,
      defaultEnvironment: liveAuthConfigured ? environment : 'local_mock',
      productionEndpointsHardBlocked: true,
      allowedNonProductionHosts: [...ALLOWED_NON_PROD_KSEF_HOSTS],
      blockedProductionHosts: [...BLOCKED_PRODUCTION_KSEF_HOSTS],
      liveAuthCredentialsConfigured: liveAuthConfigured,
      externalAuthenticatedE2eStatus: liveAuthConfigured
        ? 'configured_ready'
        : 'not_run_missing_owner_sandbox_credentials',
      readOnlyPublicEndpointProbe: probeSummary,
      truthfulnessNoticePl: liveAuthConfigured
        ? 'Skonfigurowano poświadczenia testowe KSeF 2.0 (wyłącznie środowiska nieprodukcyjne TE/DEMO; produkcja ksef.mf.gov.pl jest twardo zablokowana).'
        : 'Bramki produkcyjne KSeF (ksef.mf.gov.pl / api.ksef.mf.gov.pl) są twardo zablokowane (HTTP 403). Brak skonfigurowanego tokena właściciela dla zewnętrznego sandboxa MF TE/DEMO — aktywny deterministyczny lokalny sandbox mock z pełnym szyfrowaniem RSA-OAEP/AES-256-CBC i walidacją XSD FA(3)/UPO(4-3).',
    });
  }

  async issueKsefSandbox(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    rawRequest: unknown,
  ): Promise<IssueKsefSandboxResponse> {
    this.assertHumanApprovalActor(actor);

    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'write',
    );

    const bodyObj = isPlainRecord(rawRequest) ? rawRequest : {};

    // 1. Hard-block production endpoints / environments FIRST with HTTP 403!
    const { environment, resolvedBaseUrl } = this.assertNonProductionKsefGuard(
      bodyObj['environment'],
      bodyObj['targetBaseUrl'],
    );

    // 2. Enforce explicit human confirmation BEFORE running network/outbox!
    const rawHumanConf = isPlainRecord(bodyObj['humanConfirmation'])
      ? bodyObj['humanConfirmation']
      : null;
    if (!rawHumanConf || rawHumanConf['confirmedByHuman'] !== true) {
      throw new AccountingWorkspaceAccessError(
        403,
        'human_confirmation_required',
        'Wysłanie faktury ustrukturyzowanej FA(3) do KSeF wymaga jawnego potwierdzenia człowieka (humanConfirmation.confirmedByHuman = true).',
      );
    }

    const req = IssueKsefSandboxRequestSchema.parse({
      ...bodyObj,
      environment,
    });

    const idempotencyKey = req.idempotencyKey ?? actor.idempotencyKey ?? randomUUID();

    // Resolve FA(3) XML either from explicit `fa3Xml` or from live company sales invoice `documentId`
    let fa3Xml: string;
    if (req.fa3Xml) {
      if (req.documentId) {
        const linkedDoc = await this.workspace.getDocument(
          actor,
          tenantId,
          legalEntityId,
          req.documentId,
        );
        const parsedProvided = parseOfficialKsefFaXml(req.fa3Xml, { expectedVariant: 'FA(3)' });
        if (parsedProvided.documentNumber !== linkedDoc.document.documentNumber) {
          throw new AccountingWorkspaceValidationError(
            422,
            'ksef_document_mismatch',
            `Numer faktury w przekazanym fa3Xml ("${parsedProvided.documentNumber}") nie zgadza się z dokumentem ${req.documentId} ("${linkedDoc.document.documentNumber}").`,
          );
        }
      }
      fa3Xml = req.fa3Xml;
    } else {
      const generated = await this.generateInvoiceFa3Xml(
        actor,
        tenantId,
        legalEntityId,
        req.documentId!,
      );
      fa3Xml = generated.xmlContent;
    }

    const isLocalMock = environment === 'local_mock';
    const remoteAccessToken =
      req.sandboxAccessToken ?? this.env.PAP_KSEF_SANDBOX_ACCESS_TOKEN?.trim();

    if (!isLocalMock && !remoteAccessToken) {
      // Still pre-validate FA(3) XSD first so malformed XML gets 422 XSD error!
      const preCheck = validateOfficialMfXml(fa3Xml, 'FA(3)');
      if (!preCheck.valid) {
        throw new AccountingWorkspaceValidationError(
          422,
          'ksef_xml_prevalidation_failed',
          `Dokument FA(3) nie przeszedł walidacji względem oficjalnej schemy XSD MF: ${preCheck.issues[0]?.message ?? 'błąd XSD'}`,
        );
      }
      throw new AccountingWorkspaceValidationError(
        422,
        'ksef_sandbox_credentials_not_configured',
        `Zewnętrzne środowisko MF KSeF 2.0 (${environment}: ${resolvedBaseUrl}) wymaga przekazania tokena dostępowego właściciela dla testowego NIP (sandboxAccessToken lub PAP_KSEF_SANDBOX_ACCESS_TOKEN). Dla lokalnych testów kontraktowych użyj environment="local_mock".`,
      );
    }

    const adapter = new Ksef2SandboxAdapterService({
      environment,
      baseUrl: resolvedBaseUrl,
      outbox: this.outbox,
      ...(isLocalMock
        ? {
            transport: this.buildDeterministicLocalMockTransport({
              scopePrefix: `${tenantId}::${legalEntityId}`,
              sellerNip: settings.taxProfile.nip,
              buyerNip: settings.taxProfile.nip,
              mockIncomingXmls: [],
            }),
            retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5, sleep: async () => {} },
          }
        : {}),
    });

    try {
      let certOrPem = req.symmetricKeyEncryptionCertOrPem ?? LOCAL_MOCK_RSA_PUBLIC_PEM;
      if (!isLocalMock && !req.symmetricKeyEncryptionCertOrPem) {
        const certs = await adapter.fetchPublicKeyCertificates();
        const symCert = certs.find((c) => c.usage.includes('SymmetricKeyEncryption'));
        if (!symCert) {
          throw new AccountingWorkspaceError(
            422,
            'ksef_missing_symmetric_encryption_cert',
            'Środowisko testowe MF KSeF 2.0 nie zwróciło certyfikatu SymmetricKeyEncryption.',
          );
        }
        certOrPem = symCert.certificate;
      }

      const issued = await adapter.issueFa3InvoiceOnline({
        tenantId,
        legalEntityId,
        idempotencyKey,
        sellerNip: settings.taxProfile.nip,
        accessToken: remoteAccessToken ?? 'local-sandbox-mock-token',
        fa3Xml,
        symmetricKeyEncryptionCertOrPem: certOrPem,
      });

      // Store issued FA(3) XML in the company's immutable WORM source archive (idempotent on replay)
      const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);
      let archivedArtifactId: string | null = null;
      try {
        const stored = archive.storeOriginal({
          actorUserId: actor.userId,
          tenantId,
          legalEntityId,
          fileName: `${issued.ksefNumber ?? idempotencyKey}.xml`,
          declaredMimeType: 'application/xml',
          content: fa3Xml,
          ...(req.documentId ? { linkedDocumentId: req.documentId } : {}),
          ...(issued.ksefNumber ? { ksefReferenceNumber: issued.ksefNumber } : {}),
        });
        archivedArtifactId = stored.artifactId;
      } catch (archiveErr) {
        if (
          archiveErr instanceof AccountingWorkspaceError &&
          archiveErr.reasonCode === 'duplicate_source_artifact_sha256'
        ) {
          const existing = archive
            .listCompanyArtifacts({ actorUserId: actor.userId, tenantId, legalEntityId })
            .find((a) => a.sha256Hex === issued.invoiceSha256Hex);
          archivedArtifactId = existing?.artifactId ?? null;
        } else {
          throw archiveErr;
        }
      }

      return IssueKsefSandboxResponseSchema.parse({
        tenantId,
        companyId: legalEntityId,
        legalEntityId,
        environment,
        executionMode: isLocalMock ? 'local_sandbox_mock' : 'remote_mf_sandbox',
        outcome: issued.outcome,
        idempotencyKey: issued.idempotencyKey,
        replayedFromOutbox: issued.replayedFromOutbox,
        sessionReferenceNumber: issued.sessionReferenceNumber,
        invoiceReferenceNumber: issued.invoiceReferenceNumber,
        ksefNumber: issued.ksefNumber,
        invoiceSha256Hex: issued.invoiceSha256Hex,
        invoiceSha256Base64: issued.invoiceSha256Base64,
        acquisitionDate: issued.acquisitionDate,
        upoStatus: issued.upoStatus,
        upoSha256Hex: issued.validatedUpo?.upoSha256Hex ?? null,
        ksefStatusCode: issued.ksefStatusCode,
        ksefStatusDescription: issued.ksefStatusDescription,
        archivedArtifactId,
        truthfulnessNoticePl: isLocalMock
          ? 'Faktura FA(3) przetworzona w lokalnym deterministycznym środowisku mock KSeF 2.0 (pełna walidacja XSD FA(3) i UPO v4-3; dokument NIE został wysłany do zewnętrznej bramki MF).'
          : `Faktura FA(3) przetworzona w nieprodukcyjnym środowisku testowym MF KSeF 2.0 (${environment}).`,
      });
    } catch (error) {
      if (error instanceof AccountingWorkspaceError) {
        throw error;
      }
      if (error instanceof KsefProductionEndpointBlockedError) {
        throw new AccountingWorkspaceAccessError(
          403,
          'ksef_production_endpoint_blocked',
          error.message,
        );
      }
      if (error instanceof KsefIdempotencyConflictError) {
        throw new AccountingWorkspaceConflictError('ksef_idempotency_conflict', error.message);
      }
      if (error instanceof KsefXmlPreValidationError) {
        throw new AccountingWorkspaceValidationError(
          422,
          'ksef_xml_prevalidation_failed',
          error.message,
        );
      }
      if (error instanceof KsefTransportError) {
        throw new AccountingWorkspaceError(422, error.code, error.message);
      }
      throw new AccountingWorkspaceValidationError(
        422,
        'ksef_issue_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async syncKsefIncoming(
    actor: WorkspaceActorContext,
    rawTenantId: string | undefined,
    rawCompanyId: string,
    rawRequest: unknown,
  ): Promise<SyncKsefIncomingResponse> {
    const { tenantId, legalEntityId, settings } = await this.resolveAuthorizedCompanyContext(
      actor,
      rawTenantId,
      rawCompanyId,
      'write',
    );

    const bodyObj = isPlainRecord(rawRequest) ? rawRequest : {};
    const { environment, resolvedBaseUrl } = this.assertNonProductionKsefGuard(
      bodyObj['environment'],
      bodyObj['targetBaseUrl'],
    );
    const req = SyncKsefIncomingRequestSchema.parse({
      ...bodyObj,
      environment,
    });
    if (Date.parse(req.fromIso) > Date.parse(req.toIso)) {
      throw new AccountingWorkspaceValidationError(
        422,
        'invalid_ksef_sync_date_range',
        'Data początkowa synchronizacji (fromIso) nie może być późniejsza niż data końcowa (toIso).',
      );
    }

    const isLocalMock = environment === 'local_mock';
    const remoteAccessToken =
      req.sandboxAccessToken ?? this.env.PAP_KSEF_SANDBOX_ACCESS_TOKEN?.trim();

    if (!isLocalMock && !remoteAccessToken) {
      throw new AccountingWorkspaceValidationError(
        422,
        'ksef_sandbox_credentials_not_configured',
        `Synchronizacja faktur zakupowych z zewnętrznego środowiska MF KSeF 2.0 (${environment}) wymaga skonfigurowanego tokena testowego właściciela NIP. Dla lokalnych testów użyj environment="local_mock".`,
      );
    }

    const defaultMockIncomingXml = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-25T09:30:00Z',
      seller: {
        nip: '5250004007',
        name: 'Chmura Polska Infrastruktur Test S.A.',
        address: { countryCode: 'PL', addressLine1: 'ul. Prosta 20, 00-850 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: settings.taxProfile.nip },
        name: settings.taxProfile.companyName,
        address: {
          countryCode: 'PL',
          addressLine1: this.buildTaxpayerSubjectAndAddress(settings).faAddressLine1,
        },
      },
      invoiceNumber: `FZ/KSEF-SYNC/${req.fromIso.slice(0, 10)}/01`,
      issueDate: req.fromIso.slice(0, 10),
      saleDate: req.fromIso.slice(0, 10),
      lines: [
        {
          description: 'Usługa hostingu i archiwizacji KSeF Sandbox (synchronizacja Subject2)',
          unit: 'usł.',
          quantity: '1',
          netGrosze: 60_000,
          vatRate: '23',
        },
      ],
    }).xml;

    const mockIncomingXmls = req.mockIncomingFaXmls ?? [defaultMockIncomingXml];
    const archive = this.getOrCreateCompanyArchive(tenantId, legalEntityId);

    const adapter = new Ksef2SandboxAdapterService({
      environment,
      baseUrl: resolvedBaseUrl,
      outbox: this.outbox,
      ...(isLocalMock
        ? {
            transport: this.buildDeterministicLocalMockTransport({
              scopePrefix: `${tenantId}::${legalEntityId}`,
              sellerNip: '5250004007',
              buyerNip: settings.taxProfile.nip,
              mockIncomingXmls,
            }),
            retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5, sleep: async () => {} },
          }
        : {}),
    });

    try {
      const synced = await adapter.syncIncomingInvoices({
        tenantId,
        legalEntityId,
        buyerNip: settings.taxProfile.nip,
        accessToken: remoteAccessToken ?? 'local-sandbox-mock-token',
        fromIso: req.fromIso,
        toIso: req.toIso,
        dateType: req.dateType,
        archive,
        actorUserId: actor.userId,
      });

      const responseItems: SyncKsefIncomingResponse['items'] = [];
      for (const item of synced.items) {
        let draftDocumentId: string | null = null;
        if (req.createVerificationDrafts && item.archivedArtifactId) {
          const rawBytes = archive.readOriginalBytesVerified({
            actorUserId: actor.userId,
            tenantId,
            legalEntityId,
            artifactId: item.archivedArtifactId,
          }).bytes;
          try {
            const createdDraft = await this.workspace.createDocument(
              actor,
              tenantId,
              legalEntityId,
              {
                sourceFormat: 'ksef_xml',
                rawPayload: rawBytes.toString('utf8'),
                direction: 'purchase',
              },
            );
            draftDocumentId = createdDraft.documentId;
          } catch (docErr) {
            if (
              docErr instanceof AccountingWorkspaceError &&
              docErr.reasonCode === 'duplicate_document_sha256'
            ) {
              const existingDocs = await this.workspace.listDocuments(
                actor,
                tenantId,
                legalEntityId,
              );
              const sha = createHash('sha256').update(rawBytes).digest('hex');
              draftDocumentId =
                existingDocs.documents.find((d) => d.sha256Hash === sha)?.documentId ?? null;
            } else {
              throw docErr;
            }
          }
        }

        responseItems.push({
          ksefNumber: item.ksefNumber,
          invoiceNumber: item.invoiceNumber,
          sellerNip: item.sellerNip,
          buyerNip: item.buyerNip,
          schemaVersion: item.schemaVersion,
          netAmountGrosze: item.netAmountGrosze,
          vatAmountGrosze: item.vatAmountGrosze,
          grossAmountGrosze: item.grossAmountGrosze,
          currency: item.currency,
          archivedArtifactId: item.archivedArtifactId,
          deduplicatedInArchive: item.deduplicatedInArchive,
          draftDocumentId,
        });
      }

      return SyncKsefIncomingResponseSchema.parse({
        tenantId,
        companyId: legalEntityId,
        legalEntityId,
        environment,
        executionMode: isLocalMock ? 'local_sandbox_mock' : 'remote_mf_sandbox',
        fetchedCount: synced.fetchedCount,
        hasMore: synced.hasMore,
        isTruncated: synced.isTruncated,
        permanentStorageHwmDate: synced.permanentStorageHwmDate,
        items: responseItems,
        truthfulnessNoticePl: isLocalMock
          ? 'Pobrano i zwalidowano względem XSD faktury zakupowe (Subject2) z lokalnego sandboxa mock KSeF 2.0. Utworzono wyłącznie propozycje wymagające zatwierdzenia człowieka (needs_verification) oraz zapisano oryginały XML w archiwum WORM.'
          : `Pobrano i zwalidowano względem XSD faktury zakupowe z nieprodukcyjnego środowiska MF KSeF 2.0 (${environment}) — dokumenty oczekują na weryfikację i zatwierdzenie człowieka.`,
      });
    } catch (error) {
      if (error instanceof AccountingWorkspaceError) {
        throw error;
      }
      if (error instanceof KsefProductionEndpointBlockedError) {
        throw new AccountingWorkspaceAccessError(
          403,
          'ksef_production_endpoint_blocked',
          error.message,
        );
      }
      throw new AccountingWorkspaceValidationError(
        422,
        'ksef_sync_incoming_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
