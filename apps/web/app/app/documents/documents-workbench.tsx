'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { VatRateCode } from '@pap/domain';
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
import { AlertBanner, Button, MoneyInput, NipInput } from '../../../components/ui-controls';
import {
  SAMPLE_INVOICE_CSV,
  SAMPLE_KSEF_FA3_XML,
  type DocumentKind,
  type DocumentWorkflowStatus,
  type WorkspaceDocumentRecord,
} from '../../../lib/workspace-types';

const STATUS_META: Record<
  DocumentWorkflowStatus,
  { readonly label: string; readonly tone: 'neutral' | 'warning' | 'success' | 'info' }
> = {
  draft: { label: 'Szkic', tone: 'neutral' },
  ai_proposal: { label: 'Propozycja AI — wymaga zatwierdzenia', tone: 'warning' },
  approved_posted: { label: 'Zweryfikowany i zaksięgowany', tone: 'success' },
  archived: { label: 'Zarchiwizowany', tone: 'info' },
};

export interface DocumentsWorkbenchProps {
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

  // Import XML FA(3) / CSV / JSON
  const [importFormat, setImportFormat] = useState<'fa3_xml' | 'csv' | 'json'>('fa3_xml');
  const [rawImport, setRawImport] = useState(SAMPLE_KSEF_FA3_XML);

