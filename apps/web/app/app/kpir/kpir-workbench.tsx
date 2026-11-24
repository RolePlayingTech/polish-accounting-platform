'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  parsePlnToGrosze,
  sumGrosze,
  validatePolishNip,
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
import { IncompatibleRegimeGateCard } from '../../../components/regime-context-card';
import { AlertBanner, Button, MoneyInput } from '../../../components/ui-controls';
import { formatUserFacingErrorPl, isValidIsoCalendarDate } from '../../../lib/error-messages-pl';
import type { CompanyProfileRecord } from '../../../lib/workspace-types';

export interface KpirEntryRowView {
  readonly entry: KpirEntry;
  readonly basis: LegalBasisInfo;
}

export interface KpirWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  accessibleCompanies?: readonly CompanyProfileRecord[];
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
  accessibleCompanies = [],
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isKpirCompany =
    activeCompany.profileCode === 'jdg_kpir_skala' ||
    activeCompany.profileCode === 'jdg_kpir_liniowy';
  const canWriteEffective = canWrite && isKpirCompany;

  // Formularz ręcznego wpisu KPiR — bez fikcyjnego domyślnego NrKSeF (#115) i bez cichych danych (#102)
  const [eventDate, setEventDate] = useState(`${period}-21`);
  const [docNumber, setDocNumber] = useState('');
  const [ksefRef, setKsefRef] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyNip, setCounterpartyNip] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [salesPln, setSalesPln] = useState('0.00');
  const [expensesPln, setExpensesPln] = useState('');

  // Formularz czerwonego storna
  const [stornoTargetId, setStornoTargetId] = useState(rows[0]?.entry.id ?? '');
  const [stornoReason, setStornoReason] = useState('');

  const activeLayout = layoutMode === '2026' ? layout2026 : layout2019;
  const selectedRow = rows.find((r) => r.entry.id === selectedRowId) ?? rows[0] ?? null;

  function fillDemoKpirExpense() {
    setEventDate(`${period}-21`);
    setDocNumber(`DW-DEMO/${period}/09`);
    setKsefRef('');
    setCounterpartyName('Usługi Hostingowe Syntetyka Sp. z o.o. [DEMO]');
    setCounterpartyNip('5213004125');
    setEventDesc('[DEMO] Serwery dedykowane do projektów klientów');
    setSalesPln('0.00');
    setExpensesPln('650.00');
    setFieldErrors({});
  }

  function validateEntryForm(): boolean {
    const nextErrors: Record<string, string> = {};
    let firstId: string | null = null;
    const mark = (k: string, id: string, msg: string) => {
      if (!nextErrors[k]) {
        nextErrors[k] = msg;
        if (!firstId) firstId = id;
      }
    };

    if (!isValidIsoCalendarDate(eventDate)) {
      mark(
        'eventDate',
        'kpir-event-date',
        `Wskaż poprawną datę zdarzenia gospodarczego w formacie RRRR-MM-DD (np. ${period}-21).`,
      );
    }
    if (!docNumber.trim()) {
      mark('docNumber', 'kpir-doc-num', `Podaj numer dowodu księgowego (np. DW/${period}/01).`);
    }
    if (counterpartyName.trim().length < 2) {
      mark('counterpartyName', 'kpir-cp-name', 'Podaj nazwę kontrahenta lub wystawcy dowodu.');
    }
    if (counterpartyNip.trim().length > 0) {
      const nipCheck = validatePolishNip(counterpartyNip);
      if (!nipCheck.valid) {
        mark(
          'counterpartyNip',
          'kpir-cp-nip',
          nipCheck.reason ?? 'Podaj poprawny 10-cyfrowy NIP albo pozostaw puste dla braku NIP.',
        );
      }
    }
    if (eventDesc.trim().length < 3) {
      mark(
        'eventDesc',
        'kpir-desc',
        'Opisz zwięźle zdarzenie gospodarcze (np. „Zakup licencji oprogramowania”).',
      );
    }

    let salesG = 0;
    let expG = 0;
    try {
      salesG = parsePlnToGrosze(salesPln.trim() || '0.00');
    } catch {
      mark('salesPln', 'kpir-sales-pln', 'Wpisz poprawną kwotę przychodu PLN (np. 0.00).');
    }
    try {
      expG = parsePlnToGrosze(expensesPln.trim() || '0.00');
    } catch {
      mark('expensesPln', 'kpir-exp-pln', 'Wpisz poprawną kwotę wydatku PLN (np. 650.00).');
    }
    if (!nextErrors['salesPln'] && !nextErrors['expensesPln'] && salesG <= 0 && expG <= 0) {
      mark(
        'expensesPln',
        'kpir-exp-pln',
        'Podaj dodatnią kwotę przychodu albo pozostałych wydatków (co najmniej jedna wartość > 0,00 PLN).',
      );
    }

    setFieldErrors(nextErrors);
    if (firstId) {
      window.document.getElementById(firstId)?.focus();
      return false;
    }
    return true;
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
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        entryId?: string;
      };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Błąd zapisu KPiR (HTTP ${String(res.status)})`,
          detail: formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Sprawdź poprawność wprowadzonych danych wpisu KPiR.',
          }),
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
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z warstwą sesji BFF',
        detail: 'Nie udało się zapisać pozycji w KPiR.',
      });
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly LedgerColumn<KpirEntryRowView>[] = [
    {
      id: 'lp',
      header: 'Lp.',
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
                <span className="block max-w-[7rem] break-all font-mono text-[10px] leading-tight tabular-nums text-[#1d5c42]">
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
          ? `Kol. ${String(activeLayout.eventDateCol)}, ${String(activeLayout.documentNumberCol)} · Dowód`
          : `Kol. ${String(activeLayout.eventDateCol)}–${String(activeLayout.documentNumberCol)} · Dowód`,
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
              <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[#464c48]">
                {entry.counterpartyNip ? formatNip(entry.counterpartyNip) : '—'}
              </span>
            ),
          },
        ] satisfies LedgerColumn<KpirEntryRowView>[])
      : []),
    {
      id: 'counterparty_desc',
      header: layoutMode === '2026' ? 'Kol. 6–8 · Zdarzenie' : 'Kol. 4–6 · Opis',
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
      header: `Kol. ${String(activeLayout.totalRevenueCol)} · Przychód`,
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
      header: `Kol. ${String(activeLayout.otherExpensesCol)} · Wydatki`,
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
      header: 'Koszty KUP',
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
      header: 'Dlaczego?',
      mobileRole: 'status',
      render: ({ entry }) => {
        const isSelected = selectedRow?.entry.id === entry.id;
        return (
          <Button
            size="sm"
            variant={isSelected ? 'primary' : 'secondary'}
            className="whitespace-nowrap px-2.5 text-[11px]"
            onClick={() => setSelectedRowId(entry.id)}
          >
            § Dlaczego?
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <IncompatibleRegimeGateCard
        activeCompany={activeCompany}
        accessibleCompanies={accessibleCompanies}
        requiredBook="kpir"
      />

      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <Card
        as="div"
        eyebrow="Rozporządzenie Ministra Finansów · PKPiR"
        title="Przełącznik struktury kolumn KPiR (2026 vs 2019)"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
          defaultDensity="compact"
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
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !canWriteEffective}
                onClick={fillDemoKpirExpense}
              >
                [DEMO] Wypełnij przykładem
              </Button>
              <FieldHelpButton help={helpMap.col7} />
              <FieldHelpButton help={helpMap.col13} />
            </div>
          }
        >
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!validateEntryForm()) {
                return;
              }
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
                  salesPln: salesPln.trim() || '0.00',
                  otherExpensesPln: expensesPln.trim() || '0.00',
                },
                `Dopisano pozycję KPiR (${docNumber.trim()}).`,
              );
            }}
          >
            <fieldset disabled={busy || !canWriteEffective} className="space-y-3 border-0 p-0">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id="kpir-event-date"
                  label="Data zdarzenia (Kol. 2)"
                  required
                  {...(fieldErrors['eventDate'] ? { error: fieldErrors['eventDate'] } : {})}
                >
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={eventDate}
                      onChange={(e) => {
                        setEventDate(e.target.value);
                        if (fieldErrors['eventDate']) {
                          setFieldErrors((prev) => ({ ...prev, eventDate: '' }));
                        }
                      }}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
                <FormField
                  id="kpir-doc-num"
                  label={`Nr dowodu księgowego (Kol. ${String(activeLayout.documentNumberCol)})`}
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
                      placeholder={`np. DW/${period}/01`}
                      className={`${ctrl.className} font-mono`}
                    />
                  )}
                </FormField>
              </div>

              <FormField
                id="kpir-ksef-ref"
                label="Numer KSeF (Kol. 3 we wzorze 2026 — opcjonalnie)"
                hint="Wpisz wyłącznie rzeczywisty numer KSeF faktury ustrukturyzowanej. Dla dowodów wewnętrznych i faktur poza KSeF pozostaw puste."
                fieldHelp={helpMap.ksefReference}
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={ksefRef}
                    onChange={(e) => setKsefRef(e.target.value)}
                    placeholder="Pozostaw puste, jeśli dokument nie pochodzi z KSeF"
                    className={`${ctrl.className} font-mono text-xs tabular-nums`}
                  />
                )}
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id="kpir-cp-name"
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
                      placeholder="Nazwa kontrahenta"
                    />
                  )}
                </FormField>
                <FormField
                  id="kpir-cp-nip"
                  label="NIP kontrahenta (Kol. 5 we wzorze 2026)"
                  {...(fieldErrors['counterpartyNip']
                    ? { error: fieldErrors['counterpartyNip'] }
                    : {})}
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
                      placeholder="10 cyfr lub puste"
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
              </div>

              <FormField
                id="kpir-desc"
                label="Opis zdarzenia gospodarczego"
                required
                {...(fieldErrors['eventDesc'] ? { error: fieldErrors['eventDesc'] } : {})}
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={eventDesc}
                    onChange={(e) => {
                      setEventDesc(e.target.value);
                      if (fieldErrors['eventDesc']) {
                        setFieldErrors((prev) => ({ ...prev, eventDesc: '' }));
                      }
                    }}
                    placeholder="Zwięzły opis przychodu lub kosztu uzyskania przychodów"
                  />
                )}
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyInput
                  id="kpir-sales-pln"
                  label={`Przychód ze sprzedaży (Kol. ${String(activeLayout.salesRevenueCol)})`}
                  value={salesPln}
                  onChange={(val) => {
                    setSalesPln(val);
                    if (fieldErrors['salesPln'] || fieldErrors['expensesPln']) {
                      setFieldErrors((prev) => ({ ...prev, salesPln: '', expensesPln: '' }));
                    }
                  }}
                  fieldHelp={helpMap.col7}
                  {...(fieldErrors['salesPln'] ? { error: fieldErrors['salesPln'] } : {})}
                />
                <MoneyInput
                  id="kpir-exp-pln"
                  label={`Pozostałe wydatki (Kol. ${String(activeLayout.otherExpensesCol)})`}
                  value={expensesPln}
                  onChange={(val) => {
                    setExpensesPln(val);
                    if (fieldErrors['expensesPln']) {
                      setFieldErrors((prev) => ({ ...prev, expensesPln: '' }));
                    }
                  }}
                  fieldHelp={helpMap.col13}
                  {...(fieldErrors['expensesPln'] ? { error: fieldErrors['expensesPln'] } : {})}
                />
              </div>

              <Button type="submit" disabled={busy || !canWriteEffective}>
                {!isKpirCompany
                  ? 'Zapis zablokowany — aktywna firma nie prowadzi KPiR'
                  : !canWrite
                    ? 'Tylko odczyt — brak grantu write'
                    : 'Zapisz pozycję w KPiR'}
              </Button>
            </fieldset>
          </form>
        </Card>

        <Card
          as="div"
          eyebrow="Korekta zapisu księgowego bez wymazywania historii"
          title="Utwórz czerwone storno / zapis korygujący"
        >
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!stornoReason.trim()) {
                setFieldErrors((prev) => ({
                  ...prev,
                  stornoReason:
                    'Podaj uzasadnienie storna do dziennika audytu (np. „Omyłka pisarska w kwocie”).',
                }));
                window.document.getElementById('storno-reason')?.focus();
                return;
              }
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
            <fieldset disabled={busy || !canWriteEffective} className="space-y-3 border-0 p-0">
              <FormField id="storno-target" label="Wybierz korygowany wpis KPiR" required>
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

              <FormField
                id="storno-reason"
                label="Przyczyna storna / korekty (do dziennika audytu)"
                required
                {...(fieldErrors['stornoReason'] ? { error: fieldErrors['stornoReason'] } : {})}
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={stornoReason}
                    onChange={(e) => {
                      setStornoReason(e.target.value);
                      if (fieldErrors['stornoReason']) {
                        setFieldErrors((prev) => ({ ...prev, stornoReason: '' }));
                      }
                    }}
                    placeholder="np. Korekta kwoty na podstawie faktury korygującej"
                  />
                )}
              </FormField>

              <Button
                type="submit"
                variant="danger"
                disabled={busy || !canWriteEffective || rows.length === 0}
              >
                {!isKpirCompany
                  ? 'Storno niedostępne — inna forma opodatkowania'
                  : 'Zaksięguj czerwone storno'}
              </Button>
            </fieldset>
          </form>
        </Card>
      </div>
    </div>
  );
}
