'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
  offlineDemoMode?: boolean;
  children: ReactNode;
}

export function WorkspaceShell({
  accessibleCompanies = [],
  activeCompany,
  activeHref,
  children,
  offlineDemoMode,
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
  const [extraCompanies, setExtraCompanies] = useState<readonly CompanyProfileRecord[]>([]);
  const [optimisticEntityId, setOptimisticEntityId] = useState<string | null>(null);
  const isOfflineDemo =
    offlineDemoMode ??
    (process.env['PAP_WEB_OFFLINE_DEMO_MODE'] === 'true' ||
      process.env['NEXT_PUBLIC_PAP_WEB_OFFLINE_DEMO_MODE'] === 'true');

  useEffect(() => {
    setOptimisticEntityId(null);
  }, [activeCompany?.legalEntityId]);

  useEffect(() => {
    function onCompanySwitched(event: Event) {
      const custom = event as CustomEvent<{
        company?: CompanyProfileRecord;
        legalEntityId?: string;
      }>;
      const comp = custom.detail?.company;
      if (comp) {
        setExtraCompanies((prev) =>
          prev.some((c) => c.legalEntityId === comp.legalEntityId) ? prev : [...prev, comp],
        );
      }
      if (custom.detail?.legalEntityId) {
        setOptimisticEntityId(custom.detail.legalEntityId);
      }
    }
    window.addEventListener('pap:company-switched', onCompanySwitched);
    return () => window.removeEventListener('pap:company-switched', onCompanySwitched);
  }, []);

  const mergedAccessibleCompanies = [
    ...accessibleCompanies,
    ...extraCompanies.filter(
      (ec) => !accessibleCompanies.some((ac) => ac.legalEntityId === ec.legalEntityId),
    ),
  ];
  const effectiveActiveCompany =
    (optimisticEntityId
      ? mergedAccessibleCompanies.find((c) => c.legalEntityId === optimisticEntityId)
      : null) ?? activeCompany;

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
        if (next.legalEntityId) {
          setOptimisticEntityId(next.legalEntityId);
        }
        router.refresh();
      }
    } catch {
      setSwitchError('Błąd połączenia podczas przełączania kontekstu firmy.');
    } finally {
      setIsSwitching(false);
    }
  }

  const contextHeader =
    sessionContext && effectiveActiveCompany ? (
      <div className="space-y-0">
        <CompanyPeriodHeader
          companyName={effectiveActiveCompany.companyName}
          nip={effectiveActiveCompany.nip}
          taxProfileLabel={effectiveActiveCompany.profileLabelPl}
          period={sessionContext.period}
          availablePeriods={AVAILABLE_PERIODS}
          onPeriodChange={(nextPeriod) => {
            void handleContextChange({ period: nextPeriod });
          }}
          dataFreshnessLabel={`Aktor: ${sessionContext.displayName}`}
          dataMode="synthetic"
          actions={
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <div
                data-testid="company-profile-switcher"
                className="flex min-w-0 max-w-full items-center gap-1.5"
              >
                <label
                  htmlFor="pap-active-company-select"
                  className="shrink-0 text-xs font-medium text-[#464c48]"
                >
                  Firma:
                </label>
                <select
                  id="pap-active-company-select"
                  disabled={isSwitching}
                  value={effectiveActiveCompany.legalEntityId}
                  onChange={(e) => {
                    const selected = mergedAccessibleCompanies.find(
                      (c) => c.legalEntityId === e.target.value,
                    );
                    if (selected) {
                      void handleContextChange({
                        tenantId: selected.tenantId,
                        legalEntityId: selected.legalEntityId,
                      });
                    }
                  }}
                  className="min-h-8 min-w-0 max-w-[calc(100vw-6.5rem)] truncate rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs font-medium text-[#191c1a] sm:max-w-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
                >
                  {mergedAccessibleCompanies.map((comp) => (
                    <option key={comp.legalEntityId} value={comp.legalEntityId}>
                      {comp.shortName}
                    </option>
                  ))}
                </select>
              </div>

              <StatusBadge
                size="sm"
                tone={effectiveActiveCompany.grantedActions.includes('write') ? 'accent' : 'info'}
                label={
                  effectiveActiveCompany.grantedActions.includes('write')
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
        {isOfflineDemo ? (
          <div
            role="status"
            data-testid="offline-demo-mode-banner"
            className="border-b border-[#e2c691] bg-[#f8eedb] px-4 py-2 text-xs font-semibold text-[#7a4f0a] sm:px-6"
          >
            TRYB DEMONSTRACYJNY OFFLINE — DANE NIE SĄ ZAPISYWANE W BAZIE · TRYB DEMO OFFLINE (DANE
            TYLKO W PAMIĘCI WEB)
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
