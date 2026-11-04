'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  AppShell,
  CompanyPeriodHeader,
  StatusBadge,
  type AppSurface,
  type NavSection,
  type ShellLinkRenderer,
} from '@pap/ui';
import type { SessionContext } from '../lib/session';
import { AVAILABLE_PERIODS, type CompanyProfileRecord } from '../lib/workspace-types';

export const WORKSPACE_NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'codzienna-praca',
    title: 'Codzienna praca',
    items: [
      { id: 'dashboard', label: 'Pulpit dziś', href: '/app' },
      { id: 'documents', label: 'Obieg dokumentów i AI', href: '/app/documents' },
      { id: 'companies', label: 'Podmioty i uprawnienia', href: '/app/companies' },
    ],
  },
  {
    id: 'ksiegi-i-podatki',
    title: 'Księgi i podatki',
    items: [
      { id: 'kpir', label: 'KPiR (19 / 17 kol.)', href: '/app/kpir' },
      { id: 'ryczalt', label: 'Ewidencja ryczałtu', href: '/app/ryczalt' },
      { id: 'vat', label: 'Rejestry VAT i JPK_V7M', href: '/app/vat' },
      { id: 'ledger', label: 'Pełne księgi UoR i CIT', href: '/app/ledger' },
      { id: 'finance', label: 'Rozrachunki i bank', href: '/app/finance' },
      { id: 'calendar', label: 'Kalendarz podatkowy', href: '/app/calendar' },
      { id: 'rules', label: 'Katalog reguł „Dlaczego?”', href: '/app/rules' },
    ],
  },
  {
    id: 'automatyzacja-i-wiedza',
    title: 'Automatyzacja i wiedza',
    items: [
      { id: 'notifications', label: 'Powiadomienia i Sandbox', href: '/app/notifications' },
      { id: 'mcp', label: 'Klienci AI i kolejka MCP', href: '/app/mcp' },
      { id: 'academy', label: 'Akademia Księgowości', href: '/academy' },
    ],
  },
];

const nextLinkRenderer: ShellLinkRenderer = ({
  children,
  href,
  className,
  onClick,
  'aria-current': ariaCurrent,
}) => (
  <Link
    href={href}
    {...(className !== undefined ? { className } : {})}
    {...(ariaCurrent !== undefined ? { 'aria-current': ariaCurrent } : {})}
    {...(onClick !== undefined ? { onClick } : {})}
  >
    {children}
  </Link>
);

export interface WorkspaceShellProps {
  activeHref: string;
  surface?: AppSurface;
  pageTitle?: string;
  pageSubtitle?: string;
  pageEyebrow?: string;
  pageActions?: ReactNode;
  sessionContext: SessionContext | null;
  activeCompany: CompanyProfileRecord | null;
  accessibleCompanies?: readonly CompanyProfileRecord[];
  children: ReactNode;
}

export function WorkspaceShell({
  accessibleCompanies = [],
  activeCompany,
  activeHref,
  children,
  pageActions,
  pageEyebrow,
  pageSubtitle,
  pageTitle,
  sessionContext,
  surface = 'app',
}: WorkspaceShellProps) {
  const router = useRouter();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  async function handleContextChange(next: {
    tenantId?: string;
    legalEntityId?: string;
    period?: string;
  }) {
    setIsSwitching(true);
    setSwitchError(null);
    try {
      const response = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(next),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setSwitchError(data.error ?? 'Nie udało się zmienić aktywnej firmy.');
      } else {
        router.refresh();
      }
    } catch {
      setSwitchError('Błąd połączenia podczas przełączania kontekstu firmy.');
    } finally {
      setIsSwitching(false);
    }
  }

  const contextHeader =
    sessionContext && activeCompany ? (
      <div className="space-y-0">
        <CompanyPeriodHeader
          companyName={activeCompany.companyName}
          nip={activeCompany.nip}
          taxProfileLabel={activeCompany.profileLabelPl}
          period={sessionContext.period}
          availablePeriods={AVAILABLE_PERIODS}
          onPeriodChange={(nextPeriod) => {
            void handleContextChange({ period: nextPeriod });
          }}
          dataFreshnessLabel={`Aktor: ${sessionContext.displayName}`}
          dataMode="synthetic"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div data-testid="company-profile-switcher" className="flex items-center gap-1.5">
                <label
                  htmlFor="pap-active-company-select"
                  className="text-xs font-medium text-[#464c48]"
                >
                  Firma:
                </label>
                <select
                  id="pap-active-company-select"
                  disabled={isSwitching}
                  value={activeCompany.legalEntityId}
                  onChange={(e) => {
                    const selected = accessibleCompanies.find(
                      (c) => c.legalEntityId === e.target.value,
                    );
                    if (selected) {
                      void handleContextChange({
                        tenantId: selected.tenantId,
                        legalEntityId: selected.legalEntityId,
                      });
                    }
                  }}
                  className="min-h-8 rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs font-medium text-[#191c1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
                >
                  {accessibleCompanies.map((comp) => (
                    <option key={comp.legalEntityId} value={comp.legalEntityId}>
                      {comp.shortName}
                    </option>
                  ))}
                </select>
              </div>

              <StatusBadge
                size="sm"
                tone={activeCompany.grantedActions.includes('write') ? 'accent' : 'info'}
                label={
                  activeCompany.grantedActions.includes('write')
                    ? 'Uprawnienia: odczyt + zapis'
                    : 'Uprawnienia: tylko odczyt'
                }
              />

              <form method="post" action="/api/session/logout">
                <button
                  type="submit"
                  className="min-h-8 rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
                >
                  Wyloguj
                </button>
              </form>
            </div>
          }
        />
        {switchError ? (
          <div
            role="alert"
            className="border-b border-[#e6b3b0] bg-[#fceeed] px-4 py-2 text-xs font-medium text-[#9e2a25] sm:px-6"
          >
            {switchError}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e2d9] bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge size="sm" tone="warning" label="Dane syntetyczne (środowisko testowe)" />
          <span className="text-xs text-[#464c48]">
            Tryb publiczny bez aktywnej sesji księgowej — Akademia dostępna bez logowania.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/academy"
            className="inline-flex min-h-8 items-center rounded-md border border-[#858177] bg-white px-3 py-1 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            Otwórz Akademię Księgowości
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-1 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            Zaloguj się do środowiska testowego
          </Link>
        </div>
      </div>
    );

  return (
    <AppShell
      activeHref={activeHref}
      surface={surface}
      sections={WORKSPACE_NAV_SECTIONS}
      contextHeader={contextHeader}
      renderLink={nextLinkRenderer}
      {...(pageTitle !== undefined ? { pageTitle } : {})}
      {...(pageSubtitle !== undefined ? { pageSubtitle } : {})}
      {...(pageEyebrow !== undefined ? { pageEyebrow } : {})}
      {...(pageActions !== undefined ? { pageActions } : {})}
      footerNote="Polish Accounting Platform · „Księga Współczesna” · Wyłącznie dane syntetyczne — AI i MCP wyłącznie proponują, człowiek zatwierdza zapisy księgowe."
    >
      {children}
    </AppShell>
  );
}
