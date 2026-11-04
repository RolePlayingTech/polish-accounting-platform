'use client';

import {
  useEffect,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { StatusBadge } from './primitives.js';
import {
  formatAccountingPeriod,
  formatNip,
  ksiegaTokens,
  type AppSurface,
  type StatusTone,
} from './tokens.js';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly badge?: string | number | undefined;
  readonly badgeTone?: StatusTone | undefined;
  readonly disabled?: boolean | undefined;
}

export interface NavSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly NavItem[];
}

export const DEFAULT_APP_NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'accounting',
    title: 'Praca księgowa',
    items: [
      { id: 'dashboard', label: 'Pulpit', href: '/app' },
      { id: 'documents', label: 'Dokumenty', href: '/app/documents' },
      { id: 'kpir', label: 'KPiR / Ewidencja', href: '/app/kpir' },
      { id: 'vat-jpk', label: 'VAT i JPK', href: '/app/vat-jpk' },
      { id: 'full-ledger', label: 'Pełna księgowość', href: '/app/ledger' },
      { id: 'tax-calendar', label: 'Kalendarz podatkowy', href: '/app/calendar' },
      { id: 'finance-bank', label: 'Finanse i bank', href: '/app/finance' },
      { id: 'notifications', label: 'Powiadomienia', href: '/app/notifications' },
      { id: 'mcp-center', label: 'Centrum MCP', href: '/app/mcp' },
    ],
  },
  {
    id: 'knowledge',
    title: 'Wiedza',
    items: [
      { id: 'academy', label: 'Akademia Księgowości', href: '/app/academy' },
      { id: 'legal-rules', label: 'Rejestr reguł prawnych', href: '/app/legal-rules' },
    ],
  },
  {
    id: 'management',
    title: 'Zarządzanie',
    items: [
      { id: 'entities-access', label: 'Firmy i uprawnienia', href: '/settings' },
      { id: 'platform-admin', label: 'Administracja', href: '/platform' },
    ],
  },
] as const;

export type DataEnvironmentMode = 'synthetic' | 'staging' | 'verified';

export interface CompanyPeriodHeaderProps {
  companyName: string;
  nip: string;
  taxProfileLabel: string;
  period: string;
  availablePeriods?: readonly string[] | undefined;
  onPeriodChange?: ((nextPeriod: string) => void) | undefined;
  dataFreshnessLabel: string;
  dataMode?: DataEnvironmentMode | undefined;
  onSwitchCompany?: (() => void) | undefined;
  actions?: ReactNode | undefined;
}

const DATA_MODE_BADGE: Record<DataEnvironmentMode, { label: string; tone: StatusTone }> = {
  synthetic: { label: 'Tryb syntetyczny', tone: 'warning' },
  staging: { label: 'Środowisko testowe', tone: 'info' },
  verified: { label: 'Dane zweryfikowane', tone: 'success' },
};

/**
 * Stały pasek kontekstu firmy, NIP, profilu podatkowego, okresu rozliczeniowego (`RRRR-MM`) i świeżości danych.
 */
