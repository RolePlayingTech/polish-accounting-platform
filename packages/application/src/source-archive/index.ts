import { createHash, randomUUID } from 'node:crypto';
import type { LegalEntityId, TenantId, UserId } from '@pap/domain';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { AccountingWorkspaceError } from '../accounting-workspace.js';

export const MAX_SOURCE_ARCHIVE_BINARY_BYTES = 15 * 1024 * 1024; // 15 MiB

export type SourceArtifactKind = 'ksef_xml' | 'pdf' | 'jpeg' | 'png' | 'csv' | 'json';

export type AllowedSourceMimeType =
  | 'application/xml'
  | 'text/xml'
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'text/csv'
  | 'application/json';

export interface OcrExtractedFieldConfidence<T> {
  readonly value: T;
  readonly confidenceBps: number; // 0..10_000
}

/**
 * Propozycja ekstrakcji OCR / AI dla dokumentów PDF/JPG/PNG (#99).
 * Zgodnie z zasadą bezwzględną AGENTS.md pkt 5: AI i OCR wyłącznie proponują dane;
 * `requiresHumanApproval` jest ZAWSZE równe `true`, nigdy nie następuje automatyczne księgowanie.
 */
export interface OcrExtractionDraftProposal {
  readonly extractorId: string;
  readonly extractedAtIso: string;
  readonly requiresHumanApproval: true;
  readonly overallConfidenceBps: number;
  readonly documentNumber?: OcrExtractedFieldConfidence<string>;
  readonly issueDate?: OcrExtractedFieldConfidence<string>;
  readonly saleDate?: OcrExtractedFieldConfidence<string>;
  readonly dueDate?: OcrExtractedFieldConfidence<string>;
  readonly counterpartyNip?: OcrExtractedFieldConfidence<string>;
  readonly counterpartyName?: OcrExtractedFieldConfidence<string>;
  readonly netGrosze?: OcrExtractedFieldConfidence<number>;
  readonly vatGrosze?: OcrExtractedFieldConfidence<number>;
  readonly grossGrosze?: OcrExtractedFieldConfidence<number>;
  readonly warningsPl: readonly string[];
}

export interface SplitVerificationPreviewDescriptor {
  readonly artifactId: string;
  readonly fileName: string;
  readonly mimeType: AllowedSourceMimeType;
  readonly kind: SourceArtifactKind;
  readonly byteLength: number;
  readonly sha256Hex: string;
  readonly previewMode: 'pdf_embed' | 'image_viewer' | 'xml_source' | 'structured_text';
  readonly authorizedDownloadPath: string;
  readonly requiresHumanApproval: true;
  readonly ocrProposal: OcrExtractionDraftProposal | null;
}

export interface StoredSourceDocumentArtifact {
  readonly artifactId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly uploadedByUserId: UserId;
  readonly uploadedAtIso: string;
  readonly fileName: string;
  readonly mimeType: AllowedSourceMimeType;
  readonly kind: SourceArtifactKind;
  readonly byteLength: number;
  readonly sha256Hex: string;
  readonly linkedDocumentId: string | null;
  readonly ksefReferenceNumber: string | null;
  readonly immutable: true;
  readonly ocrProposal: OcrExtractionDraftProposal | null;
}

export interface SourceArchiveAuthorizationFacts {
  readonly allowed: boolean;
  readonly reasonCode?: string;
}

export type SourceArchiveAuthorizer = (query: {
  readonly actorUserId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly action: 'read' | 'write';
}) => SourceArchiveAuthorizationFacts;

export interface StoreSourceArtifactInput {
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly content: Uint8Array | Buffer | string;
  readonly linkedDocumentId?: string;
  readonly ksefReferenceNumber?: string;
  readonly ocrProposal?: Omit<OcrExtractionDraftProposal, 'requiresHumanApproval'>;
  readonly now?: Date;
}

