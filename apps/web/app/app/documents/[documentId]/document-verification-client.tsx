'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  createVatRegisterEntry,
  formatPlnFromGrosze,
  parsePlnToGrosze,
  qualifyKpirExpense,
  validatePolishNip,
  type KpirExpenseQualificationKind,
  type RyczaltRateCode,
  type VatDeductionMode,
  type VatRateCode,
} from '@pap/domain';
import {
  AiProposalField,
  Card,
  CriticalConfirmDialog,
  FieldHelpButton,
  FormField,
  LegalBasisPanel,
  MoneyAmount,
  SplitVerificationView,
  StatusBadge,
  type FieldHelpInfo,
} from '@pap/ui';
import {
  PurchaseQualificationHelpNotice,
  RyczaltRateGuideTrigger,
  VatRateGuideTrigger,
} from '../../../../components/tax-guide-drawer';
import { AlertBanner } from '../../../../components/ui-controls';
import { formatUserFacingErrorPl, isValidIsoCalendarDate } from '../../../../lib/error-messages-pl';
import { mapDomainExplanationToBasisInfo } from '../../../../lib/field-help';
import type {
  CompanyProfileRecord,
  WorkspaceDocumentRecord,
} from '../../../../lib/workspace-types';

function formatVatRateLabel(rate: VatRateCode): string {
  return rate === 'zw' ? 'zw.' : rate === 'np' ? 'np.' : `${rate}%`;
}

export interface DocumentVerificationClientProps {
  company: CompanyProfileRecord;
  document: WorkspaceDocumentRecord;
  resolvedCorrectedEntryId?: string | undefined;
  helpMap: {
    readonly nip: FieldHelpInfo;
    readonly ksefReference: FieldHelpInfo;
    readonly gtuCode: FieldHelpInfo;
    readonly vehicle75Kup: FieldHelpInfo;
    readonly kupDeductibility: FieldHelpInfo;
    readonly vat50Vehicle: FieldHelpInfo;
  };
}

