'use client';

import { useState, type ReactNode } from 'react';
import { ToneIcon } from './primitives.js';
import { ksiegaTokens, type TableDensity } from './tokens.js';

export type LedgerColumnMobileRole = 'title' | 'status' | 'primaryAmount' | 'meta' | 'hidden';

export interface LedgerColumn<TRow> {
  readonly id: string;
  readonly header: string;
  readonly unit?: string | undefined;
  readonly align?: 'left' | 'right' | 'center' | undefined;
  readonly numeric?: boolean | undefined;
  readonly mobileRole?: LedgerColumnMobileRole | undefined;
  readonly render: (row: TRow, index: number) => ReactNode;
  readonly footer?: ReactNode | undefined;
}

export type LedgerTableState = 'ready' | 'loading' | 'empty' | 'error' | 'forbidden';

export interface LedgerEmptyConfig {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly actionHref?: string | undefined;
}

export interface LedgerErrorConfig {
  readonly title?: string | undefined;
  readonly message?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly retryLabel?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}

export interface LedgerForbiddenConfig {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}

export interface LedgerTableProps<TRow> {
  caption: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  columns: readonly LedgerColumn<TRow>[];
  rows: readonly TRow[];
  getRowKey: (row: TRow, index: number) => string;
  state?: LedgerTableState | undefined;
  defaultDensity?: TableDensity | undefined;
  density?: TableDensity | undefined;
  onDensityChange?: ((nextDensity: TableDensity) => void) | undefined;
  hideDensityToggle?: boolean | undefined;
  toolbarSlot?: ReactNode | undefined;
  emptyState?: LedgerEmptyConfig | undefined;
  errorState?: LedgerErrorConfig | undefined;
  forbiddenState?: LedgerForbiddenConfig | undefined;
  summaryLabel?: string | undefined;
}

function resolveAlignment(column: {
  align?: 'left' | 'right' | 'center' | undefined;
  numeric?: boolean | undefined;
}) {
  const effective = column.align ?? (column.numeric ? 'right' : 'left');
  if (effective === 'right') {
    return 'text-right';
  }
  if (effective === 'center') {
    return 'text-center';
  }
  return 'text-left';
}

/**
 * Profesjonalna tabela księgowa („Księga Współczesna”) z wyrównaniem kolumn liczbowych,
 * jednostkami w nagłówkach, przełącznikiem gęstości, automatycznymi kartami mobilnymi (`< 768px`)
 * oraz dedykowanymi stanami `loading`, `empty`, `error` i `forbidden`.
 */