function detectAndVerifyBinarySignature(
  bytes: Buffer,
  declaredMimeRaw: string,
): { readonly mimeType: AllowedSourceMimeType; readonly kind: SourceArtifactKind } {
  const mime = declaredMimeRaw.trim().toLowerCase();

  if (mime === 'application/pdf') {
    if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako application/pdf nie posiada prawidłowego nagłówka binarnego "%PDF-".',
      );
    }
    return { mimeType: 'application/pdf', kind: 'pdf' };
  }

  if (mime === 'image/jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako image/jpeg nie posiada prawidłowej sygnatury binarnej JPEG (FF D8 FF).',
      );
    }
    return { mimeType: 'image/jpeg', kind: 'jpeg' };
  }

  if (mime === 'image/png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(pngSig)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako image/png nie posiada prawidłowej sygnatury binarnej PNG.',
      );
    }
    return { mimeType: 'image/png', kind: 'png' };
  }

  if (mime === 'application/xml' || mime === 'text/xml') {
    const sample = bytes
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart();
    if (!sample.startsWith('<')) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako XML nie rozpoczyna się od znacznika XML.',
      );
    }
    if (/<!DOCTYPE/i.test(sample) || /<!ENTITY/i.test(sample)) {
      throw new AccountingWorkspaceError(
        400,
        'source_xml_xxe_forbidden',
        'Archiwizowany dokument XML zawiera zabronione deklaracje DTD/ENTITY (ochrona XXE).',
      );
    }
    return {
      mimeType: mime === 'text/xml' ? 'text/xml' : 'application/xml',
      kind: 'ksef_xml',
    };
  }

  if (mime === 'application/json') {
    const sample = bytes
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart();
    if (!sample.startsWith('{') && !sample.startsWith('[')) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako application/json nie zawiera obiektu ani tablicy JSON.',
      );
    }
    return { mimeType: 'application/json', kind: 'json' };
  }

  if (mime === 'text/csv') {
    if (bytes.includes(0x00)) {
      throw new AccountingWorkspaceError(
        422,
        'invalid_source_binary_signature',
        'Plik zadeklarowany jako text/csv zawiera niedozwolone bajty zerowe (NUL).',
      );
    }
    return { mimeType: 'text/csv', kind: 'csv' };
  }

  throw new AccountingWorkspaceError(
    422,
    'unsupported_source_mime_type',
    `Nieobsługiwany typ MIME pliku źródłowego: "${declaredMimeRaw}". Dozwolone: application/pdf, image/jpeg, image/png, application/xml, text/xml, text/csv, application/json.`,
  );
}

function sanitizeArchiveFileName(rawName: string): string {
  const withoutControl = [...rawName.trim()]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('');
  const base = withoutControl.replace(/[\\/]/g, '_');
  if (base.length === 0 || base === '.' || base === '..') {
    throw new AccountingWorkspaceError(
      400,
      'invalid_source_file_name',
      'Nazwa pliku źródłowego jest pusta lub nieprawidłowa.',
    );
  }
  return base.slice(0, 200);
}

interface InternalArchiveEntry {
  readonly metadata: StoredSourceDocumentArtifact;
  readonly immutableBytes: Uint8Array;
}

/**
 * Niemutowalny magazyn oryginalnych plików źródłowych (XML KSeF, PDF, JPG, PNG, CSV, JSON)
 * z twardą izolacją tenantów i podmiotów prawnych, deduplikacją SHA-256 (409 Conflict),
 * weryfikacją integralności WORM oraz deskryptorem podglądu `SplitVerificationView` (#99).
 */
export class ImmutableSourceDocumentArchive {
  private readonly entriesById = new Map<string, InternalArchiveEntry>();
  private readonly dedupIndex = new Map<string, string>(); // `${tenantId}:${legalEntityId}:${sha256}` -> artifactId
  private readonly authorizer: SourceArchiveAuthorizer;
  private readonly maxBytes: number;

  constructor(options: {
    readonly authorizer: SourceArchiveAuthorizer;
    readonly maxBytes?: number;
  }) {
    this.authorizer = options.authorizer;
    this.maxBytes = options.maxBytes ?? MAX_SOURCE_ARCHIVE_BINARY_BYTES;
  }

