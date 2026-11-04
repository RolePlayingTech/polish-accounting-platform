'use client';

import { useId } from 'react';
import { useModalFocusTrap } from './focus-trap.js';
import { MoneyAmount } from './money.js';
import { StatusBadge, ToneIcon } from './primitives.js';
import { formatAccountingPeriod, formatNip, ksiegaTokens } from './tokens.js';

export type CriticalOperationType =
  'ledger_post' | 'mcp_approval' | 'period_close' | 'declaration_approve';

export interface McpApprovalMetadata {
  readonly clientName: string;
  readonly scope: string;
  readonly expiresAtLabel: string;
}

export interface CriticalConfirmDialogProps {
  open: boolean;
  operationType: CriticalOperationType;
  title: string;
  description: string;
  companyName: string;
  nip: string;
  period: string;
  amountGrosze?: bigint | number | undefined;
  currency?: string | undefined;
  mcpMetadata?: McpApprovalMetadata | undefined;
  auditConsequences: readonly string[];
  confirmLabel: string;
  cancelLabel?: string | undefined;
  tone?: 'accent' | 'danger' | undefined;
  isSubmitting?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

const OPERATION_LABELS: Record<CriticalOperationType, string> = {
  ledger_post: 'Zaksięgowanie w ewidencji',
  mcp_approval: 'Zatwierdzenie propozycji MCP',
  period_close: 'Zamknięcie okresu rozliczeniowego',
  declaration_approve: 'Zatwierdzenie zestawienia podatkowego',
};

/**
 * Modal świadomego zatwierdzania operacji krytycznych (zaksięgowanie do KPiR / księgi głównej,
 * akceptacja szkicu MCP, zamknięcie miesiąca) z podsumowaniem firmy, okresu, kwoty, skutków audytowych
 * oraz pełnym zarządzaniem fokusem (focus trap, auto-focus i przywrócenie fokusu wg WCAG 2.4.3).
 */
export function CriticalConfirmDialog({
  amountGrosze,
  auditConsequences,
  cancelLabel = 'Anuluj i wróć',
  companyName,
  confirmLabel,
  currency = 'PLN',
  description,
  isSubmitting = false,
  mcpMetadata,
  nip,
  onCancel,
  onConfirm,
  open,
  operationType,
  period,
  title,
  tone = 'accent',
}: CriticalConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useModalFocusTrap<HTMLDivElement>({
    open,
    onClose: onCancel,
    disableEscape: isSubmitting,
  });

  if (!open) {
    return null;
  }

  const formattedNip = formatNip(nip);
  const formattedPeriod = formatAccountingPeriod(period);
  const operationBadgeLabel = OPERATION_LABELS[operationType];
  const confirmButtonClass =
    tone === 'danger'
      ? 'bg-[#991b1b] text-white hover:bg-[#7f1d1d]'
      : 'bg-[#1d5c42] text-white hover:bg-[#164833]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-operation-type={operationType}
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[#191c1a]/50"
        onClick={() => {
          if (!isSubmitting) {
            onCancel();
          }
        }}
      />

      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`relative z-10 w-full max-w-lg rounded-xl border border-[#858177] bg-white p-5 text-[#191c1a] shadow-xl sm:p-6 ${ksiegaTokens.a11y.focusRing}`}
        data-focus-trap="active"
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#e5e2d9] pb-4">
          <div className="space-y-1">
            <StatusBadge
              label={operationBadgeLabel}
              size="sm"
              tone={tone === 'danger' ? 'danger' : 'warning'}
            />
            <h2 className="pt-1 text-base font-semibold text-[#191c1a]" id={titleId}>
              {title}
            </h2>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[#464c48]" id={descriptionId}>
          {description}
        </p>

        {/* Podsumowanie kontekstu prawno-finansowego operacji */}
        <dl className="mt-4 space-y-2 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3.5 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-[#636b66]">Firma (legal_entity):</dt>
            <dd className="font-semibold text-[#191c1a]">{companyName}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-[#636b66]">NIP podmiotu:</dt>
            <dd className={`font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}>
              {formattedNip}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-[#636b66]">Okres rozliczeniowy:</dt>
            <dd className={`font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}>
              {formattedPeriod}
            </dd>
          </div>
          {amountGrosze !== undefined && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[#e5e2d9] pt-2">
              <dt className="font-medium text-[#191c1a]">Kwota operacji:</dt>
              <dd>
                <MoneyAmount amount={amountGrosze} currency={currency} inGrosze size="md" />
              </dd>
            </div>
          )}
          {mcpMetadata && (
            <div className="space-y-1 border-t border-[#e5e2d9] pt-2">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-[#636b66]">Klient proponujący (MCP):</dt>
                <dd className="font-semibold text-[#191c1a]">{mcpMetadata.clientName}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-[#636b66]">Zakres zgody (scope):</dt>
                <dd className={ksiegaTokens.typography.ledgerCode}>{mcpMetadata.scope}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-[#636b66]">Ważność propozycji do:</dt>
                <dd className={ksiegaTokens.typography.tabularNums}>
                  {mcpMetadata.expiresAtLabel}
                </dd>
              </div>
            </div>
          )}
        </dl>

        {/* Skutki audytowe i ewidencyjne */}
        <div className="mt-4 rounded-lg border border-[#dcd3b8] bg-[#faf8f1] p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5b4618]">
            <ToneIcon className="size-3.5 shrink-0" tone="legal" />
            <span>Skutki księgowe i ślad audytowy</span>
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[#464c48]" role="list">
            {auditConsequences.map((consequence, index) => (
              <li className="flex items-start gap-2" key={`${index}-${consequence}`}>
                <span
                  aria-hidden="true"
                  className="mt-1 size-1.5 shrink-0 rounded-full bg-[#5b4618]"
                />
                <span>{consequence}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col-reverse justify-end gap-2.5 sm:flex-row">
          <button
            className={`min-h-9 rounded-lg border border-[#858177] bg-white px-4 py-2 text-xs font-semibold text-[#191c1a] hover:bg-[#faf9f5] disabled:opacity-50 ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
            data-autofocus="true"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`min-h-9 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 ${confirmButtonClass} ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
            disabled={isSubmitting}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? 'Zatwierdzanie…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
