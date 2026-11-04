'use client';

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { FieldHelpButton, type FieldHelpInfo } from './forms.js';
import { LegalBasisPanel, type LegalBasisInfo } from './legal-basis.js';
import { StatusBadge, ToneIcon } from './primitives.js';
import { ksiegaTokens, type StatusTone } from './tokens.js';

export type AiConfidenceLevel = 'high' | 'medium' | 'low';

const CONFIDENCE_META: Record<AiConfidenceLevel, { labelPl: string; tone: StatusTone }> = {
  high: {
    labelPl: 'Wysoka pewność ekstrakcji',
    tone: 'info',
  },
  medium: {
    labelPl: 'Średnia pewność — sprawdź z oryginałem',
    tone: 'warning',
  },
  low: {
    labelPl: 'Niska pewność — wymagana ręczna weryfikacja',
    tone: 'danger',
  },
};

export interface AiProposalFieldProps {
  id: string;
  label: string;
  proposedValue: string;
  value: string;
  onChange?: ((nextValue: string) => void) | undefined;
  confidence: AiConfidenceLevel;
  confidencePercent?: number | undefined;
  extractionSource?: string | undefined;
  numeric?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  fieldHelp?: FieldHelpInfo | undefined;
  readOnly?: boolean | undefined;
}

/**
 * Pole formularza weryfikacji dokumentu z jawnym oznaczeniem `Propozycja AI / OCR`,
 * poziomem pewności, widoczną różnicą (`diff`) względem wartości zatwierdzonej przez człowieka
 * oraz blokadą przypadkowego wysłania formularza klawiszem `Enter`.
 */
