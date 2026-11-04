'use client';

import Link from 'next/link';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ACADEMY_DISCLAIMER } from '@pap/domain/academy';
import type { TaxProfileCode } from '@pap/domain';
import {
  FieldHelpButton,
  FormField,
  ToneIcon,
  formatNip,
  isValidNipChecksum,
  type FieldHelpInfo,
  type StatusTone,
} from '@pap/ui';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'border border-[#1d5c42] bg-[#1d5c42] text-white hover:bg-[#164833] disabled:opacity-55',
  secondary:
    'border border-[#858177] bg-white text-[#191c1a] hover:bg-[#f4f2ec] disabled:opacity-55',
  danger:
    'border border-[#9e2a25] bg-[#fceeed] text-[#9e2a25] hover:bg-[#f7dedc] disabled:opacity-55',
  ghost:
    'border border-transparent bg-transparent text-[#1d5c42] hover:bg-[#e7f1ec] disabled:opacity-55',
};

const BUTTON_SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
};

export function Button({
  children,
  className = '',
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42] ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export interface NipInputProps {
  id: string;
  label?: string;
  value: string;
  onChange: (nextValue: string) => void;
  fieldHelp?: FieldHelpInfo;
  required?: boolean;
  error?: string;
}

export function NipInput({
  error,
  fieldHelp,
  id,
  label = 'NIP podmiotu (10 cyfr)',
  onChange,
  required = true,
  value,
}: NipInputProps) {
  const digits = value.replace(/[\s-]/g, '');
  const hasTenDigits = /^\d{10}$/.test(digits);
  const checksumOk = hasTenDigits && isValidNipChecksum(digits);
  const computedError =
    error ??
    (digits.length > 0 && hasTenDigits && !checksumOk
      ? 'Błędna suma kontrolna NIP (wagi 6-5-7-2-3-4-5-6-7 modulo 11).'
      : undefined);

  return (
    <FormField
      id={id}
      label={label}
      required={required}
      hint={
        checksumOk
          ? `Poprawny NIP: ${formatNip(digits)}`
          : 'Wpisz 10 cyfr z myślnikami lub bez — suma kontrolna weryfikowana automatycznie.'
      }
      {...(computedError !== undefined ? { error: computedError } : {})}
      {...(fieldHelp !== undefined ? { fieldHelp } : {})}
    >
      {(controlProps) => (
        <div className="relative flex items-center gap-2">
          <input
            {...controlProps}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="np. 525-000-10-03"
            className={`${controlProps.className} font-mono tabular-nums`}
          />
          {checksumOk ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[#b7d4c5] bg-[#e7f1ec] px-2 py-1 text-xs font-medium text-[#185a37]">
              <ToneIcon tone="success" />
              <span>Suma OK</span>
            </span>
          ) : null}
        </div>
      )}
    </FormField>
  );
}

export interface MoneyInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  currency?: string;
  hint?: string;
  error?: string;
  fieldHelp?: FieldHelpInfo;
  required?: boolean;
}

export function MoneyInput({
  currency = 'PLN',
  error,
  fieldHelp,
  hint,
  id,
  label,
  onChange,
  required,
  value,
}: MoneyInputProps) {
  return (
    <FormField
      id={id}
      label={label}
      {...(required !== undefined ? { required } : {})}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(fieldHelp !== undefined ? { fieldHelp } : {})}
    >
      {(controlProps) => (
        <div className="flex items-stretch">
          <input
            {...controlProps}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0.00"
            className={`${controlProps.className} rounded-r-none text-right font-mono tabular-nums`}
          />
          <span className="inline-flex items-center rounded-r-md border border-l-0 border-[#858177] bg-[#f4f2ec] px-3 font-mono text-xs font-semibold text-[#464c48]">
            {currency}
          </span>
        </div>
      )}
    </FormField>
  );
}

export interface TaxRegimeOption {
  readonly code: TaxProfileCode;
  readonly title: string;
  readonly description: string;
  readonly legalForm: 'jdg' | 'sp_z_o_o';
}

export const TAX_REGIME_OPTIONS: readonly TaxRegimeOption[] = [
  {
    code: 'jdg_kpir_skala',
    title: 'JDG — KPiR na skali podatkowej (12% / 32%)',
    description:
      'Kwota wolna 30 000 PLN, próg 120 000 PLN, rozliczanie kosztów uzyskania przychodów (KUP).',
    legalForm: 'jdg',
  },
  {
    code: 'jdg_kpir_liniowy',
    title: 'JDG — KPiR na podatku liniowym (19%)',
    description:
      'Stała stawka 19% od dochodu, składka zdrowotna 4,9% z limitem odliczenia rocznego.',
    legalForm: 'jdg',
  },
  {
    code: 'jdg_ryczalt',
    title: 'JDG — Ryczałt od przychodów ewidencjonowanych',
    description:
      'Podatek od przychodu wg stawki PKWiU (np. 12% IT, 8,5% usługi) bez rozliczania kosztów KUP.',
    legalForm: 'jdg',
  },
  {
    code: 'spzoo_pelne_ksiegi',
    title: 'Sp. z o.o. — Pełne księgi rachunkowe (UoR) + CIT 9% / 19%',
    description:
      'Podwójny zapis Wn = Ma, plan kont 0–8, bilans, RZiS oraz CIT 9% dla małego podatnika.',
    legalForm: 'sp_z_o_o',
  },
];

