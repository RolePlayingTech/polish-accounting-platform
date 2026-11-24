import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Readable } from 'node:stream';
import {
  authenticateOidcActor,
  type OidcAccessTokenVerifier,
  type UserIdentityResolver,
  type WorkspaceCompanyState,
} from '@pap/application';
import type {
  McpJpkPeriodSourceData,
  McpTaxCalculationSourceData,
  PapMcpGateway,
} from '@pap/application/mcp-gateway';
import {
  STANDARD_SPZOO_CHART_OF_ACCOUNTS,
  calculateProfileAKpirObligations,
  calculateProfileBRyczaltObligations,
  calculateProfileCCitObligations,
  generateProfitAndLoss,
  multiplyGroszeByBps,
  validateKsefNumber,
  type JpkEwpRowInput,
  type JpkKrPdJournalEntryInput,
  type JpkKrPdZois7AccountInput,
  type JpkKsefMarkerChoice,
  type JpkPkpirRowInput,
  type JpkV7PurchaseRowInput,
  type JpkV7SalesRowInput,
  type LegalEntityId,
  type PublicLawObligationKind,
  type TenantId,
  type VerifiedTaxOrZusPayment,
} from '@pap/domain';
import { createPapMcpHttpEndpoint, type PapMcpHttpEndpoint } from '@pap/mcp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  USER_IDENTITY_RESOLVER,
} from '../auth/company-access.guard.js';
import { registerAccountantConsultationsRoutes } from '../controllers/accountant-consultations.controller.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  API_RUNTIME_ENV,
  PAP_MCP_GATEWAY,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';

const MAX_MCP_BODY_BYTES = 1024 * 1024;
const DEFAULT_LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
const ALLOWED_PRECHECK_METHODS = new Set(['GET', 'POST', 'DELETE']);
const FORBIDDEN_SPOOF_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-pap-role',
  'x-approved',
  'x-forwarded-user',
] as const;
const FORBIDDEN_QUERY_PARAMS = ['access_token', 'token', 'bearer', 'id_token'] as const;

export function normalizeMcpHostnameEntry(rawEntry: string): string | null {
  const trimmed = rawEntry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    return closeIdx > 0 ? trimmed.slice(0, closeIdx + 1).toLowerCase() : null;
  }
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveMcpAllowedHostnames(rawEnvValue: string | undefined): readonly string[] {
  const allowed = new Set<string>(DEFAULT_LOOPBACK_HOSTS);
  if (!rawEnvValue) {
    return [...allowed];
  }
  for (const part of rawEnvValue.split(',')) {
    const normalized = normalizeMcpHostnameEntry(part);
    if (normalized) {
      allowed.add(normalized);
    }
  }
  return [...allowed];
}

function extractRawHostHeader(req: FastifyRequest): string | null {
  const rawHeaders = req.raw.rawHeaders;
  if (Array.isArray(rawHeaders) && rawHeaders.length > 0) {
    const hostValues: string[] = [];
    for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
      if (rawHeaders[i]?.toLowerCase() === 'host') {
        hostValues.push(rawHeaders[i + 1] ?? '');
      }
    }
    if (hostValues.length > 0) {
      return hostValues.join(', ');
    }
  }
  return typeof req.headers.host === 'string' ? req.headers.host : null;
}

function buildWebHeaders(req: FastifyRequest, explicitHost: string | null): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.toLowerCase() === 'host') {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else {
      headers.set(key, value);
    }
  }
  if (explicitHost !== null) {
    headers.set('host', explicitHost);
  }
  return headers;
}

function isReadableStream(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

async function readMcpBodyWithCap(
  body: unknown,
  contentLengthHeader: string | string[] | undefined,
  maxBytes: number,
): Promise<
  | { readonly tooLarge: true }
  | { readonly tooLarge: false; readonly bytes: Uint8Array<ArrayBuffer> | undefined }
> {
  if (typeof contentLengthHeader === 'string') {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { tooLarge: true };
    }
  }
  if (body === undefined || body === null) {
    return { tooLarge: false, bytes: undefined };
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) {
      return { tooLarge: true };
    }
    if (body.byteLength === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return { tooLarge: false, bytes: copy };
  }
  if (typeof body === 'string') {
    const buf = Buffer.from(body, 'utf8');
    if (buf.byteLength > maxBytes) {
      return { tooLarge: true };
    }
    if (buf.byteLength === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return { tooLarge: false, bytes: copy };
  }
  if (isReadableStream(body)) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        return { tooLarge: true };
      }
      chunks.push(buf);
    }
    if (total === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { tooLarge: false, bytes: out };
  }
  const serialized = Buffer.from(JSON.stringify(body), 'utf8');
  if (serialized.byteLength > maxBytes) {
    return { tooLarge: true };
  }
  const copy = new Uint8Array(serialized.byteLength);
  copy.set(serialized);
  return { tooLarge: false, bytes: copy };
}

async function sendWebResponseToFastify(webRes: Response, reply: FastifyReply): Promise<void> {
  reply.hijack();
  const nodeRes = reply.raw;
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  if (!webRes.body) {
    nodeRes.end();
    return;
  }

  const nodeReadable = Readable.fromWeb(
    webRes.body as unknown as import('node:stream/web').ReadableStream,
  );
  await new Promise<void>((resolve, reject) => {
    nodeReadable.on('error', reject);
    nodeRes.on('error', reject);
    nodeRes.on('close', () => resolve());
    nodeRes.on('finish', () => resolve());
    nodeReadable.pipe(nodeRes);
  });
}

function roundGroszeHalfUpToPlnInt(grosze: number): number {
  const sign = grosze < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(grosze));
  return sign * Math.floor((abs + 50) / 100);
}

