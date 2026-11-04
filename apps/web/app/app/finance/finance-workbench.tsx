'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BankReconciliationMatch, BankStatementTransaction } from '@pap/domain';
import {
  Card,
  FieldHelpButton,
  FormField,
  LedgerTable,
  MoneyAmount,
  StatusBadge,
  ToneIcon,
  formatNip,
  type FieldHelpInfo,
  type LedgerColumn,
} from '@pap/ui';
import { AlertBanner, Button } from '../../../components/ui-controls';
import {
  SAMPLE_BANK_CSV,
  SAMPLE_BANK_MT940,
  type WorkspaceDocumentRecord,
} from '../../../lib/workspace-types';

export interface FinanceWorkbenchProps {
  openDocuments: readonly WorkspaceDocumentRecord[];
  bankTransactions: readonly BankStatementTransaction[];
  reconciliationMatches: readonly BankReconciliationMatch[];
  asOfDate: string;
  canWrite: boolean;
  helpMap: {
    readonly whitelistIban: FieldHelpInfo;
    readonly mpp: FieldHelpInfo;
  };
}

function diffDays(dueDate: string, asOfDate: string): number {
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const refMs = Date.parse(`${asOfDate}T00:00:00Z`);
  return Math.floor((refMs - dueMs) / 86_400_000);
}

