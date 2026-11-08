'use client';

import { useState } from 'react';
import { Card, StatusBadge } from '@pap/ui';
import { AlertBanner, Button } from '../../components/ui-controls';
import type { PersonaId } from '../../lib/session';
import { AVAILABLE_PERIODS, type PublicPersonaSummary } from '../../lib/workspace-types';

export interface PersonaLoginClientProps {
  personas: readonly PublicPersonaSummary[];
  redirectTo: string;
}

export function PersonaLoginClient({ personas, redirectTo }: PersonaLoginClientProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-10');
  const [submittingPersona, setSubmittingPersona] = useState<PersonaId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loginAs(personaId: PersonaId) {
    setSubmittingPersona(personaId);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/session/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          personaId,
          period: selectedPeriod,
          redirectTo,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? 'Nie udało się utworzyć sesji OIDC.');
        setSubmittingPersona(null);
        return;
      }
      window.location.assign(data.redirectTo ?? '/app');
    } catch {
      setErrorMessage('Błąd komunikacji z warstwą BFF podczas logowania.');
      setSubmittingPersona(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e2d9] bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-[#191c1a]">
            Domyślny okres księgowy po zalogowaniu
          </p>
          <p className="text-xs text-[#636b66]">
            Możesz go w każdej chwili przełączyć w nagłówku aplikacji (w tym grudzień 2026 z wolną
            Wigilią 24.12).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="login-period-select" className="text-xs font-medium text-[#464c48]">
            Okres (RRRR-MM):
          </label>
          <select
            id="login-period-select"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="min-h-9 rounded-md border border-[#858177] bg-white px-3 py-1.5 font-mono text-sm tabular-nums text-[#191c1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            {AVAILABLE_PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMessage ? (
        <AlertBanner tone="danger" title="Błąd logowania sesji testowej">
          {errorMessage}
        </AlertBanner>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {personas.map((persona) => {
          const isBusy = submittingPersona === persona.personaId;
          return (
            <Card
              key={persona.personaId}
              as="article"
              eyebrow={persona.tenantName}
              title={persona.displayName}
              actions={
                <StatusBadge
                  size="sm"
                  tone={persona.personaId === 'piotr-izolacyjny' ? 'warning' : 'accent'}
                  label={
                    persona.tenantRole === 'owner' ? 'Rola: owner' : 'Rola: accountant (grant)'
                  }
                />
              }
            >
              <div className="space-y-3">
                <p className="text-xs font-semibold text-[#1d5c42]">{persona.roleSummaryPl}</p>
                <p className="text-sm leading-relaxed text-[#464c48]">{persona.descriptionPl}</p>

                <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-2.5 text-xs">
                  <p className="font-mono text-[#464c48]">E-mail: {persona.email}</p>
                  <p className="mt-1 font-mono text-[#636b66]">
                    Uprawnienia OIDC: {persona.scopes.join(', ')}
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={submittingPersona !== null}
                  onClick={() => {
                    void loginAs(persona.personaId);
                  }}
                >
                  {isBusy ? 'Uwierzytelnianie OIDC…' : `Zaloguj jako ${persona.displayName}`}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