export function LedgerTable<TRow>({
  caption,
  columns,
  defaultDensity = 'comfortable',
  density: controlledDensity,
  emptyState,
  errorState,
  forbiddenState,
  getRowKey,
  hideDensityToggle = false,
  onDensityChange,
  rows,
  state,
  subtitle,
  summaryLabel = 'Podsumowanie',
  title,
  toolbarSlot,
}: LedgerTableProps<TRow>) {
  const [uncontrolledDensity, setUncontrolledDensity] = useState<TableDensity>(defaultDensity);
  const activeDensity = controlledDensity ?? uncontrolledDensity;
  const densitySpec = ksiegaTokens.density[activeDensity];

  const effectiveState: LedgerTableState = state ?? (rows.length === 0 ? 'empty' : 'ready');

  const handleDensitySelect = (next: TableDensity) => {
    if (controlledDensity === undefined) {
      setUncontrolledDensity(next);
    }
    onDensityChange?.(next);
  };

  const hasFooter = columns.some((column) => column.footer !== undefined);

  const showHeaderBar = Boolean(title || subtitle || toolbarSlot || !hideDensityToggle);

  return (
    <section
      aria-label={title ?? caption}
      className="overflow-hidden rounded-xl border border-[#e5e2d9] bg-white text-[#191c1a]"
      data-density={activeDensity}
      data-table-state={effectiveState}
    >
      {showHeaderBar && (
        <div className="flex flex-col justify-between gap-3 border-b border-[#e5e2d9] bg-[#faf9f5] px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            {title && <h2 className={ksiegaTokens.typography.sectionTitle}>{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[#636b66]">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {toolbarSlot}

            {!hideDensityToggle && (
              <div
                aria-label="Gęstość wierszy tabeli"
                className="inline-flex items-center rounded-lg border border-[#d2cec2] bg-white p-0.5"
                role="group"
              >
                {(['comfortable', 'compact'] as const).map((mode) => {
                  const active = activeDensity === mode;
                  return (
                    <button
                      aria-pressed={active}
                      className={`min-h-6 rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                        active
                          ? 'bg-[#e7f1ec] text-[#164833]'
                          : 'text-[#636b66] hover:text-[#191c1a]'
                      } ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                      key={mode}
                      onClick={() => handleDensitySelect(mode)}
                      type="button"
                    >
                      {ksiegaTokens.density[mode].labelPl}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {effectiveState === 'loading' && (
        <div aria-busy="true" aria-live="polite" className="space-y-2.5 p-5" role="status">
          <p className="text-xs font-medium text-[#636b66]">
            Trwa wczytywanie pozycji ewidencyjnych…
          </p>
          {[0, 1, 2, 3].map((placeholderIndex) => (
            <div
              aria-hidden="true"
              className={`grid grid-cols-4 gap-4 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-4 py-3 animate-pulse ${ksiegaTokens.a11y.reducedMotion}`}
              key={placeholderIndex}
            >
              <div className="h-3.5 rounded bg-[#e5e2d9]" />
              <div className="col-span-2 h-3.5 rounded bg-[#e5e2d9]" />
              <div className="h-3.5 rounded bg-[#e5e2d9]" />
            </div>
          ))}
        </div>
      )}

      {effectiveState === 'empty' && (
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full border border-[#e5e2d9] bg-[#faf9f5] text-[#636b66]">
            <ToneIcon className="size-5" tone="neutral" />
          </div>
          <h3 className="text-sm font-semibold text-[#191c1a]">
            {emptyState?.title ?? 'Brak pozycji w wybranym okresie rozliczeniowym'}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#464c48]">
            {emptyState?.description ??
              'Dodaj dokument źródłowy lub zmień filtry okresu, aby wyświetlić zapisy księgowe.'}
          </p>
          {emptyState?.actionLabel && emptyState.actionHref && (
            <a
              className={`mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#1d5c42] px-4 py-2 text-xs font-semibold text-white hover:bg-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
              href={emptyState.actionHref}
            >
              {emptyState.actionLabel}
            </a>
          )}
          {emptyState?.actionLabel && !emptyState.actionHref && emptyState.onAction && (
            <button
              className={`mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#1d5c42] px-4 py-2 text-xs font-semibold text-white hover:bg-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
              onClick={emptyState.onAction}
              type="button"
            >
              {emptyState.actionLabel}
            </button>
          )}
        </div>
      )}

      {effectiveState === 'error' && (
        <div
          className="m-4 rounded-xl border border-[#f5bcbc] bg-[#fff7f7] p-5 text-[#7f1d1d]"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ToneIcon className="mt-0.5 size-5 shrink-0 text-[#991b1b]" tone="danger" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[#991b1b]">
                {errorState?.title ?? 'Nie udało się pobrać danych ewidencyjnych'}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[#7f1d1d]">
                {errorState?.message ??
                  'Wystąpił problem podczas odczytu pozycji z serwera aplikacji. Dane księgowe nie zostały zmodyfikowane.'}
              </p>
              {errorState?.correlationId && (
                <p className="mt-1.5 font-mono text-[11px] text-[#991b1b]">
                  Identyfikator diagnostyczny: {errorState.correlationId}
                </p>
              )}
              {errorState?.onRetry && (
                <button
                  className={`mt-3 inline-flex min-h-8 items-center rounded-lg border border-[#991b1b] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#991b1b] hover:bg-[#fef2f2] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                  onClick={errorState.onRetry}
                  type="button"
                >
                  {errorState.retryLabel ?? 'Ponów próbę'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {effectiveState === 'forbidden' && (
        <div
          className="m-4 rounded-xl border border-[#f3d38c] bg-[#fffbf0] p-5 text-[#713f12]"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ToneIcon className="mt-0.5 size-5 shrink-0 text-[#854d0e]" tone="warning" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[#854d0e]">
                {forbiddenState?.title ?? 'Brak uprawnień (grantu) do danych tej firmy'}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[#713f12]">
                {forbiddenState?.description ??
                  'Twoje konto nie posiada aktywnego grantu dostępu do wybranego podmiotu prawnego (legal_entity) lub okresu rozliczeniowego. Skontaktuj się z administratorem organizacji albo przełącz aktywną firmę.'}
              </p>
              {forbiddenState?.onAction && (
                <button
                  className={`mt-3 inline-flex min-h-8 items-center rounded-lg border border-[#854d0e] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#854d0e] hover:bg-[#fef7e6] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                  onClick={forbiddenState.onAction}
                  type="button"
                >
                  {forbiddenState.actionLabel ?? 'Przełącz firmę'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {effectiveState === 'ready' && (
        <>
          {/* Widok tabelaryczny Desktop (>= 768px) */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr className="border-b border-[#e5e2d9] bg-[#f4f2ec]">
                  {columns.map((column) => {
                    const alignClass = resolveAlignment(column);
                    return (
                      <th
                        className={`${densitySpec.headerPadding} ${alignClass} text-[11px] font-semibold uppercase tracking-[0.08em] text-[#464c48]`}
                        key={column.id}
                        scope="col"
                      >
                        <span>{column.header}</span>
                        {column.unit && (
                          <span className="ml-1 font-normal normal-case tracking-normal text-[#636b66]">
                            ({column.unit})
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e2d9]">
                {rows.map((row, rowIndex) => (
                  <tr
                    className={`hover:bg-[#faf9f5] ${ksiegaTokens.a11y.reducedMotion}`}
                    key={getRowKey(row, rowIndex)}
                  >
                    {columns.map((column) => {
                      const alignClass = resolveAlignment(column);
                      const numericClass = column.numeric
                        ? ksiegaTokens.typography.tabularNums
                        : '';
                      return (
                        <td
                          className={`${densitySpec.cellPadding} ${densitySpec.textSize} ${alignClass} ${numericClass} align-middle text-[#191c1a]`}
                          key={column.id}
                        >
                          {column.render(row, rowIndex)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {hasFooter && (
                <tfoot>
                  <tr className="border-t-2 border-[#d2cec2] bg-[#f4f2ec] font-semibold">
                    {columns.map((column, colIndex) => {
                      const alignClass = resolveAlignment(column);
                      const numericClass = column.numeric
                        ? ksiegaTokens.typography.tabularNums
                        : '';
                      return (
                        <td
                          className={`${densitySpec.cellPadding} ${densitySpec.textSize} ${alignClass} ${numericClass} text-[#191c1a]`}
                          key={column.id}
                        >
                          {column.footer ?? (colIndex === 0 ? summaryLabel : null)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Automatyczny widok pogrupowanych kart pozycji na Mobile (< 768px) */}
          <ul
            aria-label={`${caption} — widok kart mobilnych`}
            className="divide-y divide-[#e5e2d9] md:hidden"
            data-mobile-ledger-cards="true"
            role="list"
          >
            {rows.map((row, rowIndex) => {
              const titleColumn = columns.find((col) => col.mobileRole === 'title') ?? columns[0];
              const statusColumn = columns.find((col) => col.mobileRole === 'status');
              const amountColumn = columns.find((col) => col.mobileRole === 'primaryAmount');
              const metaColumns = columns.filter(
                (col) =>
                  col !== titleColumn &&
                  col !== statusColumn &&
                  col !== amountColumn &&
                  col.mobileRole !== 'hidden',
              );

              return (
                <li className="space-y-2.5 p-4" key={getRowKey(row, rowIndex)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm font-semibold text-[#191c1a]">
                      {titleColumn ? titleColumn.render(row, rowIndex) : null}
                    </div>
                    {statusColumn && (
                      <div className="shrink-0">{statusColumn.render(row, rowIndex)}</div>
                    )}
                  </div>

                  {amountColumn && (
                    <div className="flex items-baseline justify-between rounded-lg bg-[#faf9f5] px-3 py-2">
                      <span className="text-xs text-[#636b66]">
                        {amountColumn.header}
                        {amountColumn.unit ? ` (${amountColumn.unit})` : ''}
                      </span>
                      <div className={ksiegaTokens.typography.tabularNums}>
                        {amountColumn.render(row, rowIndex)}
                      </div>
                    </div>
                  )}

                  {metaColumns.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      {metaColumns.map((col) => (
                        <div className="min-w-0" key={col.id}>
                          <dt className="text-[11px] text-[#636b66]">
                            {col.header}
                            {col.unit ? ` (${col.unit})` : ''}
                          </dt>
                          <dd
                            className={`mt-0.5 truncate font-medium text-[#191c1a] ${
                              col.numeric ? ksiegaTokens.typography.tabularNums : ''
                            }`}
                          >
                            {col.render(row, rowIndex)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export const DataTable = LedgerTable;
export type DataTableProps<TRow> = LedgerTableProps<TRow>;