  private assertAuthorized(
    rawActorUserId: string,
    rawTenantId: string,
    rawLegalEntityId: string,
    action: 'read' | 'write',
  ): {
    readonly actorUserId: UserId;
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
  } {
    let actorUserId: UserId;
    let tenantId: TenantId;
    let legalEntityId: LegalEntityId;
    try {
      actorUserId = parseUserId(rawActorUserId);
      tenantId = parseTenantId(rawTenantId);
      legalEntityId = parseLegalEntityId(rawLegalEntityId);
    } catch {
      throw new AccountingWorkspaceError(
        400,
        'invalid_archive_selector',
        'Nieprawidłowy identyfikator UUID użytkownika, organizacji (tenantId) lub firmy (legalEntityId).',
      );
    }

    const decision = this.authorizer({
      actorUserId,
      tenantId,
      legalEntityId,
      action,
    });
    if (!decision.allowed) {
      throw new AccountingWorkspaceError(
        403,
        decision.reasonCode ?? 'source_archive_access_denied',
        `Brak uprawnień (${action}) do magazynu dokumentów źródłowych firmy ${legalEntityId} w organizacji ${tenantId}.`,
      );
    }
    return { actorUserId, tenantId, legalEntityId };
  }

  storeOriginal(input: StoreSourceArtifactInput): StoredSourceDocumentArtifact {
    const { actorUserId, tenantId, legalEntityId } = this.assertAuthorized(
      input.actorUserId,
      input.tenantId,
      input.legalEntityId,
      'write',
    );

    const fileName = sanitizeArchiveFileName(input.fileName);
    const rawBuffer =
      typeof input.content === 'string'
        ? Buffer.from(input.content, 'utf8')
        : Buffer.from(input.content);

    if (rawBuffer.byteLength === 0) {
      throw new AccountingWorkspaceError(
        400,
        'empty_source_artifact',
        'Plik źródłowy przekazywany do archiwum nie może być pusty (0 bajtów).',
      );
    }
    if (rawBuffer.byteLength > this.maxBytes) {
      throw new AccountingWorkspaceError(
        422,
        'source_artifact_too_large',
        `Plik źródłowy przekracza maksymalny dozwolony rozmiar archiwum (${String(this.maxBytes)} bajtów).`,
      );
    }

    const { mimeType, kind } = detectAndVerifyBinarySignature(rawBuffer, input.declaredMimeType);
    const sha256Hex = createHash('sha256').update(rawBuffer).digest('hex');

    const dedupKey = `${tenantId}:${legalEntityId}:${sha256Hex}`;
    const existingArtifactId = this.dedupIndex.get(dedupKey);
    if (existingArtifactId !== undefined) {
      throw new AccountingWorkspaceError(
        409,
        'duplicate_source_artifact_sha256',
        `Plik źródłowy o identycznym skrócie SHA-256 (${sha256Hex}) znajduje się już w archiwum tej firmy (artifactId: ${existingArtifactId}).`,
      );
    }

    const ocrProposal: OcrExtractionDraftProposal | null = input.ocrProposal
      ? Object.freeze({
          ...input.ocrProposal,
          requiresHumanApproval: true as const,
          overallConfidenceBps: Math.max(
            0,
            Math.min(10_000, Math.trunc(input.ocrProposal.overallConfidenceBps)),
          ),
          warningsPl: Object.freeze([...input.ocrProposal.warningsPl]),
        })
      : null;

    const artifactId = randomUUID();
    const metadata: StoredSourceDocumentArtifact = Object.freeze({
      artifactId,
      tenantId,
      legalEntityId,
      uploadedByUserId: actorUserId,
      uploadedAtIso: (input.now ?? new Date()).toISOString(),
      fileName,
      mimeType,
      kind,
      byteLength: rawBuffer.byteLength,
      sha256Hex,
      linkedDocumentId: input.linkedDocumentId ?? null,
      ksefReferenceNumber: input.ksefReferenceNumber ?? null,
      immutable: true as const,
      ocrProposal,
    });

    // Zamrożona kopia bajtów źródłowych (WORM — brak możliwości podmiany referencji bufora z zewnątrz)
    const immutableBytes = new Uint8Array(rawBuffer.byteLength);
    immutableBytes.set(rawBuffer);

    this.entriesById.set(artifactId, Object.freeze({ metadata, immutableBytes }));
    this.dedupIndex.set(dedupKey, artifactId);
    return metadata;
  }

