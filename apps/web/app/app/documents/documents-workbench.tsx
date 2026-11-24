'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  calculateInvoiceLineFromNet,
  formatPlnFromGrosze,
  parsePlnToGrosze,
  validatePolishNip,
  type KpirExpenseQualificationKind,
  type RyczaltRateCode,
  type VatDeductionMode,
  type VatRateCode,
} from '@pap/domain';
import {
  Card,
  FieldHelpButton,
  FormField,
  LedgerTable,
  MoneyAmount,
  StatusBadge,
  formatNip,
  type FieldHelpInfo,
  type LedgerColumn,
} from '@pap/ui';
import {
  PurchaseQualificationHelpNotice,
  RyczaltRateGuideTrigger,
  VatRateGuideTrigger,
} from '../../../components/tax-guide-drawer';
import { AlertBanner, Button, MoneyInput, NipInput } from '../../../components/ui-controls';
import { formatUserFacingErrorPl, isValidIsoCalendarDate } from '../../../lib/error-messages-pl';
import {
  CANONICAL_DOCUMENT_CSV_HEADERS,
  buildEmptyDocumentCsvTemplate,
  buildSampleDocumentJson,
  buildSampleMultiRateDocumentCsv,
  buildSampleSingleRateDocumentCsv,
} from '../../../lib/sample-import-templates';
import {
  SAMPLE_KSEF_FA3_XML,
  type CompanyProfileRecord,
  type DocumentKind,
  type DocumentWorkflowStatus,
  type WorkspaceDocumentRecord,
} from '../../../lib/workspace-types';

const STATUS_META: Record<
  DocumentWorkflowStatus,
  { readonly label: string; readonly tone: 'neutral' | 'warning' | 'success' | 'info' }
> = {
  draft: { label: 'Szkic', tone: 'neutral' },
  ai_proposal: { label: 'Propozycja do zatwierdzenia przez człowieka', tone: 'warning' },
  approved_posted: { label: 'Zweryfikowany i zaksięgowany', tone: 'success' },
  archived: { label: 'Zarchiwizowany', tone: 'info' },
};

interface EditableInvoiceLineState {
  readonly id: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly netPln: string;
  readonly vatRate: VatRateCode;
  readonly annex15Item: boolean;
}

function createBlankLine(id: string, defaultVatRate: VatRateCode): EditableInvoiceLineState {
  return {
    id,
    description: '',
    quantity: '1',
    unit: 'usł.',
    netPln: '',
    vatRate: defaultVatRate,
    annex15Item: false,
  };
}

function formatVatRateBadge(rate: VatRateCode): string {
  return rate === 'zw' ? 'zw.' : rate === 'np' ? 'np.' : `${rate}%`;
}

export interface DocumentsWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  documents: readonly WorkspaceDocumentRecord[];
  period: string;
  canWrite: boolean;
  helpMap: {
    readonly nip: FieldHelpInfo;
    readonly ksefReference: FieldHelpInfo;
    readonly gtuCode: FieldHelpInfo;
    readonly mpp: FieldHelpInfo;
  };
}