export function FinanceWorkbench({
  asOfDate,
  bankTransactions,
  canWrite,
  helpMap,
  openDocuments,
  reconciliationMatches,
}: FinanceWorkbenchProps) {
  const router = useRouter();
  const [format, setFormat] = useState<'csv' | 'mt940'>('csv');
  const [content, setContent] = useState(SAMPLE_BANK_CSV);
  const [applySettlements, setApplySettlements] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  const matchByTxId = new Map(reconciliationMatches.map((m) => [m.transactionId, m]));
  const unverifiedIbanDocs = openDocuments.filter(
    (d) => d.whiteListStatus === 'mismatch_alert' || (d.annex15Item && d.grossGrosze > 1_500_000),
  );

  async function handleBankImport() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_bank_statement',
          format,
          content,
          applySettlements,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        importedCount?: number;
        matchedCount?: number;
      };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Błąd importu wyciągu bankowego (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Sprawdź strukturę pliku CSV / MT940.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Zaimportowano wyciąg bankowy i wykonano parowanie deterministyczne',
          detail: `Wczytano ${String(data.importedCount ?? 0)} operacji bankowych; uzgodniono z rozrachunkami: ${String(data.matchedCount ?? 0)}.`,
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const agingColumns: readonly LedgerColumn<WorkspaceDocumentRecord>[] = [
    {
      id: 'doc',
      header: 'Dokument i kontrahent',
      mobileRole: 'title',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-[#191c1a]">{row.documentNumber}</p>
          <p className="text-xs text-[#464c48]">
            {row.counterpartyName} ({formatNip(row.counterpartyNip)})
          </p>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Typ rozrachunku',
      mobileRole: 'meta',
      render: (row) => (
        <StatusBadge
          size="sm"
          tone={row.direction === 'sales' ? 'accent' : 'info'}
          label={row.direction === 'sales' ? 'Należność (odbiorca)' : 'Zobowiązanie (dostawca)'}
        />
      ),
    },
    {
      id: 'aging',
      header: `Termin i wiekowanie (na ${asOfDate})`,
      mobileRole: 'status',
      render: (row) => {
        const remaining = Math.max(0, row.grossGrosze - row.paidAmountGrosze);
        const overdueDays = diffDays(row.dueDate, asOfDate);
        if (remaining === 0) {
          return <StatusBadge size="sm" tone="success" label="Rozliczona w całości" />;
        }
        if (overdueDays > 0) {
          return (
            <div className="space-y-0.5">
              <StatusBadge
                size="sm"
                tone="danger"
                label={`Przeterminowana o ${String(overdueDays)} dni!`}
              />
              <p className="font-mono text-[11px] tabular-nums text-[#9e2a25]">
                Termin minął: {row.dueDate}
              </p>
            </div>
          );
        }
        return (
          <div className="space-y-0.5">
            <StatusBadge
              size="sm"
              tone="warning"
              label={`W terminie (za ${String(Math.abs(overdueDays))} dni)`}
            />
            <p className="font-mono text-[11px] tabular-nums text-[#464c48]">
              Termin: {row.dueDate}
            </p>
          </div>
        );
      },
    },
    {
      id: 'wl_mpp',
      header: 'Biała Lista KAS i MPP',
      mobileRole: 'meta',
      render: (row) => (
        <div
          data-testid="whitelist-bank-verification-badge"
          className="flex flex-wrap items-center gap-1"
        >
          <StatusBadge
            size="sm"
            tone={
              row.whiteListStatus === 'verified_kas'
                ? 'success'
                : row.whiteListStatus === 'mismatch_alert'
                  ? 'danger'
                  : 'neutral'
            }
            label={
              row.whiteListStatus === 'verified_kas'
                ? 'IBAN w Wykazie KAS'
                : row.whiteListStatus === 'mismatch_alert'
                  ? 'Uwaga: IBAN poza Białą Listą!'
                  : 'Nie dotyczy WL'
            }
          />
          {row.annex15Item && row.grossGrosze > 1_500_000 ? (
            <StatusBadge size="sm" tone="warning" label="Obowiązkowy MPP!" />
          ) : null}
        </div>
      ),
    },
    {
      id: 'remaining',
      header: 'Pozostało do zapłaty',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => {
        const rem = Math.max(0, row.grossGrosze - row.paidAmountGrosze);
        const overdue = rem > 0 && diffDays(row.dueDate, asOfDate) > 0;
        return (
          <MoneyAmount
            amount={rem}
            inGrosze
            size="sm"
            variant={overdue ? 'overdue' : row.direction === 'sales' ? 'income' : 'expense'}
          />
        );
      },
    },
  ];

  const txColumns: readonly LedgerColumn<BankStatementTransaction>[] = [
    {
      id: 'date_title',
      header: 'Data i tytuł przelewu',
      mobileRole: 'title',
      render: (tx) => (
        <div>
          <p className="text-xs font-semibold text-[#191c1a]">{tx.title}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            {tx.bookingDate} · {tx.counterpartyName}{' '}
            {tx.counterpartyIban ? `· ${tx.counterpartyIban}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Kwota przelewu',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (tx) => (
        <MoneyAmount
          amount={tx.direction === 'credit' ? tx.amountGrosze : -tx.amountGrosze}
          inGrosze
          size="sm"
          showSign
          variant={tx.direction === 'credit' ? 'income' : 'expense'}
        />
      ),
    },
    {
      id: 'match',
      header: 'Wynik parowania deterministycznego',
      mobileRole: 'status',
      render: (tx) => {
        const match = matchByTxId.get(tx.transactionId);
        if (!match) {
          return <StatusBadge size="sm" tone="neutral" label="Brak analizy" />;
        }
        const tone =
          match.status === 'matched_exact'
            ? 'success'
            : match.status === 'matched_partial' || match.status === 'overpaid'
              ? 'warning'
              : match.status === 'ambiguous_manual_review'
                ? 'danger'
                : 'neutral';
        return (
          <div className="space-y-0.5">
            <StatusBadge
              size="sm"
              tone={tone}
              label={
                match.status === 'matched_exact'
                  ? `Uzgodniono 1:1 (${match.matchedDocumentNumber ?? ''})`
                  : match.status === 'matched_partial'
                    ? `Wpłata częściowa (${match.matchedDocumentNumber ?? ''})`
                    : match.status === 'overpaid'
                      ? `Nadpłata (${match.matchedDocumentNumber ?? ''})`
                      : match.status === 'ambiguous_manual_review'
                        ? 'Niejednoznaczne — decyzja człowieka'
                        : 'Nierozpoznany przelew'
              }
            />
            <p className="text-[11px] text-[#464c48]">{match.notes}</p>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div data-testid="security-iban-mismatch-alert">
        {unverifiedIbanDocs.length > 0 ? (
          <div
            role="alert"
            className="rounded-xl border border-[#e6c88a] bg-[#fdf4e3] p-4 text-xs text-[#7c4d00]"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <ToneIcon tone="warning" className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">
                    Kontrola bezpieczeństwa płatności (Biała Lista VAT i obowiązkowy Split Payment)
                  </p>
                  <p className="mt-1">
                    Przed zleceniem przelewu powyżej 15 000 PLN brutto zweryfikuj rachunek IBAN w
                    Wykazie podatników VAT KAS (ochrona przed sankcją NKUP i odpowiedzialnością
                    solidarną wg art. 117ba OP) oraz użyj komunikatu przelewu MPP dla Załącznika nr
                    15.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <FieldHelpButton help={helpMap.whitelistIban} />
                <FieldHelpButton help={helpMap.mpp} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div data-testid="receivables-aging-table">
        <LedgerTable
          caption="Rozrachunki z odbiorcami i dostawcami wraz z wiekowaniem i kontrolą Białej Listy KAS"
          title="Należności, zobowiązania i wiekowanie przeterminowań"
          subtitle="Pozycje przeterminowane posiadają czytelną odznakę tekstową i ikonę ostrzegawczą (nigdy sam kolor)."
          columns={agingColumns}
          rows={openDocuments}
          getRowKey={(r) => r.documentId}
        />
      </div>

      <div data-testid="bank-statement-reconciliation-view" className="space-y-6">
        <Card
          as="div"
          eyebrow="POST .../finance/bank-import · POST .../finance/reconcile"
          title="Import wyciągu bankowego (CSV / SWIFT MT940) i parowanie z fakturami"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFormat('csv');
                  setContent(SAMPLE_BANK_CSV);
                }}
              >
                Wczytaj przykładowy wyciąg CSV (średnik)
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFormat('mt940');
                  setContent(SAMPLE_BANK_MT940);
                }}
              >
                Wczytaj przykładowy wyciąg SWIFT MT940
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="bank-format" label="Format wyciągu bankowego">
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as 'csv' | 'mt940')}
                  >
                    <option value="csv">
                      Polski wyciąg CSV (Data;Waluta;Kontrahent;IBAN;Tytuł;Kwota)
                    </option>
                    <option value="mt940">
                      Standard bankowy SWIFT MT940 (:20:, :25:, :61:, :86:)
                    </option>
                  </select>
                )}
              </FormField>

              <div className="flex items-end pb-2">
                <label
                  htmlFor="bank-import-apply-settlements"
                  className="flex items-center gap-2 text-xs font-medium text-[#191c1a]"
                >
                  <input
                    id="bank-import-apply-settlements"
                    type="checkbox"
                    checked={applySettlements}
                    onChange={(e) => setApplySettlements(e.target.checked)}
                    className="h-4 w-4 accent-[#1d5c42]"
                  />
                  <span>Rozlicz automatycznie jednoznacznie dopasowane faktury</span>
                </label>
              </div>
            </div>

            <FormField id="bank-raw-content" label="Zawartość wyciągu syntetycznego">
              {(ctrl) => (
                <textarea
                  {...ctrl}
                  rows={6}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className={`${ctrl.className} font-mono text-xs`}
                />
              )}
            </FormField>

            <Button disabled={busy || !canWrite} onClick={() => void handleBankImport()}>
              Importuj wyciąg i uzgodnij przelewy z fakturami
            </Button>
          </div>
        </Card>

        <LedgerTable
          caption="Operacje wyciągu bankowego uzgodnione z otwartymi rozrachunkami"
          title="Transakcje bankowe i status parowania"
          columns={txColumns}
          rows={bankTransactions}
          getRowKey={(tx) => tx.transactionId}
        />
      </div>
    </div>
  );
}