function previousPeriodYearMonth(period: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function mapVatEntryKsefMarker(
  marker: string,
  ksefReferenceNumber: string | undefined,
): JpkKsefMarkerChoice {
  if (marker === 'NrKSeF' && ksefReferenceNumber) {
    const check = validateKsefNumber(ksefReferenceNumber);
    if (check.valid) {
      return { kind: 'KSEF', ksefNumber: ksefReferenceNumber };
    }
  }
  if (marker === 'OFF') {
    return { kind: 'OFF' };
  }
  if (marker === 'DI') {
    return { kind: 'DI' };
  }
  return { kind: 'BFK' };
}

function mapSpzooAccountToJpkKrPdTag(accountCode: string): {
  readonly parentAccountId: string;
  readonly balanceSheetTagS12_1: string;
  readonly taxTagS12_3?: string | undefined;
} {
  const syntheticCode = accountCode.includes('-')
    ? accountCode.split('-')[0]!.slice(0, 3)
    : accountCode.slice(0, 3);

  switch (syntheticCode) {
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
        : {
            parentAccountId: accountCode.includes('-') ? '221' : '22',
            balanceSheetTagS12_1: 'BPBIII3g',
          };
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
      return {
        parentAccountId: syntheticCode.slice(0, 2) || '00',
        balanceSheetTagS12_1: 'INNE',
      };
  }
}

function summarizePeriodVatDeclarationBucketsPln(
  comp: WorkspaceCompanyState,
  period: string,
): { readonly p38OutputPln: number; readonly p41PlusP43InputPln: number } {
  let vat5 = 0;
  let vat8 = 0;
  let vat23 = 0;
  let fixedVat = 0;
  let otherVat = 0;
  for (const v of comp.vatEntries) {
    if (v.period !== period) {
      continue;
    }
    if (v.registerType === 'sales') {
      if (v.vatRate === '5') vat5 += v.vatTotalGrosze;
      else if (v.vatRate === '8') vat8 += v.vatTotalGrosze;
      else if (v.vatRate === '23') vat23 += v.vatTotalGrosze;
    } else if (v.isFixedAssetPurchase) {
      fixedVat += v.deductibleVatGrosze;
    } else {
      otherVat += v.deductibleVatGrosze;
    }
  }
  return {
    p38OutputPln:
      roundGroszeHalfUpToPlnInt(vat5) +
      roundGroszeHalfUpToPlnInt(vat8) +
      roundGroszeHalfUpToPlnInt(vat23),
    p41PlusP43InputPln: roundGroszeHalfUpToPlnInt(fixedVat) + roundGroszeHalfUpToPlnInt(otherVat),
  };
}

function computePriorPeriodExcessCarryoverPln(comp: WorkspaceCompanyState, period: string): number {
  const configuredCurrent = comp.vatPeriodSettlements?.get(period);
  if (configuredCurrent && configuredCurrent.carryOverFromPreviousP39Grosze > 0) {
    return roundGroszeHalfUpToPlnInt(configuredCurrent.carryOverFromPreviousP39Grosze);
  }
  const priorPeriodsSet = new Set<string>();
  for (const v of comp.vatEntries) {
    if (v.period < period) {
      priorPeriodsSet.add(v.period);
    }
  }
  if (comp.vatPeriodSettlements) {
    for (const p of comp.vatPeriodSettlements.keys()) {
      if (p < period) {
        priorPeriodsSet.add(p);
      }
    }
  }
  if (priorPeriodsSet.size === 0) {
    return 0;
  }
  const sortedPriorPeriods = [...priorPeriodsSet].sort();
  let carryForwardPln = 0;
  for (const p of sortedPriorPeriods) {
    const explicit = comp.vatPeriodSettlements?.get(p);
    if (explicit) {
      carryForwardPln = roundGroszeHalfUpToPlnInt(explicit.carryForwardP62Grosze);
      continue;
    }
    const { p38OutputPln, p41PlusP43InputPln } = summarizePeriodVatDeclarationBucketsPln(comp, p);
    const totalInput = p41PlusP43InputPln + carryForwardPln;
    carryForwardPln = totalInput > p38OutputPln ? totalInput - p38OutputPln : 0;
  }
  return carryForwardPln;
}

function buildLiveJpkSourceData(
  comp: WorkspaceCompanyState,
  period: string,
): McpJpkPeriodSourceData {
  const subject =
    comp.legalForm === 'jdg'
      ? ({
          kind: 'natural_person',
          nip: comp.nip,
          firstName: 'Jan',
          lastName: 'Testowy',
          birthDate: '1988-05-14',
          email: 'biuro@firma-testowa.example',
        } as const)
      : ({
          kind: 'legal_entity',
          nip: comp.nip,
          fullName: comp.displayName,
          ...(comp.taxProfile.regon ? { regon: comp.taxProfile.regon } : {}),
          email: 'biuro@spolka-testowa.example',
        } as const);

  const corporateAddress = {
    voivodeship: comp.taxProfile.voivodeship ?? 'MAZOWIECKIE',
    county: comp.taxProfile.city ?? 'WARSZAWA',
    municipality: comp.taxProfile.city ?? 'WARSZAWA',
    street: comp.taxProfile.street ?? 'UL. TESTOWA',
    buildingNumber: comp.taxProfile.buildingNumber ?? '10',
    city: comp.taxProfile.city ?? 'WARSZAWA',
    postalCode: comp.taxProfile.postalCode ?? '00-001',
  };

  const salesByDoc = new Map<string, JpkV7SalesRowInput>();
  const purchasesByDoc = new Map<string, JpkV7PurchaseRowInput>();

  for (const v of comp.vatEntries) {
    if (v.period !== period) {
      continue;
    }
    const ksefMarker = mapVatEntryKsefMarker(v.ksefMarker, v.ksefReferenceNumber);
    if (v.registerType === 'sales') {
      const counterpartyTin = v.counterpartyNip?.replace(/^PL/i, '') || 'BRAK';
      const key = `${v.documentNumber}::${v.counterpartyNip ?? v.counterpartyName}::${v.issueDate}`;
      const existing = salesByDoc.get(key) ?? {
        counterpartyTin,
        counterpartyName: v.counterpartyName,
        documentNumber: v.documentNumber,
        issueDate: v.issueDate,
        saleDate: v.taxPointDate,
        ksefMarker,
      };
      const mutable: JpkV7SalesRowInput = {
        ...existing,
        ...(v.vatRate === '23'
          ? {
              net23Grosze: (existing.net23Grosze ?? 0) + v.netGrosze,
              vat23Grosze: (existing.vat23Grosze ?? 0) + v.vatTotalGrosze,
            }
          : v.vatRate === '8'
            ? {
                net8Grosze: (existing.net8Grosze ?? 0) + v.netGrosze,
                vat8Grosze: (existing.vat8Grosze ?? 0) + v.vatTotalGrosze,
              }
            : v.vatRate === '5'
              ? {
                  net5Grosze: (existing.net5Grosze ?? 0) + v.netGrosze,
                  vat5Grosze: (existing.vat5Grosze ?? 0) + v.vatTotalGrosze,
                }
              : v.vatRate === '0'
                ? { zeroDomesticNetGrosze: (existing.zeroDomesticNetGrosze ?? 0) + v.netGrosze }
                : v.vatRate === 'np'
                  ? {
                      outsideCountryNetGrosze:
                        (existing.outsideCountryNetGrosze ?? 0) + v.netGrosze,
                    }
                  : { exemptNetGrosze: (existing.exemptNetGrosze ?? 0) + v.netGrosze }),
      };
      salesByDoc.set(key, mutable);
    } else if (v.deductibleVatGrosze > 0 || v.vatRate === '0') {
      const key = `${v.documentNumber}::${v.counterpartyNip ?? v.counterpartyName}::${v.issueDate}`;
      const deductibleNetGrosze =
        v.vatTotalGrosze > 0 && v.deductibleVatGrosze < v.vatTotalGrosze
          ? Math.floor(
              (v.netGrosze * v.deductibleVatGrosze + Math.floor(v.vatTotalGrosze / 2)) /
                v.vatTotalGrosze,
            )
          : v.netGrosze;
      const existing = purchasesByDoc.get(key);
      const supplierTin = v.counterpartyNip?.replace(/^PL/i, '') || 'BRAK';
      if (v.isFixedAssetPurchase) {
        purchasesByDoc.set(key, {
          supplierTin,
          supplierName: v.counterpartyName,
          documentNumber: v.documentNumber,
          purchaseDate: v.issueDate,
          receiptDate: v.taxPointDate,
          ksefMarker,
          fixedAssetsNetGrosze: (existing?.fixedAssetsNetGrosze ?? 0) + deductibleNetGrosze,
          fixedAssetsVatGrosze: (existing?.fixedAssetsVatGrosze ?? 0) + v.deductibleVatGrosze,
          ...(existing?.otherAcquisitionsNetGrosze !== undefined
            ? { otherAcquisitionsNetGrosze: existing.otherAcquisitionsNetGrosze }
            : {}),
          ...(existing?.otherAcquisitionsVatGrosze !== undefined
            ? { otherAcquisitionsVatGrosze: existing.otherAcquisitionsVatGrosze }
            : {}),
        });
      } else {
        purchasesByDoc.set(key, {
          supplierTin,
          supplierName: v.counterpartyName,
          documentNumber: v.documentNumber,
          purchaseDate: v.issueDate,
          receiptDate: v.taxPointDate,
          ksefMarker,
          ...(existing?.fixedAssetsNetGrosze !== undefined
            ? { fixedAssetsNetGrosze: existing.fixedAssetsNetGrosze }
            : {}),
          ...(existing?.fixedAssetsVatGrosze !== undefined
            ? { fixedAssetsVatGrosze: existing.fixedAssetsVatGrosze }
            : {}),
          otherAcquisitionsNetGrosze:
            (existing?.otherAcquisitionsNetGrosze ?? 0) + deductibleNetGrosze,
          otherAcquisitionsVatGrosze:
            (existing?.otherAcquisitionsVatGrosze ?? 0) + v.deductibleVatGrosze,
        });
      }
    }
  }

  const yearPrefix = period.slice(0, 4);
  const periodMonth = Number(period.slice(5, 7));

  const priorExcessCarryoverPln = computePriorPeriodExcessCarryoverPln(comp, period);
  const configuredSettlement = comp.vatPeriodSettlements?.get(period);
  const requestedRefundPln = configuredSettlement
    ? roundGroszeHalfUpToPlnInt(configuredSettlement.refundRequestedP54Grosze)
    : 0;

  let quarterlyStartPriorExcessCarryoverPln: number | undefined;
  let quarterlyPriorMonthsCarryGrosze:
    McpJpkPeriodSourceData['quarterlyPriorMonthsCarryGrosze'] | undefined;

  if (periodMonth % 3 === 0) {
    const m1Period = `${yearPrefix}-${String(periodMonth - 2).padStart(2, '0')}`;
    const m2Period = `${yearPrefix}-${String(periodMonth - 1).padStart(2, '0')}`;
    quarterlyStartPriorExcessCarryoverPln = computePriorPeriodExcessCarryoverPln(comp, m1Period);
    const qAcc = {
      exemptNetGrosze: 0,
      outsideCountryNetGrosze: 0,
      zeroDomesticNetGrosze: 0,
      net5Grosze: 0,
      vat5Grosze: 0,
      net8Grosze: 0,
      vat8Grosze: 0,
      net23Grosze: 0,
      vat23Grosze: 0,
      fixedAssetsNetGrosze: 0,
      fixedAssetsVatGrosze: 0,
      otherAcquisitionsNetGrosze: 0,
      otherAcquisitionsVatGrosze: 0,
    };
    for (const v of comp.vatEntries) {
      if (v.period !== m1Period && v.period !== m2Period) {
        continue;
      }
      if (v.registerType === 'sales') {
        if (v.vatRate === '23') {
          qAcc.net23Grosze += v.netGrosze;
          qAcc.vat23Grosze += v.vatTotalGrosze;
        } else if (v.vatRate === '8') {
          qAcc.net8Grosze += v.netGrosze;
          qAcc.vat8Grosze += v.vatTotalGrosze;
        } else if (v.vatRate === '5') {
          qAcc.net5Grosze += v.netGrosze;
          qAcc.vat5Grosze += v.vatTotalGrosze;
        } else if (v.vatRate === '0') {
          qAcc.zeroDomesticNetGrosze += v.netGrosze;
        } else if (v.vatRate === 'np') {
          qAcc.outsideCountryNetGrosze += v.netGrosze;
        } else {
          qAcc.exemptNetGrosze += v.netGrosze;
        }
      } else if (v.deductibleVatGrosze > 0 || v.vatRate === '0') {
        const dedNet =
          v.vatTotalGrosze > 0 && v.deductibleVatGrosze < v.vatTotalGrosze
            ? Math.floor(
                (v.netGrosze * v.deductibleVatGrosze + Math.floor(v.vatTotalGrosze / 2)) /
                  v.vatTotalGrosze,
              )
            : v.netGrosze;
        if (v.isFixedAssetPurchase) {
          qAcc.fixedAssetsNetGrosze += dedNet;
          qAcc.fixedAssetsVatGrosze += v.deductibleVatGrosze;
        } else {
          qAcc.otherAcquisitionsNetGrosze += dedNet;
          qAcc.otherAcquisitionsVatGrosze += v.deductibleVatGrosze;
        }
      }
    }
    quarterlyPriorMonthsCarryGrosze = qAcc;
  }

  const pkpirRows: JpkPkpirRowInput[] = comp.kpirEntries
    .filter((e) => e.period.startsWith(yearPrefix) && e.period <= period)
    .map((e) => {
      const validKsef =
        e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
          ? e.ksefReferenceNumber
          : undefined;
      return {
        entryDate: e.eventDate,
        documentNumber: e.documentNumber,
        ...(validKsef ? { ksefNumber: validKsef } : {}),
        ...(e.counterpartyNip ? { counterpartyTin: e.counterpartyNip } : {}),
        counterpartyName: e.counterpartyName,
        counterpartyAddress: e.counterpartyAddress || 'Warszawa',
        description: e.eventDescription,
        salesRevenueGrosze: e.col7SalesRevenueGrosze,
        otherRevenueGrosze: e.col8OtherRevenueGrosze,
        goodsPurchaseGrosze: e.col10GoodsAndMaterialsGrosze,
        incidentalPurchaseCostsGrosze: e.col11IncidentalCostsGrosze,
        remunerationGrosze: e.col12RemunerationGrosze,
        otherExpensesGrosze: e.col13OtherExpensesGrosze,
        ...(e.col16ResearchDevelopmentDescription && e.col16ResearchDevelopmentCostGrosze > 0
          ? {
              rdCostDescription: e.col16ResearchDevelopmentDescription,
              rdCostGrosze: e.col16ResearchDevelopmentCostGrosze,
            }
          : {}),
        ...(e.col17Remarks ? { remarks: e.col17Remarks } : {}),
      };
    });

  const allowedEwpRates = new Set(['17', '15', '14', '12.5', '12', '10', '8.5', '5.5', '3', '2']);
  const ewpRows: JpkEwpRowInput[] = comp.ryczaltEntries
    .filter(
      (e) => e.period.startsWith(yearPrefix) && e.period <= period && allowedEwpRates.has(e.rate),
    )
    .map((e) => {
      const validKsef =
        e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
          ? e.ksefReferenceNumber
          : undefined;
      return {
        entryDate: e.entryDate,
        revenueDate: e.revenueDate,
        documentNumber: e.documentNumber,
        ...(validKsef ? { ksefNumber: validKsef } : {}),
        ...(e.counterpartyNip
          ? { counterpartyCountryCode: 'PL', counterpartyTin: e.counterpartyNip }
          : {}),
        revenueGrosze: e.revenueGrosze,
        ratePercent: e.rate,
        ...(e.remarks ? { remarks: e.remarks } : {}),
      };
    });

  const yearJournalEntries = comp.journalEntries.filter(
    (j) => j.period.startsWith(yearPrefix) && j.period <= period,
  );
  const entriesForKrPd = yearJournalEntries;

  const accountNames = new Map<string, string>(
    STANDARD_SPZOO_CHART_OF_ACCOUNTS.map((a) => [a.code, a.name]),
  );
  const zoisTotals = new Map<
    string,
    { periodWn: number; periodMa: number; cumWn: number; cumMa: number }
  >();
  for (const je of yearJournalEntries) {
    const inPeriod = je.period === period;
    for (const line of je.lines) {
      const cur = zoisTotals.get(line.accountCode) ?? {
        periodWn: 0,
        periodMa: 0,
        cumWn: 0,
        cumMa: 0,
      };
      if (line.side === 'Wn') {
        cur.cumWn += line.amountGrosze;
        if (inPeriod) cur.periodWn += line.amountGrosze;
      } else {
        cur.cumMa += line.amountGrosze;
        if (inPeriod) cur.periodMa += line.amountGrosze;
      }
      zoisTotals.set(line.accountCode, cur);
    }
  }

  const zois7Accounts: JpkKrPdZois7AccountInput[] = [...zoisTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, t]) => {
      const tag = mapSpzooAccountToJpkKrPdTag(code);
      const net = t.cumWn - t.cumMa;
      return {
        accountId: code,
        accountName: accountNames.get(code) ?? `Konto ${code}`,
        parentAccountId: tag.parentAccountId,
        openingDebitGrosze: 0,
        openingCreditGrosze: 0,
        turnoverPeriodDebitGrosze: t.periodWn,
        turnoverPeriodCreditGrosze: t.periodMa,
        turnoverCumulativeDebitGrosze: t.cumWn,
        turnoverCumulativeCreditGrosze: t.cumMa,
        closingDebitGrosze: net > 0 ? net : 0,
        closingCreditGrosze: net < 0 ? -net : 0,
        balanceSheetTagS12_1: tag.balanceSheetTagS12_1,
        ...(tag.taxTagS12_3 ? { taxTagS12_3: tag.taxTagS12_3 } : {}),
      };
    });

  const journalEntries: JpkKrPdJournalEntryInput[] = entriesForKrPd.map((je) => ({
    journalName: 'Dziennik główny',
    documentNumber: je.documentNumber,
    documentKind: 'Dowód księgowy',
    operationDate: je.bookingDate,
    documentDate: je.documentDate,
    postingDate: je.bookingDate,
    operatorName: 'Księgowość PAP',
    description: je.description,
    journalAmountGrosze: je.totalWnGrosze,
    postings: je.lines.map((line) => ({
      description: line.description,
      accountId: line.accountCode,
      side: line.side,
      amountGrosze: line.amountGrosze,
    })),
  }));

  const ytdKrPdNkupGrosze =
    comp.legalForm === 'sp_z_o_o' || comp.taxRegime === 'cit_klasyczny'
      ? computeLiveYtdCitNkupGrosze(comp, period)
      : 0;

  return {
    taxOfficeCode: '1435',
    subject,
    corporateAddress,
    ...(comp.taxProfile.regon ? { companyRegon: comp.taxProfile.regon } : {}),
    vatSalesRows: [...salesByDoc.values()],
    vatPurchaseRows: [...purchasesByDoc.values()],
    priorExcessCarryoverPln,
    ...(quarterlyStartPriorExcessCarryoverPln !== undefined
      ? { quarterlyStartPriorExcessCarryoverPln }
      : {}),
    ...(quarterlyPriorMonthsCarryGrosze ? { quarterlyPriorMonthsCarryGrosze } : {}),
    requestedRefundPln,
    pkpirRows,
    openingInventoryGrosze: 0,
    closingInventoryGrosze: 0,
    ewpRows,
    zois7Accounts,
    journalEntries,
    ...(ytdKrPdNkupGrosze > 0
      ? { rpdSummary: { k4NonDeductibleCostsPermanentGrosze: ytdKrPdNkupGrosze } }
      : {}),
  };
}

