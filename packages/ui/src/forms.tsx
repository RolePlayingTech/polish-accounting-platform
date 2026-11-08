'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ToneIcon } from './primitives.js';
import { ksiegaTokens, sanitizeAppUrl } from './tokens.js';

export interface FieldHelpInfo {
  readonly fieldHelpId: string;
  readonly title: string;
  readonly explanation: string;
  readonly example?: string | undefined;
  readonly lessonTitle?: string | undefined;
  readonly lessonHref?: string | undefined;
  readonly onOpenLesson?: ((fieldHelpId: string) => void) | undefined;
}

export interface FieldHelpButtonProps {
  help: FieldHelpInfo;
  defaultOpen?: boolean | undefined;
}

/**
 * Przycisk „?” otwierający pomoc kontekstową oraz odnośnik do lekcji w Akademii Księgowości dla danego `fieldHelpId`.
 */
export function FieldHelpButton({ defaultOpen = false, help }: FieldHelpButtonProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const panelId = useId();
  const safeLessonHref = sanitizeAppUrl(help.lessonHref);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className="contents">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Pomoc kontekstowa: ${help.title}`}
        className={`inline-grid size-7 shrink-0 place-items-center rounded-full border border-[#858177] bg-[#faf9f5] text-xs font-bold text-[#464c48] hover:border-[#1d5c42] hover:bg-[#e7f1ec] hover:text-[#164833] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
        data-field-help-id={help.fieldHelpId}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        ?
      </button>

      {open && (
        <div
          aria-label={`Objaśnienie pola: ${help.title}`}
          className="mt-1.5 w-full basis-full rounded-xl border border-[#b7d4c5] bg-[#f1f7f4] p-3.5 text-left text-xs text-[#191c1a]"
          data-help-panel-for={help.fieldHelpId}
          id={panelId}
          role="region"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-[#164833]">{help.title}</p>
            <button
              aria-label="Zamknij pomoc kontekstową"
              className={`inline-flex min-h-6 shrink-0 items-center rounded border border-[#858177] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#164833] ${ksiegaTokens.a11y.focusRing}`}
              onClick={() => setOpen(false)}
              type="button"
            >
              Zamknij
            </button>
          </div>
          <p className="mt-1.5 leading-relaxed text-[#191c1a]">{help.explanation}</p>
          {help.example && (
            <p className="mt-1.5 rounded bg-white/80 px-2.5 py-1.5 text-[11px] text-[#464c48]">
              <strong className="font-semibold text-[#191c1a]">Przykład: </strong>
              {help.example}
            </p>
          )}
          {(safeLessonHref || help.onOpenLesson) && (
            <div className="mt-2.5 border-t border-[#b7d4c5] pt-2">
              {safeLessonHref ? (
                <a
                  className={`inline-flex min-h-6 items-center gap-1 py-0.5 font-semibold text-[#164833] underline underline-offset-2 ${ksiegaTokens.a11y.focusRing}`}
                  href={safeLessonHref}
                  rel={safeLessonHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                >
                  <span>{help.lessonTitle ?? 'Otwórz lekcję w Akademii Księgowości'}</span>
                  <span aria-hidden="true">→</span>
                </a>
              ) : (
                <button
                  className={`inline-flex min-h-6 items-center gap-1 py-0.5 font-semibold text-[#164833] underline underline-offset-2 ${ksiegaTokens.a11y.focusRing}`}
                  onClick={() => help.onOpenLesson?.(help.fieldHelpId)}
                  type="button"
                >
                  <span>{help.lessonTitle ?? 'Otwórz lekcję w Akademii Księgowości'}</span>
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface FormFieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean;
  'aria-required': boolean | undefined;
  className: string;
}

export interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  fieldHelp?: FieldHelpInfo | undefined;
  defaultHelpOpen?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode | ((controlProps: FormFieldControlProps) => ReactNode);
}

/**
 * Dostępne pole formularza zgodne z WCAG 2.2 AA (`label`, `hint`, `error` z `role="alert"`,
 * `aria-invalid`, `aria-describedby`, obramowanie `#858177` >= 3.8:1 oraz przycisk `FieldHelpButton`).
 */
export function FormField({
  children,
  className = '',
  defaultHelpOpen = false,
  error,
  fieldHelp,
  hint,
  id,
  label,
  required,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedByIds = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const hasError = Boolean(error);

  const defaultInputClass = `min-w-0 max-w-full w-full rounded-lg border px-3 py-2 text-sm text-[#191c1a] bg-white ${
    hasError ? 'border-[#991b1b] bg-[#fff7f7]' : 'border-[#858177]'
  } ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`;

  return (
    <div className={`min-w-0 space-y-1.5 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-[#191c1a]" htmlFor={id}>
            {label}
            {required ? (
              <span className="ml-1 text-[#991b1b]">(wymagane)</span>
            ) : (
              <span className="ml-1 font-normal text-[#636b66]">(opcjonalne)</span>
            )}
          </label>
          {fieldHelp && <FieldHelpButton defaultOpen={defaultHelpOpen} help={fieldHelp} />}
        </div>
      </div>

      {hint && (
        <p className="text-xs leading-relaxed text-[#636b66]" id={hintId}>
          {hint}
        </p>
      )}

      <div>
        {typeof children === 'function'
          ? children({
              id,
              'aria-describedby': describedByIds,
              'aria-invalid': hasError,
              'aria-required': required ? true : undefined,
              className: defaultInputClass,
            })
          : children}
      </div>

      {error && (
        <div
          className="flex items-start gap-1.5 text-xs font-medium text-[#991b1b]"
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
