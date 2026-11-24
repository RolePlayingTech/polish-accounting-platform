'use client';

import { useState } from 'react';
import { Card, CriticalConfirmDialog, FormField, StatusBadge } from '@pap/ui';
import { formatUserFacingErrorPl } from '../lib/error-messages-pl';
import type {
  ExportedFa3XmlView,
  KsefSandboxIssueResult,
  KsefSandboxStatusSnapshot,
  KsefSandboxSyncResult,
  SourceArchiveWormRecord,
} from '../lib/wave2-statutory-and-close';
import type { WorkspaceDocumentRecord } from '../lib/workspace-types';
import { AlertBanner, Button } from './ui-controls';

export interface KsefSandboxPanelProps {
  readonly companyName: string;
  readonly companyNip: string;
  readonly period: string;
  readonly canWrite: boolean;
  readonly status: KsefSandboxStatusSnapshot;
  readonly documents: readonly WorkspaceDocumentRecord[];
  readonly preselectedDocumentId?: string | undefined;
}

export function KsefSandboxPanel({
  canWrite,
  companyName,
  companyNip,
  documents,
  period,
  preselectedDocumentId,
  status,
}: KsefSandboxPanelProps) {
  const salesDocuments = documents.filter((d) => d.direction === 'sales');
  const preselectedDoc = preselectedDocumentId
    ? (documents.find((d) => d.documentId === preselectedDocumentId) ?? null)
    : null;
  const [selectedDocId, setSelectedDocId] = useState(
    preselectedDoc?.direction === 'sales'
      ? preselectedDoc.documentId
      : (salesDocuments[0]?.documentId ?? ''),
  );
  const [environment, setEnvironment] = useState<'local_mock' | 'test' | 'demo'>(
    status.defaultEnvironment,
  );
  const [busy, setBusy] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [fa3Export, setFa3Export] = useState<ExportedFa3XmlView | null>(null);
  const [issueResult, setIssueResult] = useState<KsefSandboxIssueResult | null>(null);
  const [syncResult, setSyncResult] = useState<KsefSandboxSyncResult | null>(null);
  const [wormResult, setWormResult] = useState<SourceArchiveWormRecord | null>(null);
  const [wormName, setWormName] = useState(`zalacznik-zrodlowy-${period}.csv`);
  const [wormContent, setWormContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedDoc = preselectedDocumentId
    ? preselectedDoc?.direction === 'sales'
      ? preselectedDoc
      : null
    : (salesDocuments.find((d) => d.documentId === selectedDocId) ?? salesDocuments[0] ?? null);

  async function handleGenerateFa3Xml() {
    if (!selectedDoc) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'export_invoice_fa3_xml',
          documentId: selectedDoc.documentId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        fa3?: ExportedFa3XmlView;
      };
      if (!res.ok || !data.ok || !data.fa3) {
        setErrorMsg(
          formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się wygenerować pliku XML FA(3).',
          }),
        );
      } else {
        setFa3Export(data.fa3);
      }
    } catch {
      setErrorMsg('Błąd połączenia podczas generowania pliku XML FA(3).');
    } finally {
      setBusy(false);
    }
  }

  function downloadFa3Xml() {
    if (!fa3Export) return;
    const blob = new Blob([fa3Export.xmlContent], { type: 'application/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = fa3Export.fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function executeConfirmedSandboxIssue() {
    if (!selectedDoc) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ksef_sandbox_issue',
          documentId: selectedDoc.documentId,
          environment,
          confirmHumanSend: true,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        result?: KsefSandboxIssueResult;
      };
      setConfirmSendOpen(false);
      if (!res.ok || !data.ok || !data.result) {
        setErrorMsg(
          formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Błąd wysyłki do środowiska nieprodukcyjnego KSeF 2.0.',
          }),
        );
      } else {
        setIssueResult(data.result);
      }
    } catch {
      setConfirmSendOpen(false);
      setErrorMsg('Błąd połączenia z warstwą sesji BFF podczas operacji KSeF Sandbox.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncIncoming() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ksef_sandbox_sync_incoming',
          environment,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        result?: KsefSandboxSyncResult;
      };
      if (!res.ok || !data.ok || !data.result) {
        setErrorMsg(
          formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się zsynchronizować kolejki odbiorczej KSeF.',
          }),
        );
      } else {
        setSyncResult(data.result);
      }
    } catch {
      setErrorMsg('Błąd połączenia podczas synchronizacji odbiorczej KSeF.');
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveWorm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive_source_document_worm',
          fileName: wormName,
          mimeType: wormName.toLowerCase().endsWith('.xml')
            ? 'application/xml'
            : wormName.toLowerCase().endsWith('.json')
              ? 'application/json'
              : wormName.toLowerCase().endsWith('.png')
                ? 'image/png'
                : wormName.toLowerCase().endsWith('.jpg') ||
                    wormName.toLowerCase().endsWith('.jpeg')
                  ? 'image/jpeg'
                  : wormName.toLowerCase().endsWith('.pdf') &&
                      wormContent.trimStart().startsWith('%PDF-')
                    ? 'application/pdf'
                    : 'text/csv',
          content: wormContent,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        record?: SourceArchiveWormRecord;
      };
      if (!res.ok || !data.ok || !data.record) {
        setErrorMsg(
          formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się zapisać załącznika w archiwum źródłowym WORM.',
          }),
        );
      } else {
        setWormResult(data.record);
      }
    } catch {
      setErrorMsg('Błąd połączenia podczas zapisu do archiwum źródłowego WORM.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="ksef-sandbox-and-fa3-panel">
      <Card
        as="section"
        eyebrow="Eksport FA(3) XML · KSeF 2.0 Sandbox (nieprodukcyjny) · Archiwum WORM SHA-256"
        title="Generator ustrukturyzowanych e-faktur FA(3) i adapter testowy KSeF 2.0"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              size="sm"
              tone="warning"
              label="Tylko nieprodukcyjne (ksef.mf.gov.pl zablokowany 403)"
            />
            <StatusBadge
              size="sm"
              tone="neutral"
              label={`Zewnętrzny token MF: ${status.liveExternalE2eStatus}`}
            />
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-[#464c48]">
            {status.statusSummaryPl} Obowiązek <strong>odbioru</strong> faktur w KSeF 2.0 dotyczy
            wszystkich podatników od{' '}
            <strong className="font-mono">{status.mandatoryReceiveFrom}</strong>, a obowiązek
            wystawiania: od <strong className="font-mono">{status.mandatoryIssueLargeFrom}</strong>{' '}
            (sprzedaż &gt; 200 mln zł) i od{' '}
            <strong className="font-mono">{status.mandatoryIssueStandardFrom}</strong> (pozostali, z
            wyjątkiem przejściowym do{' '}
            <strong className="font-mono">
              {String(status.microExemptionMonthlyGrossLimitPln)} PLN
            </strong>{' '}
            brutto miesięcznie do końca 2026 r.).
          </p>

          {errorMsg ? (
            <AlertBanner tone="danger" title="Komunikat kontroli KSeF / Archiwum WORM">
              {errorMsg}
            </AlertBanner>
          ) : null}

          <div className="grid gap-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5 md:grid-cols-3">
            {!preselectedDocumentId ? (
              <FormField id="ksef-panel-doc-select" label="Faktura sprzedaży do eksportu FA(3)">
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={selectedDoc?.documentId ?? ''}
                    disabled={salesDocuments.length === 0}
                    onChange={(e) => {
                      setSelectedDocId(e.target.value);
                      setFa3Export(null);
                      setIssueResult(null);
                    }}
                  >
                    {salesDocuments.length > 0 ? (
                      salesDocuments.map((d) => (
                        <option key={d.documentId} value={d.documentId}>
                          {d.documentNumber} · {d.counterpartyName}
                        </option>
                      ))
                    ) : (
                      <option value="">Brak faktur sprzedaży do eksportu FA(3)</option>
                    )}
                  </select>
                )}
              </FormField>
            ) : preselectedDoc?.direction === 'purchase' ? (
              <div className="flex items-center text-xs text-[#464c48]">
                Dokument zakupu (Podmiot2) — wystawianie XML FA(3) dotyczy wyłącznie faktur
                sprzedaży.
              </div>
            ) : null}

            <FormField id="ksef-sandbox-env-select" label="Środowisko nieprodukcyjne KSeF 2.0">
              {(ctrl) => (
                <select
                  {...ctrl}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'local_mock' | 'test' | 'demo')}
                >
                  <option value="local_mock">
                    Lokalny symulator kontraktu KSeF 2.0 (bez ruchu zewnętrznego)
                  </option>
                  <option value="test">MF Test (api-test.ksef.mf.gov.pl/v2)</option>
                  <option value="demo">MF Demo (api-demo.ksef.mf.gov.pl/v2)</option>
                </select>
              )}
            </FormField>

            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                data-testid="export-fa3-xml-button"
                disabled={busy || !selectedDoc}
                onClick={() => void handleGenerateFa3Xml()}
              >
                Generuj XML FA(3)
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="ksef-sync-incoming-button"
                disabled={busy || !canWrite}
                onClick={() => void handleSyncIncoming()}
              >
                Odbierz zakupy (Podmiot2)
              </Button>
              <Button
                size="sm"
                data-testid="ksef-sandbox-issue-button"
                disabled={busy || !canWrite || !selectedDoc}
                onClick={() => setConfirmSendOpen(true)}
              >
                Wyślij do KSeF Sandbox
              </Button>
            </div>
          </div>

          {fa3Export ? (
            <div
              data-testid="exported-fa3-xml-result"
              className="space-y-2 rounded-xl border border-[#1d5c42] bg-white p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs font-semibold text-[#191c1a]">
                  {fa3Export.fileName} · SHA-256: {fa3Export.xmlSha256Hex.slice(0, 16)}… (lokalny
                  plik XML — nieprzesłany do MF)
                </p>
                <Button size="sm" variant="secondary" onClick={downloadFa3Xml}>
                  Pobierz plik FA(3) .xml
                </Button>
              </div>
              <pre className="max-h-44 overflow-auto rounded border border-[#e5e2d9] bg-[#faf9f5] p-2.5 font-mono text-[11px] leading-relaxed text-[#191c1a]">
                {fa3Export.xmlContent}
              </pre>
            </div>
          ) : null}

          {issueResult ? (
            <AlertBanner
              tone={issueResult.status === 'mock_simulated_local_only' ? 'info' : 'warning'}
              title={
                issueResult.status === 'mock_simulated_local_only'
                  ? 'Symulacja wysyłki w lokalnym mocku KSeF 2.0 (bez mocy urzędowej)'
                  : 'Wysyłka zewnętrzna KSeF 2.0 wstrzymana — brak tokenu testowego MF (NOT RUN)'
              }
            >
              {issueResult.messagePl}
            </AlertBanner>
          ) : null}

          {syncResult ? (
            <AlertBanner tone="info" title="Wynik synchronizacji kolejki odbiorczej KSeF Sandbox">
              {syncResult.messagePl}
            </AlertBanner>
          ) : null}

          <form
            noValidate
            onSubmit={(e) => void handleArchiveWorm(e)}
            className="grid gap-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5 sm:grid-cols-3"
          >
            <FormField id="worm-archive-filename" label="Archiwum źródłowe WORM (nazwa pliku)">
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={wormName}
                  onChange={(e) => setWormName(e.target.value)}
                  className={`${ctrl.className} font-mono text-xs`}
                />
              )}
            </FormField>
            <FormField
              id="worm-archive-content"
              label="Treść / suma załącznika spoza KSeF (deduplikacja SHA-256)"
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={wormContent}
                  onChange={(e) => setWormContent(e.target.value)}
                  placeholder="Wklej treść noty / załącznika do trwałego archiwum"
                />
              )}
            </FormField>
            <div className="flex items-end gap-2">
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                data-testid="worm-archive-submit-button"
                disabled={busy || !canWrite}
              >
                Zabezpiecz w archiwum WORM
              </Button>
            </div>
          </form>

          {wormResult ? (
            <p
              data-testid="worm-archive-saved-badge"
              className="font-mono text-xs tabular-nums text-[#1d5c42]"
            >
              Zapisano niezmienny rekord WORM ({wormResult.archiveId}) · SHA-256:{' '}
              {wormResult.sha256Hex}
            </p>
          ) : null}
        </div>
      </Card>

      {selectedDoc ? (
        <CriticalConfirmDialog
          open={confirmSendOpen}
          operationType="declaration_approve"
          title="Potwierdź nieprodukcyjną operację KSeF 2.0 Sandbox"
          description={`Potwierdzasz jako człowiek operację testową KSeF 2.0 (${environment}) dla dokumentu ${selectedDoc.documentNumber}.`}
          companyName={companyName}
          nip={companyNip}
          period={period}
          amountGrosze={selectedDoc.grossGrosze}
          auditConsequences={[
            'Bramki produkcyjne ksef.mf.gov.pl są sprzętowo zablokowane (HTTP 403).',
            'Operacja nie wywołuje skutków prawnych w Ministerstwie Finansów i nie generuje urzędowego UPO.',
          ]}
          confirmLabel="Potwierdzam wykonanie w KSeF Sandbox"
          isSubmitting={busy}
          onCancel={() => setConfirmSendOpen(false)}
          onConfirm={() => {
            void executeConfirmedSandboxIssue();
          }}
        />
      ) : null}
    </div>
  );
}
