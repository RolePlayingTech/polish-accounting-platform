'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatNip } from '@pap/ui';
import {
  findAccessibleCompaniesForBook,
  getCompanyCapabilities,
  type PrimaryAccountingBookKind,
} from '../lib/company-capabilities';
import { formatUserFacingErrorPl } from '../lib/error-messages-pl';
import type { CompanyProfileRecord } from '../lib/workspace-types';
import { AlertBanner, Button } from './ui-controls';

const TARGET_BOOK_DESCRIPTIONS: Record<
  PrimaryAccountingBookKind,
  {
    readonly targetProfileNamePl: string;
    readonly explanationPl: string;
  }
> = {
  kpir: {
    targetProfileNamePl: 'JDG rozliczającej się na KPiR (skala 12%/32% lub podatek liniowy 19%)',
    explanationPl:
      'Podatkowa Księga Przychodów i Rozchodów służy wyłącznie podmiotom prowadzącym uproszczoną ewidencję przychodów i kosztów wg rozporządzenia MF.',
  },
  ryczalt: {
    targetProfileNamePl: 'JDG opodatkowanej ryczałtem od przychodów ewidencjonowanych',
    explanationPl:
      'Ewidencja przychodów wg stawek ryczałtu (art. 12 i art. 15 PPE) obowiązuje wyłącznie podatników rozliczających ryczałt — bez ujmowania kosztów uzyskania przychodów.',
  },
  full_ledger: {
    targetProfileNamePl:
      'spółki prowadzącej pełne księgi rachunkowe wg Ustawy o rachunkowości (np. Sp. z o.o.)',
    explanationPl:
      'Dziennik księgowań Wn = Ma, Zestawienie Obrotów i Sald, Bilans, RZiS oraz zaliczka CIT dotyczą jednostek prowadzących pełną rachunkowość.',
  },
};

export interface IncompatibleRegimeGateCardProps {
  readonly activeCompany: CompanyProfileRecord;
  readonly accessibleCompanies: readonly CompanyProfileRecord[];
  readonly requiredBook: PrimaryAccountingBookKind;
}

/**
 * Uczciwy komponent przełączania i informacji o niezgodnym reżimie (#101, #104, #120).
 * Nigdy nie używa sztywnego `demoCompanyCode` — proponuje przełączenie wyłącznie na realnie
 * dostępne firmy w `accessibleCompanies` z zachowaniem pełnej walidacji sesji i komunikatów błędów.
 */
export function IncompatibleRegimeGateCard({
  accessibleCompanies,
  activeCompany,
  requiredBook,
}: IncompatibleRegimeGateCardProps) {
  const router = useRouter();
  const [switchingEntityId, setSwitchingEntityId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<{
    readonly title: string;
    readonly detail: string;
  } | null>(null);

  const activeCaps = getCompanyCapabilities(activeCompany);
  if (activeCaps.primaryBook === requiredBook) {
    return null;
  }

  const matchingCompanies = findAccessibleCompaniesForBook(accessibleCompanies, requiredBook);
  const meta = TARGET_BOOK_DESCRIPTIONS[requiredBook];

  async function handleSwitchToCompany(target: CompanyProfileRecord) {
    setSwitchingEntityId(target.legalEntityId);
    setSwitchError(null);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          tenantId: target.tenantId,
          legalEntityId: target.legalEntityId,
        }),
      });

      let body: { ok?: boolean; error?: string; reasonCode?: string } = {};
      try {
        body = (await res.json()) as { ok?: boolean; error?: string; reasonCode?: string };
      } catch {
        body = {};
      }

      if (!res.ok || !body.ok) {
        setSwitchError({
          title: `Nie udało się przełączyć podmiotu (HTTP ${String(res.status)})`,
          detail: formatUserFacingErrorPl({
            status: res.status,
            reasonCode: body.reasonCode,
            rawMessage: body.error,
            fallbackPl: 'Wybrany podmiot jest niedostępny lub brakuje aktywnego grantu odczytu.',
          }),
        });
        return;
      }

      window.dispatchEvent(
        new CustomEvent('pap:company-switched', {
          detail: {
            company: target,
            legalEntityId: target.legalEntityId,
          },
        }),
      );
      router.refresh();
    } catch {
      setSwitchError({
        title: 'Błąd połączenia podczas zmiany aktywnego podmiotu',
        detail:
          'Nie udało się połączyć z warstwą sesji BFF. Dotychczasowy kontekst firmy pozostał bez zmian.',
      });
    } finally {
      setSwitchingEntityId(null);
    }
  }

  return (
    <div className="space-y-3" data-testid={`incompatible-regime-banner-${requiredBook}`}>
      <AlertBanner
        tone="warning"
        title={`Aktywna firma (${activeCompany.companyName}) rozlicza się w profilu: ${activeCompany.profileLabelPl}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={activeCaps.primaryBookHref}
              className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Otwórz księgę tej firmy: {activeCaps.primaryBookShortLabelPl} →
            </Link>
            {matchingCompanies.length === 0 ? (
              <Link
                href="/app/companies"
                className="inline-flex min-h-8 items-center rounded-md border border-[#858177] bg-white px-3 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
              >
                Zarządzaj podmiotami (/app/companies)
              </Link>
            ) : null}
          </div>
        }
      >
        <div className="space-y-2.5">
          <p>
            {meta.explanationPl} Zapisywanie operacji w tym widoku dla obecnego podmiotu jest{' '}
            <strong>zablokowane</strong>, aby nie dopuścić do zaksięgowania dokumentów w
            niewłaściwym reżimie podatkowym.
          </p>

          {matchingCompanies.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              <p className="font-semibold text-[#191c1a]">
                Dostępne na Twoim koncie podmioty {meta.targetProfileNamePl}:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {matchingCompanies.map((comp) => (
                  <Button
                    key={comp.legalEntityId}
                    size="sm"
                    variant="secondary"
                    disabled={switchingEntityId !== null}
                    onClick={() => void handleSwitchToCompany(comp)}
                  >
                    {switchingEntityId === comp.legalEntityId
                      ? 'Przełączanie kontekstu…'
                      : `Przełącz na: ${comp.companyName} (NIP ${formatNip(comp.nip)})`}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p>
              Na Twoim koncie nie ma obecnie żadnej dostępnej firmy o profilu{' '}
              <strong>{meta.targetProfileNamePl}</strong>. Jeśli jesteś właścicielem organizacji,
              możesz utworzyć testowy podmiot syntetyczny o takim profilu w sekcji{' '}
              <Link href="/app/companies" className="font-semibold underline underline-offset-2">
                Podmioty i uprawnienia (/app/companies)
              </Link>
              .
            </p>
          )}
        </div>
      </AlertBanner>

      {switchError ? (
        <AlertBanner tone="danger" title={switchError.title}>
          {switchError.detail}
        </AlertBanner>
      ) : null}
    </div>
  );
}