export function AiProposalField({
  confidence,
  confidencePercent,
  error,
  extractionSource = 'Propozycja AI / OCR',
  fieldHelp,
  hint,
  id,
  label,
  numeric = false,
  onChange,
  proposedValue,
  readOnly = false,
  value,
}: AiProposalFieldProps) {
  const confidenceSpec = CONFIDENCE_META[confidence];
  const isModifiedByHuman = value.trim() !== proposedValue.trim();
  const hintId = hint ? `${id}-hint` : undefined;
  const diffId = `${id}-proposal-status`;
  const errorId = error ? `${id}-error` : undefined;
  const ariaDescribedBy = [hintId, diffId, errorId].filter(Boolean).join(' ');

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  };

  const confidenceBadgeLabel =
    confidencePercent !== undefined
      ? `${confidenceSpec.labelPl} (${confidencePercent}%)`
      : confidenceSpec.labelPl;

  return (
    <div
      className={`rounded-xl border p-3.5 ${
        isModifiedByHuman
          ? 'border-[#b7d4c5] bg-[#f6fbf8]'
          : confidence === 'low'
            ? 'border-[#f5bcbc] bg-[#fffafa]'
            : 'border-[#e5e2d9] bg-white'
      }`}
      data-ai-confidence={confidence}
      data-proposal-diff={isModifiedByHuman ? 'modified' : 'unchanged'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-[#191c1a]" htmlFor={id}>
            {label}
          </label>
          {fieldHelp && <FieldHelpButton help={fieldHelp} />}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-[#dcd3b8] bg-[#f7f4ea] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5b4618]">
            {extractionSource}
          </span>
          <StatusBadge label={confidenceBadgeLabel} size="sm" tone={confidenceSpec.tone} />
        </div>
      </div>

      {hint && (
        <p className="mt-1 text-xs text-[#636b66]" id={hintId}>
          {hint}
        </p>
      )}

      <div className="mt-2">
        <input
          aria-describedby={ariaDescribedBy}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-lg border px-3 py-2 text-sm font-medium text-[#191c1a] bg-white ${
            error ? 'border-[#991b1b]' : 'border-[#d2cec2]'
          } ${numeric ? ksiegaTokens.typography.tabularNums : ''} ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
          data-prevent-enter-submit="true"
          id={id}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={handleInputKeyDown}
          readOnly={readOnly}
          type="text"
          value={value}
        />
      </div>

      <div className="mt-2 text-xs" id={diffId}>
        {isModifiedByHuman ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#b7d4c5] bg-white px-2.5 py-1.5 text-[#164833]">
            <div className="flex flex-wrap items-center gap-1.5">
              <ToneIcon className="size-3.5 shrink-0" tone="accent" />
              <span className="font-semibold">Skorygowano przez człowieka:</span>
              <span className="text-[#636b66]">
                Proponowano:{' '}
                <del className={numeric ? ksiegaTokens.typography.tabularNums : ''}>
                  {proposedValue || '(puste)'}
                </del>
              </span>
              <span aria-hidden="true">→</span>
              <strong className={numeric ? ksiegaTokens.typography.tabularNums : ''}>
                Zatwierdzane: {value || '(puste)'}
              </strong>
            </div>
            {!readOnly && onChange && (
              <button
                className={`rounded border border-[#d2cec2] bg-[#faf9f5] px-2 py-0.5 text-[11px] font-semibold text-[#464c48] hover:text-[#191c1a] ${ksiegaTokens.a11y.focusRing}`}
                onClick={() => onChange(proposedValue)}
                type="button"
              >
                Przywróć propozycję AI
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-[#636b66]">
            Wartość zgodna z propozycją ekstrakcji ({proposedValue || 'brak'}) — porównaj z
            oryginałem po lewej przed zatwierdzeniem.
          </p>
        )}
      </div>

      {error && (
        <div
          className="mt-2 flex items-start gap-1.5 text-xs font-medium text-[#991b1b]"
          id={errorId}
          role="alert"
        >
          <ToneIcon className="mt-0.5 size-3.5 shrink-0" tone="danger" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export interface SplitVerificationViewProps {
  documentTitle: string;
  fileName: string;
  mimeLabel: string;
  sha256: string;
  sourceChannel: string;
  uploadedAtLabel: string;
  antivirusStatusLabel?: string | undefined;
  verificationStatusLabel?: string | undefined;
  verificationTone?: StatusTone | undefined;
  previewContent?: ReactNode | undefined;
  legalBasis?: LegalBasisInfo | undefined;
  children: ReactNode;
  primaryActionLabel?: string | undefined;
  draftActionLabel?: string | undefined;
  rejectActionLabel?: string | undefined;
  onApprove?: (() => void) | undefined;
  onSaveDraft?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
}

/**
 * Dwukolumnowy warsztat weryfikacji dokumentu:
 * po lewej niezmienny oryginał i metadane integralności (`SHA-256`),
 * po prawej formularz decyzji człowieka z blokadą przypadkowego zatwierdzenia klawiszem `Enter`.
 */
export function SplitVerificationView({
  antivirusStatusLabel = 'Skan bezpieczeństwa: zweryfikowano',
  children,
  documentTitle,
  draftActionLabel = 'Zapisz wersję roboczą',
  fileName,
  legalBasis,
  mimeLabel,
  onApprove,
  onReject,
  onSaveDraft,
  previewContent,
  primaryActionLabel = 'Zatwierdź dane po weryfikacji',
  rejectActionLabel = 'Odrzuć dokument',
  sha256,
  sourceChannel,
  uploadedAtLabel,
  verificationStatusLabel = 'Oczekuje na weryfikację człowieka',
  verificationTone = 'warning',
}: SplitVerificationViewProps) {
  const [mobilePane, setMobilePane] = useState<'document' | 'form'>('form');

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement | null;
    if (event.key === 'Enter' && target && target.tagName === 'INPUT') {
      event.preventDefault();
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApprove?.();
  };

  return (
    <section
      aria-label={`Weryfikacja dokumentu: ${documentTitle}`}
      className="space-y-4"
      data-enter-submit-blocked="true"
    >
      {/* Przełącznik widoku na ekranach mobilnych (< 1024px) */}
      <div
        aria-label="Przełączanie między oryginałem dokumentu a formularzem weryfikacji"
        className="grid grid-cols-2 gap-1 rounded-xl border border-[#d2cec2] bg-[#f4f2ec] p-1 lg:hidden"
        role="group"
      >
        <button
          aria-pressed={mobilePane === 'document'}
          className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            mobilePane === 'document'
              ? 'bg-white text-[#191c1a]'
              : 'text-[#636b66] hover:text-[#191c1a]'
          } ${ksiegaTokens.a11y.focusRing}`}
          onClick={() => setMobilePane('document')}
          type="button"
        >
          1. Oryginał i SHA-256
        </button>
        <button
          aria-pressed={mobilePane === 'form'}
          className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            mobilePane === 'form'
              ? 'bg-white text-[#191c1a]'
              : 'text-[#636b66] hover:text-[#191c1a]'
          } ${ksiegaTokens.a11y.focusRing}`}
          onClick={() => setMobilePane('form')}
          type="button"
        >
          2. Pola i decyzja człowieka
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(340px,0.95fr)_minmax(400px,1.05fr)]">
        {/* Lewa kolumna: Oryginał write-once i metadane integralności */}
        <aside
          aria-label="Podgląd oryginału dokumentu i integralność kryptograficzna"
          className={`flex flex-col rounded-xl border border-[#d2cec2] bg-[#efece4] p-4 sm:p-5 ${
            mobilePane === 'document' ? 'block' : 'hidden lg:flex'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#d2cec2] pb-3.5">
            <div className="min-w-0">
              <p className={ksiegaTokens.typography.eyebrow}>Oryginał dokumentu (write-once)</p>
              <h2 className="mt-1 truncate text-sm font-semibold text-[#191c1a]">{fileName}</h2>
            </div>
            <span className="rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-[#464c48]">
              {mimeLabel}
            </span>
          </div>

          <dl className="mt-3.5 grid gap-2 rounded-lg border border-[#d2cec2] bg-[#faf9f5] p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[#636b66]">Źródło wpływu:</dt>
              <dd className="font-semibold text-[#191c1a]">{sourceChannel}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[#636b66]">Zarejestrowano:</dt>
              <dd className={`font-medium text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}>
                {uploadedAtLabel}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[#636b66]">Status pliku:</dt>
              <dd className="font-medium text-[#165b33]">{antivirusStatusLabel}</dd>
            </div>
            <div className="border-t border-[#e5e2d9] pt-2">
              <dt className="text-[11px] text-[#636b66]">Skrót integralności SHA-256:</dt>
              <dd
                className={`mt-0.5 break-all rounded bg-white px-2 py-1 text-[11px] text-[#191c1a] ${ksiegaTokens.typography.ledgerCode}`}
              >
                {sha256}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex-1 rounded-lg border border-[#d2cec2] bg-white p-4">
            {previewContent ?? (
              <div className="flex min-h-[240px] flex-col justify-between text-xs text-[#464c48]">
                <div>
                  <p className="font-semibold text-[#191c1a]">{documentTitle}</p>
                  <p className="mt-1 text-[#636b66]">
                    Bezpieczny podgląd dokumentu źródłowego (bez wykonywania aktywnych skryptów i
                    instrukcji z wnętrza pliku).
                  </p>
                </div>
                <p className="rounded border border-[#e5e2d9] bg-[#faf9f5] p-2.5 text-[11px] text-[#636b66]">
                  Gwarancja nienaruszalności: edycja pól po prawej stronie tworzy audytowaną wersję
                  metadanych i nigdy nie nadpisuje pliku oryginalnego.
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Prawa kolumna: Formularz decyzji człowieka */}
        <form
          aria-label="Formularz weryfikacji i zatwierdzenia dokumentu"
          className={`flex flex-col justify-between rounded-xl border border-[#e5e2d9] bg-white p-4 sm:p-5 ${
            mobilePane === 'form' ? 'block' : 'hidden lg:flex'
          }`}
          noValidate
          onKeyDown={handleFormKeyDown}
          onSubmit={handleFormSubmit}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#e5e2d9] pb-3.5">
              <div>
                <p className={ksiegaTokens.typography.eyebrow}>Decyzja człowieka</p>
                <h2 className="mt-1 text-base font-semibold text-[#191c1a]">{documentTitle}</h2>
              </div>
              <StatusBadge label={verificationStatusLabel} size="sm" tone={verificationTone} />
            </div>

            <p className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2 text-xs text-[#464c48]">
              AI i OCR wyłącznie proponują wartości pól. Sprawdź kwoty, daty i NIP kontrahenta.
              Klawisz{' '}
              <kbd className="rounded border border-[#d2cec2] bg-white px-1 font-mono">Enter</kbd> w
              polach tekstowych jest zablokowany przed przypadkowym zatwierdzeniem.
            </p>

            <div className="space-y-3.5">{children}</div>

            {legalBasis && (
              <div className="pt-2">
                <LegalBasisPanel basis={legalBasis} />
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse justify-between gap-3 border-t border-[#e5e2d9] pt-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2">
              {onReject && (
                <button
                  className={`min-h-9 rounded-lg border border-[#f5bcbc] bg-[#fef2f2] px-3.5 py-2 text-xs font-semibold text-[#991b1b] hover:bg-[#fee2e2] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                  onClick={onReject}
                  type="button"
                >
                  {rejectActionLabel}
                </button>
              )}
              {onSaveDraft && (
                <button
                  className={`min-h-9 rounded-lg border border-[#d2cec2] bg-[#faf9f5] px-3.5 py-2 text-xs font-semibold text-[#191c1a] hover:bg-[#f4f2ec] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                  onClick={onSaveDraft}
                  type="button"
                >
                  {draftActionLabel}
                </button>
              )}
            </div>

            <button
              className={`min-h-10 rounded-lg bg-[#1d5c42] px-5 py-2 text-xs font-semibold text-white hover:bg-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
              type="submit"
            >
              {primaryActionLabel}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
