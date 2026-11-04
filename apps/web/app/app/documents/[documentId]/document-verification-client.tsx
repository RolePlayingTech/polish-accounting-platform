'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  createVatRegisterEntry,
  parsePlnToGrosze,
  qualifyKpirExpense,
  type KpirExpenseQualificationKind,
  type VatDeductionMode,
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
import { AlertBanner } from '../../../../components/ui-controls';
import { mapDomainExplanationToBasisInfo } from '../../../../lib/field-help';
import type {
  CompanyProfileRecord,
  WorkspaceDocumentRecord,
} from '../../../../lib/workspace-types';

export interface DocumentVerificationClientProps {
  company: CompanyProfileRecord;
  document: WorkspaceDocumentRecord;
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
  helpMap,
}: DocumentVerificationClientProps) {
  const router = useRouter();
  const canWrite = company.grantedActions.includes('write');
  const isAlreadyPosted = document.status === 'approved_posted';

  const [docNumber, setDocNumber] = useState(document.documentNumber);
  const [issueDate, setIssueDate] = useState(document.issueDate);
  const [counterpartyName, setCounterpartyName] = useState(document.counterpartyName);
  const [counterpartyNip, setCounterpartyNip] = useState(document.counterpartyNip);
  const [netPln, setNetPln] = useState((document.netGrosze / 100).toFixed(2));
  const [vatPln, setVatPln] = useState((document.vatGrosze / 100).toFixed(2));
  const [expenseQualification, setExpenseQualification] = useState<KpirExpenseQualificationKind>(
    document.expenseQualification,
  );
  const [vatDeductionMode, setVatDeductionMode] = useState<VatDeductionMode>(
    document.vatDeductionMode,
  );

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
    try {
      netGrosze = parsePlnToGrosze(netPln);
      vatGrosze = parsePlnToGrosze(vatPln);
    } catch {
      // Pozostaw poprzednią kwotę przy niepełnym wpisywaniu
    }

    const vatEntry = createVatRegisterEntry({
      id: `live-vat-${document.documentId}`,
      registerType: document.direction,
      period: document.period,
      taxPointDate: issueDate || document.eventDate,
      issueDate: issueDate || document.issueDate,
      documentNumber: docNumber || document.documentNumber,
      counterpartyName: counterpartyName || document.counterpartyName,
      counterpartyNip: counterpartyNip || document.counterpartyNip,
      vatRate: document.vatRate,
      netGrosze,
      vatTotalGrosze: vatGrosze,
      deductionMode: vatDeductionMode,
      annex15Item: document.annex15Item,
      ksefMarker: document.ksefMarker,
    });

    const kup =
      document.direction === 'purchase' && expenseQualification !== 'none'
        ? qualifyKpirExpense({
            eventDate: issueDate || document.eventDate,
            qualificationKind: expenseQualification,
            netGrosze,
            vatGrosze,
            taxpayerVatActive: company.vatStatus === 'czynny',
            deductibleVatGrosze: vatEntry.deductibleVatGrosze,
          })
        : null;

    const basis = kup
      ? mapDomainExplanationToBasisInfo(
          kup.explanation,
          `Kwalifikacja podatkowa kosztu i VAT (${docNumber})`,
        )
      : mapDomainExplanationToBasisInfo(
          vatEntry.explanation,
          `Ujęcie w rejestrze VAT (${docNumber})`,
        );

    return {
      netGrosze,
      vatGrosze,
      grossGrosze: netGrosze + vatGrosze,
      vatEntry,
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
    netPln,
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
          counterpartyNip,
          issueDate,
          netPln,
          vatPln,
          expenseQualification,
          vatDeductionMode,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        document?: { postedEntryId?: string };
      };
      setConfirmOpen(false);
      if (!response.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa lub błąd księgowania (HTTP ${String(response.status)})`,
          detail: data.error ?? 'Nie udało się zatwierdzić dokumentu.',
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
        title: 'Błąd połączenia z BFF',
        detail: 'Nie udało się wysłać zatwierdzenia.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="document-split-verification-workbench" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/app/documents"
          className="text-xs font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
        >
          ← Powrót do listy dokumentów
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {document.isDuplicateSha256 ? (
            <StatusBadge tone="danger" label="Ostrzeżenie: wykryto duplikat SHA-256!" />
          ) : null}
          <StatusBadge
            tone="legal"
            label={
              document.ksefReferenceNumber
                ? `KSeF FA(3): ${document.ksefReferenceNumber}`
                : `Znacznik JPK: ${document.ksefMarker}`
            }
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
              : `Propozycja AI (${String(document.aiConfidencePercent)}%) — czeka na decyzję człowieka`
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
                  Treść oryginału / XML KSeF FA(3)
                </span>
                <span className="font-mono">
                  Biała Lista KAS: {document.whiteListCheckId ?? 'zweryfikowano'}
                </span>
              </div>
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
            confidencePercent={document.aiConfidencePercent}
            extractionSource={document.sourceChannel}
            readOnly={isAlreadyPosted || !canWrite}
          />

          <AiProposalField
            id="verify-issue-date"
            label="Data wystawienia / zdarzenia gospodarczego"
            proposedValue={document.aiProposed.issueDate}
            value={issueDate}
            onChange={setIssueDate}
            confidence={document.aiConfidence}
            confidencePercent={document.aiConfidencePercent}
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
            confidencePercent={document.aiConfidencePercent}
            readOnly={isAlreadyPosted || !canWrite}
          />

          <AiProposalField
            id="verify-counterparty-nip"
            label="NIP kontrahenta"
            proposedValue={document.aiProposed.counterpartyNip}
            value={counterpartyNip}
            onChange={setCounterpartyNip}
            confidence={document.aiConfidence}
            confidencePercent={document.aiConfidencePercent}
            numeric
            fieldHelp={helpMap.nip}
            readOnly={isAlreadyPosted || !canWrite}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <AiProposalField
              id="verify-net-pln"
              label="Kwota netto (PLN)"
              proposedValue={(document.aiProposed.netGrosze / 100).toFixed(2)}
              value={netPln}
              onChange={setNetPln}
              confidence={document.aiConfidence}
              numeric
              readOnly={isAlreadyPosted || !canWrite}
            />
            <AiProposalField
              id="verify-vat-pln"
              label={`Kwota VAT (${document.vatRate}%, PLN)`}
              proposedValue={(document.aiProposed.vatGrosze / 100).toFixed(2)}
              value={vatPln}
              onChange={setVatPln}
              confidence={document.aiConfidence}
              numeric
              readOnly={isAlreadyPosted || !canWrite}
            />
          </div>

          {document.direction === 'purchase' ? (
            <div
              data-testid="document-tax-qualification-panel"
              className="space-y-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-3.5"
            >
              <FormField
                id="verify-expense-qualification"
                label="Kwalifikacja kosztu uzyskania przychodów (KUP / KPiR)"
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
                      100% KUP — Pozostałe wydatki (kolumna 13 KPiR)
                    </option>
                    <option value="goods_and_materials_col10">
                      100% KUP — Zakup towarów handlowych i materiałów (kolumna 10 KPiR)
                    </option>
                    <option value="vehicle_mixed_75_col13">
                      75% KUP / 50% VAT — Eksploatacja samochodu osobowego mieszanego (art. 23 ust.
                      1 pkt 46a PIT)
                    </option>
                    <option value="research_development_col16">
                      100% KUP — Koszty działalności badawczo-rozwojowej B+R (kolumna 16 KPiR)
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
                    <option value="none_0">0% — brak prawa do odliczenia VAT</option>
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
                    amount={liveCalculation.vatEntry.deductibleVatGrosze}
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
                    amount={liveCalculation.vatEntry.nonDeductibleVatGrosze}
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
        description={`Zatwierdzasz jako człowiek propozycję AI dla dowodu ${docNumber} (${counterpartyName}).`}
        companyName={company.companyName}
        nip={company.nip}
        period={document.period}
        amountGrosze={liveCalculation.grossGrosze}
        auditConsequences={[
          `Dokument przejdzie ze stanu propozycji AI do stanu „Zweryfikowany i zaksięgowany” (POST .../approve-and-post).`,
          `Kwota ujęcia w ewidencji i rejestrze VAT zostanie utrwalona wraz z podpisem aktora ${company.shortName}.`,
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
