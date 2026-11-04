'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, LegalBasisPanel, StatusBadge, type LegalBasisInfo } from '@pap/ui';
import { AlertBanner, Button } from '../../../components/ui-controls';

export interface CalendarObligationView {
  readonly code: string;
  readonly title: string;
  readonly category: string;
  readonly statutoryDueDate: string;
  readonly effectiveDueDate: string;
  readonly shiftedDays: readonly { readonly date: string; readonly reason: string }[];
  readonly status: 'applicable' | 'exempt_transitional' | 'informational';
  readonly isPaid: boolean;
  readonly basis: LegalBasisInfo;
}

export interface CalendarWorkbenchProps {
  period: string;
  canWrite: boolean;
  obligations: readonly CalendarObligationView[];
  holidaysInYear: readonly { readonly date: string; readonly name: string }[];
}

export function CalendarWorkbench({
  canWrite,
  holidaysInYear,
  obligations,
  period,
}: CalendarWorkbenchProps) {
  const router = useRouter();
  const [expandedCode, setExpandedCode] = useState<string | null>(obligations[0]?.code ?? null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  async function togglePaid(code: string) {
    setBusyCode(code);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_obligation_paid',
          obligationCode: code,
        }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="space-y-6">
      <div data-testid="zus-dra-and-holiday-reminder">
        <AlertBanner
          tone="legal"
          title="Zasada przesuwania terminów z art. 12 § 5 Ordynacji podatkowej (w tym wolna Wigilia 24.12)"
        >
          Jeżeli ostatni dzień ustawowego terminu przypada na sobotę lub dzień ustawowo wolny od
          pracy (w tym obowiązującą od 2025 r. wolną{' '}
          <strong>Wigilię Bożego Narodzenia 24.12</strong> wg Dz.U. 2024 poz. 1965), za ostatni
          dzień terminu uważa się następny dzień po dniu lub dniach wolnych od pracy. Przełącz okres
          w nagłówku na <code className="font-mono">2026-06</code> lub{' '}
          <code className="font-mono">2026-11</code>, aby zobaczyć przesunięcia
          weekendowe/świąteczne!
        </AlertBanner>
      </div>

      <div data-testid="tax-calendar-month-view" className="space-y-3">
        {obligations.map((ob) => {
          const isShifted = ob.shiftedDays.length > 0;
          const isOpen = expandedCode === ob.code;
          return (
            <Card
              key={ob.code}
              as="article"
              eyebrow={`Kategoria: ${ob.category.toUpperCase()} · okres ${period}`}
              title={ob.title}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    size="sm"
                    tone={
                      ob.isPaid
                        ? 'success'
                        : ob.status !== 'applicable'
                          ? 'neutral'
                          : isShifted
                            ? 'warning'
                            : 'info'
                    }
                    label={
                      ob.isPaid
                        ? 'Opłacone / złożone'
                        : ob.status !== 'applicable'
                          ? 'Informacyjne / okres przejściowy'
                          : isShifted
                            ? 'Termin przesunięty (art. 12 § 5 OP)'
                            : 'Oczekuje na realizację'
                    }
                  />
                  {ob.status === 'applicable' ? (
                    <Button
                      size="sm"
                      variant={ob.isPaid ? 'secondary' : 'primary'}
                      disabled={!canWrite || busyCode === ob.code}
                      onClick={() => void togglePaid(ob.code)}
                    >
                      {ob.isPaid ? 'Cofnij oznaczenie wpłaty' : 'Oznacz jako opłacone'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setExpandedCode(isOpen ? null : ob.code)}
                  >
                    {isOpen ? 'Ukryj podstawę' : '§ Dlaczego?'}
                  </Button>
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-4 text-xs text-[#464c48]">
                <span>
                  Termin efektywny:{' '}
                  <strong className="font-mono text-sm tabular-nums text-[#191c1a]">
                    {ob.effectiveDueDate}
                  </strong>
                </span>
                <span>
                  Termin nominalny w ustawie:{' '}
                  <span className="font-mono tabular-nums">{ob.statutoryDueDate}</span>
                </span>
                {isShifted ? (
                  <span className="font-medium text-[#7c4d00]">
                    Pominięte dni wolne:{' '}
                    {ob.shiftedDays.map((d) => `${d.date} (${d.reason})`).join(' → ')}
                  </span>
                ) : null}
              </div>

              {isOpen ? (
                <div className="mt-4">
                  <LegalBasisPanel basis={ob.basis} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div
        data-testid="tutorial-calendar-notifications-mcp-panel"
        className="grid gap-6 lg:grid-cols-2"
      >
        <Card
          as="div"
          eyebrow="Dni ustawowo wolne od pracy w Polsce (2026)"
          title="Kalendarz świąt uwzględniany przez silnik terminów"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {holidaysInYear.map((h) => (
              <li
                key={h.date}
                className="flex items-center justify-between rounded border border-[#e5e2d9] bg-[#faf9f5] px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium text-[#191c1a]">{h.name}</span>
                <span className="font-mono tabular-nums text-[#1d5c42]">{h.date}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          as="div"
          eyebrow="Powiązane moduły automatyzacji"
          title="Przypomnienia e-mail (RFC 5322) i asystent MCP"
        >
          <p className="text-sm leading-relaxed text-[#464c48]">
            Każdy z powyższych obowiązków może wygenerować pomocnicze przypomnienie e-mail (7 dni, 2
            dni, w dniu terminu oraz po terminie) w skrzynce Sandbox lub zostać odpytany przez
            zewnętrznego klienta AI za pomocą narzędzia{' '}
            <code className="font-mono text-xs">get_monthly_tax_obligations</code>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/app/notifications"
              className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#164833]"
            >
              Otwórz Powiadomienia i Skrzynkę Sandbox
            </Link>
            <Link
              href="/app/rules"
              className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
            >
              Katalog 32 reguł prawnych →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
