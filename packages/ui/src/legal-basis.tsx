'use client';

import { useId, useState } from 'react';
import { StatusBadge, ToneIcon } from './primitives.js';
import { formatPolishDate, ksiegaTokens, type StatusTone } from './tokens.js';

export type LegalVerificationStatus =
  'verified_official' | 'requires_expert_review' | 'experimental';

export interface LegalCalculationStep {
  readonly label: string;
  readonly formula?: string | undefined;
  readonly valueFormatted: string;
  readonly note?: string | undefined;
}

export interface LegalBasisInfo {
  readonly title: string;
  readonly provision: string;
  readonly journalReference: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null | undefined;
  readonly ruleVersion: string;
  readonly verificationStatus: LegalVerificationStatus;
  readonly plainExplanation?: string | undefined;
  readonly calculationSteps: readonly LegalCalculationStep[];
  readonly officialSourceUrl: string;
  readonly officialSourceLabel?: string | undefined;
}

const VERIFICATION_STATUS_META: Record<
  LegalVerificationStatus,
  { labelPl: string; tone: StatusTone }
> = {
  verified_official: {
    labelPl: 'Zweryfikowano w źródle urzędowym',
    tone: 'success',
  },
  requires_expert_review: {
    labelPl: 'Wymaga kontroli eksperta',
    tone: 'warning',
  },
  experimental: {
    labelPl: 'Reguła robocza — nie stosować do deklaracji',
    tone: 'danger',
  },
};

function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeFormatEffectiveDate(dateStr: string): string {
  try {
    return formatPolishDate(dateStr);
  } catch {
    return dateStr;
  }
}

