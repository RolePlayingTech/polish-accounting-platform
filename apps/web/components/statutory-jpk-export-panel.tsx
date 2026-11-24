'use client';

import { useState } from 'react';
import type { ApplicableJpkStructureDescriptor, OfficialJpkStructureCode } from '@pap/domain';
import { Card, FormField, StatusBadge } from '@pap/ui';
import { formatUserFacingErrorPl } from '../lib/error-messages-pl';
import type { ExportedJpkXmlView } from '../lib/wave2-statutory-and-close';
import { AlertBanner, Button } from './ui-controls';

export interface StatutoryJpkExportPanelProps {
  readonly period: string;
  readonly structures: readonly ApplicableJpkStructureDescriptor[];
  readonly vatActive: boolean;
}

const OBLIGATION_KIND_LABEL: Record<
  ApplicableJpkStructureDescriptor['obligationKind'],
  { readonly label: string; readonly tone: 'legal' | 'info' | 'neutral' }
> = {
  periodic_statutory: { label: 'Miesięczny / okresowy obowiązek ustawowy', tone: 'legal' },
  annual_statutory: { label: 'Roczny obowiązek JPK_PD', tone: 'info' },
  on_demand_or_annual: { label: 'Na żądanie organu / kolejna fala JPK_PD', tone: 'neutral' },
};

export function StatutoryJpkExportPanel({
  period,
  structures,
  vatActive,
}: StatutoryJpkExportPanelProps) {
  const [selectedStructure, setSelectedStructure] = useState<OfficialJpkStructureCode>(
    structures[0]?.structureCode ?? 'JPK_PKPIR(3)',
  );
  const [purpose, setPurpose] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportedJpkXmlView | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleGenerateXml() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'export_jpk_xml',
          period,
          structureCode: selectedStructure,
          purpose,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        artifact?: ExportedJpkXmlView;
      };
      if (!res.ok || !data.ok || !data.artifact) {
        setErrorMsg(
          formatUserFacingErrorPl({
            status: res.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się wygenerować i zwalidować pliku XML JPK.',
          }),
        );
      } else {
        setExported(data.artifact);
      }
    } catch {
      setErrorMsg('Błąd połączenia podczas generowania pliku XML JPK.');
    } finally {
      setBusy(false);
    }
  }

  function downloadExportedXml() {
    if (!exported) return;
    const blob = new Blob([exported.xmlContent], { type: 'application/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = exported.fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-testid="statutory-jpk-export-panel">
      <Card
        as="section"
        eyebrow={`Eksport struktur JPK zgodnych z XSD MF · okres ${period}`}
        title="Generator urzędowych plików XML JPK i kontrola statusu wysyłki"
        actions={
          <StatusBadge
            size="sm"
            tone={exported ? 'info' : 'neutral'}
            label={
              exported
                ? 'Wyeksportowany do podpisu zewnętrznego (brak UPO)'
                : 'Szkic wyliczenia (nieeksportowany)'
            }
          />
        }
      >
        <div className="space-y-4">
          <AlertBanner
            tone="legal"
            title="Uczciwy status deklaracji: lokalna walidacja XSD bez fikcyjnego potwierdzenia UPO"
          >
            Wygenerowany plik <code className="font-mono">.xml</code> jest budowany ze
            zaksięgowanych zapisów firmy wg urzędowych przestrzeni nazw Ministerstwa Finansów (
            {vatActive ? 'JPK_V7M(3) od 01.02.2026 oraz JPK_PD' : 'struktury dochodowe JPK_PD'}).
            Aplikacja <strong>nie wysyła</strong> plików na produkcyjną bramkę e-Deklaracje / e-US i{' '}
            <strong>nigdy nie nadaje fikcyjnego numeru UPO</strong>.
          </AlertBanner>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {structures.map((st) => {
              const kindMeta =
                OBLIGATION_KIND_LABEL[st.obligationKind] ??
                OBLIGATION_KIND_LABEL.periodic_statutory;
              const isSelected = st.structureCode === selectedStructure;
              return (
                <button
                  key={st.structureCode}
                  type="button"
                  data-testid={`jpk-structure-option-${st.structureCode}`}
                  onClick={() => {
                    setSelectedStructure(st.structureCode);
                    setExported(null);
                    setErrorMsg(null);
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    isSelected
                      ? 'border-[#1d5c42] bg-[#e7f1ec]/70'
                      : 'border-[#e5e2d9] bg-[#faf9f5] hover:border-[#858177]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-mono text-xs font-bold text-[#191c1a]">
                      {st.structureCode}
                    </span>
                    <StatusBadge size="sm" tone={kindMeta.tone} label={kindMeta.label} />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-[#464c48]">{st.notesPl}</p>
                  <p className="mt-1 font-mono text-[10px] text-[#636b66]">
                    Od: {st.statutoryEffectiveFrom}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5 sm:grid-cols-3">
            <FormField id="jpk-export-structure-select" label="Wybrana struktura MF XSD">
              {(ctrl) => (
                <select
                  {...ctrl}
                  value={selectedStructure}
                  onChange={(e) => {
                    setSelectedStructure(e.target.value as OfficialJpkStructureCode);
                    setExported(null);
                  }}
                  className={`${ctrl.className} font-mono`}
                >
                  {structures.map((s) => (
                    <option key={s.structureCode} value={s.structureCode}>
                      {s.structureCode}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField id="jpk-export-purpose-select" label="Cel złożenia (CelZlozenia)">
              {(ctrl) => (
                <select
                  {...ctrl}
                  value={String(purpose)}
                  onChange={(e) => setPurpose(e.target.value === '2' ? 2 : 1)}
                >
                  <option value="1">1 — Złożenie pliku po raz pierwszy za okres</option>
                  <option value="2">2 — Korekta wcześniej złożonego pliku JPK</option>
                </select>
              )}
            </FormField>

            <div className="flex items-end gap-2">
              <Button
                data-testid="generate-jpk-xml-button"
                disabled={busy || structures.length === 0}
                onClick={() => void handleGenerateXml()}
              >
                {busy ? 'Generowanie i walidacja…' : 'Generuj i zwaliduj plik XML JPK'}
              </Button>
            </div>
          </div>

          {errorMsg ? (
            <AlertBanner tone="danger" title="Odmowa eksportu pliku JPK">
              {errorMsg}
            </AlertBanner>
          ) : null}

          {exported ? (
            <div
              data-testid="exported-jpk-xml-result"
              className="space-y-3 rounded-xl border border-[#1d5c42] bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-[#191c1a]">
                    Gotowy eksport lokalny: <code className="font-mono">{exported.fileName}</code> (
                    {String(exported.xmlByteLength)} B)
                  </p>
                  <p className="font-mono text-[11px] tabular-nums text-[#464c48]">
                    SHA-256: {exported.xmlSha256Hex} · UPO: brak (nieprzesłano do MF)
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="download-jpk-xml-button"
                  onClick={downloadExportedXml}
                >
                  Pobierz plik .xml do podpisu
                </Button>
              </div>
              <p className="text-xs text-[#464c48]">{exported.truthfulnessNoticePl}</p>
              <pre className="max-h-56 overflow-auto rounded border border-[#e5e2d9] bg-[#faf9f5] p-3 font-mono text-[11px] leading-relaxed text-[#191c1a]">
                {exported.xmlContent}
              </pre>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
