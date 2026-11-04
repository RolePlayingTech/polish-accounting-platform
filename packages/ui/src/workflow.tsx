import { WhyTrigger, type LegalBasisInfo } from './legal-basis.js';
import { MoneyAmount } from './money.js';
import { Card, StatusBadge } from './primitives.js';
import { formatPolishDate, ksiegaTokens, sanitizeAppUrl, type StatusTone } from './tokens.js';

export type ActionCategory =
  'document_verify' | 'mcp_approval' | 'bank_match' | 'discrepancy' | 'period_close';

export type ActionUrgency = 'urgent' | 'attention' | 'normal';

export interface ActionQueueItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: ActionCategory;
  readonly urgency: ActionUrgency;
  readonly amountGrosze?: bigint | number | undefined;
  readonly currency?: string | undefined;
  readonly sourceLabel?: string | undefined;
  readonly ctaLabel: string;
  readonly href?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  document_verify: 'Weryfikacja dokumentu',
  mcp_approval: 'Zgoda na operację MCP',
  bank_match: 'Uzgodnienie płatności',
  discrepancy: 'Niezgodność danych',
  period_close: 'Zamknięcie okresu',
};

const URGENCY_BADGES: Record<ActionUrgency, { label: string; tone: StatusTone }> = {
  urgent: { label: 'Pilne', tone: 'danger' },
  attention: { label: 'Do sprawdzenia', tone: 'warning' },
  normal: { label: 'W kolejce', tone: 'info' },
};

function buildDefaultSummary(count: number): string {
  if (count === 0) {
    return 'Wszystkie dokumenty i propozycje w wybranym okresie zostały sprawdzone.';
  }
  if (count === 1) {
    return 'Masz 1 zadanie wymagające świadomej decyzji człowieka.';
  }
  if (count >= 2 && count <= 4) {
    return `Masz ${count} zadania wymagające świadomej decyzji człowieka.`;
  }
  return `Masz ${count} zadań wymagających świadomej decyzji człowieka.`;
}

export interface ActionQueueProps {
  items: readonly ActionQueueItem[];
  title?: string | undefined;
  eyebrow?: string | undefined;
  summarySentence?: string | undefined;
}

/**
 * Kolejka działań na górę pulpitu („najpierw zadanie, potem panel”) — eksponuje dokumenty
 * i propozycje AI/MCP wymagające decyzji człowieka.
 */
