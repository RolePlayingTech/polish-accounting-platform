import type { HTMLAttributes, ReactNode } from 'react';
import { ToneIcon } from './primitives.js';
import { ksiegaTokens, splitFormattedMoney, type StatusTone } from './tokens.js';

export type MoneyVariant = 'neutral' | 'income' | 'expense' | 'tax' | 'overdue';
export type MoneySize = 'sm' | 'md' | 'lg' | 'xl';

export interface MoneyAmountProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  amount: bigint | number;
  inGrosze?: boolean | undefined;
  currency?: string | undefined;
  variant?: MoneyVariant | undefined;
  size?: MoneySize | undefined;
  align?: 'right' | 'left' | undefined;
  showSign?: boolean | undefined;
  showVariantBadge?: boolean | undefined;
  whySlot?: ReactNode | undefined;
}

const VARIANT_META: Record<
  MoneyVariant,
  {
    colorClass: string;
    labelPl: string;
    tone: StatusTone;
  }
> = {
  neutral: {
    colorClass: 'text-[#191c1a]',
    labelPl: 'Kwota',
    tone: 'neutral',
  },
  income: {
    colorClass: 'text-[#165b33]',
    labelPl: 'Przychód',
    tone: 'success',
  },
  expense: {
    colorClass: 'text-[#191c1a]',
    labelPl: 'Koszt',
    tone: 'neutral',
  },
  tax: {
    colorClass: 'text-[#5b4618]',
    labelPl: 'Zobowiązanie podatkowe',
    tone: 'legal',
  },
  overdue: {
    colorClass: 'text-[#991b1b]',
    labelPl: 'Zaległość',
    tone: 'danger',
  },
};

const SIZE_CLASSES: Record<MoneySize, string> = {
  sm: 'text-xs font-semibold',
  md: 'text-sm font-semibold',
  lg: 'text-lg font-semibold',
  xl: 'text-2xl font-bold',
};

/**
 * Komponent prezentacji kwoty finansowej w standardzie „Księga Współczesna”:
 * cyfry `tabular-nums`, wyrównanie do prawej, wyróżniona część groszowa oraz kod waluty ISO.
 */
export function MoneyAmount({
  align = 'right',
  amount,
  className = '',
  currency = 'PLN',
  inGrosze,
  showSign = false,
  showVariantBadge = false,
  size = 'md',
  variant = 'neutral',
  whySlot,
  ...props
}: MoneyAmountProps) {
  const parts = splitFormattedMoney(amount, {
    currency,
    inGrosze,
    signDisplay: showSign ? 'always' : 'auto',
  });

  const meta = VARIANT_META[variant];
  const sizeClass = SIZE_CLASSES[size];
  const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start text-left';

  return (
    <span
      className={`inline-flex items-baseline gap-1.5 ${alignClass} ${ksiegaTokens.typography.financialFigure} ${meta.colorClass} ${sizeClass} ${className}`.trim()}
      data-money-currency={parts.currency}
      data-money-variant={variant}
      {...props}
    >
      {variant !== 'neutral' && <span className="sr-only">{meta.labelPl}: </span>}
      {(variant === 'overdue' || showVariantBadge) && (
        <span className="inline-flex items-center gap-1 self-center rounded border border-current/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
          <ToneIcon className="size-3 shrink-0" tone={meta.tone} />
          <span>{meta.labelPl}</span>
        </span>
      )}
      <span>
        <span>
          {parts.sign}
          {parts.integerPart}
        </span>
        <span className="text-[0.84em] font-medium opacity-80">,{parts.decimalPart}</span>
        <span className="ml-1 text-[0.76em] font-medium tracking-normal text-[#636b66]">
          {parts.currency}
        </span>
      </span>
      {whySlot && <span className="ml-1 inline-flex self-center">{whySlot}</span>}
    </span>
  );
}