const COMMERCIAL_LEGAL_SUFFIX_RE =
  /\b(?:sp\.\s*z\s*o\.?\s*o\.?|spółka\s+z\s+o\.?\s*o\.?|spolka\s+z\s+o\.?\s*o\.?|s\.?\s*a\.?|sp\.\s*j\.?|sp\.\s*k\.?|llc|ltd|gmbh|inc)\b/i;

const ZUS_AUTHORITY_COUNTERPARTY_RE =
  /(?:^|\b)(?:zakład\s+ubezpieczeń\s+społecznych|zaklad\s+ubezpieczen\s+spolecznych|zus)(?:\b|$)/i;

const TAX_AUTHORITY_COUNTERPARTY_RE =
  /(?:^|\b)(?:urząd\s+skarbowy|urzad\s+skarbowy|krajowa\s+administracja\s+skarbowa|ministerstwo\s+finansów|ministerstwo\s+finansow|kas|us)(?:\b|$)/i;

function classifyAuthorityBankTaxObligation(
  counterpartyName: string,
  transferTitle: string,
): PublicLawObligationKind | null {
  const cp = counterpartyName.trim();
  const title = transferTitle.trim();
  if (!cp || !title || COMMERCIAL_LEGAL_SUFFIX_RE.test(cp)) {
    return null;
  }
  if (ZUS_AUTHORITY_COUNTERPARTY_RE.test(cp) && /\bzus\b/i.test(title)) {
    if (/zdrow/i.test(title)) {
      return 'zus_health';
    }
    if (/\bfp\b|fundusz\s+pracy/i.test(title)) {
      return 'zus_labor_fund';
    }
    return 'zus_social';
  }
  if (TAX_AUTHORITY_COUNTERPARTY_RE.test(cp)) {
    if (/\b(?:ryczałt|ryczalt|ppe|pit-28)\b/i.test(title)) {
      return 'ryczalt_advance';
    }
    if (/\bcit(?:-8)?\b/i.test(title)) {
      return 'cit_advance';
    }
    if (/\bpit(?:-5|-5l|-36|-36l)?\b/i.test(title)) {
      return 'pit_advance';
    }
    if (/\b(?:vat(?:-7|-7k)?|jpk_v7[mk]?)\b/i.test(title) && !/faktur[aęy]\s+vat/i.test(title)) {
      return 'vat_settlement';
    }
  }
  return null;
}

