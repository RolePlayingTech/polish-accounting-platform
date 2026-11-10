'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, StatusBadge } from '@pap/ui';
import type { CompanyProfileRecord } from '../lib/workspace-types';
import { useAllowSyntheticLogin } from './runtime-mode-provider';
import { AlertBanner, Button } from './ui-controls';

export interface WorkspaceAccessDeniedCardProps {
  statusCode?: number;
  reasonCode?: string;
  messagePl: string;
  accessibleCompanies?: readonly CompanyProfileRecord[];
  allowSyntheticLogin?: boolean;
}

export function WorkspaceAccessDeniedCard({
  accessibleCompanies = [],
  allowSyntheticLogin,
  messagePl,
  reasonCode,
  statusCode = 403,
}: WorkspaceAccessDeniedCardProps) {
  const contextAllowSyntheticLogin = useAllowSyntheticLogin();
  const effectiveAllowSyntheticLogin = allowSyntheticLogin ?? contextAllowSyntheticLogin;
  const router = useRouter();
  const [switchingEntityId, setSwitchingEntityId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function switchCompany(company: CompanyProfileRecord) {
    setSwitchingEntityId(company.legalEntityId);
    setSwitchError(null);
    try {
      const response = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          tenantId: company.tenantId,
          legalEntityId: company.legalEntityId,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setSwitchError(body.error ?? 'Nie udało się przełączyć aktywnego podmiotu.');
        setSwitchingEntityId(null);
        return;
      }
      router.refresh();
    } catch {
      setSwitchError('Błąd połączenia z warstwą BFF podczas zmiany podmiotu.');
      setSwitchingEntityId(null);
    }
  }

  const badgeLabel =
    statusCode >= 500
      ? `${String(statusCode)} · Usługa API niedostępna (Fail-Closed)`
      : statusCode === 404
        ? '404 · Zasób niedostępny'
        : statusCode === 401
          ? '401 · Wymagane ponowne logowanie'
          : '403 · Brak uprawnień do podmiotu';

  const cardTitle =
    statusCode >= 500
      ? `${String(statusCode)} Niedostępność backendu API (Fail-Closed)`
      : statusCode === 404
        ? '404 Zasób księgowy nie został znaleziony'
        : statusCode === 401
          ? '401 Sesja wygasła lub wymaga ponownego uwierzytelnienia'
          : '403 Brak uprawnień do wybranego podmiotu';

  const alertTitle =
    statusCode >= 500
      ? 'Operacja zablokowana — brak połączenia z backendem API (Fail-Closed)'
      : statusCode === 404
        ? 'Żądany zasób nie istnieje w wybranym podmiocie'
        : statusCode === 401
          ? 'Wymagane uwierzytelnienie OIDC'
          : 'Odmowa dostępu do danych księgowych';

  return (
    <Card
      as="section"
      tone="subtle"
      eyebrow="Ochrona izolacji organizacji i grantów podmiotowych (ADR-003)"
      title={cardTitle}
      actions={<StatusBadge size="sm" tone="danger" label={badgeLabel} />}
    >
      <div role="alert" className="space-y-4">
        <AlertBanner tone="danger" title={alertTitle}>
          <p>{messagePl}</p>
          {reasonCode ? (
            <p className="mt-1 font-mono text-xs text-[#6e1c18]">
              Kod decyzji autoryzacji: {reasonCode}
            </p>
          ) : null}
        </AlertBanner>

        {switchError ? (
          <AlertBanner tone="warning" title="Nie udało się przełączyć firmy">
            {switchError}
          </AlertBanner>
        ) : null}

        {accessibleCompanies.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-[#e5e2d9] bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#464c48]">
              Dostępne firmy na Twoim koncie — przełącz jednym kliknięciem:
            </p>
            <div className="flex flex-wrap gap-2">
              {accessibleCompanies.map((comp) => (
                <Button
                  key={comp.legalEntityId}
                  variant="secondary"
                  disabled={switchingEntityId !== null}
                  onClick={() => {
                    void switchCompany(comp);
                  }}
                >
                  {switchingEntityId === comp.legalEntityId
                    ? 'Przełączanie…'
                    : `Przełącz na: ${comp.shortName} (NIP ${comp.nip})`}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/app/companies"
            className="inline-flex min-h-10 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            Przejdź do wyboru firmy (/app/companies)
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-10 items-center rounded-md border border-[#858177] bg-white px-4 py-2 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            {effectiveAllowSyntheticLogin
              ? 'Zmień personę OIDC (/login)'
              : 'Przejdź do logowania (/login)'}
          </Link>
        </div>
      </div>
    </Card>
  );
}
