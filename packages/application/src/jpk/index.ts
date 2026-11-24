import { createHash } from 'node:crypto';
import {
  generateJpkEwp4Xml,
  generateJpkKrPd1Xml,
  generateJpkPkpir3Xml,
  generateJpkSt1Xml,
  generateJpkStKr1Xml,
  generateJpkV7Xml,
  type GenerateJpkEwp4Input,
  type GenerateJpkKrPd1Input,
  type GenerateJpkPkpir3Input,
  type GenerateJpkSt1Input,
  type GenerateJpkStKr1Input,
  type GenerateJpkV7Input,
  type OfficialJpkStructureCode,
} from '@pap/domain';

import { validateOfficialMfXml, type XsdValidationResult } from '../xsd/index.js';

/**
 * Honest JPK export & filing lifecycle state machine:
 * XML generation and offline XSD validation NEVER fabricate e-signatures,
 * e-Deklaracje / e-Urząd Skarbowy transport receipts, or fake UPO numbers.
 */
export type JpkFilingLifecycleStatus =
  | 'draft_calculated'
  | 'exported_xsd_valid_awaiting_signature'
  | 'signed_externally_ready_to_submit'
  | 'submitted_externally_pending_upo'
  | 'upo_confirmed_external';

export class JpkXsdValidationFailedError extends Error {
  readonly code = 'jpk_xsd_validation_failed' as const;
  readonly structureCode: OfficialJpkStructureCode;
  readonly validation: XsdValidationResult;

  constructor(structureCode: OfficialJpkStructureCode, validation: XsdValidationResult) {
    const firstIssue = validation.issues[0]?.message ?? 'Official MF XSD validation failed.';
    super(`Generated ${structureCode} XML failed offline MF XSD validation: ${firstIssue}`);
    this.name = 'JpkXsdValidationFailedError';
    this.structureCode = structureCode;
    this.validation = validation;
  }
}

export interface PreparedJpkExportArtifact {
  structureCode: OfficialJpkStructureCode;
  lifecycleStatus: 'exported_xsd_valid_awaiting_signature';
  xmlContent: string;
  xmlByteLength: number;
  xmlSha256Hex: string;
  xsdValidation: XsdValidationResult;
  externalSubmissionRequired: true;
  externalSignatureRequired: true;
  /** Strictly null until an authentic external MF UPO is imported & verified. */
  officialUpoReferenceNumber: null;
  officialUpoXml: null;
  truthfulnessNoticePl: string;
}

export type PrepareValidatedJpkExportRequest =
  | { structureCode: 'JPK_V7M(3)'; payload: Omit<GenerateJpkV7Input, 'variant'> }
  | { structureCode: 'JPK_V7K(3)'; payload: Omit<GenerateJpkV7Input, 'variant'> }
  | { structureCode: 'JPK_V7M(2)'; payload: Omit<GenerateJpkV7Input, 'variant'> }
  | { structureCode: 'JPK_PKPIR(3)'; payload: GenerateJpkPkpir3Input }
  | { structureCode: 'JPK_EWP(4)'; payload: GenerateJpkEwp4Input }
  | { structureCode: 'JPK_ST(1)'; payload: GenerateJpkSt1Input }
  | { structureCode: 'JPK_KR_PD(1)'; payload: GenerateJpkKrPd1Input }
  | { structureCode: 'JPK_ST_KR(1)'; payload: GenerateJpkStKr1Input };

/**
 * Generates an official Polish MF JPK XML document and validates it offline
 * against the vendored official MF XSD schema (`test/fixtures/xsd/`).
 * Fails closed on any XSD violation and NEVER invents fake UPO receipts.
 */
export function prepareValidatedJpkExport(
  request: PrepareValidatedJpkExportRequest,
): PreparedJpkExportArtifact {
  let xmlContent: string;
  switch (request.structureCode) {
    case 'JPK_V7M(3)':
    case 'JPK_V7K(3)':
    case 'JPK_V7M(2)':
      xmlContent = generateJpkV7Xml({
        ...request.payload,
        variant: request.structureCode,
      });
      break;
    case 'JPK_PKPIR(3)':
      xmlContent = generateJpkPkpir3Xml(request.payload);
      break;
    case 'JPK_EWP(4)':
      xmlContent = generateJpkEwp4Xml(request.payload);
      break;
    case 'JPK_ST(1)':
      xmlContent = generateJpkSt1Xml(request.payload);
      break;
    case 'JPK_KR_PD(1)':
      xmlContent = generateJpkKrPd1Xml(request.payload);
      break;
    case 'JPK_ST_KR(1)':
      xmlContent = generateJpkStKr1Xml(request.payload);
      break;
  }

  return finalizeValidatedJpkXml(request.structureCode, xmlContent);
}

export function finalizeValidatedJpkXml(
  structureCode: OfficialJpkStructureCode,
  xmlContent: string,
): PreparedJpkExportArtifact {
  const xsdValidation = validateOfficialMfXml(xmlContent, structureCode);
  if (!xsdValidation.valid) {
    throw new JpkXsdValidationFailedError(structureCode, xsdValidation);
  }

  const rawBytes = Buffer.from(xmlContent, 'utf8');
  const xmlSha256Hex = createHash('sha256').update(rawBytes).digest('hex');

  return {
    structureCode,
    lifecycleStatus: 'exported_xsd_valid_awaiting_signature',
    xmlContent,
    xmlByteLength: rawBytes.byteLength,
    xmlSha256Hex,
    xsdValidation,
    externalSubmissionRequired: true,
    externalSignatureRequired: true,
    officialUpoReferenceNumber: null,
    officialUpoXml: null,
    truthfulnessNoticePl:
      'Wygenerowano plik XML zgodny z urzędową schemą XSD MF (walidacja offline PASS). Plik NIE został podpisany ani wysłany do bramki MF — wymagany podpis kwalifikowany / Profil Zaufany / dane autoryzujące oraz zewnętrzne pobranie UPO.',
  };
}
