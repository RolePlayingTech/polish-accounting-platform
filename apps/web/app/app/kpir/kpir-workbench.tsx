'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  sumGrosze,
  type KpirColumnLayout,
  type KpirEntry,
  type KpirPeriodSummary,
} from '@pap/domain';
import {
  Card,
  FieldHelpButton,
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

export interface KpirEntryRowView {
  readonly entry: KpirEntry;
  readonly basis: LegalBasisInfo;
}

export interface KpirWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  period: string;
  canWrite: boolean;
  rows: readonly KpirEntryRowView[];
  summary: KpirPeriodSummary;
  layout2026: KpirColumnLayout;
  layout2019: KpirColumnLayout;
  pitSkalaDueGrosze: number;
  pitSkalaBasis: LegalBasisInfo;
  pitLiniowyDueGrosze: number;
  pitLiniowyBasis: LegalBasisInfo;
  helpMap: {
    readonly ksefReference: FieldHelpInfo;
    readonly col7: FieldHelpInfo;
    readonly col13: FieldHelpInfo;
  };
}

export function KpirWorkbench({
  activeCompany,
  canWrite,
  helpMap,
  layout2019,
  layout2026,
  period,
  pitLiniowyBasis,
  pitLiniowyDueGrosze,
  pitSkalaBasis,
  pitSkalaDueGrosze,
  rows,
  summary,
}: KpirWorkbenchProps) {
  const router = useRouter();
  const [layoutMode, setLayoutMode] = useState<'2026' | '2019'>('2026');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(rows[0]?.entry.id ?? null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  // Formularz ręcznego wpisu KPiR
  const [eventDate, setEventDate] = useState(`${period}-21`);
  const [docNumber, setDocNumber] = useState(`DW/${period}/09`);
  const [ksefRef, setKsefRef] = useState('5250001003-20261021-AABBCC112233-09');
  const [counterpartyName, setCounterpartyName] = useState(
    'Usługi Hostingowe Syntetyka Sp. z o.o.',
  );
  const [counterpartyNip, setCounterpartyNip] = useState('5213004125');
  const [eventDesc, setEventDesc] = useState('Serwery dedykowane do projektów klientów');
  const [salesPln, setSalesPln] = useState('0.00');
  const [expensesPln, setExpensesPln] = useState('650.00');

  // Formularz czerwonego storna
  const [stornoTargetId, setStornoTargetId] = useState(rows[0]?.entry.id ?? '');
  const [stornoReason, setStornoReason] = useState('Omyłka pisarska w kwocie dowodu wewnętrznego');

  const activeLayout = layoutMode === '2026' ? layout2026 : layout2019;
  const selectedRow = rows.find((r) => r.entry.id === selectedRowId) ?? rows[0] ?? null;

  async function switchToDemoKpir() {
    setBusy(true);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoCompanyCode: 'demo_jdg_kpir_alfa' }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function postKpirMutation(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; entryId?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Błąd zapisu KPiR (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Sprawdź poprawność wprowadzonych danych.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Zaktualizowano Podatkową Księgę Przychodów i Rozchodów',
          detail: okMessage,
        });
        if (data.entryId) {
          setSelectedRowId(data.entryId);
        }
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly LedgerColumn<KpirEntryRowView>[] = [
    {
      id: 'lp',
      header: `Kol. ${String(activeLayout.ordinalCol)} · Lp.`,
      numeric: true,
      mobileRole: 'meta',
      render: ({ entry }) => (
        <span className="font-mono text-xs font-semibold tabular-nums text-[#191c1a]">
          {String(entry.ordinalNumber)}
        </span>
      ),
    },
    ...(layoutMode === '2026'
      ? ([
          {
            id: 'ksef_col',
            header: `Kol. ${String(activeLayout.ksefReferenceCol ?? 3)} · Nr KSeF`,
            mobileRole: 'meta',
            render: ({ entry }: KpirEntryRowView) =>
              entry.ksefReferenceNumber ? (
                <span className="font-mono text-[11px] tabular-nums text-[#1d5c42]">
                  {entry.ksefReferenceNumber}
                </span>
              ) : (
                <span className="text-xs text-[#636b66]">— (poza KSeF)</span>
              ),
          },
        ] satisfies LedgerColumn<KpirEntryRowView>[])
      : []),
    {
      id: 'date_doc',
      header:
        layoutMode === '2026'
          ? `Kol. ${String(activeLayout.eventDateCol)} i ${String(activeLayout.documentNumberCol)} · Data i nr dowodu`
          : `Kol. ${String(activeLayout.eventDateCol)}–${String(activeLayout.documentNumberCol)} · Data i nr dowodu`,
      mobileRole: 'title',
      render: ({ entry }) => (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-[#191c1a]">
              {entry.documentNumber}
            </span>
            {entry.isCorrection ? (
              <StatusBadge size="sm" tone="danger" label="Storno (korekta)" />
            ) : null}
          </div>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">{entry.eventDate}</p>
        </div>
      ),
    },
    ...(layoutMode === '2026'
      ? ([
          {
            id: 'nip_col',
            header: `Kol. ${String(activeLayout.counterpartyNipCol ?? 5)} · NIP`,
            mobileRole: 'meta',
            render: ({ entry }: KpirEntryRowView) => (
              <span className="font-mono text-xs tabular-nums text-[#464c48]">
                {entry.counterpartyNip ? formatNip(entry.counterpartyNip) : '—'}
              </span>
            ),
          },
        ] satisfies LedgerColumn<KpirEntryRowView>[])
      : []),
    {
      id: 'counterparty_desc',
      header:
        layoutMode === '2026'
          ? 'Kol. 6–8 · Kontrahent i zdarzenie'
          : 'Kol. 4–6 · Kontrahent i opis',
      mobileRole: 'meta',
      render: ({ entry }) => (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-[#191c1a]">{entry.counterpartyName}</p>
          <p className="text-xs text-[#464c48]">{entry.eventDescription}</p>
        </div>
      ),
    },
    {
      id: 'rev_total',
      header: `Kol. ${String(activeLayout.totalRevenueCol)} · Razem przychód`,
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: ({ entry }) => (
        <MoneyAmount
          amount={entry.col9TotalRevenueGrosze}
          inGrosze
          size="sm"
          variant={entry.col9TotalRevenueGrosze > 0 ? 'income' : 'neutral'}
        />
      ),
      footer: (
        <MoneyAmount
          amount={summary.monthTotals.col9TotalRevenueGrosze}
          inGrosze
          size="sm"
          variant="income"
        />
      ),
    },
    {
      id: 'other_expenses_col',
      header: `Kol. ${String(activeLayout.otherExpensesCol)} · Pozostałe wydatki`,
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: ({ entry }) => (
        <MoneyAmount
          amount={entry.col13OtherExpensesGrosze}
          inGrosze
          size="sm"
          variant={entry.isCorrection ? 'overdue' : 'expense'}
        />
      ),
      footer: (
        <MoneyAmount
          amount={summary.monthTotals.col13OtherExpensesGrosze}
          inGrosze
          size="sm"
          variant="expense"
        />
      ),
    },
    {
      id: 'cost_total',
      header:
        layoutMode === '2026'
          ? 'Łącznie koszty KUP (Kol. 12+13+16)'
          : 'Łącznie koszty KUP (Kol. 10+11+14)',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: ({ entry }) => (
        <MoneyAmount
          amount={sumGrosze([
            entry.col10GoodsAndMaterialsGrosze,
            entry.col11IncidentalCostsGrosze,
            entry.col14TotalExpensesGrosze,
          ])}
          inGrosze
          size="sm"
          variant={entry.isCorrection ? 'overdue' : 'expense'}
        />
      ),
      footer: (
        <MoneyAmount
          amount={summary.monthTotals.totalTaxDeductibleCostsGrosze}
          inGrosze
          size="sm"
          variant="expense"
        />
      ),
    },
    {
      id: 'why_col',
      header: 'Wyjaśnienie „Dlaczego?”',
      mobileRole: 'status',
      render: ({ entry }) => {
        const isSelected = selectedRow?.entry.id === entry.id;
        return (
          <Button
            size="sm"
            variant={isSelected ? 'primary' : 'secondary'}
            onClick={() => setSelectedRowId(entry.id)}
          >
            § Dlaczego?
          </Button>
        );
      },
    },
  ];

  const isNonKpirCompany =
    activeCompany.profileCode !== 'jdg_kpir_skala' &&
    activeCompany.profileCode !== 'jdg_kpir_liniowy';

  return (
    <div className="space-y-6">
      {isNonKpirCompany ? (
        <AlertBanner
          tone="info"
          title={`Aktywna firma (${activeCompany.shortName}) rozlicza się w innym reżimie (${activeCompany.profileLabelPl})`}
          actions={
            <Button size="sm" disabled={busy} onClick={() => void switchToDemoKpir()}>
              Przełącz na JDG KPiR (Pracownia Projektowa)
            </Button>
          }
        >
          Możesz jednym kliknięciem przełączyć aktywny kontekst na syntetyczną firmę{' '}
          <strong>Pracownia Projektowa Jan Testowy</strong>, aby zobaczyć wypełnioną KPiR 2026 z
          numerami KSeF i kosztami 75% KUP.
        </AlertBanner>
      ) : null}

      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <Card
        as="div"
        eyebrow="Rozporządzenie Ministra Finansów · PKPiR"
        title="Przełącznik struktury kolumn KPiR (2026 vs 2019)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={layoutMode === '2026' ? 'primary' : 'secondary'}
              onClick={() => setLayoutMode('2026')}
            >
              2026 — 19 kolumn z nr KSeF (Dz.U. 2025 poz. 1299)
            </Button>
            <Button
              size="sm"
              variant={layoutMode === '2019' ? 'primary' : 'secondary'}
              onClick={() => setLayoutMode('2019')}
            >
              2019 — 17 kolumn (układ historyczny)
            </Button>
          </div>
        }
      >
        <p className="text-xs text-[#464c48]">
          Aktywny wzór:{' '}
          <strong className="text-[#191c1a]">
            {layoutMode === '2026'
              ? 'Rozporządzenie MF (Dz.U. 2025 poz. 1299 — wzór 19 kolumn z nr KSeF w Kol. 3 i pozostałymi wydatkami w Kol. 15)'
              : 'Rozporządzenie MF (Dz.U. 2019 poz. 2544 — historyczny wzór 17 kolumn z pozostałymi wydatkami w Kol. 13)'}
          </strong>{' '}
          · łączna liczba kolumn urzędowych:{' '}
          <span className="font-mono font-semibold tabular-nums">
            {String(activeLayout.totalColumns)}
          </span>
          .
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {activeLayout.columns.map((col) => (
            <span
              key={col.columnNumber}
              className="rounded border border-[#e5e2d9] bg-[#faf9f5] px-2 py-0.5 font-mono text-[11px] text-[#464c48]"
            >
              {String(col.columnNumber)}. {col.label}
            </span>
          ))}
        </div>
      </Card>

      <div data-testid="kpir-ledger-table">
        <LedgerTable
          caption={`Podatkowa Księga Przychodów i Rozchodów za okres ${period} (${activeLayout.regulationVersion})`}
          title={`Zapisy w KPiR (${layoutMode === '2026' ? '19 kolumn z KSeF' : '17 kolumn'})`}
          subtitle="Kliknij przycisk „§ Dlaczego?” w dowolnym wierszu, aby otworzyć pełną podstawę prawną i ścieżkę kwalifikacji kwoty."
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.entry.id}
        />
      </div>

      {selectedRow ? (
        <Card
          as="div"
          tone="legal"
          eyebrow={`Wybrany zapis KPiR · Lp. ${String(selectedRow.entry.ordinalNumber)} (${selectedRow.entry.documentNumber})`}
          title="Dlaczego? / Podstawa prawna wybranego wiersza KPiR"
        >
          <LegalBasisPanel basis={selectedRow.basis} />
        </Card>
      ) : null}

      <div data-testid="pit-advance-calculation-trace" className="grid gap-6 lg:grid-cols-2">
        <Card
          as="div"
          eyebrow={`Symulacja zaliczki PIT za ${period} · wariant A`}
          title="Skala podatkowa (12% / 32%, kwota wolna 30 000 PLN)"
          actions={<MoneyAmount amount={pitSkalaDueGrosze} inGrosze size="md" variant="tax" />}
        >
          <LegalBasisPanel basis={pitSkalaBasis} />
        </Card>

        <Card
          as="div"
          eyebrow={`Symulacja zaliczki PIT za ${period} · wariant B`}
          title="Podatek liniowy (19% art. 30c ustawy o PIT)"
          actions={<MoneyAmount amount={pitLiniowyDueGrosze} inGrosze size="md" variant="tax" />}
        >
          <LegalBasisPanel basis={pitLiniowyBasis} />
        </Card>
      </div>

      <div data-testid="kpir-annual-inventory-summary" className="grid gap-6 lg:grid-cols-2">
        <Card
          as="div"
          eyebrow="Nowy zapis w księdze"
          title="Dodaj ręczny wpis do KPiR"
          actions={
            <div className="flex items-center gap-1">
              <FieldHelpButton help={helpMap.col7} />
              <FieldHelpButton help={helpMap.col13} />
            </div>
          }
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void postKpirMutation(
                {
                  action: 'add_kpir_entry',
                  eventDate,
                  documentNumber: docNumber,
                  ksefReferenceNumber: ksefRef,
                  counterpartyName,
                  counterpartyNip,
                  counterpartyAddress: 'Polska',
                  eventDescription: eventDesc,
                  salesPln,
                  otherExpensesPln: expensesPln,
                },
                `Dopisano pozycję KPiR (${docNumber}) wraz z numerem KSeF.`,
              );
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="kpir-event-date" label="Data zdarzenia (Kol. 2)">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className={`${ctrl.className} font-mono tabular-nums`}
                  />
                )}
              </FormField>
              <FormField
                id="kpir-doc-num"
                label={`Nr dowodu księgowego (Kol. ${String(activeLayout.documentNumberCol)})`}
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                  />
                )}
              </FormField>
            </div>

            <FormField
              id="kpir-ksef-ref"
              label="Numer KSeF (Kol. 3 we wzorze 2026)"
              fieldHelp={helpMap.ksefReference}
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={ksefRef}
                  onChange={(e) => setKsefRef(e.target.value)}
                  className={`${ctrl.className} font-mono text-xs tabular-nums`}
                />
              )}
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="kpir-cp-name" label="Kontrahent">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                  />
                )}
              </FormField>
              <FormField id="kpir-cp-nip" label="NIP kontrahenta (Kol. 5 we wzorze 2026)">
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
            </div>

            <FormField id="kpir-desc" label="Opis zdarzenia gospodarczego">
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                />
              )}
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput
                id="kpir-sales-pln"
                label={`Przychód ze sprzedaży (Kol. ${String(activeLayout.salesRevenueCol)})`}
                value={salesPln}
                onChange={setSalesPln}
                fieldHelp={helpMap.col7}
              />
              <MoneyInput
                id="kpir-exp-pln"
                label={`Pozostałe wydatki (Kol. ${String(activeLayout.otherExpensesCol)})`}
                value={expensesPln}
                onChange={setExpensesPln}
                fieldHelp={helpMap.col13}
              />
            </div>

            <Button type="submit" disabled={busy || !canWrite}>
              Zapisz pozycję w KPiR
            </Button>
          </form>
        </Card>

        <Card
          as="div"
          eyebrow="Korekta zapisu księgowego bez wymazywania historii"
          title="Utwórz czerwone storno / zapis korygujący"
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void postKpirMutation(
                {
                  action: 'storno_kpir_entry',
                  targetEntryId: stornoTargetId,
                  correctionDate: `${period}-26`,
                  correctionDocumentNumber: `STORNO/${period}`,
                  correctionReason: stornoReason,
                },
                'Zaksięgowano czerwone storno ze znakiem ujemnym i zachowano oryginalny wpis.',
              );
            }}
          >
            <FormField id="storno-target" label="Wybierz korygowany wpis KPiR">
              {(ctrl) => (
                <select
                  {...ctrl}
                  value={stornoTargetId}
                  onChange={(e) => setStornoTargetId(e.target.value)}
                >
                  {rows.map(({ entry }) => (
                    <option key={entry.id} value={entry.id}>
                      Lp. {String(entry.ordinalNumber)} · {entry.documentNumber} (
                      {entry.counterpartyName})
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField id="storno-reason" label="Przyczyna storna / korekty (do dziennika audytu)">
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={stornoReason}
                  onChange={(e) => setStornoReason(e.target.value)}
                />
              )}
            </FormField>

            <Button
              type="submit"
              variant="danger"
              disabled={busy || !canWrite || rows.length === 0}
            >
              Zaksięguj czerwone storno
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
