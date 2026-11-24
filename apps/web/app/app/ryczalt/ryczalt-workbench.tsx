'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  parsePlnToGrosze,
  validatePolishNip,
  type MonthlyRyczaltCalculationResult,
  type RyczaltEntry,
  type RyczaltRateCode,
  type VatExemptionEvaluationResult,
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
import { IncompatibleRegimeGateCard } from '../../../components/regime-context-card';
import { RyczaltRateGuideTrigger } from '../../../components/tax-guide-drawer';
import { AlertBanner, Button, MoneyInput } from '../../../components/ui-controls';
import { formatUserFacingErrorPl } from '../../../lib/error-messages-pl';
import type { CompanyProfileRecord } from '../../../lib/workspace-types';

export interface RyczaltWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  accessibleCompanies?: readonly CompanyProfileRecord[];
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
  accessibleCompanies = [],
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isRegimeCompatible = activeCompany.profileCode === 'jdg_ryczalt';
  const canWriteEffective = canWrite && isRegimeCompatible;

  const [revenueDate, setRevenueDate] = useState(`${period}-22`);
  const [docNumber, setDocNumber] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyNip, setCounterpartyNip] = useState('');
  const [rate, setRate] = useState<RyczaltRateCode>('12');
  const [revenuePln, setRevenuePln] = useState('');
  const [remarks, setRemarks] = useState('');

  const isLimitExceeded = vatExemption.status !== 'exempt_within_limit';
  const usedPercent = Math.min(
    100,
    Math.round(
      (vatExemption.cumulativeNetSalesAfterGrosze /
        Math.max(1, vatExemption.proportionalLimitGrosze)) *
        100,
    ),
  );

  function fillDemoRyczaltEntry() {
    setRevenueDate(`${period}-22`);
    setDocNumber(`FS-DEMO/RYC/${period}/08`);
    setCounterpartyName('Aplikacje Mobilne Syntetyka Sp. z o.o. [DEMO]');
    setCounterpartyNip('5213004125');
    setRate('12');
    setRevenuePln('8400.00');
    setRemarks('[DEMO] PKWiU 62.01 — wytwarzanie oprogramowania');
    setFieldErrors({});
  }

  function validateForm(): boolean {
    const nextErrors: Record<string, string> = {};
    let firstId: string | null = null;
    const mark = (k: string, id: string, msg: string) => {
      if (!nextErrors[k]) {
        nextErrors[k] = msg;
        if (!firstId) firstId = id;
      }
    };

    if (!docNumber.trim()) {
      mark('docNumber', 'ryc-doc', `Podaj numer dowodu sprzedaży (np. FS/${period}/08).`);
    }
    if (counterpartyName.trim().length < 2) {
      mark(
        'counterpartyName',
        'ryc-cp',
        'Podaj nazwę nabywcy albo wpisz „Sprzedaż bezrachunkowa”.',
      );
    }
    if (counterpartyNip.trim().length > 0) {
      const nipCheck = validatePolishNip(counterpartyNip);
      if (!nipCheck.valid) {
        mark(
          'counterpartyNip',
          'ryc-nip',
          nipCheck.reason ?? 'Podaj poprawny 10-cyfrowy NIP albo pozostaw pole puste.',
        );
      }
    }
    if (!revenuePln.trim()) {
      mark('revenuePln', 'ryc-amount', 'Podaj kwotę uzyskanego przychodu netto (np. 4500.00).');
    } else {
      try {
        if (parsePlnToGrosze(revenuePln) <= 0) {
          mark('revenuePln', 'ryc-amount', 'Kwota przychodu musi być większa od 0,00 PLN.');
        }
      } catch {
        mark('revenuePln', 'ryc-amount', 'Wpisz kwotę PLN w formacie dziesiętnym, np. 4500.00.');
      }
    }

    setFieldErrors(nextErrors);
    if (firstId) {
      window.document.getElementById(firstId)?.focus();
      return false;
    }
    return true;
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!validateForm()) {
      return;
    }
    setBusy(true);
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
      const data = (await res.json()) as { ok?: boolean; reasonCode?: string; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa zapisu (HTTP ${String(res.status)})`,
          detail: formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się zapisać pozycji w ewidencji przychodów.',
          }),
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Dopisano przychód do ewidencji ryczałtu',
          detail: `Zaktualizowano ryczałt PPE wg stawki ${rate}% oraz licznik limitu VAT.`,
        });
        router.refresh();
      }
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z warstwą sesji BFF',
        detail: 'Nie udało się zapisać przychodu w ewidencji.',
      });
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
      <IncompatibleRegimeGateCard
        activeCompany={activeCompany}
        accessibleCompanies={accessibleCompanies}
        requiredBook="ryczalt"
      />

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

      <Card
        as="div"
        eyebrow="Nowy wpis ewidencyjny (art. 15 PPE)"
        title="Dodaj przychód do ewidencji ryczałtu"
        actions={
          <Button size="sm" variant="secondary" onClick={fillDemoRyczaltEntry}>
            [DEMO] Wypełnij przykładem (12% IT)
          </Button>
        }
      >
        <form noValidate className="space-y-4" onSubmit={(e) => void handleAddEntry(e)}>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField id="ryc-date" label="Data uzyskania przychodu" required>
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

            <FormField
              id="ryc-doc"
              label="Numer dowodu sprzedaży"
              required
              {...(fieldErrors['docNumber'] ? { error: fieldErrors['docNumber'] } : {})}
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={docNumber}
                  onChange={(e) => {
                    setDocNumber(e.target.value);
                    if (fieldErrors['docNumber']) {
                      setFieldErrors((prev) => ({ ...prev, docNumber: '' }));
                    }
                  }}
                  placeholder={`np. FS/${period}/08`}
                  className={`${ctrl.className} font-mono`}
                />
              )}
            </FormField>

            <FormField
              id="ryc-rate"
              label="Stawka ryczałtu (art. 12 PPE)"
              required
              fieldHelp={helpMap.ryczaltRate}
            >
              {(ctrl) => (
                <select
                  {...ctrl}
                  value={rate}
                  onChange={(e) => setRate(e.target.value as RyczaltRateCode)}
                >
                  <option value="12">12% — IT / programowanie (PKWiU 62.01)</option>
                  <option value="8.5">8,5% — działalność usługowa ogólna</option>
                  <option value="15">15% — doradztwo, reklama, pośrednictwo</option>
                  <option value="17">17% — wolne zawody</option>
                  <option value="14">14% — usługi architektoniczne i inżynierskie</option>
                  <option value="5.5">5,5% — roboty budowlane / wytwórcze</option>
                  <option value="3">3% — działalność handlowa / gastronomia</option>
                </select>
              )}
            </FormField>
          </div>

          <RyczaltRateGuideTrigger selectedRate={rate} eventDate={revenueDate} />

          <div className="grid gap-3 md:grid-cols-3">
            <FormField
              id="ryc-cp"
              label="Kontrahent"
              required
              {...(fieldErrors['counterpartyName']
                ? { error: fieldErrors['counterpartyName'] }
                : {})}
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={counterpartyName}
                  onChange={(e) => {
                    setCounterpartyName(e.target.value);
                    if (fieldErrors['counterpartyName']) {
                      setFieldErrors((prev) => ({ ...prev, counterpartyName: '' }));
                    }
                  }}
                  placeholder="Nazwa nabywcy z faktury"
                />
              )}
            </FormField>

            <FormField
              id="ryc-nip"
              label="NIP kontrahenta (opcjonalnie)"
              {...(fieldErrors['counterpartyNip'] ? { error: fieldErrors['counterpartyNip'] } : {})}
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={counterpartyNip}
                  onChange={(e) => {
                    setCounterpartyNip(e.target.value);
                    if (fieldErrors['counterpartyNip']) {
                      setFieldErrors((prev) => ({ ...prev, counterpartyNip: '' }));
                    }
                  }}
                  placeholder="10 cyfr lub puste dla B2C"
                  className={`${ctrl.className} font-mono tabular-nums`}
                />
              )}
            </FormField>

            <MoneyInput
              id="ryc-amount"
              label="Kwota przychodu netto"
              required
              value={revenuePln}
              onChange={(val) => {
                setRevenuePln(val);
                if (fieldErrors['revenuePln']) {
                  setFieldErrors((prev) => ({ ...prev, revenuePln: '' }));
                }
              }}
              fieldHelp={helpMap.vatLimit}
              {...(fieldErrors['revenuePln'] ? { error: fieldErrors['revenuePln'] } : {})}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <FormField id="ryc-remarks" label="Klasyfikacja PKWiU / opis wykonanej usługi">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="np. PKWiU 62.01 — wytwarzanie oprogramowania"
                  />
                )}
              </FormField>
            </div>

            <div className="flex items-end">
              <Button type="submit" disabled={busy || !canWriteEffective} className="w-full">
                {!isRegimeCompatible
                  ? 'Zapis zablokowany — inna forma opodatkowania'
                  : !canWrite
                    ? 'Brak uprawnień do zapisu (read-only)'
                    : 'Zapisz w ewidencji ryczałtu'}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