export interface TaxRegimeSelectorProps {
  value: TaxProfileCode;
  onChange: (nextCode: TaxProfileCode, legalForm: 'jdg' | 'sp_z_o_o') => void;
  fieldHelp?: FieldHelpInfo;
}

export function TaxRegimeSelector({ fieldHelp, onChange, value }: TaxRegimeSelectorProps) {
  const groupId = useId();
  return (
    <fieldset className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium text-[#191c1a]">
          Forma opodatkowania i księgowości
        </legend>
        {fieldHelp ? <FieldHelpButton help={fieldHelp} /> : null}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {TAX_REGIME_OPTIONS.map((opt) => {
          const selected = opt.code === value;
          const radioId = `${groupId}-${opt.code}`;
          return (
            <label
              key={opt.code}
              htmlFor={radioId}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors motion-reduce:transition-none ${
                selected
                  ? 'border-[#1d5c42] bg-[#e7f1ec]/70'
                  : 'border-[#e5e2d9] bg-white hover:border-[#858177]'
              }`}
            >
              <input
                id={radioId}
                type="radio"
                name={`taxRegimeProfile-${groupId}`}
                value={opt.code}
                checked={selected}
                onChange={() => onChange(opt.code, opt.legalForm)}
                className="mt-1 h-4 w-4 accent-[#1d5c42] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
              />
              <span className="block space-y-1">
                <span className="block text-sm font-semibold text-[#191c1a]">{opt.title}</span>
                <span className="block text-xs leading-relaxed text-[#464c48]">
                  {opt.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const BANNER_STYLES: Record<StatusTone, string> = {
  success: 'border-[#b7d4c5] bg-[#e9f5ee] text-[#185a37]',
  warning: 'border-[#e6c88a] bg-[#fdf4e3] text-[#7c4d00]',
  danger: 'border-[#e6b3b0] bg-[#fceeed] text-[#9e2a25]',
  info: 'border-[#b4cee6] bg-[#ebf3fa] text-[#1c4b78]',
  legal: 'border-[#b8c4de] bg-[#eff2f8] text-[#28385e]',
  accent: 'border-[#b7d4c5] bg-[#e7f1ec] text-[#1d5c42]',
  neutral: 'border-[#d8d4ca] bg-[#f4f2ec] text-[#464c48]',
};

export interface AlertBannerProps {
  tone: StatusTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function AlertBanner({ actions, children, className = '', title, tone }: AlertBannerProps) {
  const isAssertive = tone === 'danger' || tone === 'warning';
  return (
    <div
      role={isAssertive ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3.5 ${BANNER_STYLES[tone]} ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <ToneIcon tone={tone} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">{title}</p>
            {children ? <div className="text-xs leading-relaxed opacity-95">{children}</div> : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export function EmptyState({
  actionHref,
  actionLabel,
  description,
  onAction,
  title,
}: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-[#858177] bg-[#faf9f5] p-6 text-center">
      <p className="text-base font-semibold text-[#191c1a]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-[#464c48]">{description}</p>
      {actionLabel && actionHref ? (
        <div className="mt-4">
          <Link
            href={actionHref}
            className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            {actionLabel}
          </Link>
        </div>
      ) : null}
      {actionLabel && !actionHref && onAction ? (
        <div className="mt-4">
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AcademyDisclaimerBanner({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-label="Zastrzeżenie prawne i edukacyjne"
      className={`rounded-xl border border-[#b8c4de] bg-[#eff2f8] px-4 py-3 text-xs leading-relaxed text-[#28385e] ${className}`.trim()}
    >
      <div className="flex items-start gap-2.5">
        <ToneIcon tone="legal" className="mt-0.5 shrink-0" />
        <p>
          <strong className="font-semibold">Klauzula informacyjna Akademii: </strong>
          {ACADEMY_DISCLAIMER}
        </p>
      </div>
    </aside>
  );
}

export interface StepIndicatorProps {
  steps: readonly { readonly id: string; readonly label: string }[];
  currentIndex: number;
}

export function StepIndicator({ currentIndex, steps }: StepIndicatorProps) {
  return (
    <ol
      aria-label="Postęp kroków operacji"
      className="flex flex-wrap items-center gap-2 text-xs text-[#464c48]"
    >
      {steps.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isDone = index < currentIndex;
        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${
              isCurrent
                ? 'border-[#1d5c42] bg-[#e7f1ec] text-[#1d5c42]'
                : isDone
                  ? 'border-[#b7d4c5] bg-white text-[#185a37]'
                  : 'border-[#e5e2d9] bg-[#f4f2ec] text-[#636b66]'
            }`}
          >
            <span className="font-mono tabular-nums">{String(index + 1)}.</span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