function parsePlnStringToSafeGrosze(pln: string): number {
  const match = /^(-?\d+)\.(\d{2})$/.exec(pln.trim());
  if (!match?.[1] || !match[2]) {
    return 0;
  }
  const sign = match[1].startsWith('-') ? -1 : 1;
  const whole = Math.abs(Number(match[1]));
  const frac = Number(match[2]);
  return sign * (whole * 100 + frac);
}

function computeLiveYtdCitNkupGrosze(comp: WorkspaceCompanyState, period: string): number {
  const yearPrefix = period.slice(0, 4);
  let totalNkupGrosze = 0;
  for (const docItem of comp.documents) {
    if (
      docItem.status !== 'posted' ||
      docItem.document.direction !== 'purchase' ||
      !docItem.document.eventDate.startsWith(yearPrefix) ||
      docItem.document.eventDate.slice(0, 7) > period
    ) {
      continue;
    }
    const explanation = comp.explanationsById.get(docItem.documentId);
    if (explanation) {
      const parsedNkup = parsePlnStringToSafeGrosze(explanation.nkupAmountPln);
      if (parsedNkup > 0) {
        totalNkupGrosze += parsedNkup;
        continue;
      }
    }
    if (docItem.aiProposal?.suggestedCategory === 'eksploatacja_samochodu_mieszana') {
      const vatActive = comp.taxProfile.vatStatus === 'czynny';
      const nonDeductibleVat = vatActive
        ? docItem.document.totalVatGrosze -
          multiplyGroszeByBps(docItem.document.totalVatGrosze, 5000, 'half_up')
        : docItem.document.totalVatGrosze;
      const costBase = docItem.document.totalNetGrosze + nonDeductibleVat;
      const kup = multiplyGroszeByBps(costBase, 7500, 'half_up');
      totalNkupGrosze += Math.max(0, costBase - kup);
    }
  }
  return totalNkupGrosze;
}

