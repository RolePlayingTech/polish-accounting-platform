'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CriticalConfirmDialog, FormField, StatusBadge } from '@pap/ui';
import { formatUserFacingErrorPl } from '../lib/error-messages-pl';
import type { PeriodCloseSnapshot } from '../lib/wave2-statutory-and-close';
import { AlertBanner, Button } from './ui-controls';

export interface PeriodClosePanelProps {
  readonly companyName: string;
  readonly companyNip: string;
  readonly canWrite: boolean;
  readonly initialSnapshot: PeriodCloseSnapshot;
}

export function PeriodClosePanel({
  canWrite,
  companyName,
  companyNip,
  initialSnapshot,
}: PeriodClosePanelProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    readonly tone: 'success' | 'danger';
    readonly title: string;
    readonly detail: string;
  } | null>(null);

  const isClosed = snapshot.status === 'closed';

  async function executeClosePeriod() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close_accounting_period',
          period: snapshot.period,
          confirmClose: true,
          note,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        periodClose?: PeriodCloseSnapshot;
      };
      setConfirmOpen(false);
      if (!res.ok || !data.ok || !data.periodClose) {
        setFeedback({
          tone: 'danger',
          title: `Nie udało się zamknąć okresu ${snapshot.period} (HTTP ${String(res.status)})`,
          detail: formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Sprawdź otwarte pozycje kontrolne przed zamknięciem miesiąca.',
          }),
        });
      } else {
        setSnapshot(data.periodClose);
        setFeedback({
          tone: 'success',
          title: `Okres rozliczeniowy ${snapshot.period} został zamknięty`,
          detail:
            'Wsteczne dopisywanie zapisów do zamkniętego miesiąca zostało zablokowane (HTTP 409 period_closed). Ewentualne korekty wprowadzaj w kolejnym otwartym okresie ze śladem audytowym.',
        });
        window.dispatchEvent(
          new CustomEvent('pap:period-closed', {
            detail: { period: snapshot.period, status: 'closed' },
          }),
        );
        router.refresh();
      }
    } catch {
      setConfirmOpen(false);
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z warstwą BFF',
        detail: 'Nie udało się zapisać blokady okresu rozliczeniowego.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="period-close-panel">
      <Card
        as="section"
        eyebrow={`Zamknięcie miesiąca księgowego · ${snapshot.period}`}
        title={`Kontrola kompletności i blokada okresu ${snapshot.period}`}
        actions={
          <StatusBadge
            size="sm"
            tone={isClosed ? 'danger' : snapshot.readyToClose ? 'success' : 'warning'}
            label={
              isClosed
                ? `Okres zamknięty (${snapshot.period})`
                : snapshot.readyToClose
                  ? 'Gotowy do zamknięcia'
                  : `Wymaga uzgodnienia (${String(snapshot.blockingItemsCount)} blokujące)`
            }
          />
        }
      >
        <div className="space-y-4">
          {feedback ? (
            <AlertBanner tone={feedback.tone} title={feedback.title}>
              {feedback.detail}
            </AlertBanner>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Dokumenty do weryfikacji:</p>
              <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#191c1a]">
                {String(snapshot.checklist.pendingDocumentsCount)}
              </p>
            </div>
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Oczekujące szkice MCP:</p>
              <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#191c1a]">
                {String(snapshot.checklist.pendingMcpProposalsCount)}
              </p>
            </div>
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Nierozliczone przelewy bankowe:</p>
              <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#191c1a]">
                {String(snapshot.checklist.unreconciledBankTransactionsCount)}
              </p>
            </div>
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Nieopłacone terminy ustawowe:</p>
              <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#191c1a]">
                {String(snapshot.checklist.unpaidTaxObligationsCount)}
              </p>
            </div>
          </div>

          {snapshot.warningsPl.length > 0 && !isClosed ? (
            <AlertBanner
              tone="warning"
              title="Uwagi kontrolne przed zamknięciem okresu (brak fikcyjnej kompletności)"
            >
              <ul className="list-disc space-y-1 pl-4">
                {snapshot.warningsPl.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </AlertBanner>
          ) : null}

          {isClosed ? (
            <div
              data-testid="period-closed-active-lock-notice"
              className="rounded-lg border border-[#9e2a25]/40 bg-[#fdf2f2] px-3.5 py-2.5 text-xs text-[#6e1b18]"
            >
              <strong>Blokada okresu aktywna:</strong> okres{' '}
              <code className="font-mono">{snapshot.period}</code> został zamknięty
              {snapshot.closedBy ? ` przez ${snapshot.closedBy}` : ''}
              {snapshot.closeNote ? ` (notatka: ${snapshot.closeNote})` : ''}. Wszystkie próby
              wstecznego zapisu w tym miesiącu są odrzucane z kodem{' '}
              <code className="font-mono">period_closed</code>.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <FormField
                  id="period-close-note"
                  label="Notatka audytowa do zamknięcia okresu (opcjonalnie)"
                >
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="text"
                      disabled={!canWrite || busy}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={`np. Uzgodniono ewidencje i JPK za ${snapshot.period}`}
                    />
                  )}
                </FormField>
              </div>
              <div className="flex items-end">
                <Button
                  data-testid="close-accounting-period-button"
                  disabled={!canWrite || busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  {canWrite
                    ? `Zamknij okres ${snapshot.period}`
                    : 'Zamknięcie wymaga grantu zapisu'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <CriticalConfirmDialog
        open={confirmOpen}
        operationType="period_close"
        title={`Potwierdź zamknięcie okresu księgowego ${snapshot.period}`}
        description={`Zamykasz księgi za okres ${snapshot.period} dla podmiotu ${companyName}. Po zamknięciu dopisywanie dokumentów i zapisów wstecznych w tym miesiącu będzie zablokowane.`}
        companyName={companyName}
        nip={companyNip}
        period={snapshot.period}
        auditConsequences={[
          'Wszystkie ścieżki zapisu (zatwierdzanie dokumentów, KPiR, ryczałt, dziennik UoR, rozliczenia okresu) odrzucą mutacje z kodem HTTP 409 period_closed.',
          'Korekty po zamknięciu miesiąca są ujmowane jawnie w kolejnym otwartym okresie sprawozdawczym ze śladem audytowym.',
        ]}
        confirmLabel={`Potwierdzam zamknięcie ${snapshot.period}`}
        isSubmitting={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          void executeClosePeriod();
        }}
      />
    </div>
  );
}
