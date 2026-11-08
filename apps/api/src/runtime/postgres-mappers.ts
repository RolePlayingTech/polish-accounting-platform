import { createHash } from 'node:crypto';
import type { WorkspaceCompanyState } from '@pap/application';
import type {
  CompanyDocumentItemContract,
  CompanyLegalFormContract,
  CompanySettingsResponse,
  CompanyTaxRegimeContract,
  CompanyVatStatusSimpleContract,
} from '@pap/contracts';
import type {
  BankReconciliationMatchContract,
  KsefInvoiceMarkerContract,
  TaxProfileConfigContract,
} from '@pap/contracts/accounting';
import type { CompanyTaxSettingsRecord } from '@pap/db';
import type { RyczaltRateCode } from '@pap/domain';

export type WorkspaceExplanationRecord =
  WorkspaceCompanyState['explanationsById'] extends Map<string, infer V> ? V : never;

export const INTERNAL_TENANT_COMPANY_INDEX_CATEGORY = '__pap_tenant_company_index__' as const;
export const INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY = '__pap_mcp_proposal_index__' as const;
export const INTERNAL_COMMAND_RECEIPT_INDEX_CATEGORY = '__pap_command_receipt__' as const;

const META_MARKER = ' ##pap_meta:';
const POSTED_DOC_MARKER = ' ##pap_posted:';
const BANK_MATCH_MARKER = '##pap_match:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isInternalIndexDocumentCategory(categoryCode: string): boolean {
  return (
    categoryCode === INTERNAL_TENANT_COMPANY_INDEX_CATEGORY ||
    categoryCode === INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY ||
    categoryCode === INTERNAL_COMMAND_RECEIPT_INDEX_CATEGORY
  );
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`).join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function isCanonicalUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function deterministicUuidV4(seed: string): string {
  const bytes = Buffer.from(createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function toUuidOrDeterministic(namespace: string, rawId: string): string {
  return isCanonicalUuid(rawId)
    ? rawId.toLowerCase()
    : deterministicUuidV4(`${namespace}:${rawId}`);
}

export interface PersistedCompanyMeta {
  readonly displayName: string;
  readonly legalForm: CompanyLegalFormContract;
  readonly taxRegime: CompanyTaxRegimeContract;
  readonly vatStatusSimple: CompanyVatStatusSimpleContract;
  readonly taxProfile: TaxProfileConfigContract;
  readonly settingsHistory: CompanySettingsResponse['history'];
  readonly address?: WorkspaceCompanyState['address'];
}

export function encodeCompanyMetaInAddress(meta: PersistedCompanyMeta): string {
  const payload = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
  return `Polska${META_MARKER}${payload}`;
}

export function decodeCompanyMetaFromAddress(addressSummary: string): PersistedCompanyMeta | null {
  const idx = addressSummary.indexOf(META_MARKER);
  if (idx < 0) {
    return null;
  }
  const encoded = addressSummary.slice(idx + META_MARKER.length).trim();
  if (!encoded) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as PersistedCompanyMeta;
  } catch {
    return null;
  }
}

export interface PersistedPostedDocumentSnapshot {
  readonly documentItem: CompanyDocumentItemContract;
  readonly explanations: Readonly<Record<string, WorkspaceExplanationRecord>>;
}

export function encodePostedDocumentSnapshotInDescription(
  humanDescription: string,
  snapshot: PersistedPostedDocumentSnapshot,
): string {
  const cleanBase = stripPostedDocumentSnapshotFromDescription(humanDescription);
  const encoded = Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64');
  return `${cleanBase || 'Dokument zaksięgowany'}${POSTED_DOC_MARKER}${encoded}`;
}

export function stripPostedDocumentSnapshotFromDescription(description: string): string {
  const idx = description.indexOf(POSTED_DOC_MARKER);
  return idx >= 0 ? description.slice(0, idx).trim() : description.trim();
}

export function decodePostedDocumentSnapshotFromDescription(description: string): {
  readonly cleanDescription: string;
  readonly snapshot: PersistedPostedDocumentSnapshot | null;
} {
  const idx = description.indexOf(POSTED_DOC_MARKER);
  if (idx < 0) {
    return { cleanDescription: description, snapshot: null };
  }
  const cleanDescription = description.slice(0, idx).trim();
  const encoded = description.slice(idx + POSTED_DOC_MARKER.length).trim();
  try {
    const snapshot = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ) as PersistedPostedDocumentSnapshot;
    return { cleanDescription, snapshot };
  } catch {
    return { cleanDescription, snapshot: null };
  }
}

export function mapZusSchemeToDbStage(
  scheme: TaxProfileConfigContract['zusScheme'],
): CompanyTaxSettingsRecord['zusStage'] {
  switch (scheme) {
    case 'ulga_na_start':
      return 'ulga_na_start';
    case 'preferencyjny_zus':
      return 'preferencyjny';
    case 'duzy_zus':
      return 'duzy_zus';
    case 'not_applicable':
      return 'brak_sp_zoo';
  }
}

export function mapDbStageToZusScheme(
  stage: CompanyTaxSettingsRecord['zusStage'],
): TaxProfileConfigContract['zusScheme'] {
  switch (stage) {
    case 'ulga_na_start':
      return 'ulga_na_start';
    case 'preferencyjny':
    case 'maly_zus_plus':
      return 'preferencyjny_zus';
    case 'duzy_zus':
      return 'duzy_zus';
    case 'brak_sp_zoo':
      return 'not_applicable';
  }
}

export function resolveDbKsefMode(
  taxProfile: TaxProfileConfigContract,
): CompanyTaxSettingsRecord['ksefMode'] {
  if (taxProfile.ksefSales2024Above200M) {
    return 'mandatory_2026_feb';
  }
  return 'mandatory_2026_apr';
}

export function mapContractKsefMarkerToDb(marker?: string | null): 'NONE' | 'OFF' | 'BFK' | 'DI' {
  if (marker === 'OFF' || marker === 'BFK' || marker === 'DI') {
    return marker;
  }
  return 'NONE';
}

export function mapDbKsefMarkerToContract(
  marker: 'NONE' | 'OFF' | 'BFK' | 'DI',
  ksefReference: string | null,
): KsefInvoiceMarkerContract {
  if (marker === 'OFF' || marker === 'BFK' || marker === 'DI') {
    return marker;
  }
  return ksefReference ? 'NrKSeF' : 'BFK';
}

export function mapRyczaltRateCodeToBps(rate: RyczaltRateCode): number {
  return Math.round(Number(rate) * 100);
}

export function mapBpsToRyczaltRateCode(rateBps: number): RyczaltRateCode {
  switch (rateBps) {
    case 1700:
      return '17';
    case 1500:
      return '15';
    case 1400:
      return '14';
    case 1250:
      return '12.5';
    case 1200:
      return '12';
    case 1000:
      return '10';
    case 850:
      return '8.5';
    case 550:
      return '5.5';
    case 300:
      return '3';
    case 200:
      return '2';
    default:
      return '12';
  }
}

export function computeMcpProposalSealHash(
  tenantId: string,
  legalEntityId: string,
  proposalId: string,
  payloadHash: string,
): string {
  return sha256Hex(`pap-mcp-seal:${tenantId}:${legalEntityId}:${proposalId}:${payloadHash}`);
}

export function encodeBankTxExternalRef(meta: {
  readonly rawTxId: string;
  readonly reference?: string | undefined;
}): string {
  return JSON.stringify(meta);
}

export function decodeBankTxExternalRef(
  externalRef: string | null,
  fallbackId: string,
): { readonly rawTxId: string; readonly reference?: string | undefined } {
  if (!externalRef) {
    return { rawTxId: fallbackId };
  }
  try {
    const parsed = JSON.parse(externalRef) as { rawTxId?: unknown; reference?: unknown };
    if (typeof parsed.rawTxId === 'string' && parsed.rawTxId.length > 0) {
      return {
        rawTxId: parsed.rawTxId,
        ...(typeof parsed.reference === 'string' ? { reference: parsed.reference } : {}),
      };
    }
  } catch {
    // Surowy identyfikator tekstowy spoza JSON.
  }
  return { rawTxId: externalRef };
}

export function encodeBankMatchNotes(match: BankReconciliationMatchContract): string {
  const encoded = Buffer.from(JSON.stringify(match), 'utf8').toString('base64');
  return `${match.notes} ${BANK_MATCH_MARKER}${encoded}`;
}

export function decodeBankMatchNotes(
  matchNotes: string | null,
): BankReconciliationMatchContract | null {
  if (!matchNotes) {
    return null;
  }
  const idx = matchNotes.indexOf(BANK_MATCH_MARKER);
  if (idx < 0) {
    return null;
  }
  const encoded = matchNotes.slice(idx + BANK_MATCH_MARKER.length).trim();
  try {
    return JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    ) as BankReconciliationMatchContract;
  } catch {
    return null;
  }
}