function computeKpirCumulativeForPeriod(
  comp: WorkspaceCompanyState,
  targetPeriod: string,
): {
  readonly ytdRevGrosze: number;
  readonly ytdCostGrosze: number;
  readonly prevMonthIncomeGrosze: number;
} {
  const yearPrefix = targetPeriod.slice(0, 4);
  const prevPeriod = previousPeriodYearMonth(targetPeriod);
  let ytdRevGrosze = 0;
  let ytdCostGrosze = 0;
  let prevMonthRev = 0;
  let prevMonthCost = 0;
  for (const e of comp.kpirEntries) {
    if (!e.period.startsWith(yearPrefix) || e.period > targetPeriod) {
      continue;
    }
    const entryCost =
      e.col10GoodsAndMaterialsGrosze + e.col11IncidentalCostsGrosze + e.col14TotalExpensesGrosze;
    ytdRevGrosze += e.col9TotalRevenueGrosze;
    ytdCostGrosze += entryCost;
    if (prevPeriod && e.period === prevPeriod) {
      prevMonthRev += e.col9TotalRevenueGrosze;
      prevMonthCost += entryCost;
    }
  }
  return {
    ytdRevGrosze: Math.max(0, ytdRevGrosze),
    ytdCostGrosze: Math.max(0, ytdCostGrosze),
    prevMonthIncomeGrosze: Math.max(0, prevMonthRev - prevMonthCost),
  };
}