  getMetadata(query: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly artifactId: string;
  }): StoredSourceDocumentArtifact {
    const { tenantId, legalEntityId } = this.assertAuthorized(
      query.actorUserId,
      query.tenantId,
      query.legalEntityId,
      'read',
    );
    const entry = this.entriesById.get(query.artifactId);
    if (
      !entry ||
      entry.metadata.tenantId !== tenantId ||
      entry.metadata.legalEntityId !== legalEntityId
    ) {
      throw new AccountingWorkspaceError(
        404,
        'source_artifact_not_found',
        `Nie znaleziono pliku źródłowego ${query.artifactId} w archiwum wskazanej firmy.`,
      );
    }
    return entry.metadata;
  }

  readOriginalBytesVerified(query: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly artifactId: string;
  }): { readonly metadata: StoredSourceDocumentArtifact; readonly bytes: Buffer } {
    const { tenantId, legalEntityId } = this.assertAuthorized(
      query.actorUserId,
      query.tenantId,
      query.legalEntityId,
      'read',
    );
    const entry = this.entriesById.get(query.artifactId);
    if (
      !entry ||
      entry.metadata.tenantId !== tenantId ||
      entry.metadata.legalEntityId !== legalEntityId
    ) {
      throw new AccountingWorkspaceError(
        404,
        'source_artifact_not_found',
        `Nie znaleziono pliku źródłowego ${query.artifactId} w archiwum wskazanej firmy.`,
      );
    }

    const copy = Buffer.from(entry.immutableBytes);
    const verifyHash = createHash('sha256').update(copy).digest('hex');
    if (verifyHash !== entry.metadata.sha256Hex) {
      throw new AccountingWorkspaceError(
        409,
        'source_artifact_integrity_violation',
        `Naruszenie integralności WORM archiwum dla pliku ${query.artifactId}: niezgodny skrót SHA-256.`,
      );
    }
    return { metadata: entry.metadata, bytes: copy };
  }

  listCompanyArtifacts(query: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
  }): readonly StoredSourceDocumentArtifact[] {
    const { tenantId, legalEntityId } = this.assertAuthorized(
      query.actorUserId,
      query.tenantId,
      query.legalEntityId,
      'read',
    );
    const results: StoredSourceDocumentArtifact[] = [];
    for (const entry of this.entriesById.values()) {
      if (entry.metadata.tenantId === tenantId && entry.metadata.legalEntityId === legalEntityId) {
        results.push(entry.metadata);
      }
    }
    return results.sort((a, b) => a.uploadedAtIso.localeCompare(b.uploadedAtIso));
  }

  buildSplitVerificationPreview(query: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly artifactId: string;
  }): SplitVerificationPreviewDescriptor {
    const metadata = this.getMetadata(query);
    const previewMode: SplitVerificationPreviewDescriptor['previewMode'] =
      metadata.kind === 'pdf'
        ? 'pdf_embed'
        : metadata.kind === 'jpeg' || metadata.kind === 'png'
          ? 'image_viewer'
          : metadata.kind === 'ksef_xml'
            ? 'xml_source'
            : 'structured_text';

    return {
      artifactId: metadata.artifactId,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      kind: metadata.kind,
      byteLength: metadata.byteLength,
      sha256Hex: metadata.sha256Hex,
      previewMode,
      authorizedDownloadPath: `/api/v1/tenants/${metadata.tenantId}/companies/${metadata.legalEntityId}/source-artifacts/${metadata.artifactId}/content`,
      requiresHumanApproval: true,
      ocrProposal: metadata.ocrProposal,
    };
  }
}