export function ActionQueue({
  eyebrow = 'Kolejka decyzji człowieka',
  items,
  summarySentence,
  title = 'Sprawy wymagające Twojej uwagi',
}: ActionQueueProps) {
  const summary = summarySentence ?? buildDefaultSummary(items.length);

  return (
    <Card
      actions={
        <StatusBadge
          label={items.length === 0 ? 'Czysta kolejka' : `${items.length} do decyzji`}
          size="sm"
          tone={items.length === 0 ? 'success' : 'warning'}
        />
      }
      eyebrow={eyebrow}
      title={title}
    >
      <p className="mb-4 text-xs leading-relaxed text-[#464c48]">{summary}</p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-4 py-6 text-center text-xs text-[#464c48]">
          Brak pozycji oczekujących na zatwierdzenie. Możesz dodać nową fakturę lub przejść do
          przeglądu ewidencji.
        </div>
      ) : (
        <ul className="divide-y divide-[#e5e2d9] rounded-lg border border-[#e5e2d9]" role="list">
          {items.map((item) => {
            const urgencySpec = URGENCY_BADGES[item.urgency];
            const categoryLabel = CATEGORY_LABELS[item.category];
            const safeHref = sanitizeAppUrl(item.href);

            return (
              <li
                className="flex flex-col justify-between gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-4"
                key={item.id}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={urgencySpec.label} size="sm" tone={urgencySpec.tone} />
                    <span className="text-[11px] font-medium text-[#636b66]">{categoryLabel}</span>
                    {item.sourceLabel && (
                      <span className="rounded bg-[#f4f2ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#464c48]">
                        Źródło: {item.sourceLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[#191c1a]">{item.title}</p>
                  <p className="text-xs leading-relaxed text-[#464c48]">{item.description}</p>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  {item.amountGrosze !== undefined && (
                    <MoneyAmount
                      amount={item.amountGrosze}
                      currency={item.currency ?? 'PLN'}
                      inGrosze
                      size="sm"
                    />
                  )}
                  {safeHref ? (
                    <a
                      className={`inline-flex min-h-9 items-center justify-center rounded-lg bg-[#1d5c42] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                      href={safeHref}
                      rel={safeHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                    >
                      {item.ctaLabel}
                    </a>
                  ) : (
                    <button
                      className={`inline-flex min-h-9 items-center justify-center rounded-lg bg-[#1d5c42] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                      onClick={item.onAction}
                      type="button"
                    >
                      {item.ctaLabel}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export type TaxAuthorityCode = 'US' | 'ZUS' | 'KRS' | 'GUS';

export type ObligationStatus = 'overdue' | 'due_soon' | 'upcoming' | 'submitted' | 'not_applicable';

export interface TaxObligationItem {
  readonly id: string;
  readonly dueDate: string;
  readonly title: string;
  readonly authority: TaxAuthorityCode;
  readonly status: ObligationStatus;
  readonly relativeLabel: string;
  readonly amountGrosze?: bigint | number | null | undefined;
  readonly currency?: string | undefined;
  readonly uncalculatedReason?: string | undefined;
  readonly legalBasis?: LegalBasisInfo | undefined;
}

const AUTHORITY_FULL_NAMES: Record<TaxAuthorityCode, string> = {
  US: 'Urząd Skarbowy',
  ZUS: 'Zakład Ubezpieczeń Społecznych (ZUS)',
  KRS: 'Krajowy Rejestr Sądowy (KRS)',
  GUS: 'Główny Urząd Statystyczny (GUS)',
};

const OBLIGATION_STATUS_META: Record<
  ObligationStatus,
  { labelPl: string; tone: StatusTone; dotClass: string }
> = {
  overdue: {
    labelPl: 'Po terminie',
    tone: 'danger',
    dotClass: 'border-[#991b1b] bg-[#fef2f2]',
  },
  due_soon: {
    labelPl: 'Zbliża się termin',
    tone: 'warning',
    dotClass: 'border-[#854d0e] bg-[#fef7e6]',
  },
  upcoming: {
    labelPl: 'Zaplanowany',
    tone: 'info',
    dotClass: 'border-[#1e40af] bg-[#eff6ff]',
  },
  submitted: {
    labelPl: 'Rozliczony',
    tone: 'success',
    dotClass: 'border-[#165b33] bg-[#eaf5ee]',
  },
  not_applicable: {
    labelPl: 'Nie dotyczy profilu',
    tone: 'neutral',
    dotClass: 'border-[#636b66] bg-[#f5f4f0]',
  },
};

export interface ObligationTimelineProps {
  items: readonly TaxObligationItem[];
  title?: string | undefined;
  eyebrow?: string | undefined;
}

function safeFormatObligationDate(dateStr: string): string {
  try {
    return formatPolishDate(dateStr);
  } catch {
    return dateStr;
  }
}

/**
 * Oś ustawowych terminów podatkowych i składkowych (US / ZUS) z wyraźnym rozróżnieniem
 * zaległości, nadchodzących terminów oraz obowiązków nieobsługiwanych / niedotyczących profilu.
 */
export function ObligationTimeline({
  eyebrow = 'Kalendarz ustawowy',
  items,
  title = 'Terminy podatkowe i ZUS',
}: ObligationTimelineProps) {
  return (
    <Card eyebrow={eyebrow} title={title}>
      {items.length === 0 ? (
        <p className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-4 py-6 text-center text-xs text-[#464c48]">
          Brak wygenerowanych terminów dla wybranego okresu i profilu podatkowego.
        </p>
      ) : (
        <ol aria-label="Oś terminów podatkowych i ZUS" className="relative space-y-3">
          {items.map((item) => {
            const statusMeta = OBLIGATION_STATUS_META[item.status];
            const authorityName = AUTHORITY_FULL_NAMES[item.authority];
            const formattedDate = safeFormatObligationDate(item.dueDate);

            return (
              <li
                className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3.5"
                data-obligation-status={item.status}
                key={item.id}
              >
                <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-start">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold text-[#191c1a] ${statusMeta.dotClass} ${ksiegaTokens.typography.tabularNums}`}
                      >
                        {formattedDate}
                      </span>
                      <StatusBadge
                        label={`${statusMeta.labelPl} · ${item.relativeLabel}`}
                        size="sm"
                        tone={statusMeta.tone}
                      />
                    </div>
                    <p className="text-sm font-semibold text-[#191c1a]">{item.title}</p>
                    <p className="text-xs text-[#636b66]">Organ: {authorityName}</p>
                  </div>

                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    {item.status === 'not_applicable' ? (
                      <span className="text-xs font-medium text-[#636b66]">
                        Nie dotyczy aktywnego profilu firmy
                      </span>
                    ) : item.amountGrosze !== undefined && item.amountGrosze !== null ? (
                      <MoneyAmount
                        amount={item.amountGrosze}
                        currency={item.currency ?? 'PLN'}
                        inGrosze
                        size="sm"
                        variant={item.status === 'overdue' ? 'overdue' : 'tax'}
                      />
                    ) : (
                      <span className="text-xs text-[#636b66]">
                        {item.uncalculatedReason ?? 'Wyliczenie po zamknięciu ewidencji'}
                      </span>
                    )}
                  </div>
                </div>

                {item.legalBasis && (
                  <div className="mt-2.5 border-t border-[#e5e2d9] pt-2.5">
                    <WhyTrigger basis={item.legalBasis} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
