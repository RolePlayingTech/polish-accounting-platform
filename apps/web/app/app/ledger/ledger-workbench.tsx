'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  parsePlnToGrosze,
  type JournalEntry,
  type LedgerAccountDefinition,
  type ProfitAndLossReport,
  type SimplifiedBalanceSheet,
  type TrialBalanceAccountRow,
  type TrialBalanceReport,
} from '@pap/domain';
import {
  Card,
  FieldHelpButton,
  FormField,
  LedgerTable,
  LegalBasisPanel,
  MoneyAmount,
  StatusBadge,
  type FieldHelpInfo,
  type LedgerColumn,
  type LegalBasisInfo,
} from '@pap/ui';
import { AlertBanner, Button } from '../../../components/ui-controls';
import type { CompanyProfileRecord } from '../../../lib/workspace-types';

type LedgerTabId = 'journal' | 'chart' | 'trial_balance' | 'statements' | 'cit';

interface DraftVoucherLine {
  accountCode: string;
  side: 'Wn' | 'Ma';
  amountPln: string;
  description: string;
}

export interface LedgerWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  period: string;
  canWrite: boolean;
  chartOfAccounts: readonly LedgerAccountDefinition[];
  journalEntries: readonly JournalEntry[];
  trialBalance: TrialBalanceReport;
  balanceSheet: SimplifiedBalanceSheet;
  profitAndLoss: ProfitAndLossReport;
  cit9DueGrosze: number;
  cit9Basis: LegalBasisInfo;
  cit19DueGrosze: number;
  cit19Basis: LegalBasisInfo;
  helpMap: {
    readonly wnMa: FieldHelpInfo;
    readonly cit9: FieldHelpInfo;
  };
}