export function DocumentVerificationClient({
  company,
  document,
  resolvedCorrectedEntryId,
  helpMap,
}: DocumentVerificationClientProps) {
  const router = useRouter();
  const canWrite = company.grantedActions.includes('write');
  const isAlreadyPosted = document.status === 'approved_posted';
  const hasMultipleLines = Boolean(document.lines && document.lines.length > 1);
  const isCorrectionDoc = Boolean(document.isCorrection) || document.documentKind === 'correction';
  const lockHeaderAmounts = hasMultipleLines || isCorrectionDoc;

  const [docNumber, setDocNumber] = useState(document.documentNumber);
  const [issueDate, setIssueDate] = useState(document.issueDate);
  const [counterpartyName, setCounterpartyName] = useState(document.counterpartyName);
  const [counterpartyNip, setCounterpartyNip] = useState(document.counterpartyNip);
  const [noPolishNip, setNoPolishNip] = useState(!document.counterpartyNip);
  const [netPln, setNetPln] = useState((document.netGrosze / 100).toFixed(2));
  const [vatPln, setVatPln] = useState((document.vatGrosze / 100).toFixed(2));
  const [correctedEntryId, setCorrectedEntryId] = useState(
    resolvedCorrectedEntryId ??
      document.correctedDocumentNumber ??
      `kor-ref-${document.documentId}`,
  );
  const [correctionReason, setCorrectionReason] = useState(
    document.correctionReason ?? 'Faktura korygująca (KOR)',
  );
  const [expenseQualification, setExpenseQualification] = useState<KpirExpenseQualificationKind>(
    document.expenseQualification,
  );
  const [vatDeductionMode, setVatDeductionMode] = useState<VatDeductionMode>(
    document.vatDeductionMode,
  );
  const [ryczaltRate, setRyczaltRate] = useState<RyczaltRateCode>(document.ryczaltRate ?? '12');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  const liveCalculation = useMemo(() => {
    let netGrosze = document.netGrosze;
    let vatGrosze = document.vatGrosze;
    if (!lockHeaderAmounts) {
      try {
        netGrosze = parsePlnToGrosze(netPln);
        vatGrosze = parsePlnToGrosze(vatPln);
      } catch {
        // Pozostaw poprzednią kwotę przy niepełnym wpisywaniu
      }
    }

    const amountsEdited =
      !lockHeaderAmounts && (netGrosze !== document.netGrosze || vatGrosze !== document.vatGrosze);
    const safeIssueDate = isValidIsoCalendarDate(issueDate) ? issueDate.trim() : document.issueDate;
    const nipValidation = validatePolishNip(counterpartyNip);
    const safeNip = noPolishNip
      ? 'BrakID'
      : nipValidation.valid && nipValidation.normalizedNip
        ? nipValidation.normalizedNip
        : document.counterpartyNip || 'BrakID';
    const safeDocNum = docNumber.trim() || document.documentNumber;
    const safeCounterpartyName = counterpartyName.trim() || document.counterpartyName;

    const rateBuckets = new Map<
      VatRateCode,
      { netGrosze: number; vatTotalGrosze: number; hasAnnex15: boolean }
    >();
    if (!amountsEdited && document.lines && document.lines.length > 0) {
      for (const line of document.lines) {
        const prev = rateBuckets.get(line.vatRate) ?? {
          netGrosze: 0,
          vatTotalGrosze: 0,
          hasAnnex15: false,
        };
        rateBuckets.set(line.vatRate, {
          netGrosze: prev.netGrosze + line.netGrosze,
          vatTotalGrosze: prev.vatTotalGrosze + line.vatGrosze,
          hasAnnex15: prev.hasAnnex15 || Boolean(line.annex15Item),
        });
      }
    }
    if (rateBuckets.size === 0) {
      rateBuckets.set(document.vatRate, {
        netGrosze,
        vatTotalGrosze: vatGrosze,
        hasAnnex15: document.annex15Item,
      });
    }

    let primaryVatEntry: ReturnType<typeof createVatRegisterEntry> | null = null;
    let totalDeductibleVatGrosze = 0;
    let totalNonDeductibleVatGrosze = 0;
    let idx = 0;

    for (const [rate, group] of rateBuckets.entries()) {
      idx += 1;
      const entry = createVatRegisterEntry({
        id: `live-vat-${document.documentId}-${String(idx)}`,
        registerType: document.direction,
        period: safeIssueDate.slice(0, 7),
        taxPointDate: safeIssueDate,
        issueDate: safeIssueDate,
        documentNumber: safeDocNum,
        counterpartyName: safeCounterpartyName,
        counterpartyNip: safeNip,
        vatRate: rate,
        netGrosze: group.netGrosze,
        vatTotalGrosze: group.vatTotalGrosze,
        deductionMode: document.direction === 'sales' ? 'full_100' : vatDeductionMode,
        annex15Item: group.hasAnnex15,
        ksefMarker: document.ksefMarker,
        ...(document.ksefReferenceNumber !== undefined
          ? { ksefReferenceNumber: document.ksefReferenceNumber }
          : {}),
      });
      if (!primaryVatEntry) {
        primaryVatEntry = entry;
      }
      totalDeductibleVatGrosze += entry.deductibleVatGrosze;
      totalNonDeductibleVatGrosze += entry.nonDeductibleVatGrosze;
    }

    const vatEntry = primaryVatEntry!;

    const kup =
      document.direction === 'purchase' && expenseQualification !== 'none'
        ? qualifyKpirExpense({
            eventDate: safeIssueDate,
            qualificationKind: expenseQualification,
            netGrosze,
            vatGrosze,
            taxpayerVatActive: company.vatStatus === 'czynny',
            deductibleVatGrosze: totalDeductibleVatGrosze,
          })
        : null;

    const basis = kup
      ? mapDomainExplanationToBasisInfo(
          kup.explanation,
          `Kwalifikacja podatkowa kosztu i VAT (${safeDocNum})`,
        )
      : mapDomainExplanationToBasisInfo(
          vatEntry.explanation,
          `Ujęcie w rejestrze VAT (${safeDocNum})`,
        );

    return {
      netGrosze,
      vatGrosze,
      grossGrosze: netGrosze + vatGrosze,
      amountsEdited,
      vatEntry,
      totalDeductibleVatGrosze,
      totalNonDeductibleVatGrosze,
      kup,
      basis,
    };
  }, [
    company.vatStatus,
    counterpartyName,
    counterpartyNip,
    docNumber,
    document,
    expenseQualification,
    issueDate,
    lockHeaderAmounts,
    netPln,
    noPolishNip,
    vatDeductionMode,
    vatPln,
  ]);

  async function executeApproveAndPost() {
    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_and_post_document',
          documentId: document.documentId,
          documentNumber: docNumber,
          counterpartyName,
          counterpartyNip: noPolishNip ? '' : counterpartyNip,
          noPolishNip,
          issueDate,
          netPln,
          vatPln,
          amountsEdited: liveCalculation.amountsEdited,
          isCorrection: isCorrectionDoc,
          ...(isCorrectionDoc
            ? {
                correctedEntryId:
                  correctedEntryId.trim() ||
                  document.correctedDocumentNumber ||
                  `kor-ref-${document.documentId}`,
                correctionReason: correctionReason.trim() || 'Faktura korygująca (KOR)',
              }
            : {}),
          expenseQualification,
          vatDeductionMode,
          ...(document.direction === 'sales' && company.profileCode === 'jdg_ryczalt'
            ? { ryczaltRate }
            : {}),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        reasonCode?: string;
        error?: string;
        document?: { postedEntryId?: string };
      };
      setConfirmOpen(false);
      if (!response.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa lub błąd księgowania (HTTP ${String(response.status)})`,
          detail: formatUserFacingErrorPl({
            status: response.status,
            reasonCode: data.reasonCode,
            rawMessage: data.error,
            fallbackPl: 'Nie udało się zatwierdzić dokumentu.',
          }),
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Dokument zatwierdzony przez człowieka i zaksięgowany',
          detail: `Zapisano wpis księgowy (${data.document?.postedEntryId ?? 'OK'}) oraz ślad audytowy DOCUMENT_APPROVED_AND_POSTED.`,
        });
        router.refresh();
      }
    } catch {
      setConfirmOpen(false);
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z warstwą sesji BFF',
        detail: 'Nie udało się wysłać zatwierdzenia. Księgi pozostały nienaruszone.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const ksefHeaderBadgeLabel = document.ksefReferenceNumber
    ? document.ksefVerificationStatus === 'parsed_xml_unverified'
      ? `XML FA · NrKSeF: ${document.ksefReferenceNumber} (niezweryfikowano online w MF)`
      : `NrKSeF deklarowany: ${document.ksefReferenceNumber} (niezweryfikowano w MF)`
    : document.ksefMarker === 'BFK'
      ? 'Poza KSeF (BFK — nieprzesłano)'
      : `Znacznik JPK: ${document.ksefMarker}`;

  return (
    <div data-testid="document-split-verification-workbench" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/app/documents"
          className="inline-flex min-h-6 items-center text-xs font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
        >
          ← Powrót do listy dokumentów
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {document.isDuplicateSha256 ? (
            <StatusBadge tone="danger" label="Ostrzeżenie: wykryto duplikat SHA-256!" />
          ) : null}
          <StatusBadge
            tone={document.ksefReferenceNumber ? 'legal' : 'neutral'}
            label={ksefHeaderBadgeLabel}
          />
          <FieldHelpButton help={helpMap.ksefReference} />
          <FieldHelpButton help={helpMap.gtuCode} />
        </div>
      </div>

      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div data-testid="tutorial-invoice-split-verification">
        <SplitVerificationView
          documentTitle={`${document.documentNumber} · ${document.counterpartyName}`}
          fileName={document.fileName}
          mimeLabel={document.mimeLabel}
          sha256={document.sha256}
          sourceChannel={document.sourceChannel}
          uploadedAtLabel={document.uploadedAtLabel}
          verificationStatusLabel={
            isAlreadyPosted
              ? `Zaksięgowano (${document.postedEntryId ?? 'OK'})`
              : `${document.extractionMethodLabelPl ?? 'Wymaga weryfikacji człowieka'}${document.aiConfidencePercent !== null && document.aiConfidencePercent !== undefined ? ` (${String(document.aiConfidencePercent)}%)` : ''} — czeka na decyzję człowieka`
          }
          verificationTone={isAlreadyPosted ? 'success' : 'warning'}
          primaryActionLabel="Zatwierdź i zaksięguj dokument"
          {...(canWrite && !isAlreadyPosted
            ? {
                onApprove: () => setConfirmOpen(true),
              }
            : {})}
          previewContent={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e2d9] pb-2 text-xs text-[#464c48]">
                <span className="font-semibold text-[#191c1a]">
                  Treść oryginału / pozycje źródłowe
                </span>
                <span className="font-mono">
                  Biała Lista KAS:{' '}
                  {document.whiteListStatus === 'verified_kas'
                    ? (document.whiteListCheckId ?? 'zweryfikowano w API MF')
                    : document.whiteListStatus === 'mismatch_alert'
                      ? 'Uwaga: IBAN poza Białą Listą!'
                      : 'Niesprawdzone w API KAS'}
                </span>
              </div>

              {document.lines && document.lines.length > 0 ? (
                <div
                  data-testid="split-view-document-lines-table"
                  className="overflow-x-auto rounded border border-[#e5e2d9] bg-white"
                >
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-b border-[#e5e2d9] bg-[#f4f2ec] text-[11px] font-semibold text-[#464c48]">
                      <tr>
                        <th className="px-2.5 py-1.5">Poz.</th>
                        <th className="px-2.5 py-1.5">Opis pozycji</th>
                        <th className="px-2.5 py-1.5 text-right">Ilość</th>
                        <th className="px-2.5 py-1.5 text-right">Netto</th>
                        <th className="px-2.5 py-1.5 text-right">Stawka</th>
                        <th className="px-2.5 py-1.5 text-right">VAT</th>
                        <th className="px-2.5 py-1.5 text-right">Brutto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#efede6]">
                      {document.lines.map((line) => (
                        <tr key={line.lineNumber}>
                          <td className="px-2.5 py-1.5 font-mono tabular-nums">
                            {String(line.lineNumber)}
                          </td>
                          <td className="px-2.5 py-1.5 font-medium text-[#191c1a]">
                            {line.description}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {line.quantity} {line.unit}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {formatPlnFromGrosze(line.netGrosze)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {formatVatRateLabel(line.vatRate)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {formatPlnFromGrosze(line.vatGrosze)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums">
                            {formatPlnFromGrosze(line.grossGrosze)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-[#e5e2d9] bg-[#faf9f5] p-3 font-mono text-xs leading-relaxed text-[#191c1a]">
                {document.rawPreviewText}
              </pre>
            </div>
          }
          legalBasis={liveCalculation.basis}
        >
          <AiProposalField
            id="verify-doc-number"
            label="Numer dowodu księgowego"
            proposedValue={document.aiProposed.documentNumber}
            value={docNumber}
            onChange={setDocNumber}
            confidence={document.aiConfidence}
            {...(document.aiConfidencePercent !== null && document.aiConfidencePercent !== undefined
              ? { confidencePercent: document.aiConfidencePercent }
              : {})}
            extractionSource={document.extractionMethodLabelPl ?? document.sourceChannel}
            readOnly={isAlreadyPosted || !canWrite}
          />

          <AiProposalField
            id="verify-issue-date"
            label="Data wystawienia / zdarzenia gospodarczego"
            proposedValue={document.aiProposed.issueDate}
            value={issueDate}
            onChange={setIssueDate}
            confidence={document.aiConfidence}
            {...(document.aiConfidencePercent !== null && document.aiConfidencePercent !== undefined
              ? { confidencePercent: document.aiConfidencePercent }
              : {})}
            numeric
            readOnly={isAlreadyPosted || !canWrite}
          />

          <AiProposalField
            id="verify-counterparty-name"
            label="Nazwa kontrahenta"
            proposedValue={document.aiProposed.counterpartyName}
            value={counterpartyName}
            onChange={setCounterpartyName}
            confidence={document.aiConfidence}
            {...(document.aiConfidencePercent !== null && document.aiConfidencePercent !== undefined
              ? { confidencePercent: document.aiConfidencePercent }
              : {})}
            readOnly={isAlreadyPosted || !canWrite}
          />

          {!noPolishNip ? (
            <AiProposalField
              id="verify-counterparty-nip"
              label="NIP kontrahenta"
              proposedValue={document.aiProposed.counterpartyNip || 'BrakID'}
              value={counterpartyNip}
              onChange={setCounterpartyNip}
              confidence={document.aiConfidence}
              {...(document.aiConfidencePercent !== null &&
              document.aiConfidencePercent !== undefined
                ? { confidencePercent: document.aiConfidencePercent }
                : {})}
              numeric
              fieldHelp={helpMap.nip}
              readOnly={isAlreadyPosted || !canWrite}
            />
          ) : (
            <p className="rounded-md border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2 text-xs text-[#464c48]">
              Kontrahent bez polskiego numeru NIP (<code className="font-mono">BrakID</code>).
              {!isAlreadyPosted && canWrite ? (
                <button
                  type="button"
                  onClick={() => setNoPolishNip(false)}
                  className="ml-2 font-semibold text-[#1d5c42] underline"
                >
                  Uzupełnij polski NIP
                </button>
              ) : null}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <AiProposalField
              id="verify-net-pln"
              label={hasMultipleLines ? 'Suma netto wszystkich pozycji (PLN)' : 'Kwota netto (PLN)'}
              proposedValue={(document.aiProposed.netGrosze / 100).toFixed(2)}
              value={netPln}
              onChange={setNetPln}
              confidence={document.aiConfidence}
              numeric
              readOnly={isAlreadyPosted || !canWrite || lockHeaderAmounts}
            />
            <AiProposalField
              id="verify-vat-pln"
              label={
                hasMultipleLines
                  ? 'Suma podatku VAT wszystkich stawek (PLN)'
                  : `Kwota VAT (${formatVatRateLabel(document.vatRate)}, PLN)`
              }
              proposedValue={(document.aiProposed.vatGrosze / 100).toFixed(2)}
              value={vatPln}
              onChange={setVatPln}
              confidence={document.aiConfidence}
              numeric
              readOnly={isAlreadyPosted || !canWrite || lockHeaderAmounts}
            />
          </div>

          {lockHeaderAmounts ? (
            <p className="rounded-md border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2 text-xs text-[#464c48]">
              {isCorrectionDoc
                ? 'Kwoty ujemne faktury korygującej (KOR) są zablokowane do odczytu w podsumowaniu nagłówka — wynikają bezpośrednio z pozycji korekty widocznych po lewej stronie.'
                : 'Suma nagłówka wynika z podziału pozycji na stawki VAT w tabeli po lewej stronie — zaksięgowanie zachowuje wszystkie stawki bez spłaszczania.'}
            </p>
          ) : null}

          {isCorrectionDoc ? (
            <div
              data-testid="verify-correction-metadata-panel"
              className="grid gap-3 rounded-lg border border-[#dcd3b8] bg-[#faf8f1] p-3 sm:grid-cols-2"
            >
              <FormField
                id="verify-corrected-entry-id"
                label="Dowód / wpis korygowany (art. 106j VAT)"
                required
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    disabled={isAlreadyPosted || !canWrite}
                    value={correctedEntryId}
                    onChange={(e) => setCorrectedEntryId(e.target.value)}
                    className={`${ctrl.className} font-mono text-xs`}
                  />
                )}
              </FormField>
              <FormField id="verify-correction-reason" label="Przyczyna korekty" required>
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    disabled={isAlreadyPosted || !canWrite}
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}

          <VatRateGuideTrigger
            selectedRate={document.vatRate}
            eventDate={issueDate}
            profileCode={company.profileCode}
          />

          {document.direction === 'purchase' ? (
            <div
              data-testid="document-tax-qualification-panel"
              className="space-y-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5"
            >
              <PurchaseQualificationHelpNotice
                profileCode={company.profileCode}
                vatStatus={company.vatStatus}
                eventDate={issueDate}
              />

              <FormField
                id="verify-expense-qualification"
                label="Kwalifikacja kosztu uzyskania przychodów (KUP / KPiR / CIT)"
                fieldHelp={
                  expenseQualification === 'vehicle_mixed_75_col13'
                    ? helpMap.vehicle75Kup
                    : helpMap.kupDeductibility
                }
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    disabled={isAlreadyPosted || !canWrite}
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
                      100% KUP — Pozostałe wydatki (Kol. 15 KPiR 2026 / Kol. 13 KPiR 2019)
                    </option>
                    <option value="goods_and_materials_col10">
                      100% KUP — Zakup towarów handlowych i materiałów (Kol. 12 KPiR 2026 / Kol. 10
                      KPiR 2019)
                    </option>
                    <option value="vehicle_mixed_75_col13">
                      75% KUP / 50% VAT — Eksploatacja samochodu osobowego mieszanego (art. 23 ust.
                      1 pkt 46a PIT)
                    </option>
                    <option value="research_development_col16">
                      100% KUP — Koszty działalności badawczo-rozwojowej B+R (Kol. 18 KPiR 2026 /
                      Kol. 16 KPiR 2019)
                    </option>
                    <option value="nkup_excluded">
                      0% NKUP — Koszty reprezentacji / wyłączone z KUP (art. 23 ust. 1 pkt 23 PIT)
                    </option>
                  </select>
                )}
              </FormField>

              <FormField
                id="verify-vat-deduction"
                label="Tryb odliczenia podatku VAT naliczonego"
                fieldHelp={helpMap.vat50Vehicle}
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    disabled={isAlreadyPosted || !canWrite}
                    value={vatDeductionMode}
                    onChange={(e) => setVatDeductionMode(e.target.value as VatDeductionMode)}
                  >
                    <option value="full_100">
                      100% odliczenia VAT (związek z czynnościami opodatkowanymi)
                    </option>
                    <option value="vehicle_mixed_50">
                      50% odliczenia VAT — pojazd samochodowy o użytku mieszanym (art. 86a VAT)
                    </option>
                    <option value="none_0">
                      0% — brak prawa do odliczenia VAT (np. zw. z VAT lub wyłączenia art. 88)
                    </option>
                  </select>
                )}
              </FormField>

              <div
                data-testid="vehicle-mixed-use-split-preview"
                className="grid gap-2 rounded-lg border border-[#e5e2d9] bg-white p-3 sm:grid-cols-3"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#636b66]">
                    VAT do odliczenia
                  </p>
                  <MoneyAmount
                    amount={liveCalculation.totalDeductibleVatGrosze}
                    inGrosze
                    size="sm"
                    variant="tax"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#636b66]">
                    VAT nieodliczony
                  </p>
                  <MoneyAmount
                    amount={liveCalculation.totalNonDeductibleVatGrosze}
                    inGrosze
                    size="sm"
                    variant="neutral"
                  />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#636b66]">
                    Kwota KUP do KPiR
                  </p>
                  <MoneyAmount
                    amount={liveCalculation.kup?.deductibleKupGrosze ?? 0}
                    inGrosze
                    size="sm"
                    variant="expense"
                  />
                </div>
              </div>
            </div>
          ) : company.profileCode === 'jdg_ryczalt' ? (
            <div className="space-y-3 rounded-xl border border-[#dcd3b8] bg-[#faf8f1] p-3.5">
              <FormField
                id="verify-ryczalt-rate"
                label="Stawka ryczałtu przychodu (art. 12 PPE)"
                required
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    disabled={isAlreadyPosted || !canWrite}
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
              <RyczaltRateGuideTrigger selectedRate={ryczaltRate} eventDate={issueDate} />
            </div>
          ) : null}
        </SplitVerificationView>
      </div>

      <Card as="div" eyebrow="Pełna ścieżka wyliczenia" title="Dlaczego? / Podstawa prawna ujęcia">
        <LegalBasisPanel basis={liveCalculation.basis} />
      </Card>

      <CriticalConfirmDialog
        open={confirmOpen}
        operationType="ledger_post"
        title="Potwierdź zatwierdzenie i zaksięgowanie dokumentu"
        description={`Zatwierdzasz jako człowiek propozycję dla dowodu ${docNumber} (${counterpartyName}).`}
        companyName={company.companyName}
        nip={company.nip}
        period={document.period}
        amountGrosze={liveCalculation.grossGrosze}
        auditConsequences={[
          `Dokument przejdzie ze stanu propozycji do stanu „Zweryfikowany i zaksięgowany” (POST .../approve-and-post).`,
          hasMultipleLines && !liveCalculation.amountsEdited
            ? `Wszystkie pozycje wielostawkowe (${String(document.lines?.length ?? 1)} poz.) zostaną ujęte w rejestrze VAT z podziałem na stawki.`
            : `Kwota ujęcia w ewidencji i rejestrze VAT zostanie utrwalona wraz z podpisem aktora ${company.shortName}.`,
        ]}
        confirmLabel="Zatwierdź i zaksięguj dokument"
        isSubmitting={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          void executeApproveAndPost();
        }}
      />
    </div>
  );
}