export function DocumentsWorkbench({
  activeCompany,
  canWrite,
  documents,
  helpMap,
  period,
}: DocumentsWorkbenchProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DocumentWorkflowStatus>('all');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger' | 'warning';
    title: string;
    detail: string;
    createdId?: string;
  } | null>(null);

  // Import XML FA(3) / CSV / JSON (#114)
  const [importFormat, setImportFormat] = useState<'fa3_xml' | 'csv' | 'json'>('fa3_xml');
  const [rawImport, setRawImport] = useState(SAMPLE_KSEF_FA3_XML);

  // Edytowalny, wielopozycyjny formularz faktury / korekty (#102, #115, #103, #105)
  const defaultVatRate: VatRateCode = activeCompany.vatStatus === 'czynny' ? '23' : 'zw';
  const [docKind, setDocKind] = useState<DocumentKind>('purchase');
  const [direction, setDirection] = useState<'sales' | 'purchase'>('purchase');
  const [docNumber, setDocNumber] = useState('');
  const [issueDate, setIssueDate] = useState(`${period}-18`);
  const [saleDate, setSaleDate] = useState(`${period}-18`);
  const [dueDate, setDueDate] = useState(`${period}-28`);
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyNip, setCounterpartyNip] = useState('');
  const [noPolishNip, setNoPolishNip] = useState(false);
  const [counterpartyAddress, setCounterpartyAddress] = useState('');
  const [correctedDocumentNumber, setCorrectedDocumentNumber] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  // Uczciwy domyślny status KSeF (#115): poza KSeF / nieprzesłano (BFK), zero fikcyjnego NrKSeF
  const [ksefMarker, setKsefMarker] = useState<'NrKSeF' | 'OFF' | 'BFK' | 'DI'>('BFK');
  const [ksefRef, setKsefRef] = useState('');

  // Kwalifikacja zakupu lub ryczałtu (#103)
  const [expenseQualification, setExpenseQualification] = useState<KpirExpenseQualificationKind>(
    'other_expenses_100_col13',
  );
  const [vatDeductionMode, setVatDeductionMode] = useState<VatDeductionMode>(
    activeCompany.vatStatus === 'czynny' ? 'full_100' : 'none_0',
  );
  const [ryczaltRate, setRyczaltRate] = useState<RyczaltRateCode>('12');

  const [lines, setLines] = useState<readonly EditableInvoiceLineState[]>(() => [
    createBlankLine('line-1', defaultVatRate),
  ]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (statusFilter !== 'all' && doc.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        doc.documentNumber.toLowerCase().includes(q) ||
        doc.counterpartyName.toLowerCase().includes(q) ||
        doc.counterpartyNip.includes(q) ||
        doc.description.toLowerCase().includes(q) ||
        (doc.ksefReferenceNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [documents, searchQuery, statusFilter]);

  const liveSummary = useMemo(() => {
    const isCorrection = docKind === 'correction';
    const computedLines = lines.map((line) => {
      let netGrosze = 0;
      let parseOk = false;
      if (line.netPln.trim().length > 0) {
        try {
          netGrosze = parsePlnToGrosze(line.netPln);
          if (isCorrection && netGrosze > 0) {
            netGrosze = -netGrosze;
          }
          parseOk = true;
        } catch {
          parseOk = false;
        }
      }
      const calc = calculateInvoiceLineFromNet(netGrosze, line.vatRate);
      return {
        ...line,
        parseOk,
        netGrosze: calc.netGrosze,
        vatGrosze: calc.vatGrosze,
        grossGrosze: calc.grossGrosze,
      };
    });

    const byRate = new Map<
      VatRateCode,
      { netGrosze: number; vatGrosze: number; grossGrosze: number }
    >();
    for (const item of computedLines) {
      const prev = byRate.get(item.vatRate) ?? { netGrosze: 0, vatGrosze: 0, grossGrosze: 0 };
      byRate.set(item.vatRate, {
        netGrosze: prev.netGrosze + item.netGrosze,
        vatGrosze: prev.vatGrosze + item.vatGrosze,
        grossGrosze: prev.grossGrosze + item.grossGrosze,
      });
    }

    const totalNetGrosze = computedLines.reduce((s, l) => s + l.netGrosze, 0);
    const totalVatGrosze = computedLines.reduce((s, l) => s + l.vatGrosze, 0);
    const totalGrossGrosze = computedLines.reduce((s, l) => s + l.grossGrosze, 0);

    return {
      computedLines,
      rateBuckets: Array.from(byRate.entries()),
      totalNetGrosze,
      totalVatGrosze,
      totalGrossGrosze,
    };
  }, [docKind, lines]);

  function updateLine(index: number, patch: Partial<EditableInvoiceLineState>) {
    setLines((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  }

  function fillSyntheticMultiRateDemo() {
    setDocKind('purchase');
    setDirection('purchase');
    setDocNumber(`FV-DEMO/${period}/204`);
    setIssueDate(`${period}-18`);
    setSaleDate(`${period}-18`);
    setDueDate(`${period}-28`);
    setCounterpartyName('Centrum Szkoleniowo-Wydawnicze Syntetyk Sp. z o.o. [DEMO]');
    setCounterpartyNip('5213004125');
    setNoPolishNip(false);
    setCounterpartyAddress('ul. Wspólna 40, 00-684 Warszawa');
    setKsefMarker('BFK');
    setKsefRef('');
    setLines([
      {
        id: 'demo-line-1',
        description: '[DEMO] Warsztaty wdrożeniowe KSeF FA(3) dla działu finansowego',
        quantity: '1',
        unit: 'usł.',
        netPln: '1600.00',
        vatRate: '23',
        annex15Item: false,
      },
      {
        id: 'demo-line-2',
        description: '[DEMO] Publikacje książkowe specjalistyczne z numerem ISBN',
        quantity: '2',
        unit: 'egz.',
        netPln: '200.00',
        vatRate: '5',
        annex15Item: false,
      },
    ]);
    setFieldErrors({});
  }

  function downloadCsvTemplate() {
    const csvContent = buildEmptyDocumentCsvTemplate(period);
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `szablon-importu-faktury-${period}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function validateManualForm(): boolean {
    const nextErrors: Record<string, string> = {};
    let firstInvalidId: string | null = null;
    const markError = (key: string, elementId: string, msg: string) => {
      if (!nextErrors[key]) {
        nextErrors[key] = msg;
        if (!firstInvalidId) firstInvalidId = elementId;
      }
    };

    if (!docNumber.trim()) {
      markError(
        'docNumber',
        'manual-doc-number',
        'Podaj numer faktury lub dowodu źródłowego (np. FV/2026/03/014).',
      );
    }
    if (counterpartyName.trim().length < 2) {
      markError(
        'counterpartyName',
        'manual-counterparty-name',
        'Podaj pełną nazwę sprzedawcy lub nabywcy z faktury.',
      );
    }
    if (!noPolishNip) {
      const nipCheck = validatePolishNip(counterpartyNip);
      if (!nipCheck.valid) {
        markError(
          'counterpartyNip',
          'manual-counterparty-nip',
          nipCheck.reason ??
            'Wpisz poprawny 10-cyfrowy polski NIP albo zaznacz „Brak polskiego NIP (BrakID)”.',
        );
      }
    }
    if (!isValidIsoCalendarDate(issueDate)) {
      markError(
        'issueDate',
        'manual-issue-date',
        `Wskaż poprawną datę wystawienia w formacie RRRR-MM-DD (np. ${period}-18).`,
      );
    }
    if (!isValidIsoCalendarDate(saleDate)) {
      markError(
        'saleDate',
        'manual-sale-date',
        `Wskaż poprawną datę sprzedaży / wykonania w formacie RRRR-MM-DD (np. ${period}-18).`,
      );
    }
    if (!isValidIsoCalendarDate(dueDate)) {
      markError(
        'dueDate',
        'manual-due-date',
        `Wskaż poprawny termin płatności w formacie RRRR-MM-DD (np. ${period}-28).`,
      );
    } else if (isValidIsoCalendarDate(issueDate) && dueDate < issueDate) {
      markError(
        'dueDate',
        'manual-due-date',
        'Termin płatności nie może być wcześniejszy niż data wystawienia.',
      );
    }
    if (docKind === 'correction') {
      if (!correctedDocumentNumber.trim()) {
        markError(
          'correctedDocumentNumber',
          'manual-corrected-doc-number',
          'Wskaż numer faktury pierwotnej, której dotyczy korekta.',
        );
      }
      if (!correctionReason.trim()) {
        markError(
          'correctionReason',
          'manual-correction-reason',
          'Podaj przyczynę korekty (np. rabat potransakcyjny, zwrot towaru, błąd w cenie).',
        );
      }
    }
    if (ksefMarker === 'NrKSeF' && ksefRef.trim().length < 10) {
      markError(
        'ksefRef',
        'manual-ksef-ref',
        'Dla znacznika NrKSeF wpisz numer KSeF e-faktury albo przełącz znacznik na BFK (faktura poza KSeF / nieprzesłano).',
      );
    }

    lines.forEach((line, idx) => {
      if (!line.description.trim()) {
        markError(
          `line-desc-${line.id}`,
          `manual-line-desc-${String(idx)}`,
          `Opisz przedmiot transakcji w pozycji nr ${String(idx + 1)} (np. „Usługa doradcza wg umowy”).`,
        );
      }
      if (!line.netPln.trim()) {
        markError(
          `line-net-${line.id}`,
          `manual-line-net-${String(idx)}`,
          `Podaj kwotę netto w pozycji nr ${String(idx + 1)} (np. 1200.00).`,
        );
      } else {
        try {
          const parsed = parsePlnToGrosze(line.netPln);
          if (parsed === 0) {
            markError(
              `line-net-${line.id}`,
              `manual-line-net-${String(idx)}`,
              `Kwota netto pozycji nr ${String(idx + 1)} musi być różna od 0,00 PLN.`,
            );
          } else if (parsed < 0 && docKind !== 'correction') {
            markError(
              `line-net-${line.id}`,
              `manual-line-net-${String(idx)}`,
              'Ujemna kwota netto jest dozwolona wyłącznie dla faktury korygującej (KOR).',
            );
          }
        } catch {
          markError(
            `line-net-${line.id}`,
            `manual-line-net-${String(idx)}`,
            'Wpisz poprawną kwotę PLN z dokładnością do grosza (np. 1250.00).',
          );
        }
      }
    });

    setFieldErrors(nextErrors);
    if (firstInvalidId) {
      const el = window.document.getElementById(firstInvalidId);
      el?.focus();
      return false;
    }
    return true;
  }

  async function submitDocumentAction(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        document?: { documentId: string; isDuplicateSha256?: boolean };
      };
      if (!response.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Nie udało się zapisać dokumentu (HTTP ${String(response.status)})`,
          detail: formatUserFacingErrorPl({
            status: response.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Sprawdź wymagane pola formularza i poprawność kwot PLN.',
          }),
        });
      } else {
        const dupWarn = data.document?.isDuplicateSha256
          ? ' Uwaga: wykryto identyczny skrót SHA-256 w tej firmie (oznaczono duplikat).'
          : '';
        setFeedback({
          tone: data.document?.isDuplicateSha256 ? 'warning' : 'success',
          title: 'Dokument przyjęty jako propozycja do weryfikacji człowieka',
          detail: `${successMsg}${dupWarn}`,
          ...(data.document?.documentId ? { createdId: data.document.documentId } : {}),
        });
        router.refresh();
      }
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd komunikacji z warstwą sesji BFF',
        detail:
          'Nie udało się przesłać dokumentu do usługi księgowej. Żadne dane nie zostały zmienione.',
      });
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly LedgerColumn<WorkspaceDocumentRecord>[] = [
    {
      id: 'doc',
      header: 'Numer i kontrahent',
      mobileRole: 'title',
      render: (row) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/app/documents/${row.documentId}`}
              className="inline-flex min-h-6 items-center font-mono text-xs font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
            >
              {row.documentNumber}
            </Link>
            {row.documentKind === 'correction' || row.isCorrection ? (
              <StatusBadge size="sm" tone="warning" label="Korekta" />
            ) : null}
            {row.isDuplicateSha256 ? (
              <StatusBadge size="sm" tone="danger" label="Duplikat SHA-256!" />
            ) : null}
          </div>
          <p className="text-xs font-medium text-[#191c1a]">{row.counterpartyName}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            {row.counterpartyNip ? `NIP ${formatNip(row.counterpartyNip)}` : 'NIP: BrakID'} ·{' '}
            {row.issueDate}
          </p>
          <p className="line-clamp-1 text-[11px] text-[#464c48]">{row.description}</p>
        </div>
      ),
    },
    {
      id: 'ksef',
      header: 'Status KSeF / Oznaczenia',
      mobileRole: 'meta',
      render: (row) => {
        const ksefBadgeLabel =
          row.ksefMarker === 'NrKSeF'
            ? row.sourceChannel === 'KSeF FA(3) XML' || row.sourceChannel === 'KSeF FA(2) XML'
              ? 'XML FA · NrKSeF'
              : 'NrKSeF (deklarowany)'
            : row.ksefMarker === 'BFK'
              ? 'Poza KSeF (BFK)'
              : row.ksefMarker === 'OFF'
                ? 'Tryb offline (OFF)'
                : 'Dowód inny (DI)';

        return (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              <StatusBadge
                size="sm"
                tone={row.ksefMarker === 'NrKSeF' ? 'legal' : 'neutral'}
                label={ksefBadgeLabel}
              />
              {row.gtuCodes.map((gtu) => (
                <StatusBadge key={gtu} size="sm" tone="info" label={gtu} />
              ))}
              {row.annex15Item ? <StatusBadge size="sm" tone="warning" label="MPP" /> : null}
            </div>
            {row.ksefReferenceNumber ? (
              <p className="font-mono text-[11px] tabular-nums text-[#464c48]">
                {row.ksefReferenceNumber}
              </p>
            ) : (
              <p className="text-[10px] text-[#636b66]">Nieprzesłano do KSeF MF</p>
            )}
            {row.ksefReferenceNumber && row.ksefVerificationStatus !== 'verified_ksef' ? (
              <p className="text-[10px] text-[#7c4d00]">Niezweryfikowano online w KSeF MF</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status obiegu i ekstrakcja',
      mobileRole: 'status',
      render: (row) => {
        const meta = STATUS_META[row.status];
        const statusLabel =
          row.status === 'ai_proposal' &&
          row.extractionMethodLabelPl &&
          row.extractionMethodLabelPl.includes('deterministyczny')
            ? 'Zaimportowano (XML/CSV/JSON) — wymaga zatwierdzenia'
            : meta.label;
        return (
          <div className="space-y-1">
            <StatusBadge size="sm" tone={meta.tone} label={statusLabel} />
            {row.extractionMethodLabelPl ? (
              <p className="text-[11px] text-[#464c48]">{row.extractionMethodLabelPl}</p>
            ) : null}
            <p className="font-mono text-[10px] text-[#636b66]">
              {row.whiteListStatus === 'verified_kas'
                ? 'Wykaz KAS: zweryfikowano'
                : row.whiteListStatus === 'mismatch_alert'
                  ? 'Uwaga: IBAN poza Białą Listą!'
                  : 'Wykaz KAS: niesprawdzone w API MF'}
            </p>
          </div>
        );
      },
    },
    {
      id: 'amounts',
      header: 'Kwota brutto',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => {
        const uniqueRates =
          row.lines && row.lines.length > 0
            ? Array.from(new Set(row.lines.map((l) => formatVatRateBadge(l.vatRate))))
            : [formatVatRateBadge(row.vatRate)];
        return (
          <div className="text-right">
            <MoneyAmount
              amount={row.grossGrosze}
              inGrosze
              size="sm"
              variant={row.direction === 'sales' ? 'income' : 'expense'}
            />
            <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
              Netto {formatPlnFromGrosze(row.netGrosze)} · VAT {uniqueRates.join(' + ')}
            </p>
            {row.lines && row.lines.length > 1 ? (
              <p className="font-mono text-[10px] text-[#5b4618]">
                {String(row.lines.length)} pozycje wielostawkowe
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'action',
      header: 'Warsztat Split-View',
      mobileRole: 'meta',
      render: (row) => (
        <Link
          href={`/app/documents/${row.documentId}`}
          className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-white px-2.5 py-1 text-xs font-medium text-[#1d5c42] hover:bg-[#e7f1ec]"
        >
          {row.status === 'approved_posted' ? 'Podgląd i audyt' : 'Weryfikuj i zaksięguj'}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {feedback ? (
        <AlertBanner
          tone={feedback.tone}
          title={feedback.title}
          actions={
            feedback.createdId ? (
              <Link
                href={`/app/documents/${feedback.createdId}`}
                className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-1 text-xs font-medium text-white hover:bg-[#164833]"
              >
                Otwórz Split-View weryfikacji →
              </Link>
            ) : undefined
          }
        >
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div data-testid="ksef-sync-status-panel">
        <LedgerTable
          caption="Ewidencja dokumentów źródłowych, faktur KSeF FA(3) oraz propozycji oczekujących na weryfikację człowieka"
          title="Rejestr dokumentów źródłowych i kolejka weryfikacji"
          subtitle="Każdy dokument otrzymuje skrót integralności SHA-256. Zapis w księgach następuje dopiero po zatwierdzeniu przez uprawnionego człowieka w Split-View."
          columns={columns}
          rows={filteredDocs}
          getRowKey={(row) => row.documentId}
          toolbarSlot={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label htmlFor="doc-search" className="sr-only">
                Szukaj po numerze, NIP, nazwie, opisie lub NrKSeF
              </label>
              <input
                id="doc-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Szukaj nr, NIP, kontrahenta, opisu…"
                className="min-h-8 w-full rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs text-[#191c1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42] sm:w-56"
              />
              <label htmlFor="doc-status-filter" className="sr-only">
                Filtruj po statusie dokumentu
              </label>
              <select
                id="doc-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | DocumentWorkflowStatus)}
                className="min-h-8 w-full rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs text-[#191c1a] sm:w-auto"
              >
                <option value="all">Wszystkie statusy ({String(documents.length)})</option>
                <option value="ai_proposal">Wymaga zatwierdzenia człowieka</option>
                <option value="approved_posted">Zweryfikowany i zaksięgowany</option>
                <option value="draft">Szkic</option>
                <option value="archived">Zarchiwizowany</option>
              </select>
            </div>
          }
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5" data-testid="invoice-advance-final-chain">
          <Card
            as="div"
            eyebrow="Import ustrukturyzowany KSeF FA(3) / CSV / JSON"
            title="Importuj e-fakturę FA(3) XML, CSV lub JSON"
            actions={<FieldHelpButton help={helpMap.ksefReference} />}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setImportFormat('fa3_xml');
                    setRawImport(SAMPLE_KSEF_FA3_XML);
                  }}
                >
                  Wczytaj przykładową fakturę XML FA(3)
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setImportFormat('csv');
                    setRawImport(buildSampleSingleRateDocumentCsv(period));
                  }}
                >
                  Wczytaj przykładowy plik CSV
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setImportFormat('csv');
                    setRawImport(buildSampleMultiRateDocumentCsv(period));
                  }}
                >
                  [DEMO] CSV wielostawkowy (23%+8%+5%)
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setImportFormat('json');
                    setRawImport(buildSampleDocumentJson(period));
                  }}
                >
                  [DEMO] Wczytaj JSON
                </Button>
                <Button size="sm" variant="ghost" onClick={downloadCsvTemplate}>
                  Pobierz szablon CSV
                </Button>
              </div>

              <FormField id="import-format-select" label="Format dokumentu wejściowego">
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={importFormat}
                    onChange={(e) => setImportFormat(e.target.value as 'fa3_xml' | 'csv' | 'json')}
                  >
                    <option value="fa3_xml">
                      XML KSeF FA(2) / FA(3) (parser deterministyczny MF)
                    </option>
                    <option value="csv">CSV rozdzielany średnikami (;)</option>
                    <option value="json">Struktura JSON (wielopozycyjna)</option>
                  </select>
                )}
              </FormField>

              {importFormat === 'csv' ? (
                <p className="rounded-md border border-[#e5dec8] bg-[#faf8f1] px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-[#5b4618]">
                  <strong>Wymagany nagłówek CSV:</strong> {CANONICAL_DOCUMENT_CSV_HEADERS.join(';')}
                  . Wiele wierszy z tym samym <code>numer_faktury</code> i <code>nip</code> tworzy
                  jedną fakturę wielostawkową.
                </p>
              ) : null}

              <FormField
                id="import-raw-payload"
                label="Treść dokumentu (weryfikowana sumą SHA-256 pod kątem duplikatów)"
                hint="Przykładowe ładunki powyżej są jawnie oznaczone jako dane syntetyczne [DEMO]."
              >
                {(ctrl) => (
                  <textarea
                    {...ctrl}
                    rows={9}
                    value={rawImport}
                    onChange={(e) => setRawImport(e.target.value)}
                    className={`${ctrl.className} font-mono text-xs`}
                  />
                )}
              </FormField>

              <Button
                disabled={busy || !canWrite}
                onClick={() => {
                  void submitDocumentAction(
                    {
                      action: 'import_document',
                      format: importFormat,
                      rawPayload: rawImport,
                    },
                    'Zaimportowano dokument do kolejki weryfikacji człowieka (Split-View).',
                  );
                }}
              >
                {canWrite
                  ? 'Importuj i utwórz propozycję do weryfikacji'
                  : 'Tylko odczyt — brak grantu write'}
              </Button>
            </div>
          </Card>
        </div>

        <div className="xl:col-span-7" data-testid="credit-note-creator-panel">
          <Card
            as="div"
            eyebrow={`Wystawianie i rejestracja faktury · ${activeCompany.shortName}`}
            title="Dodaj fakturę lub korektę ręcznie (wiele pozycji i stawek VAT)"
            actions={
              <Button
                size="sm"
                variant="secondary"
                data-testid="fill-demo-multiline-invoice-button"
                onClick={fillSyntheticMultiRateDemo}
              >
                [DEMO] Wypełnij przykładem (23% + 5%)
              </Button>
            }
          >
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!validateManualForm()) {
                  return;
                }
                void submitDocumentAction(
                  {
                    action: 'create_manual_document',
                    documentKind: docKind,
                    direction,
                    documentNumber: docNumber,
                    issueDate,
                    saleDate,
                    dueDate,
                    counterpartyName,
                    counterpartyNip: noPolishNip ? '' : counterpartyNip,
                    noPolishNip,
                    counterpartyAddress,
                    isCorrection: docKind === 'correction',
                    correctedDocumentNumber,
                    correctionReason,
                    ksefMarker,
                    ksefReferenceNumber: ksefMarker === 'NrKSeF' ? ksefRef : '',
                    expenseQualification: direction === 'purchase' ? expenseQualification : 'none',
                    vatDeductionMode,
                    ...(direction === 'sales' && activeCompany.profileCode === 'jdg_ryczalt'
                      ? { ryczaltRate }
                      : {}),
                    lines: lines.map((line) => ({
                      description: line.description,
                      quantity: line.quantity,
                      unit: line.unit,
                      netPln: line.netPln,
                      vatRate: line.vatRate,
                      annex15Item: line.annex15Item,
                    })),
                  },
                  `Zarejestrowano dowód ${docNumber.trim()} (${String(lines.length)} poz.) jako propozycję do zatwierdzenia.`,
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="manual-doc-kind" label="Rodzaj dokumentu" required>
                  {(ctrl) => (
                    <select
                      {...ctrl}
                      value={docKind}
                      onChange={(e) => {
                        const next = e.target.value as DocumentKind;
                        setDocKind(next);
                        if (next === 'sales') setDirection('sales');
                        if (next === 'purchase') setDirection('purchase');
                      }}
                    >
                      <option value="purchase">Faktura zakupu (kosztowa)</option>
                      <option value="sales">Faktura sprzedaży</option>
                      <option value="correction">Faktura korygująca (KOR / in minus)</option>
                    </select>
                  )}
                </FormField>

                {docKind === 'correction' ? (
                  <FormField id="manual-correction-direction" label="Kierunek korekty" required>
                    {(ctrl) => (
                      <select
                        {...ctrl}
                        value={direction}
                        onChange={(e) => setDirection(e.target.value as 'sales' | 'purchase')}
                      >
                        <option value="purchase">Korekta zakupu</option>
                        <option value="sales">Korekta sprzedaży</option>
                      </select>
                    )}
                  </FormField>
                ) : null}

                <div className={docKind === 'correction' ? '' : 'sm:col-span-2'}>
                  <FormField
                    id="manual-doc-number"
                    label="Numer faktury / korekty"
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
                        placeholder={`np. FV/${period}/014`}
                        className={`${ctrl.className} font-mono`}
                      />
                    )}
                  </FormField>
                </div>
              </div>

              {docKind === 'correction' ? (
                <div className="grid gap-3 rounded-lg border border-[#e6c88a] bg-[#fdf4e3]/60 p-3 sm:grid-cols-2">
                  <FormField
                    id="manual-corrected-doc-number"
                    label="Numer faktury korygowanej"
                    required
                    {...(fieldErrors['correctedDocumentNumber']
                      ? { error: fieldErrors['correctedDocumentNumber'] }
                      : {})}
                  >
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="text"
                        value={correctedDocumentNumber}
                        onChange={(e) => setCorrectedDocumentNumber(e.target.value)}
                        placeholder={`np. FV/${period}/001`}
                        className={`${ctrl.className} font-mono`}
                      />
                    )}
                  </FormField>
                  <FormField
                    id="manual-correction-reason"
                    label="Przyczyna korekty (art. 106j VAT)"
                    required
                    {...(fieldErrors['correctionReason']
                      ? { error: fieldErrors['correctionReason'] }
                      : {})}
                  >
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="text"
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        placeholder="np. Rabat potransakcyjny lub częściowy zwrot"
                      />
                    )}
                  </FormField>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  id="manual-issue-date"
                  label="Data wystawienia"
                  required
                  {...(fieldErrors['issueDate'] ? { error: fieldErrors['issueDate'] } : {})}
                >
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={issueDate}
                      onChange={(e) => {
                        setIssueDate(e.target.value);
                        if (fieldErrors['issueDate']) {
                          setFieldErrors((prev) => ({ ...prev, issueDate: '' }));
                        }
                      }}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
                <FormField
                  id="manual-sale-date"
                  label="Data sprzedaży / wykonania"
                  required
                  {...(fieldErrors['saleDate'] ? { error: fieldErrors['saleDate'] } : {})}
                >
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={saleDate}
                      onChange={(e) => {
                        setSaleDate(e.target.value);
                        if (fieldErrors['saleDate']) {
                          setFieldErrors((prev) => ({ ...prev, saleDate: '' }));
                        }
                      }}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
                <FormField
                  id="manual-due-date"
                  label="Termin płatności"
                  required
                  {...(fieldErrors['dueDate'] ? { error: fieldErrors['dueDate'] } : {})}
                >
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={dueDate}
                      onChange={(e) => {
                        setDueDate(e.target.value);
                        if (fieldErrors['dueDate']) {
                          setFieldErrors((prev) => ({ ...prev, dueDate: '' }));
                        }
                      }}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id="manual-counterparty-name"
                  label={direction === 'sales' ? 'Nazwa nabywcy' : 'Nazwa sprzedawcy (dostawcy)'}
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
                      placeholder="Pełna nazwa kontrahenta z faktury"
                    />
                  )}
                </FormField>

                <FormField id="manual-counterparty-address" label="Adres kontrahenta (opcjonalnie)">
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="text"
                      value={counterpartyAddress}
                      onChange={(e) => setCounterpartyAddress(e.target.value)}
                      placeholder="ul., kod pocztowy i miejscowość"
                    />
                  )}
                </FormField>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="manual-no-polish-nip"
                  className="inline-flex min-h-6 items-center gap-2 text-xs text-[#191c1a]"
                >
                  <input
                    id="manual-no-polish-nip"
                    type="checkbox"
                    checked={noPolishNip}
                    onChange={(e) => {
                      setNoPolishNip(e.target.checked);
                      if (e.target.checked) {
                        setFieldErrors((prev) => ({ ...prev, counterpartyNip: '' }));
                      }
                    }}
                    className="h-5 w-5 shrink-0 accent-[#1d5c42]"
                  />
                  <span>
                    Brak polskiego NIP kontrahenta (konsument B2C lub kontrahent zagraniczny —{' '}
                    <code className="font-mono">BrakID</code> w JPK)
                  </span>
                </label>

                {!noPolishNip ? (
                  <NipInput
                    id="manual-counterparty-nip"
                    label="NIP kontrahenta (10 cyfr)"
                    value={counterpartyNip}
                    onChange={(val) => {
                      setCounterpartyNip(val);
                      if (fieldErrors['counterpartyNip']) {
                        setFieldErrors((prev) => ({ ...prev, counterpartyNip: '' }));
                      }
                    }}
                    fieldHelp={helpMap.nip}
                    {...(fieldErrors['counterpartyNip']
                      ? { error: fieldErrors['counterpartyNip'] }
                      : {})}
                  />
                ) : null}
              </div>

              {/* Pozycje faktury — pełny edytor wielopozycyjny i wielostawkowy (#102, #103) */}
              <div
                data-testid="invoice-multiline-editor"
                className="space-y-3 rounded-xl border border-[#d8d4ca] bg-[#faf9f5] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#191c1a]">
                      Pozycje faktury ({String(lines.length)})
                    </p>
                    <p className="text-xs text-[#464c48]">
                      Każda pozycja posiada własny opis towaru/usługi oraz niezależną stawkę VAT.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="add-invoice-line-button"
                    onClick={() =>
                      setLines((prev) => [
                        ...prev,
                        createBlankLine(
                          `line-${String(Date.now())}-${String(prev.length + 1)}`,
                          defaultVatRate,
                        ),
                      ])
                    }
                  >
                    + Dodaj pozycję faktury
                  </Button>
                </div>

                <VatRateGuideTrigger
                  selectedRate={lines[0]?.vatRate ?? defaultVatRate}
                  eventDate={saleDate || issueDate}
                  profileCode={activeCompany.profileCode}
                />

                <div className="space-y-3">
                  {lines.map((line, index) => {
                    const computed = liveSummary.computedLines[index];
                    return (
                      <div
                        key={line.id}
                        data-testid={`invoice-line-row-${String(index)}`}
                        className="space-y-2.5 rounded-lg border border-[#e5e2d9] bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-[#164833]">
                            Pozycja #{String(index + 1)}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs tabular-nums text-[#464c48]">
                              VAT: {formatPlnFromGrosze(computed?.vatGrosze ?? 0)} · Brutto:{' '}
                              <strong className="text-[#191c1a]">
                                {formatPlnFromGrosze(computed?.grossGrosze ?? 0)}
                              </strong>
                            </span>
                            {lines.length > 1 ? (
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() =>
                                  setLines((prev) => prev.filter((_, idx) => idx !== index))
                                }
                              >
                                Usuń pozycję
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        <FormField
                          id={`manual-line-desc-${String(index)}`}
                          label="Nazwa towaru lub zakres wykonanej usługi"
                          required
                          {...(fieldErrors[`line-desc-${line.id}`]
                            ? { error: fieldErrors[`line-desc-${line.id}`] }
                            : {})}
                        >
                          {(ctrl) => (
                            <input
                              {...ctrl}
                              type="text"
                              value={line.description}
                              onChange={(e) => {
                                updateLine(index, { description: e.target.value });
                                if (fieldErrors[`line-desc-${line.id}`]) {
                                  setFieldErrors((prev) => ({
                                    ...prev,
                                    [`line-desc-${line.id}`]: '',
                                  }));
                                }
                              }}
                              placeholder="np. Usługa wytwarzania oprogramowania wg specyfikacji"
                            />
                          )}
                        </FormField>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <FormField
                              id={`manual-line-qty-${String(index)}`}
                              label="Ilość"
                              required
                            >
                              {(ctrl) => (
                                <input
                                  {...ctrl}
                                  type="text"
                                  inputMode="decimal"
                                  value={line.quantity}
                                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                                  className={`${ctrl.className} text-right font-mono tabular-nums`}
                                />
                              )}
                            </FormField>
                          </div>
                          <div>
                            <FormField
                              id={`manual-line-unit-${String(index)}`}
                              label="Jednostka"
                              required
                            >
                              {(ctrl) => (
                                <input
                                  {...ctrl}
                                  type="text"
                                  value={line.unit}
                                  onChange={(e) => updateLine(index, { unit: e.target.value })}
                                />
                              )}
                            </FormField>
                          </div>
                          <div>
                            <MoneyInput
                              id={`manual-line-net-${String(index)}`}
                              label={
                                docKind === 'correction' ? 'Zmiana netto (in minus)' : 'Kwota netto'
                              }
                              required
                              value={line.netPln}
                              onChange={(val) => {
                                updateLine(index, { netPln: val });
                                if (fieldErrors[`line-net-${line.id}`]) {
                                  setFieldErrors((prev) => ({
                                    ...prev,
                                    [`line-net-${line.id}`]: '',
                                  }));
                                }
                              }}
                              {...(fieldErrors[`line-net-${line.id}`]
                                ? { error: fieldErrors[`line-net-${line.id}`] }
                                : {})}
                            />
                          </div>
                          <div>
                            <FormField
                              id={`manual-line-vat-rate-${String(index)}`}
                              label="Stawka VAT"
                              required
                            >
                              {(ctrl) => (
                                <select
                                  {...ctrl}
                                  value={line.vatRate}
                                  onChange={(e) =>
                                    updateLine(index, { vatRate: e.target.value as VatRateCode })
                                  }
                                >
                                  <option value="23">23% — podstawowa</option>
                                  <option value="8">8% — obniżona (zał. nr 3)</option>
                                  <option value="5">5% — obniżona (zał. nr 10)</option>
                                  <option value="0">0% — WDT / eksport</option>
                                  <option value="zw">zw. — zwolniona z VAT</option>
                                  <option value="np">np. — poza VAT w PL (np. art. 28b)</option>
                                </select>
                              )}
                            </FormField>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <label
                            htmlFor={`manual-line-annex15-${String(index)}`}
                            className="inline-flex min-h-6 items-center gap-2 text-xs text-[#464c48]"
                          >
                            <input
                              id={`manual-line-annex15-${String(index)}`}
                              type="checkbox"
                              checked={line.annex15Item}
                              onChange={(e) => updateLine(index, { annex15Item: e.target.checked })}
                              className="h-5 w-5 shrink-0 accent-[#1d5c42]"
                            />
                            <span>
                              Towar/usługa z Załącznika nr 15 ustawy o VAT (obowiązkowy MPP powyżej
                              15 000 PLN brutto)
                            </span>
                          </label>
                          <div className="flex items-center gap-1">
                            <FieldHelpButton help={helpMap.gtuCode} />
                            <FieldHelpButton help={helpMap.mpp} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Podsumowanie deterministyczne wg stawek VAT i łącznie */}
                <div
                  data-testid="invoice-totals-summary"
                  className="space-y-2 rounded-lg border border-[#b7d4c5] bg-[#e7f1ec]/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#164833]">
                      Podsumowanie dokumentu (wyliczenie deterministyczne co do grosza):
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#191c1a]">
                      Netto: <strong>{formatPlnFromGrosze(liveSummary.totalNetGrosze)}</strong> ·
                      VAT: <strong>{formatPlnFromGrosze(liveSummary.totalVatGrosze)}</strong> ·
                      Brutto:{' '}
                      <strong className="text-[#164833]">
                        {formatPlnFromGrosze(liveSummary.totalGrossGrosze)}
                      </strong>
                    </span>
                  </div>
                  {liveSummary.rateBuckets.length > 1 ? (
                    <div className="flex flex-wrap gap-2 border-t border-[#c7dfd2] pt-2 font-mono text-[11px] tabular-nums text-[#464c48]">
                      {liveSummary.rateBuckets.map(([rate, bucket]) => (
                        <span
                          key={rate}
                          className="rounded border border-[#b7d4c5] bg-white px-2 py-0.5"
                        >
                          Stawka {formatVatRateBadge(rate)}: netto{' '}
                          {formatPlnFromGrosze(bucket.netGrosze)} · VAT{' '}
                          {formatPlnFromGrosze(bucket.vatGrosze)} · brutto{' '}
                          {formatPlnFromGrosze(bucket.grossGrosze)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Kontekstowa kwalifikacja zakupu KUP/VAT albo stawki ryczałtu (#103) */}
              {direction === 'purchase' ? (
                <div className="space-y-3">
                  <PurchaseQualificationHelpNotice
                    profileCode={activeCompany.profileCode}
                    vatStatus={activeCompany.vatStatus}
                    eventDate={saleDate || issueDate}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      id="manual-expense-qualification"
                      label="Wstępna kwalifikacja kosztowa (KUP / NKUP)"
                    >
                      {(ctrl) => (
                        <select
                          {...ctrl}
                          value={expenseQualification}
                          onChange={(e) => {
                            const next = e.target.value as KpirExpenseQualificationKind;
                            setExpenseQualification(next);
                            if (next === 'vehicle_mixed_75_col13') {
                              setVatDeductionMode('vehicle_mixed_50');
                            }
                          }}
                        >
                          <option value="other_expenses_100_col13">
                            100% KUP — Pozostałe wydatki związane z działalnością
                          </option>
                          <option value="goods_and_materials_col10">
                            100% KUP — Zakup towarów handlowych i materiałów
                          </option>
                          <option value="vehicle_mixed_75_col13">
                            75% KUP — Eksploatacja samochodu osobowego mieszanego
                          </option>
                          <option value="nkup_excluded">
                            0% NKUP — Wydatek wyłączony z kosztów podatkowych (np. reprezentacja)
                          </option>
                        </select>
                      )}
                    </FormField>

                    <FormField
                      id="manual-vat-deduction"
                      label="Wstępne prawo do odliczenia VAT naliczonego"
                    >
                      {(ctrl) => (
                        <select
                          {...ctrl}
                          value={vatDeductionMode}
                          onChange={(e) => setVatDeductionMode(e.target.value as VatDeductionMode)}
                        >
                          <option value="full_100">
                            100% odliczenia VAT (związek z czynnościami opodatkowanymi)
                          </option>
                          <option value="vehicle_mixed_50">
                            50% odliczenia VAT — pojazd samochodowy mieszany (art. 86a VAT)
                          </option>
                          <option value="none_0">
                            0% — brak odliczenia (np. zwolnienie z VAT, gastronomia/noclegi art. 88)
                          </option>
                        </select>
                      )}
                    </FormField>
                  </div>
                </div>
              ) : activeCompany.profileCode === 'jdg_ryczalt' ? (
                <div className="space-y-2 rounded-lg border border-[#dcd3b8] bg-[#faf8f1] p-3">
                  <FormField
                    id="manual-sales-ryczalt-rate"
                    label="Stawka ryczałtu od przychodów ewidencjonowanych (art. 12 PPE)"
                    required
                  >
                    {(ctrl) => (
                      <select
                        {...ctrl}
                        value={ryczaltRate}
                        onChange={(e) => setRyczaltRate(e.target.value as RyczaltRateCode)}
                      >
                        <option value="17">17% — wolne zawody</option>
                        <option value="15">15% — doradztwo, reklama, licencje</option>
                        <option value="14">14% — architektura, inżynieria, opieka zdrowotna</option>
                        <option value="12">12% — programowanie i IT (PKWiU 62)</option>
                        <option value="8.5">8,5% — usługi ogólne</option>
                        <option value="5.5">5,5% — roboty budowlane i wytwórczość</option>
                        <option value="3">3% — działalność handlowa</option>
                      </select>
                    )}
                  </FormField>
                  <RyczaltRateGuideTrigger
                    selectedRate={ryczaltRate}
                    eventDate={saleDate || issueDate}
                  />
                </div>
              ) : null}

              {/* Uczciwe oznaczenie statusu KSeF (#115) */}
              <div className="space-y-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5">
                <FormField
                  id="manual-ksef-marker"
                  label="Status w Krajowym Systemie e-Faktur (znacznik JPK_V7M)"
                  fieldHelp={helpMap.ksefReference}
                  hint="Domyślnie BFK — dokument ręczny nie otrzymuje fikcyjnego numeru KSeF."
                >
                  {(ctrl) => (
                    <select
                      {...ctrl}
                      value={ksefMarker}
                      onChange={(e) => {
                        const next = e.target.value as 'NrKSeF' | 'OFF' | 'BFK' | 'DI';
                        setKsefMarker(next);
                        if (next !== 'NrKSeF') {
                          setKsefRef('');
                          setFieldErrors((prev) => ({ ...prev, ksefRef: '' }));
                        }
                      }}
                    >
                      <option value="BFK">
                        BFK — Nieprzesłano do KSeF / faktura wystawiona poza KSeF
                      </option>
                      <option value="OFF">
                        OFF — Faktura w trybie offline24 / awaryjnym (jeszcze bez numeru KSeF)
                      </option>
                      <option value="DI">DI — Dowód wewnętrzny / inny niż faktura</option>
                      <option value="NrKSeF">
                        NrKSeF — Posiadam nadany numer KSeF faktury ustrukturyzowanej
                      </option>
                    </select>
                  )}
                </FormField>

                {ksefMarker === 'NrKSeF' ? (
                  <FormField
                    id="manual-ksef-ref"
                    label="Rzeczywisty numer referencyjny KSeF"
                    required
                    hint="Wartość deklarowana przez użytkownika — aplikacja nie oznacza jej jako zweryfikowanej online w MF bez aktywnej sesji KSeF."
                    {...(fieldErrors['ksefRef'] ? { error: fieldErrors['ksefRef'] } : {})}
                  >
                    {(ctrl) => (
                      <input
                        {...ctrl}
                        type="text"
                        value={ksefRef}
                        onChange={(e) => {
                          setKsefRef(e.target.value);
                          if (fieldErrors['ksefRef']) {
                            setFieldErrors((prev) => ({ ...prev, ksefRef: '' }));
                          }
                        }}
                        placeholder="np. 5250001003-20260318-A1B2C3D4E5F6-01"
                        className={`${ctrl.className} font-mono text-xs tabular-nums`}
                      />
                    )}
                  </FormField>
                ) : null}
              </div>

              <Button type="submit" disabled={busy || !canWrite}>
                {canWrite
                  ? 'Dodaj dokument do obiegu (do weryfikacji Split-View)'
                  : 'Dodawanie zablokowane — brak grantu write'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