export function LedgerWorkbench({
  activeCompany,
  balanceSheet,
  canWrite,
  chartOfAccounts,
  cit19Basis,
  cit19DueGrosze,
  cit9Basis,
  cit9DueGrosze,
  helpMap,
  journalEntries,
  period,
  profitAndLoss,
  trialBalance,
}: LedgerWorkbenchProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LedgerTabId>('journal');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  const [bookingDate, setBookingDate] = useState(`${period}-25`);
  const [documentNumber, setDocumentNumber] = useState(`PK/${period}/04`);
  const [description, setDescription] = useState('Zakup usług chmurowych — dekret wielopozycyjny');
  const [lines, setLines] = useState<DraftVoucherLine[]>([
    { accountCode: '402', side: 'Wn', amountPln: '2000.00', description: 'Usługi obce netto' },
    { accountCode: '221-2', side: 'Wn', amountPln: '460.00', description: 'VAT naliczony 23%' },
    {
      accountCode: '202',
      side: 'Ma',
      amountPln: '2460.00',
      description: 'Zobowiązanie wobec dostawcy',
    },
  ]);

  const balanceCheck = useMemo(() => {
    let wn = 0;
    let ma = 0;
    let validParse = true;
    for (const line of lines) {
      try {
        const g = parsePlnToGrosze(line.amountPln || '0.00');
        if (line.side === 'Wn') wn += g;
        else ma += g;
      } catch {
        validParse = false;
      }
    }
    return {
      wnGrosze: wn,
      maGrosze: ma,
      diffGrosze: wn - ma,
      isBalanced: validParse && wn > 0 && wn === ma && lines.length >= 2,
    };
  }, [lines]);

  async function switchToDemoSpzoo() {
    setBusy(true);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoCompanyCode: 'demo_spzoo_gamma' }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitJournalVoucher(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_journal_entry',
          bookingDate,
          documentNumber,
          description,
          lines,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; entryNumber?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odrzucono dekret księgowy (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Naruszenie zasady podwójnego zapisu Wn = Ma.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: `Zaksięgowano dekret ${data.entryNumber ?? ''} w Dzienniku i Księdze Głównej`,
          detail:
            'Obroty i salda, Bilans oraz RZiS zostały przeliczone z zachowaniem równowagi Aktywa = Pasywa.',
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const chartColumns: readonly LedgerColumn<LedgerAccountDefinition>[] = [
    {
      id: 'code',
      header: 'Symbol konta',
      mobileRole: 'title',
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-[#1d5c42]">{r.code}</span>
      ),
    },
    {
      id: 'name',
      header: 'Nazwa konta księgi głównej',
      mobileRole: 'meta',
      render: (r) => <span className="text-xs font-medium text-[#191c1a]">{r.name}</span>,
    },
    {
      id: 'group',
      header: 'Zespół UoR',
      mobileRole: 'status',
      render: (r) => (
        <StatusBadge size="sm" tone="legal" label={`Zespół ${String(r.classGroup)}`} />
      ),
    },
    {
      id: 'nature',
      header: 'Charakter konta',
      mobileRole: 'meta',
      render: (r) => <span className="font-mono text-xs text-[#464c48]">{r.nature}</span>,
    },
  ];

  const tbColumns: readonly LedgerColumn<TrialBalanceAccountRow>[] = [
    {
      id: 'acc',
      header: 'Konto',
      mobileRole: 'title',
      render: (r) => (
        <div>
          <span className="font-mono text-xs font-semibold text-[#191c1a]">{r.accountCode}</span>{' '}
          <span className="text-xs text-[#464c48]">{r.accountName}</span>
        </div>
      ),
    },
    {
      id: 'turn_wn',
      header: 'Obroty Wn',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (r) => <MoneyAmount amount={r.turnoverWnGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={trialBalance.totalTurnoverWnGrosze} inGrosze size="sm" />,
    },
    {
      id: 'turn_ma',
      header: 'Obroty Ma',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (r) => <MoneyAmount amount={r.turnoverMaGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={trialBalance.totalTurnoverMaGrosze} inGrosze size="sm" />,
    },
    {
      id: 'sal_wn',
      header: 'Saldo końcowe Wn',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (r) => <MoneyAmount amount={r.endingBalanceWnGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={trialBalance.totalEndingBalanceWnGrosze} inGrosze size="sm" />,
    },
    {
      id: 'sal_ma',
      header: 'Saldo końcowe Ma',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (r) => <MoneyAmount amount={r.endingBalanceMaGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={trialBalance.totalEndingBalanceMaGrosze} inGrosze size="sm" />,
    },
  ];

  return (
    <div className="space-y-6">
      {activeCompany.profileCode !== 'spzoo_pelne_ksiegi' ? (
        <AlertBanner
          tone="info"
          title={`Aktywna firma (${activeCompany.shortName}) prowadzi uproszczoną ewidencję JDG`}
          actions={
            <Button size="sm" disabled={busy} onClick={() => void switchToDemoSpzoo()}>
              Przełącz na Syntetyczna Technologia Test Sp. z o.o.
            </Button>
          }
        >
          Pełne księgi rachunkowe wg Ustawy o rachunkowości obowiązują spółki kapitałowe (Sp. z
          o.o.). Kliknij przycisk obok, aby jednym kliknięciem przełączyć aktywną firmę na{' '}
          <strong>Syntetyczna Technologia Test Sp. z o.o.</strong> i zobaczyć kompletny dziennik,
          ZOiS, Bilans, RZiS oraz CIT 9%.
        </AlertBanner>
      ) : null}

      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div
        role="tablist"
        aria-label="Sekcje modułu pełnej księgowości UoR"
        className="flex flex-wrap gap-2 rounded-xl border border-[#e5e2d9] bg-white p-2"
      >
        {(
          [
            { id: 'journal', label: 'Dziennik księgowań (Wn = Ma)' },
            { id: 'chart', label: 'Plan kont (Zespoły 0–8)' },
            { id: 'trial_balance', label: 'Zestawienie obrotów i sald' },
            { id: 'statements', label: 'Bilans i RZiS' },
            { id: 'cit', label: 'Zaliczka CIT (9% / 19%)' },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            size="sm"
            variant={activeTab === tab.id ? 'primary' : 'secondary'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'journal' ? (
        <div className="space-y-6">
          <div data-testid="journal-entry-voucher-editor">
            <Card
              as="div"
              eyebrow="Zasada podwójnego zapisu (art. 15 Ustawy o rachunkowości)"
              title="Wprowadź dekret wielopozycyjny z kontrolą bilansu Wn === Ma na żywo"
              actions={<FieldHelpButton help={helpMap.wnMa} />}
            >
              <form className="space-y-4" onSubmit={(e) => void submitJournalVoucher(e)}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField id="jrn-date" label="Data księgowania">
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="date"
                        value={bookingDate}
                        onChange={(e) => setBookingDate(e.target.value)}
                        className={`${ctrl.className} font-mono tabular-nums`}
                      />
                    )}
                  </FormField>
                  <FormField id="jrn-doc" label="Numer dowodu źródłowego">
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="text"
                        value={documentNumber}
                        onChange={(e) => setDocumentNumber(e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField id="jrn-desc" label="Treść operacji gospodarczej">
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    )}
                  </FormField>
                </div>

                <div className="space-y-2">
                  {lines.map((line, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-2.5 sm:grid-cols-12"
                    >
                      <div className="sm:col-span-4">
                        <label
                          htmlFor={`jrn-acc-${String(index)}`}
                          className="block text-[11px] font-medium text-[#636b66]"
                        >
                          Konto syntetyczne
                        </label>
                        <select
                          id={`jrn-acc-${String(index)}`}
                          value={line.accountCode}
                          onChange={(e) => {
                            const copy = [...lines];
                            copy[index] = { ...line, accountCode: e.target.value };
                            setLines(copy);
                          }}
                          className="mt-0.5 min-h-9 w-full rounded border border-[#858177] bg-white px-2 text-xs"
                        >
                          {chartOfAccounts.map((acc) => (
                            <option key={acc.code} value={acc.code}>
                              {acc.code} — {acc.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          htmlFor={`jrn-side-${String(index)}`}
                          className="block text-[11px] font-medium text-[#636b66]"
                        >
                          Strona
                        </label>
                        <select
                          id={`jrn-side-${String(index)}`}
                          value={line.side}
                          onChange={(e) => {
                            const copy = [...lines];
                            copy[index] = {
                              ...line,
                              side: e.target.value === 'Ma' ? 'Ma' : 'Wn',
                            };
                            setLines(copy);
                          }}
                          className="mt-0.5 min-h-9 w-full rounded border border-[#858177] bg-white px-2 font-mono text-xs font-semibold"
                        >
                          <option value="Wn">Wn (Debet)</option>
                          <option value="Ma">Ma (Kredyt)</option>
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor={`jrn-amt-${String(index)}`}
                          className="block text-[11px] font-medium text-[#636b66]"
                        >
                          Kwota (PLN)
                        </label>
                        <input
                          id={`jrn-amt-${String(index)}`}
                          type="text"
                          value={line.amountPln}
                          onChange={(e) => {
                            const copy = [...lines];
                            copy[index] = { ...line, amountPln: e.target.value };
                            setLines(copy);
                          }}
                          className="mt-0.5 min-h-9 w-full rounded border border-[#858177] bg-white px-2 text-right font-mono text-xs tabular-nums"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor={`jrn-ldesc-${String(index)}`}
                          className="block text-[11px] font-medium text-[#636b66]"
                        >
                          Opis pozycji
                        </label>
                        <input
                          id={`jrn-ldesc-${String(index)}`}
                          type="text"
                          value={line.description}
                          onChange={(e) => {
                            const copy = [...lines];
                            copy[index] = { ...line, description: e.target.value };
                            setLines(copy);
                          }}
                          className="mt-0.5 min-h-9 w-full rounded border border-[#858177] bg-white px-2 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span>
                      Suma Wn: <MoneyAmount amount={balanceCheck.wnGrosze} inGrosze size="sm" />
                    </span>
                    <span>
                      Suma Ma: <MoneyAmount amount={balanceCheck.maGrosze} inGrosze size="sm" />
                    </span>
                    <StatusBadge
                      size="sm"
                      tone={balanceCheck.isBalanced ? 'success' : 'danger'}
                      label={
                        balanceCheck.isBalanced
                          ? 'Bilans zgodny (Wn === Ma)'
                          : `Niezbilansowany dekret (różnica ${(balanceCheck.diffGrosze / 100).toFixed(2)} PLN)`
                      }
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setLines([
                          ...lines,
                          {
                            accountCode: '130',
                            side: 'Ma',
                            amountPln: '0.00',
                            description: 'Dodatkowa linia dekretu',
                          },
                        ])
                      }
                    >
                      + Dodaj wiersz dekretu
                    </Button>
                    <Button
                      size="sm"
                      type="submit"
                      disabled={busy || !canWrite || !balanceCheck.isBalanced}
                    >
                      Zaksięguj dekret w Dzienniku
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>

          <Card as="div" eyebrow="Chronologiczny rejestr dekretów" title="Dziennik księgowań (UoR)">
            <div className="space-y-3">
              {journalEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e2d9] pb-2">
                    <div>
                      <span className="font-mono text-xs font-semibold text-[#1d5c42]">
                        {entry.entryNumber}
                      </span>{' '}
                      <span className="text-xs font-semibold text-[#191c1a]">
                        · {entry.documentNumber} — {entry.description}
                      </span>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-[#636b66]">
                      Data: {entry.bookingDate} · Wn = Ma ={' '}
                      <MoneyAmount amount={entry.totalWnGrosze} inGrosze size="sm" />
                    </span>
                  </div>
                  <div className="mt-2 divide-y divide-[#e5e2d9] text-xs">
                    {entry.lines.map((l) => (
                      <div
                        key={l.lineNumber}
                        className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                      >
                        <span>
                          <strong className="font-mono">{l.side}</strong> konto{' '}
                          <code className="font-mono font-semibold">{l.accountCode}</code> —{' '}
                          {l.description}
                        </span>
                        <MoneyAmount amount={l.amountGrosze} inGrosze size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'chart' ? (
        <div data-testid="chart-of-accounts-tree">
          <LedgerTable
            caption="Wzorcowy plan kont spółki z o.o. (Zespoły 0–8 wg Ustawy o rachunkowości)"
            title="Plan kont księgi głównej (Zespoły 0, 1, 2, 3, 4, 7, 8)"
            columns={chartColumns}
            rows={chartOfAccounts}
            getRowKey={(r) => r.code}
          />
        </div>
      ) : null}

      {activeTab === 'trial_balance' ? (
        <LedgerTable
          caption="Zestawienie obrotów i sald księgi głównej (art. 18 ust. 1 UoR)"
          title="Zestawienie Obrotów i Sald (ZOiS)"
          subtitle={
            trialBalance.isBalanced
              ? 'Obroty Wn === Obroty Ma oraz Salda końcowe Wn === Salda końcowe Ma.'
              : 'Wykryto niezgodność obrotów!'
          }
          columns={tbColumns}
          rows={trialBalance.rows}
          getRowKey={(r) => r.accountCode}
        />
      ) : null}

      {activeTab === 'statements' ? (
        <div data-testid="balance-sheet-and-pnl-report" className="grid gap-6 lg:grid-cols-2">
          <Card
            as="div"
            eyebrow="Uproszczony Bilans (Załącznik nr 1 / nr 4 UoR)"
            title="Aktywa i Pasywa"
            actions={
              <StatusBadge
                size="sm"
                tone={balanceSheet.isBalanced ? 'success' : 'danger'}
                label={balanceSheet.isBalanced ? 'Aktywa === Pasywa' : 'Niezbilansowany'}
              />
            }
          >
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">A. Aktywa trwałe netto (Zespół 0)</dt>
                <dd>
                  <MoneyAmount amount={balanceSheet.fixedAssetsNetGrosze} inGrosze size="sm" />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">
                  B. Aktywa obrotowe (środki pieniężne, należności, zapasy)
                </dt>
                <dd>
                  <MoneyAmount amount={balanceSheet.currentAssetsGrosze} inGrosze size="sm" />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#858177] pb-2 font-semibold">
                <dt>RAZEM AKTYWA</dt>
                <dd>
                  <MoneyAmount amount={balanceSheet.totalAssetsGrosze} inGrosze size="md" />
                </dd>
              </div>

              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5 pt-2">
                <dt className="text-[#464c48]">
                  A. Kapitał (fundusz) własny (z wynikiem bieżącym)
                </dt>
                <dd>
                  <MoneyAmount amount={balanceSheet.totalEquityGrosze} inGrosze size="sm" />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">B. Zobowiązania i rezerwy na zobowiązania</dt>
                <dd>
                  <MoneyAmount amount={balanceSheet.totalLiabilitiesGrosze} inGrosze size="sm" />
                </dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>RAZEM PASYWA</dt>
                <dd>
                  <MoneyAmount
                    amount={balanceSheet.totalEquityAndLiabilitiesGrosze}
                    inGrosze
                    size="md"
                  />
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            as="div"
            eyebrow="Wariant porównawczy UoR (Zespoły 4, 7 i konto 870)"
            title="Rachunek Zysków i Strat (RZiS)"
          >
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">
                  A. Przychody netto ze sprzedaży i finansowe (Zespół 7)
                </dt>
                <dd>
                  <MoneyAmount
                    amount={profitAndLoss.totalRevenuesGrosze}
                    inGrosze
                    size="sm"
                    variant="income"
                  />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">
                  B. Koszty działalności operacyjnej i finansowe (Zespół 4 / 7)
                </dt>
                <dd>
                  <MoneyAmount
                    amount={profitAndLoss.totalOperatingAndFinancialExpensesGrosze}
                    inGrosze
                    size="sm"
                    variant="expense"
                  />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5 font-medium">
                <dt>Zysk (strata) brutto</dt>
                <dd>
                  <MoneyAmount amount={profitAndLoss.grossProfitOrLossGrosze} inGrosze size="sm" />
                </dd>
              </div>
              <div className="flex justify-between border-b border-[#e5e2d9] pb-1.5">
                <dt className="text-[#464c48]">Podatek dochodowy zaksięgowany (konto 870)</dt>
                <dd>
                  <MoneyAmount
                    amount={profitAndLoss.citTaxBookedGrosze}
                    inGrosze
                    size="sm"
                    variant="tax"
                  />
                </dd>
              </div>
              <div className="flex justify-between pt-1 font-semibold">
                <dt>Zysk (strata) netto okresu</dt>
                <dd>
                  <MoneyAmount
                    amount={profitAndLoss.netProfitOrLossGrosze}
                    inGrosze
                    size="md"
                    variant="income"
                  />
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      ) : null}

      {activeTab === 'cit' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            as="div"
            eyebrow="Art. 19 ust. 1 pkt 2 ustawy o CIT"
            title="Zaliczka CIT 9% (mały podatnik do 2 000 000 EUR)"
            actions={
              <div className="flex items-center gap-2">
                <MoneyAmount amount={cit9DueGrosze} inGrosze size="md" variant="tax" />
                <FieldHelpButton help={helpMap.cit9} />
              </div>
            }
          >
            <LegalBasisPanel basis={cit9Basis} />
          </Card>

          <Card
            as="div"
            eyebrow="Art. 19 ust. 1 pkt 1 ustawy o CIT"
            title="Zaliczka CIT 19% (stawka podstawowa)"
            actions={<MoneyAmount amount={cit19DueGrosze} inGrosze size="md" variant="tax" />}
          >
            <LegalBasisPanel basis={cit19Basis} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