function buildLiveTaxCalculationSourceData(
  comp: WorkspaceCompanyState,
  period: string,
): McpTaxCalculationSourceData {
  const yearPrefix = period.slice(0, 4);
  const targetMonth = Number(period.slice(5, 7));
  const zusScheme =
    comp.taxProfile.zusScheme === 'not_applicable' ? 'duzy_zus' : comp.taxProfile.zusScheme;

  const verifiedPayments: VerifiedTaxOrZusPayment[] = [];
  const usedBankTxIds = new Set<string>();
  const explicitPayments = (
    comp as WorkspaceCompanyState & {
      readonly verifiedTaxPayments?: readonly VerifiedTaxOrZusPayment[];
    }
  ).verifiedTaxPayments;
  if (Array.isArray(explicitPayments)) {
    for (const p of explicitPayments) {
      if (p.amountGrosze > 0) {
        verifiedPayments.push(p);
        if (p.bankTransactionId) {
          usedBankTxIds.add(p.bankTransactionId);
        }
      }
    }
  }
  for (const m of comp.reconciliationMatches) {
    if (m.status === 'matched_exact' || m.status === 'matched_partial' || m.status === 'overpaid') {
      usedBankTxIds.add(m.transactionId);
    }
  }
  for (const tx of comp.bankTransactions) {
    if (tx.direction !== 'debit' || tx.amountGrosze <= 0 || usedBankTxIds.has(tx.transactionId)) {
      continue;
    }
    const obligationKind = classifyAuthorityBankTaxObligation(tx.counterpartyName, tx.title);
    if (obligationKind) {
      const periodMatch = /\b(20\d{2}-(0[1-9]|1[0-2]))\b/.exec(tx.title);
      const targetPeriod = periodMatch?.[1] ?? period;
      verifiedPayments.push({
        paymentId: `bank-pay-${tx.transactionId}`,
        obligationKind,
        targetPeriod,
        paidDate: tx.bookingDate,
        amountGrosze: tx.amountGrosze,
        bankTransactionId: tx.transactionId,
      });
    }
  }

  let ytdRevenueGrosze = 0;
  let ytdTaxDeductibleCostsGrosze = 0;
  let previousMonthIncomeForHealthGrosze = 0;
  let previousPitOrCitAdvancesAccruedYtdGrosze = 0;
  let socialZusAlreadyDeductedPriorMonthsYtdGrosze = 0;
  let health50PctAlreadyDeductedPriorMonthsYtdGrosze = 0;

  const citAttest = comp.taxProfile.citPreferentialAttestation;
  const citTaxYearStartDate = citAttest?.taxYearStartDate ?? `${yearPrefix}-01-01`;
  const citTaxYearEndDate = citAttest?.taxYearEndDate ?? `${yearPrefix}-12-31`;
  const citPreferentialEligibility = citAttest
    ? {
        smallTaxpayerVerified: citAttest.smallTaxpayerVerified,
        ...(citAttest.priorYearGrossSalesGrosze !== undefined
          ? { priorYearGrossSalesGrosze: citAttest.priorYearGrossSalesGrosze }
          : {}),
        isFirstTaxYearNewEntityVerified: citAttest.isFirstTaxYearNewEntityVerified,
        excludedRestructuringArt19Ust1aVerified: citAttest.excludedRestructuringArt19Ust1aVerified,
        excludedTaxCapitalGroupOrSplitVerified: citAttest.excludedTaxCapitalGroupOrSplitVerified,
      }
    : undefined;
  const usePreferentialCit9Pct = Boolean(
    comp.taxProfile.smallTaxpayer && citPreferentialEligibility,
  );

  if (comp.legalForm === 'sp_z_o_o' || comp.taxRegime === 'cit_klasyczny') {
    const entriesUpToPeriod = comp.journalEntries.filter(
      (je) => je.period.startsWith(yearPrefix) && je.period <= period,
    );
    const pnl = generateProfitAndLoss(entriesUpToPeriod);
    const ytdNkup = computeLiveYtdCitNkupGrosze(comp, period);
    ytdRevenueGrosze = Math.max(0, pnl.totalRevenuesGrosze);
    ytdTaxDeductibleCostsGrosze = Math.max(
      0,
      pnl.totalOperatingAndFinancialExpensesGrosze - ytdNkup,
    );
    for (let m = 1; m < targetMonth; m += 1) {
      const priorP = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorEntries = comp.journalEntries.filter(
        (je) => je.period.startsWith(yearPrefix) && je.period <= priorP,
      );
      if (priorEntries.length === 0) {
        continue;
      }
      const priorPnl = generateProfitAndLoss(priorEntries);
      const priorNkup = computeLiveYtdCitNkupGrosze(comp, priorP);
      const basePriorCitInput = {
        period: priorP,
        operatingRevenuesYtdGrosze: Math.max(0, priorPnl.totalRevenuesGrosze),
        operatingTaxDeductibleCostsYtdGrosze: Math.max(
          0,
          priorPnl.totalOperatingAndFinancialExpensesGrosze - priorNkup,
        ),
        previousAdvancesAccruedDueYtdGrosze: previousPitOrCitAdvancesAccruedYtdGrosze,
        verifiedPayments,
        taxYearStartDate: citTaxYearStartDate,
        taxYearEndDate: citTaxYearEndDate,
      };
      let priorCitAccrued: number;
      try {
        const priorCit = calculateProfileCCitObligations({
          ...basePriorCitInput,
          ...(usePreferentialCit9Pct && citPreferentialEligibility
            ? {
                requestPreferential9PctRate: true,
                preferentialEligibility: citPreferentialEligibility,
              }
            : {}),
        });
        priorCitAccrued = priorCit.citAdvanceSettlement.accruedDueGrosze;
      } catch {
        const fallbackPriorCit = calculateProfileCCitObligations(basePriorCitInput);
        priorCitAccrued = fallbackPriorCit.citAdvanceSettlement.accruedDueGrosze;
      }
      previousPitOrCitAdvancesAccruedYtdGrosze += priorCitAccrued;
    }
  } else if (comp.taxRegime === 'ryczalt') {
    const ytdRyczalt = comp.ryczaltEntries.filter(
      (r) => r.period.startsWith(yearPrefix) && r.period <= period,
    );
    for (const r of ytdRyczalt) {
      ytdRevenueGrosze += r.revenueGrosze;
    }
    for (let m = 1; m < targetMonth; m += 1) {
      const priorP = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorRycz = calculateProfileBRyczaltObligations({
        period: priorP,
        zusScheme,
        voluntarySicknessInsurance: comp.taxProfile.voluntarySicknessInsurance,
        entries: ytdRyczalt.filter((r) => r.period <= priorP),
        verifiedPayments,
        socialZusAlreadyDeductedPriorMonthsYtdGrosze,
        health50PctAlreadyDeductedPriorMonthsYtdGrosze,
      });
      socialZusAlreadyDeductedPriorMonthsYtdGrosze += priorRycz.appliedSocialDeductionGrosze;
      health50PctAlreadyDeductedPriorMonthsYtdGrosze += priorRycz.appliedHealth50PctDeductionGrosze;
    }
  } else {
    const curKpir = computeKpirCumulativeForPeriod(comp, period);
    ytdRevenueGrosze = curKpir.ytdRevGrosze;
    ytdTaxDeductibleCostsGrosze = curKpir.ytdCostGrosze;
    previousMonthIncomeForHealthGrosze = curKpir.prevMonthIncomeGrosze;
    const taxForm = comp.taxRegime === 'kpir_liniowy' ? 'liniowy' : 'skala';
    for (let m = 1; m < targetMonth; m += 1) {
      const priorP = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorKpir = computeKpirCumulativeForPeriod(comp, priorP);
      const priorPit = calculateProfileAKpirObligations({
        period: priorP,
        taxForm,
        zusScheme,
        voluntarySicknessInsurance: comp.taxProfile.voluntarySicknessInsurance,
        previousMonthIncomeForHealthGrosze: priorKpir.prevMonthIncomeGrosze,
        ytdRevenueGrosze: priorKpir.ytdRevGrosze,
        ytdCostsGrosze: priorKpir.ytdCostGrosze,
        previousAdvancesAccruedDueYtdGrosze: previousPitOrCitAdvancesAccruedYtdGrosze,
        verifiedPayments,
      });
      previousPitOrCitAdvancesAccruedYtdGrosze += priorPit.pitAdvanceSettlement.accruedDueGrosze;
    }
  }

  const { p38OutputPln: vatOutputPln, p41PlusP43InputPln: vatInputPln } =
    summarizePeriodVatDeclarationBucketsPln(comp, period);
  const priorP39Pln = computePriorPeriodExcessCarryoverPln(comp, period);
  const configuredSettlement = comp.vatPeriodSettlements?.get(period);
  const refundP54Pln = configuredSettlement
    ? roundGroszeHalfUpToPlnInt(configuredSettlement.refundRequestedP54Grosze)
    : 0;
  const totalInputWithCarryPln = vatInputPln + priorP39Pln;
  const vatDueToPayP51Pln =
    vatOutputPln > totalInputWithCarryPln ? vatOutputPln - totalInputWithCarryPln : 0;
  const excessInputPln =
    totalInputWithCarryPln > vatOutputPln ? totalInputWithCarryPln - vatOutputPln : 0;
  const vatNextCarryoverP62Pln = Math.max(0, excessInputPln - refundP54Pln);

  return {
    zusScheme,
    voluntarySicknessInsurance: comp.taxProfile.voluntarySicknessInsurance,
    previousMonthIncomeForHealthGrosze,
    ytdRevenueGrosze: Math.max(0, ytdRevenueGrosze),
    ytdTaxDeductibleCostsGrosze: Math.max(0, ytdTaxDeductibleCostsGrosze),
    previousPitOrCitAdvancesAccruedYtdGrosze,
    socialZusAlreadyDeductedPriorMonthsYtdGrosze,
    health50PctAlreadyDeductedPriorMonthsYtdGrosze,
    ryczaltEntries: comp.ryczaltEntries.filter(
      (r) => r.period.startsWith(yearPrefix) && r.period <= period,
    ),
    verifiedPayments,
    smallTaxpayer: Boolean(comp.taxProfile.smallTaxpayer),
    ...(citPreferentialEligibility ? { citPreferentialEligibility } : {}),
    taxYearStartDate: citTaxYearStartDate,
    taxYearEndDate: citTaxYearEndDate,
    vatOutputGrosze: vatOutputPln * 100,
    vatDeductibleInputGrosze: vatInputPln * 100,
    vatPriorCarryoverP39Grosze: priorP39Pln * 100,
    vatDueToPayP51Grosze: vatDueToPayP51Pln * 100,
    vatNextCarryoverP62Grosze: vatNextCarryoverP62Pln * 100,
  };
}

