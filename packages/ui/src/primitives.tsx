import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { ksiegaTokens, type StatusTone } from './tokens.js';

export interface ToneIconProps {
  tone: StatusTone;
  className?: string | undefined;
}

/**
 * Semantyczna ikona SVG gwarantująca, że żaden status w interfejsie nie opiera się wyłącznie na kolorze (WCAG 2.2 1.4.1).
 */
export function ToneIcon({ tone, className = 'size-3.5 shrink-0' }: ToneIconProps) {
  switch (tone) {
    case 'success':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="success"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="m5.4 8.2 1.75 1.8 3.55-3.8" />
        </svg>
      );
    case 'warning':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="warning"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <path d="M8 2.2 14.3 13.3H1.7L8 2.2Z" />
          <path d="M8 6.3v3.2" />
          <circle cx="8" cy="11.4" fill="currentColor" r="0.6" stroke="none" />
        </svg>
      );
    case 'danger':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="danger"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <polygon points="5.3,1.8 10.7,1.8 14.2,5.3 14.2,10.7 10.7,14.2 5.3,14.2 1.8,10.7 1.8,5.3" />
          <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
        </svg>
      );
    case 'info':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="info"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.2v3.8" />
          <circle cx="8" cy="4.9" fill="currentColor" r="0.65" stroke="none" />
        </svg>
      );
    case 'legal':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="legal"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.9}
          viewBox="0 0 16 16"
        >
          <path d="M9.8 3.2c-.5-.6-1.4-.9-2.2-.7-1.1.2-1.8 1.1-1.5 2 .2.8 1 1.2 2.2 1.6 1.2.4 2 .9 2.2 1.8.2.9-.5 1.8-1.6 2-.8.2-1.7-.1-2.2-.7" />
          <path d="M6.4 5.9c-.8.5-1.2 1.3-1 2.2.2.8 1 1.3 2.1 1.7 1.1.4 1.8 1 1.9 1.9.1.9-.6 1.8-1.7 2-.8.1-1.6-.2-2.1-.8" />
        </svg>
      );
    case 'accent':
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="accent"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <path d="M8 2.1 13.9 8 8 13.9 2.1 8 8 2.1Z" />
          <circle cx="8" cy="8" fill="currentColor" r="1.5" stroke="none" />
        </svg>
      );
    case 'neutral':
    default:
      return (
        <svg
          aria-hidden="true"
          className={className}
          data-tone-icon="neutral"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.5 8h5" />
        </svg>
      );
  }
}

export type CardTone = 'default' | 'subtle' | 'warning' | 'danger' | 'legal' | 'accent';

export type CardProps = PropsWithChildren<HTMLAttributes<HTMLElement>> & {
  title?: string | undefined;
  eyebrow?: string | undefined;
  icon?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  tone?: CardTone | undefined;
  as?: 'section' | 'article' | 'div' | undefined;
};

const CARD_TONE_CLASSES: Record<CardTone, string> = {
  default: 'border-[#e5e2d9] bg-white text-[#191c1a]',
  subtle: 'border-[#e5e2d9] bg-[#faf9f5] text-[#191c1a]',
  warning: 'border-[#f3d38c] bg-[#fffbf0] text-[#191c1a]',
  danger: 'border-[#f5bcbc] bg-[#fff7f7] text-[#191c1a]',
  legal: 'border-[#dcd3b8] bg-[#faf8f1] text-[#191c1a]',
  accent: 'border-[#b7d4c5] bg-[#f1f7f4] text-[#191c1a]',
};

/**
 * Kontener sekcyjny w standardzie „Księga Współczesna” — cienka linia ewidencyjna zamiast ciężkich cieni.
 * W pełni kompatybilny wstecz z wcześniejszym interfejsem `Card` z etapu bootstrapu.
 */
export function Card({
  as: Element = 'section',
  actions,
  children,
  className = '',
  eyebrow,
  icon,
  title,
  tone = 'default',
  ...props
}: CardProps) {
  const toneClass = CARD_TONE_CLASSES[tone];

  return (
    <Element className={`rounded-xl border p-5 ${toneClass} ${className}`.trim()} {...props}>
      {(title || eyebrow || icon || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className={`mb-1 ${ksiegaTokens.typography.eyebrow}`}>{eyebrow}</p>}
            {title && <h2 className={ksiegaTokens.typography.sectionTitle}>{title}</h2>}
          </div>
          {(icon || actions) && (
            <div className="flex shrink-0 items-center gap-2">
              {icon}
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </Element>
  );
}

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  label: string;
  tone: StatusTone;
  icon?: ReactNode | undefined;
  size?: 'sm' | 'md' | undefined;
};

/**
 * Odznaka stanu łącząca kolor semantyczny, wbudowaną ikonę SVG oraz polską etykietę tekstową.
 */
export function StatusBadge({
  className = '',
  icon,
  label,
  size = 'md',
  tone,
  ...props
}: StatusBadgeProps) {
  const toneSpec = ksiegaTokens.tones[tone];
  const sizeClass =
    size === 'sm' ? 'px-2 py-0.5 text-[11px] gap-1.5' : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-md border font-semibold leading-tight ${toneSpec.badgeClass} ${sizeClass} ${className}`.trim()}
      data-status-tone={tone}
      {...props}
    >
      {icon ?? <ToneIcon className="size-3.5 shrink-0" tone={tone} />}
      <span>{label}</span>
    </span>
  );
}