export interface LegalBasisPanelProps {
  basis: LegalBasisInfo;
  id?: string | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Panel wyjaśnialności prawa („Dlaczego? / Podstawa prawna”) prezentujący przepis, Dz.U.,
 * okres obowiązywania, status weryfikacji merytorycznej, kroki wyliczenia na liczbach oraz link urzędowy.
 */
export function LegalBasisPanel({ basis, className = '', id, onClose }: LegalBasisPanelProps) {
  const statusMeta = VERIFICATION_STATUS_META[basis.verificationStatus];
  const fromFormatted = safeFormatEffectiveDate(basis.effectiveFrom);
  const toFormatted = basis.effectiveTo
    ? safeFormatEffectiveDate(basis.effectiveTo)
    : 'obowiązuje nadal';
  const safeExternalUrl = isSafeHttpsUrl(basis.officialSourceUrl)
    ? basis.officialSourceUrl.trim()
    : null;

  return (
    <section
      aria-label={`Podstawa prawna: ${basis.title}`}
      className={`rounded-xl border border-[#dcd3b8] bg-[#faf8f1] p-4 text-[#191c1a] sm:p-5 ${className}`.trim()}
      data-rule-version={basis.ruleVersion}
      data-verification-status={basis.verificationStatus}
      id={id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5dec8] pb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5b4618]">
            <ToneIcon className="size-3.5 shrink-0" tone="legal" />
            <span>Dlaczego taka kwota? · Podstawa prawna</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-[#191c1a]">{basis.title}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={statusMeta.labelPl} size="sm" tone={statusMeta.tone} />
          {onClose && (
            <button
              aria-label="Zamknij panel podstawy prawnej"
              className={`inline-flex min-h-6 items-center rounded-md border border-[#858177] bg-white px-2.5 py-1 text-xs font-semibold text-[#464c48] hover:text-[#191c1a] ${ksiegaTokens.a11y.focusRing}`}
              onClick={onClose}
              type="button"
            >
              Ukryj
            </button>
          )}
        </div>
      </div>

      {basis.plainExplanation && (
        <p className="mt-3 text-xs leading-relaxed text-[#464c48]">{basis.plainExplanation}</p>
      )}

      <dl className="mt-3.5 grid gap-3 rounded-lg border border-[#e5dec8] bg-white p-3.5 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-medium text-[#636b66]">Przepis prawa</dt>
          <dd className="mt-0.5 font-semibold text-[#191c1a]">{basis.provision}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-[#636b66]">Publikator urzędowy</dt>
          <dd className="mt-0.5 font-semibold text-[#191c1a]">{basis.journalReference}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-[#636b66]">Zakres obowiązywania reguły</dt>
          <dd
            className={`mt-0.5 font-medium text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}
          >
            od {fromFormatted} — {toFormatted}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-[#636b66]">Wersja reguły w rejestrze</dt>
          <dd className={`mt-0.5 ${ksiegaTokens.typography.ledgerCode} text-[#191c1a]`}>
            {basis.ruleVersion}
          </dd>
        </div>
      </dl>

      {basis.calculationSteps.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5b4618]">
            Kroki obliczenia na konkretnych liczbach
          </h4>
          <ol className="mt-2 divide-y divide-[#e5dec8] rounded-lg border border-[#e5dec8] bg-white">
            {basis.calculationSteps.map((step, index) => (
              <li
                className="flex flex-col justify-between gap-1 px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:gap-4"
                key={`${index}-${step.label}`}
              >
                <div className="min-w-0">
                  <span className="font-semibold text-[#191c1a]">
                    {index + 1}. {step.label}
                  </span>
                  {step.formula && (
                    <p
                      className={`mt-0.5 break-words text-[11px] text-[#636b66] ${ksiegaTokens.typography.tabularNums}`}
                    >
                      Wzór: {step.formula}
                    </p>
                  )}
                  {step.note && (
                    <p className="mt-0.5 break-words text-[11px] text-[#636b66]">{step.note}</p>
                  )}
                </div>
                <span
                  className={`min-w-0 max-w-full break-words font-semibold tracking-tight text-[#191c1a] sm:shrink-0 sm:text-right ${ksiegaTokens.typography.tabularNums}`}
                >
                  {step.valueFormatted}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        {safeExternalUrl ? (
          <a
            className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#b7d4c5] bg-[#e7f1ec] px-3 py-1 font-semibold text-[#164833] hover:bg-[#d7e8df] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
            href={safeExternalUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>{basis.officialSourceLabel ?? 'Otwórz tekst aktu (ISAP / podatki.gov.pl)'}</span>
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="text-[11px] text-[#991b1b]" role="alert">
            Pominięto link zewnętrzny — dozwolone są wyłącznie zweryfikowane adresy HTTPS.
          </span>
        )}
        <span className="text-[11px] text-[#636b66]">
          Wyliczenie pomocnicze — ostateczną deklarację zatwierdza uprawniony użytkownik.
        </span>
      </div>
    </section>
  );
}

export interface WhyTriggerProps {
  basis: LegalBasisInfo;
  label?: string | undefined;
  defaultOpen?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((nextOpen: boolean) => void) | undefined;
}

/**
 * Przycisk „§ Dlaczego? / Podstawa prawna” otwierający powiązany `LegalBasisPanel`.
 */
export function WhyTrigger({
  basis,
  defaultOpen = false,
  label = 'Dlaczego? / Podstawa prawna',
  onOpenChange,
  open: controlledOpen,
}: WhyTriggerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState<boolean>(defaultOpen);
  const panelId = useId();
  const isOpen = controlledOpen ?? uncontrolledOpen;

  const toggle = () => {
    const next = !isOpen;
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <div className="inline-block max-w-full text-left align-middle">
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border border-[#858177] bg-[#f7f4ea] px-2.5 py-1 text-[11px] font-semibold text-[#5b4618] hover:bg-[#efe9d6] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
        onClick={toggle}
        type="button"
      >
        <span aria-hidden="true" className="font-serif text-xs font-bold">
          §
        </span>
        <span>{label}</span>
      </button>

      {isOpen && (
        <div className="mt-2.5">
          <LegalBasisPanel basis={basis} id={panelId} onClose={toggle} />
        </div>
      )}
    </div>
  );
}