  // Ręczne dodanie faktury / korekty
  const [docKind, setDocKind] = useState<DocumentKind>('purchase');
  const [direction, setDirection] = useState<'sales' | 'purchase'>('purchase');
  const [docNumber, setDocNumber] = useState(`FZ/${period}/105`);
  const [issueDate, setIssueDate] = useState(`${period}-18`);
  const [dueDate, setDueDate] = useState(`${period}-30`);
  const [counterpartyName, setCounterpartyName] = useState('Biuro Projektowe Syntetyka Sp. z o.o.');
  const [counterpartyNip, setCounterpartyNip] = useState('5213004125');
  const [description] = useState('Usługi doradztwa inżynieryjnego i licencje CAD');
  const [netPln, setNetPln] = useState('1500.00');
  const [vatRate, setVatRate] = useState<VatRateCode>('23');
  const [ksefMarker, setKsefMarker] = useState<'NrKSeF' | 'OFF' | 'BFK' | 'DI'>('NrKSeF');
  const [ksefRef, setKsefRef] = useState('5213004125-20261018-778899AABBCC-12');
  const [annex15, setAnnex15] = useState(false);

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
        error?: string;
        document?: { documentId: string; isDuplicateSha256?: boolean };
      };
      if (!response.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Nie udało się zapisać dokumentu (HTTP ${String(response.status)})`,
          detail: data.error ?? 'Sprawdź poprawność pól formularza.',
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
        title: 'Błąd komunikacji z BFF',
        detail: 'Nie udało się przesłać dokumentu.',
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
              className="font-mono text-xs font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
            >
              {row.documentNumber}
            </Link>
            {row.isDuplicateSha256 ? (
              <StatusBadge size="sm" tone="danger" label="Duplikat SHA-256!" />
            ) : null}
          </div>
          <p className="text-xs font-medium text-[#191c1a]">{row.counterpartyName}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            NIP {formatNip(row.counterpartyNip)} · {row.issueDate}
          </p>
        </div>
      ),
    },
    {
      id: 'ksef',
      header: 'KSeF / Oznaczenia',
      mobileRole: 'meta',
      render: (row) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge
              size="sm"
              tone={row.ksefMarker === 'NrKSeF' ? 'legal' : 'neutral'}
              label={row.ksefMarker === 'NrKSeF' ? 'FA(3) · NrKSeF' : `KSeF: ${row.ksefMarker}`}
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
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status obiegu',
      mobileRole: 'status',
      render: (row) => {
        const meta = STATUS_META[row.status];
        return <StatusBadge size="sm" tone={meta.tone} label={meta.label} />;
      },
    },
    {
      id: 'amounts',
      header: 'Kwota brutto',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => (
        <div className="text-right">
          <MoneyAmount
            amount={row.grossGrosze}
            inGrosze
            size="sm"
            variant={row.direction === 'sales' ? 'income' : 'expense'}
          />
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            Netto {(row.netGrosze / 100).toFixed(2)} · VAT {row.vatRate}%
          </p>
        </div>
      ),
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
          {row.status === 'approved_posted' ? 'Podgląd i audyt' : 'Weryfikuj propozycję AI'}
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
          caption="Ewidencja dokumentów źródłowych, faktur KSeF FA(3) oraz propozycji AI oczekujących na weryfikację człowieka"
          title="Rejestr dokumentów źródłowych i propozycji AI"
          subtitle="Każdy dokument otrzymuje skrót integralności SHA-256. AI i parser FA(3) wyłącznie proponują dane — zapis w księgach wymaga zatwierdzenia człowieka."
          columns={columns}
          rows={filteredDocs}
          getRowKey={(row) => row.documentId}
          toolbarSlot={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label htmlFor="doc-search" className="sr-only">
                Szukaj po numerze, NIP, nazwie lub NrKSeF
              </label>
              <input
                id="doc-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Szukaj nr, NIP, kontrahenta, NrKSeF…"
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
                <option value="ai_proposal">Propozycja AI — wymaga zatwierdzenia</option>
                <option value="approved_posted">Zweryfikowany i zaksięgowany</option>
                <option value="draft">Szkic</option>
                <option value="archived">Zarchiwizowany</option>
              </select>
            </div>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div data-testid="invoice-advance-final-chain">
          <Card
            as="div"
            eyebrow="Import ustrukturyzowany KSeF FA(3) / CSV / JSON"
            title="Importuj e-fakturę FA(3) XML lub plik CSV"
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
                    setRawImport(SAMPLE_INVOICE_CSV);
                  }}
                >
                  Wczytaj przykładowy plik CSV
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
                      XML KSeF FA(3) (schemat MF obowiązkowy od 2026 r.)
                    </option>
                    <option value="csv">CSV rozdzielany średnikami (;)</option>
                    <option value="json">Struktura JSON</option>
                  </select>
                )}
              </FormField>

              <FormField
                id="import-raw-payload"
                label="Treść dokumentu (weryfikowana sumą SHA-256 pod kątem duplikatów)"
              >
                {(ctrl) => (
                  <textarea
                    {...ctrl}
                    rows={8}
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

        <div data-testid="credit-note-creator-panel">
          <Card
            as="div"
            eyebrow="Rejestracja sprzedaży, zakupu lub faktury korygującej"
            title="Dodaj dokument ręcznie (w tym korektę in minus)"
          >
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitDocumentAction(
                  {
                    action: 'create_manual_document',
                    documentKind: docKind,
                    direction,
                    documentNumber: docNumber,
                    issueDate,
                    dueDate,
                    counterpartyName,
                    counterpartyNip,
                    description,
                    netPln,
                    vatRate,
                    ksefMarker,
                    ksefReferenceNumber: ksefRef,
                    annex15Item: annex15,
                  },
                  `Dodano dokument ${docNumber} jako propozycję do zatwierdzenia.`,
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="manual-doc-kind" label="Rodzaj dokumentu">
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

                <FormField id="manual-doc-number" label="Numer faktury / korekty" required>
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

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="manual-issue-date" label="Data wystawienia">
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
                <FormField id="manual-due-date" label="Termin płatności">
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={`${ctrl.className} font-mono tabular-nums`}
                    />
                  )}
                </FormField>
              </div>

              <FormField id="manual-counterparty-name" label="Nazwa kontrahenta (syntetyczna)">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                  />
                )}
              </FormField>

              <NipInput
                id="manual-counterparty-nip"
                label="NIP kontrahenta"
                value={counterpartyNip}
                onChange={setCounterpartyNip}
                fieldHelp={helpMap.nip}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyInput
                  id="manual-net-pln"
                  label="Kwota netto"
                  value={netPln}
                  onChange={setNetPln}
                />
                <FormField id="manual-vat-rate" label="Stawka VAT">
                  {(ctrl) => (
                    <select
                      {...ctrl}
                      value={vatRate}
                      onChange={(e) => setVatRate(e.target.value as VatRateCode)}
                    >
                      <option value="23">23% (stawka podstawowa)</option>
                      <option value="8">8% (obniżona)</option>
                      <option value="5">5% (obniżona)</option>
                      <option value="0">0%</option>
                      <option value="zw">zw (zwolniona)</option>
                    </select>
                  )}
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id="manual-ksef-marker"
                  label="Znacznik KSeF do JPK_V7M(3)"
                  fieldHelp={helpMap.ksefReference}
                >
                  {(ctrl) => (
                    <select
                      {...ctrl}
                      value={ksefMarker}
                      onChange={(e) =>
                        setKsefMarker(e.target.value as 'NrKSeF' | 'OFF' | 'BFK' | 'DI')
                      }
                    >
                      <option value="NrKSeF">NrKSeF — faktura ustrukturyzowana FA(3)</option>
                      <option value="OFF">OFF — tryb awaryjny / offline24</option>
                      <option value="BFK">BFK — faktura bez KSeF</option>
                      <option value="DI">DI — dowód inny niż faktura</option>
                    </select>
                  )}
                </FormField>

                <FormField id="manual-ksef-ref" label="Numer KSeF (35 znaków, opcjonalnie)">
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
              </div>

              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="manual-doc-annex15"
                  className="flex items-center gap-2 text-xs text-[#191c1a]"
                >
                  <input
                    id="manual-doc-annex15"
                    type="checkbox"
                    checked={annex15}
                    onChange={(e) => setAnnex15(e.target.checked)}
                    className="h-4 w-4 accent-[#1d5c42]"
                  />
                  <span>
                    Pozycja z Załącznika nr 15 (weryfikacja MPP powyżej 15 000 PLN brutto)
                  </span>
                </label>
                <div className="flex items-center gap-1">
                  <FieldHelpButton help={helpMap.gtuCode} />
                  <FieldHelpButton help={helpMap.mpp} />
                </div>
              </div>

              <Button type="submit" disabled={busy || !canWrite}>
                Dodaj dokument do obiegu
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