@Injectable()
export class RemoteMcpFastifyRegistrar implements OnModuleInit, OnModuleDestroy {
  private endpoint: PapMcpHttpEndpoint | null = null;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
    @Inject(PAP_MCP_GATEWAY)
    private readonly gateway: PapMcpGateway,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
    @Optional()
    @Inject(API_RUNTIME_ENV)
    env?: Readonly<Record<string, string | undefined>>,
    @Optional()
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace?: WorkspaceRuntimePort,
  ) {
    this.env = env ?? process.env;
  }

  private async passesPreBodySecurityGate(
    method: string,
    fullUrl: string,
    headers: Headers,
    explicitHost: string | null,
    allowedHostSet: ReadonlySet<string>,
    allowedOriginSet: ReadonlySet<string>,
  ): Promise<boolean> {
    if (!explicitHost || explicitHost.trim().length === 0 || explicitHost.includes(',')) {
      return false;
    }
    const hostName = normalizeMcpHostnameEntry(explicitHost);
    if (!hostName || !allowedHostSet.has(hostName)) {
      return false;
    }
    const originHeader = headers.get('origin');
    if (originHeader !== null) {
      const originHost = normalizeMcpHostnameEntry(originHeader);
      if (!originHost || !allowedOriginSet.has(originHost)) {
        return false;
      }
    }
    if (!ALLOWED_PRECHECK_METHODS.has(method)) {
      return false;
    }
    for (const spoofHeader of FORBIDDEN_SPOOF_HEADERS) {
      if (headers.has(spoofHeader)) {
        return false;
      }
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return false;
    }
    for (const qKey of FORBIDDEN_QUERY_PARAMS) {
      if (parsedUrl.searchParams.has(qKey)) {
        return false;
      }
    }
    const rawAuth = headers.get('authorization');
    if (!rawAuth || rawAuth.includes(',')) {
      return false;
    }
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(rawAuth.trim());
    if (!match?.[1]) {
      return false;
    }
    const actor = await authenticateOidcActor(
      match[1],
      { verifier: this.verifier, identityResolver: this.identityResolver },
      { requiredScopes: ['pap:mcp:read'] },
    );
    return actor.authenticated;
  }

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      return;
    }

    if (this.workspace) {
      const workspaceRef = this.workspace;
      this.gateway.attachLiveDataSourceOverrides({
        getJpkPeriodSourceData: async (
          tenantId: TenantId,
          legalEntityId: LegalEntityId,
          period: string,
        ) => {
          const comp = workspaceRef.store.getCompany(tenantId, legalEntityId);
          return comp ? buildLiveJpkSourceData(comp, period) : null;
        },
        getTaxCalculationSourceData: async (
          tenantId: TenantId,
          legalEntityId: LegalEntityId,
          period: string,
        ) => {
          const comp = workspaceRef.store.getCompany(tenantId, legalEntityId);
          return comp ? buildLiveTaxCalculationSourceData(comp, period) : null;
        },
      });
    }

    await registerAccountantConsultationsRoutes(fastify, this.gateway.getConsultationService());

    const allowedHostnames = resolveMcpAllowedHostnames(this.env.PAP_MCP_ALLOWED_HOSTS);
    const allowedOriginHostnames = resolveMcpAllowedHostnames(this.env.PAP_MCP_ALLOWED_ORIGINS);
    const allowedHostSet = new Set(allowedHostnames);
    const allowedOriginSet = new Set(allowedOriginHostnames);

    this.endpoint = createPapMcpHttpEndpoint({
      gateway: this.gateway,
      verifier: this.verifier,
      identityResolver: this.identityResolver,
      allowedHostnames,
      allowedOriginHostnames,
      allowedPaths: ['/api/v1/mcp', '/mcp'],
      maxRequestBodyBytes: MAX_MCP_BODY_BYTES,
    });

    const endpoint = this.endpoint;

    await fastify.register(async (mcpScope) => {
      // Do NOT buffer body in Fastify content-type parser before pre-body auth & Host checks run.
      mcpScope.removeAllContentTypeParsers();
      mcpScope.addContentTypeParser('*', (_req, payload, done) => {
        done(null, payload);
      });

      mcpScope.all('/api/v1/mcp', async (req, reply) => {
        const explicitHost = extractRawHostHeader(req);
        const headers = buildWebHeaders(req, explicitHost);
        const safeBaseHost =
          explicitHost && explicitHost.trim().length > 0 && !explicitHost.includes(',')
            ? explicitHost.trim()
            : '127.0.0.1';
        const rawUrl = req.raw.url ?? req.url;

        let fullUrl: string;
        try {
          fullUrl = new URL(rawUrl, `http://${safeBaseHost}`).toString();
        } catch {
          fullUrl = 'http://127.0.0.1/api/v1/mcp';
        }

        const method = req.method.toUpperCase();
        const canReadBody = await this.passesPreBodySecurityGate(
          method,
          fullUrl,
          headers,
          explicitHost,
          allowedHostSet,
          allowedOriginSet,
        );

        let bodyBytes: Uint8Array<ArrayBuffer> | undefined;
        if (canReadBody && method !== 'GET' && method !== 'HEAD') {
          const readResult = await readMcpBodyWithCap(
            req.body,
            req.headers['content-length'],
            MAX_MCP_BODY_BYTES,
          );
          bodyBytes = readResult.tooLarge
            ? new Uint8Array(MAX_MCP_BODY_BYTES + 1)
            : readResult.bytes;
        }

        const webReq = new Request(fullUrl, {
          method,
          headers,
          ...(bodyBytes !== undefined ? { body: bodyBytes } : {}),
        });

        const webRes = await endpoint.handleRequest(webReq);
        await sendWebResponseToFastify(webRes, reply);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.endpoint) {
      await this.endpoint.close();
      this.endpoint = null;
    }
  }
}
