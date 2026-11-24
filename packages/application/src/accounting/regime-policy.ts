import type { ApproveAndPostDocumentRequest, CompanyLegalFormContract } from '@pap/contracts/api';
import type { TaxProfileCode } from '@pap/domain';
import { AccountingWorkspaceValidationError } from './errors.js';

export type AccountingRegimeAction =
  | 'kpir_manual_write'
  | 'ryczalt_manual_write'
  | 'full_ledger_manual_write'
  | 'document_kpir_override'
  | 'document_ryczalt_override'
  | 'document_ledger_override';

function describeProfilePl(profileCode: TaxProfileCode): string {
  switch (profileCode) {
    case 'jdg_kpir_skala':
      return 'JDG — Podatkowa Księga Przychodów i Rozchodów (skala podatkowa 12%/32%)';
    case 'jdg_kpir_liniowy':
      return 'JDG — Podatkowa Księga Przychodów i Rozchodów (podatek liniowy 19%)';
    case 'jdg_ryczalt':
      return 'JDG — Ryczałt od przychodów ewidencjonowanych';
    case 'spzoo_pelne_ksiegi':
      return 'Sp. z o.o. — Pełne księgi rachunkowe (Ustawa o rachunkowości, CIT)';
    default:
      return profileCode;
  }
}

/**
 * Egzekwuje po stronie serwera zgodność operacji zapisu z reżimem księgowo-podatkowym firmy (#109, GLD-06).
 * Widoki edukacyjne GET pozostają dostępne do odczytu, natomiast każdy zapis do księgi niezgodnej z profilem
 * kończy się odmową HTTP 422 (`incompatible_tax_regime`).
 */
export function assertAccountingRegimeSupportsAction(
  profileCode: TaxProfileCode,
  action: AccountingRegimeAction,
): void {
  const isKpir = profileCode === 'jdg_kpir_skala' || profileCode === 'jdg_kpir_liniowy';
  const isRyczalt = profileCode === 'jdg_ryczalt';
  const isFullLedger = profileCode === 'spzoo_pelne_ksiegi';
  const profileDesc = describeProfilePl(profileCode);

  switch (action) {
    case 'kpir_manual_write':
      if (!isKpir) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Operacja zapisu w Podatkowej Księdze Przychodów i Rozchodów (KPiR) jest niedozwolona dla profilu "${profileDesc}". Zapisy KPiR są właściwe wyłącznie dla JDG na skali podatkowej lub podatku liniowym.`,
        );
      }
      return;

    case 'ryczalt_manual_write':
      if (!isRyczalt) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Operacja zapisu w Ewidencji Przychodów Ryczałtowych jest niedozwolona dla profilu "${profileDesc}". Ewidencja ryczałtu jest właściwa wyłącznie dla JDG opodatkowanej ryczałtem.`,
        );
      }
      return;

    case 'full_ledger_manual_write':
      if (!isFullLedger) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Operacja księgowania dekretu w Księgach Rachunkowych (UoR) jest niedozwolona dla profilu "${profileDesc}". Dziennik i konta księgi głównej są właściwe dla podmiotów prowadzących pełne księgi rachunkowe.`,
        );
      }
      return;

    case 'document_kpir_override':
      if (!isKpir) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Wskazanie kolumny lub kwalifikacji kosztowej KPiR przy zatwierdzaniu dokumentu jest niedozwolone dla profilu "${profileDesc}".`,
        );
      }
      return;

    case 'document_ryczalt_override':
      if (!isRyczalt) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Wskazanie stawki ryczałtu ewidencjonowanego przy zatwierdzaniu dokumentu jest niedozwolone dla profilu "${profileDesc}".`,
        );
      }
      return;

    case 'document_ledger_override':
      if (!isFullLedger) {
        throw new AccountingWorkspaceValidationError(
          422,
          'incompatible_tax_regime',
          `Wskazanie konta księgi głównej (ledgerAccountCode) przy zatwierdzaniu dokumentu jest niedozwolone dla profilu "${profileDesc}".`,
        );
      }
      return;
  }
}

export function assertApproveOverridesMatchRegime(
  profileCode: TaxProfileCode,
  overrides?: ApproveAndPostDocumentRequest,
): void {
  if (!overrides) {
    return;
  }
  if (overrides.ledgerAccountCode !== undefined) {
    assertAccountingRegimeSupportsAction(profileCode, 'document_ledger_override');
  }
  if (overrides.ryczaltRate !== undefined || overrides.ryczaltRateCode !== undefined) {
    assertAccountingRegimeSupportsAction(profileCode, 'document_ryczalt_override');
  }
  if (overrides.kpirColumnNumber !== undefined) {
    assertAccountingRegimeSupportsAction(profileCode, 'document_kpir_override');
  }
  const kpirQual = overrides.kpirQualification ?? overrides.expenseQualification;
  if (kpirQual !== undefined) {
    if (profileCode === 'jdg_ryczalt') {
      assertAccountingRegimeSupportsAction(profileCode, 'document_kpir_override');
    }
    if (profileCode === 'spzoo_pelne_ksiegi' && kpirQual !== 'vehicle_mixed_75_col13') {
      assertAccountingRegimeSupportsAction(profileCode, 'document_kpir_override');
    }
  }
}

export function assertTaxProfileMutationAllowed(params: {
  readonly legalForm: CompanyLegalFormContract;
  readonly currentProfileCode: TaxProfileCode;
  readonly nextProfileCode: TaxProfileCode;
  readonly postedDocumentsCount: number;
  readonly kpirEntriesCount: number;
  readonly ryczaltEntriesCount: number;
  readonly journalEntriesCount: number;
  readonly vatEntriesCount: number;
}): void {
  if (params.legalForm === 'sp_z_o_o' && params.nextProfileCode !== 'spzoo_pelne_ksiegi') {
    throw new AccountingWorkspaceValidationError(
      422,
      'incompatible_tax_regime',
      'Spółka z ograniczoną odpowiedzialnością (sp. z o.o.) podlega obowiązkowi prowadzenia pełnych ksiąg rachunkowych (art. 2 ust. 1 pkt 1 UoR) i nie może korzystać z KPiR ani ryczałtu JDG.',
    );
  }
  if (params.legalForm === 'jdg' && params.nextProfileCode === 'spzoo_pelne_ksiegi') {
    throw new AccountingWorkspaceValidationError(
      422,
      'incompatible_tax_regime',
      'Jednoosobowa działalność gospodarcza (JDG) nie może zostać przypisana do profilu CIT spółki kapitałowej (spzoo_pelne_ksiegi).',
    );
  }

  if (params.nextProfileCode === params.currentProfileCode) {
    return;
  }

  const totalBookedItems =
    params.postedDocumentsCount +
    params.kpirEntriesCount +
    params.ryczaltEntriesCount +
    params.journalEntriesCount +
    params.vatEntriesCount;

  if (totalBookedItems > 0) {
    throw new AccountingWorkspaceValidationError(
      422,
      'incompatible_tax_regime',
      `Nie można zmienić profilu podatkowo-księgowego firmy z "${describeProfilePl(params.currentProfileCode)}" na "${describeProfilePl(params.nextProfileCode)}", ponieważ w księgach istnieją już zaksięgowane dokumenty lub zapisy (${totalBookedItems}).`,
    );
  }
}