export function CompanyPeriodHeader({
  actions,
  availablePeriods,
  companyName,
  dataFreshnessLabel,
  dataMode = 'synthetic',
  nip,
  onPeriodChange,
  onSwitchCompany,
  period,
  taxProfileLabel,
}: CompanyPeriodHeaderProps) {
  const periodSelectId = useId();
  const formattedNip = formatNip(nip);
  const normalizedPeriod = formatAccountingPeriod(period);
  const modeSpec = DATA_MODE_BADGE[dataMode];

  return (
    <div
      aria-label="Kontekst firmy i okresu rozliczeniowego"
      className="border-b border-[#e5e2d9] bg-white px-4 py-3 sm:px-6 lg:px-8"
      role="region"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#636b66]">
                Podmiot
              </span>
              <strong className="truncate text-sm font-semibold text-[#191c1a] sm:max-w-[380px]">
                {companyName}
              </strong>
              {onSwitchCompany && (
                <button
                  className={`rounded-md border border-[#d2cec2] bg-[#faf9f5] px-2 py-0.5 text-[11px] font-medium text-[#191c1a] hover:bg-[#f4f2ec] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                  onClick={onSwitchCompany}
                  type="button"
                >
                  Zmień firmę
                </button>
              )}
            </div>
          </div>

          <span aria-hidden="true" className="hidden text-[#d2cec2] sm:inline">
            |
          </span>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#464c48]">
            <span>
              NIP:{' '}
              <span
                className={`font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}
              >
                {formattedNip}
              </span>
            </span>
            <span aria-hidden="true" className="text-[#d2cec2]">
              ·
            </span>
            <span className="rounded bg-[#f4f2ec] px-2 py-0.5 font-medium text-[#191c1a]">
              {taxProfileLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-[#d2cec2] bg-[#faf9f5] px-2.5 py-1">
            <label
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#636b66]"
              htmlFor={periodSelectId}
            >
              Okres
            </label>
            {availablePeriods && availablePeriods.length > 0 && onPeriodChange ? (
              <select
                aria-label="Okres rozliczeniowy (RRRR-MM)"
                className={`bg-transparent text-xs font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums} ${ksiegaTokens.a11y.focusRing}`}
                id={periodSelectId}
                onChange={(event) => onPeriodChange(event.target.value)}
                value={normalizedPeriod}
              >
                {availablePeriods.map((optionPeriod) => {
                  const code = formatAccountingPeriod(optionPeriod);
                  return (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  );
                })}
              </select>
            ) : (
              <span
                className={`text-xs font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}
                id={periodSelectId}
              >
                {normalizedPeriod}
              </span>
            )}
          </div>

          <StatusBadge label={modeSpec.label} size="sm" tone={modeSpec.tone} />

          <span className="text-xs text-[#636b66]">{dataFreshnessLabel}</span>

          {actions}
        </div>
      </div>
    </div>
  );
}

export type ShellLinkRenderer = (
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode },
) => ReactNode;

export interface AppShellProps extends PropsWithChildren {
  activeHref?: string | undefined;
  sections?: readonly NavSection[] | undefined;
  surface?: AppSurface | undefined;
  contextHeader?: ReactNode | undefined;
  pageTitle?: string | undefined;
  pageSubtitle?: string | undefined;
  pageEyebrow?: string | undefined;
  pageActions?: ReactNode | undefined;
  footerNote?: string | undefined;
  defaultMobileMenuOpen?: boolean | undefined;
  renderLink?: ShellLinkRenderer | undefined;
}

const SURFACE_META: Record<
  AppSurface,
  {
    brandSubtitle: string;
    bannerText?: string;
    sidebarBg: string;
  }
> = {
  app: {
    brandSubtitle: 'Księga Współczesna',
    sidebarBg: 'bg-[#f4f2ec]',
  },
  settings: {
    brandSubtitle: 'Ustawienia organizacji',
    bannerText:
      'Obszar administracji organizacji (tenanta) — zarządzanie firmami, członkostwami i uprawnieniami MCP.',
    sidebarBg: 'bg-[#f4f2ec]',
  },
  platform: {
    brandSubtitle: 'Konsola operatora',
    bannerText:
      'Konsola operatora usługi — brak automatycznego dostępu do dokumentów, faktur i ksiąg podatkowych klientów (ADR-003).',
    sidebarBg: 'bg-[#efece4]',
  },
};

function defaultLinkRenderer({
  children,
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * Główny szkielet aplikacji („Księga Współczesna”) z podzieloną na sekcje lewą nawigacją,
 * dostępną klawiaturowo szufladą mobilną oraz rozdziałem powierzchni `/app`, `/settings` i `/platform`.
 */
export function AppShell({
  activeHref = '/app',
  children,
  contextHeader,
  defaultMobileMenuOpen = false,
  footerNote = 'Polish Accounting Platform · Jurysdykcja: Polska · AI i OCR wyłącznie proponują dane',
  pageActions,
  pageEyebrow,
  pageSubtitle,
  pageTitle,
  renderLink = defaultLinkRenderer,
  sections = DEFAULT_APP_NAV_SECTIONS,
  surface = 'app',
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState<boolean>(defaultMobileMenuOpen);
  const mobileDrawerId = useId();
  const surfaceMeta = SURFACE_META[surface];

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  const renderNavigationList = (onNavigate?: () => void) => (
    <nav
      aria-label="Główna nawigacja aplikacji"
      className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
    >
      {sections.map((section) => (
        <div key={section.id}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#636b66]">
            {section.title}
          </p>
          <ul className="mt-2 space-y-0.5" role="list">
            {section.items.map((item) => {
              const isActive = item.href === activeHref;
              const baseItemClass = `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-medium ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`;
              const stateClass = item.disabled
                ? 'cursor-not-allowed text-[#636b66] opacity-60'
                : isActive
                  ? 'bg-[#e7f1ec] font-semibold text-[#164833] border border-[#b7d4c5]'
                  : 'border border-transparent text-[#464c48] hover:bg-white/70 hover:text-[#191c1a]';

              if (item.disabled) {
                return (
                  <li key={item.id}>
                    <span aria-disabled="true" className={`${baseItemClass} ${stateClass}`}>
                      <span>{item.label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-[#636b66]">
                        Wkrótce
                      </span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.id}>
                  {renderLink({
                    href: item.href,
                    'aria-current': isActive ? 'page' : undefined,
                    className: `${baseItemClass} ${stateClass}`,
                    onClick: onNavigate,
                    children: (
                      <>
                        <span className="flex items-center gap-2.5 truncate">
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full ${
                              isActive ? 'bg-[#1d5c42]' : 'bg-[#d2cec2]'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.badge !== undefined && (
                          <StatusBadge
                            label={String(item.badge)}
                            size="sm"
                            tone={item.badgeTone ?? 'warning'}
                          />
                        )}
                      </>
                    ),
                  })}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div
      className="min-h-screen bg-[#faf9f5] text-[#191c1a] lg:grid lg:grid-cols-[264px_1fr]"
      data-surface={surface}
    >
      <a
        className={`sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#1d5c42] focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-white ${ksiegaTokens.a11y.focusRing}`}
        href="#main-content"
      >
        Przejdź do głównej treści
      </a>

      {/* Nawigacja boczna Desktop */}
      <aside
        aria-label="Pasek boczny"
        className={`hidden border-r border-[#e5e2d9] ${surfaceMeta.sidebarBg} lg:flex lg:flex-col`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-[#e5e2d9] px-5">
          <div
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-[#1d5c42] text-xs font-bold tracking-tight text-white"
          >
            KW
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-[#191c1a]">
              Polish Accounting
            </p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#636b66]">
              {surfaceMeta.brandSubtitle}
            </p>
          </div>
        </div>

        {renderNavigationList()}

        <div className="border-t border-[#e5e2d9] p-4">
          <p className="text-[11px] leading-relaxed text-[#636b66]">
            Wszystkie operacje księgowe i deklaracje wymagają jawnego zatwierdzenia człowieka.
          </p>
        </div>
      </aside>

      {/* Pasek górny Mobile + szuflada */}
      <div className="flex min-w-0 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-[#e5e2d9] bg-[#f4f2ec] px-4 lg:hidden">
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-md bg-[#1d5c42] text-[11px] font-bold text-white"
            >
              KW
            </div>
            <span className="text-sm font-semibold text-[#191c1a]">Polish Accounting</span>
          </div>

          <button
            aria-controls={mobileDrawerId}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Zamknij menu nawigacji' : 'Otwórz menu nawigacji'}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d2cec2] bg-white px-3 py-1.5 text-xs font-semibold text-[#191c1a] ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
            onClick={() => setMobileOpen((prev) => !prev)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={2}
              viewBox="0 0 16 16"
            >
              {mobileOpen ? (
                <path d="M4 4l8 8M12 4l-8 8" />
              ) : (
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
              )}
            </svg>
            <span>{mobileOpen ? 'Zamknij' : 'Menu'}</span>
          </button>
        </div>

        {mobileOpen && (
          <div
            aria-label="Nawigacja mobilna"
            aria-modal="true"
            className="fixed inset-0 z-40 flex lg:hidden"
            id={mobileDrawerId}
            role="dialog"
          >
            <div
              aria-hidden="true"
              className="fixed inset-0 bg-[#191c1a]/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative z-10 flex w-72 max-w-[85vw] flex-col border-r border-[#e5e2d9] bg-[#faf9f5] shadow-xl">
              <div className="flex h-14 items-center justify-between border-b border-[#e5e2d9] px-4">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#636b66]">
                  {surfaceMeta.brandSubtitle}
                </span>
                <button
                  className={`rounded-lg border border-[#d2cec2] bg-white px-2.5 py-1 text-xs font-semibold text-[#191c1a] ${ksiegaTokens.a11y.focusRing}`}
                  onClick={() => setMobileOpen(false)}
                  type="button"
                >
                  Zamknij (Esc)
                </button>
              </div>
              {renderNavigationList(() => setMobileOpen(false))}
            </div>
          </div>
        )}

        {surfaceMeta.bannerText && (
          <div
            className="border-b border-[#dcd3b8] bg-[#f7f4ea] px-4 py-2 text-xs font-medium text-[#5b4618] sm:px-6 lg:px-8"
            role="note"
          >
            {surfaceMeta.bannerText}
          </div>
        )}

        {contextHeader}

        <main
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
          id="main-content"
          tabIndex={-1}
        >
          {(pageTitle || pageEyebrow || pageSubtitle || pageActions) && (
            <header className="mb-6 flex flex-col justify-between gap-4 border-b border-[#e5e2d9] pb-5 sm:flex-row sm:items-end">
              <div>
                {pageEyebrow && (
                  <p className={`mb-1.5 ${ksiegaTokens.typography.eyebrow}`}>{pageEyebrow}</p>
                )}
                {pageTitle && <h1 className={ksiegaTokens.typography.pageTitle}>{pageTitle}</h1>}
                {pageSubtitle && (
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[#464c48]">
                    {pageSubtitle}
                  </p>
                )}
              </div>
              {pageActions && (
                <div className="flex flex-wrap items-center gap-2.5">{pageActions}</div>
              )}
            </header>
          )}

          {children}
        </main>

        <footer className="border-t border-[#e5e2d9] px-4 py-4 text-xs text-[#636b66] sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1400px]">{footerNote}</div>
        </footer>
      </div>
    </div>
  );
}
