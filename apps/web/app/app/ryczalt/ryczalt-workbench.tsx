'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  MonthlyRyczaltCalculationResult,
  RyczaltEntry,
  RyczaltRateCode,
  VatExemptionEvaluationResult,
} from '@pap/domain';
import {
  Card,
  FormField,
  LedgerTable,
  LegalBasisPanel,
  MoneyAmount,
  StatusBadge,
  formatNip,
  type FieldHelpInfo,
  type LedgerColumn,
  type LegalBasisInfo,
} from '@pap/ui';
import { AlertBanner, Button, MoneyInput } from '../../../components/ui-controls';
import type { CompanyProfileRecord } from '../../../lib/workspace-types';

export interface RyczaltWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  period: string;
  canWrite: boolean;
  entries: readonly RyczaltEntry[];
  ryczaltSummary: MonthlyRyczaltCalculationResult;
  vatExemption: VatExemptionEvaluationResult;
  zusHealthGrosze: number;
  ryczaltBasis: LegalBasisInfo;
  vatLimitBasis: LegalBasisInfo;
  zusBasis: LegalBasisInfo;
  helpMap: {
    readonly ryczaltRate: FieldHelpInfo;
    readonly vatLimit: FieldHelpInfo;
  };
}

export function RyczaltWorkbench({
  activeCompany,
  canWrite,
  entries,
  helpMap,
  period,
  ryczaltBasis,
  ryczaltSummary,
  vatExemption,
  vatLimitBasis,
  zusBasis,
  zusHealthGrosze,
}: RyczaltWorkbenchProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  const [revenueDate, setRevenueDate] = useState(`${period}-22`);
  const [docNumber, setDocNumber] = useState(`FS/RYC/${period}/08`);
  const [counterpartyName, setCounterpartyName] = useState(
    'Aplikacje Mobilne Syntetyka Sp. z o.o.',
  );
  const [counterpartyNip, setCounterpartyNip] = useState('5213004125');
  const [rate, setRate] = useState<RyczaltRateCode>('12');
  const [revenuePln, setRevenuePln] = useState('8400.00');
  const [remarks, setRemarks] = useState('PKWiU 62.01 — wytwarzanie oprogramowania');

  const isLimitExceeded = vatExemption.status !== 'exempt_within_limit';
  const usedPercent = Math.min(
    100,
    Math.round(
      (vatExemption.cumulativeNetSalesAfterGrosze /
        Math.max(1, vatExemption.proportionalLimitGrosze)) *
        100,
    ),
  );

  async function switchToDemoRyczalt() {
    setBusy(true);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoCompanyCode: 'demo_jdg_ryczalt_beta' }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_ryczalt_entry',
          revenueDate,
          documentNumber: docNumber,
          counterpartyName,
          counterpartyNip,
          rate,
          revenuePln,
          remarks,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa zapisu (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Nie udało się zapisać pozycji w ewidencji przychodów.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Dopisano przychód do ewidencji ryczałtu',
          detail: `Zaktualizowano ryczałt PPE wg stawki ${rate}% oraz licznik limitu VAT 240 000 PLN.`,
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly LedgerColumn<RyczaltEntry>[] = [
    {
      id: 'lp',
      header: 'Lp.',
      numeric: true,
      mobileRole: 'meta',
      render: (row) => (
        <span className="font-mono text-xs font-semibold tabular-nums">
          {String(row.ordinalNumber)}
        </span>
      ),
    },
    {
      id: 'doc',
      header: 'Data przychodu i dowód',
      mobileRole: 'title',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-[#191c1a]">{row.documentNumber}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">{row.revenueDate}</p>
        </div>
      ),
    },
    {
      id: 'cp',
      header: 'Kontrahent i PKWiU / uwagi',
      mobileRole: 'meta',
      render: (row) => (
        <div>
          <p className="text-xs font-medium text-[#191c1a]">
            {row.counterpartyName}{' '}
            {row.counterpartyNip ? (
              <span className="font-mono text-[#636b66]">({formatNip(row.counterpartyNip)})</span>
            ) : null}
          </p>
          {row.remarks ? <p className="text-xs text-[#464c48]">{row.remarks}</p> : null}
        </div>
      ),
    },
    {
      id: 'rate',
      header: 'Stawka PPE',
      mobileRole: 'status',
      render: (row) => <StatusBadge size="sm" tone="accent" label={`Stawka ${row.rate}%`} />,
    },
    {
      id: 'amount',
      header: 'Przychód objęty ryczałtem',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => (
        <MoneyAmount amount={row.revenueGrosze} inGrosze size="sm" variant="income" />
      ),
      footer: (
        <MoneyAmount
          amount={ryczaltSummary.totalNetRevenueGrosze}
          inGrosze
          size="sm"
          variant="income"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {activeCompany.profileCode !== 'jdg_ryczalt' ? (
        <AlertBanner
          tone="info"
          title={`Aktywna firma (${activeCompany.shortName}) nie rozlicza się ryczałtem`}
          actions={
            <Button size="sm" disabled={busy} onClick={() => void switchToDemoRyczalt()}>
              Przełącz na Studio Kodowania (Ryczałt 12% + zw. VAT)
            </Button>
          }
        >
          Przełącz jednym kliknięciem na firmę <strong>Studio Kodowania Anna Przykładowa</strong>,
          aby obejrzeć ewidencję ryczałtu w stawkach 12% i 8,5% oraz monitor limitu zwolnienia z VAT
          240 000 PLN.
        </AlertBanner>
      ) : null}

      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div data-testid="vat-exemption-limit-tracker">
          <Card
            as="div"
            tone={isLimitExceeded ? 'danger' : 'default'}
            eyebrow="Art. 113 ust. 1 i 9 ustawy o VAT · limit 2026"
            title="Wykorzystanie limitu zwolnienia podmiotowego VAT (240 000 PLN)"
            actions={
              <StatusBadge
                size="sm"
                tone={isLimitExceeded ? 'danger' : usedPercent >= 80 ? 'warning' : 'success'}
                label={
                  isLimitExceeded
                    ? 'Limit przekroczony — rejestracja VAT-R!'
                    : `Wykorzystano ${String(usedPercent)}% limitu`
                }
              />
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-[#464c48]">Sprzedaż narastająco w roku:</span>
                <MoneyAmount
                  amount={vatExemption.cumulativeNetSalesAfterGrosze}
                  inGrosze
                  size="md"
                  variant="income"
                />
              </div>

              <div
                role="meter"
                aria-label="Wykorzystanie rocznego limitu zwolnienia z VAT"
                aria-valuemin={0}
                aria-valuemax={vatExemption.proportionalLimitGrosze / 100}
                aria-valuenow={Math.round(vatExemption.cumulativeNetSalesAfterGrosze / 100)}
                className="h-3 w-full overflow-hidden rounded-full border border-[#858177] bg-[#f4f2ec]"
              >
                <div
                  className={`h-full ${isLimitExceeded ? 'bg-[#9e2a25]' : 'bg-[#1d5c42]'}`}
                  style={{ width: `${String(usedPercent)}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#464c48]">
                <span>
                  Limit przysługujący:{' '}
                  <MoneyAmount amount={vatExemption.proportionalLimitGrosze} inGrosze size="sm" />
                </span>
                <span>
                  Pozostały bufor:{' '}
                  <MoneyAmount amount={vatExemption.remainingLimitGrosze} inGrosze size="sm" />
                </span>
              </div>

              <LegalBasisPanel basis={vatLimitBasis} />
            </div>
          </Card>
        </div>

        <div data-testid="ryczalt-health-threshold-gauge" className="space-y-6">
          <Card
            as="div"
            eyebrow={`Wyliczenie ryczałtu PPE za ${period}`}
            title="Podatek zryczałtowany po odliczeniu ZUS i 50% zdrowotnej"
            actions={
              <MoneyAmount amount={ryczaltSummary.taxDueGrosze} inGrosze size="lg" variant="tax" />
            }
          >
            <div data-testid="ryczalt-monthly-tax-trace" className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {ryczaltSummary.breakdownByRate.map((b) => (
                  <div
                    key={b.rate}
                    className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-2.5 text-xs"
                  >
                    <p className="font-semibold text-[#191c1a]">Stawka {b.rate}%</p>
                    <p className="mt-1 text-[#464c48]">
                      Przychód: <MoneyAmount amount={b.revenueGrosze} inGrosze size="sm" />
                    </p>
                    <p className="text-[#464c48]">
                      Po odliczeniach:{' '}
                      <MoneyAmount amount={b.revenueAfterDeductionsGrosze} inGrosze size="sm" />
                    </p>
                  </div>
                ))}
              </div>
              <LegalBasisPanel basis={ryczaltBasis} />
            </div>
          </Card>

          <Card
            as="div"
            eyebrow="Progi składki zdrowotnej na ryczałcie (60 000 / 300 000 PLN)"
            title="Miesięczna składka zdrowotna ZUS"
            actions={<MoneyAmount amount={zusHealthGrosze} inGrosze size="md" variant="tax" />}
          >
            <LegalBasisPanel basis={zusBasis} />
          </Card>
        </div>
      </div>

      <div data-testid="ryczalt-revenue-register">
        <LedgerTable
          caption={`Ewidencja przychodów opodatkowanych ryczałtem za okres ${period}`}
          title="Ewidencja przychodów wg stawek ryczałtu"
          subtitle="Odliczenia składek ZUS społecznych oraz 50% zapłaconej składki zdrowotnej są rozliczane proporcjonalnie do udziału poszczególnych stawek w przychodzie ogółem."
          columns={columns}
          rows={entries}
          getRowKey={(r) => r.id}
        />
      </div>

      <Card as="div" eyebrow="Nowy wpis ewidencyjny" title="Dodaj przychód do ewidencji ryczałtu">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={(e) => void handleAddEntry(e)}>
          <FormField id="ryc-date" label="Data uzyskania przychodu">
            {(ctrl) => (
              <input
                {...ctrl}
                type="date"
                value={revenueDate}
                onChange={(e) => setRevenueDate(e.target.value)}
                className={`${ctrl.className} font-mono tabular-nums`}
              />
            )}
          </FormField>

          <FormField id="ryc-doc" label="Numer dowodu sprzedaży">
            {(ctrl) => (
              <input
                {...ctrl}
                type="text"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
              />
            )}
          </FormField>

          <FormField
            id="ryc-rate"
            label="Stawka ryczałtu (art. 12 PPE)"
            fieldHelp={helpMap.ryczaltRate}
          >
            {(ctrl) => (
              <select
                {...ctrl}
                value={rate}
                onChange={(e) => setRate(e.target.value as RyczaltRateCode)}
              >
                <option value="12">12% — IT / programowanie (PKWiU 62.01)</option>
                <option value="8.5">8,5% — działalność usługowa do 100 tys. PLN</option>
                <option value="15">15% — doradztwo, reklama, pośrednictwo</option>
                <option value="17">17% — wolne zawody</option>
                <option value="14">14% — usługi architektoniczne i inżynierskie</option>
                <option value="5.5">5,5% — roboty budowlane / wytwórcze</option>
                <option value="3">3% — działalność handlowa / gastronomia</option>
              </select>
            )}
          </FormField>

          <FormField id="ryc-cp" label="Kontrahent">
            {(ctrl) => (
              <input
                {...ctrl}
                type="text"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
              />
            )}
          </FormField>

          <FormField id="ryc-nip" label="NIP kontrahenta">
            {(ctrl) => (
              <input
                {...ctrl}
                type="text"
                value={counterpartyNip}
                onChange={(e) => setCounterpartyNip(e.target.value)}
                className={`${ctrl.className} font-mono tabular-nums`}
              />
            )}
          </FormField>

          <MoneyInput
            id="ryc-amount"
            label="Kwota przychodu netto"
            value={revenuePln}
            onChange={setRevenuePln}
            fieldHelp={helpMap.vatLimit}
          />

          <div className="md:col-span-2">
            <FormField id="ryc-remarks" label="Klasyfikacja PKWiU / uwagi">
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              )}
            </FormField>
          </div>

          <div className="flex items-end">
            <Button type="submit" disabled={busy || !canWrite} className="w-full">
              {canWrite ? 'Zapisz w ewidencji ryczałtu' : 'Brak uprawnień do zapisu (read-only)'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
