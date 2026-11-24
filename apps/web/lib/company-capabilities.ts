import type { TaxProfileCode } from '@pap/domain';
import type { NavItem, NavSection } from '@pap/ui';
import type { CompanyProfileRecord } from './workspace-types';

export type PrimaryAccountingBookKind = 'kpir' | 'ryczalt' | 'full_ledger';

export interface CompanyCapabilities {
  readonly profileCode: TaxProfileCode | null;
  readonly profileShortBadgePl: string;
  readonly primaryBook: PrimaryAccountingBookKind | null;
  readonly primaryBookHref: '/app/kpir' | '/app/ryczalt' | '/app/ledger' | '/app';
  readonly primaryBookLabelPl: string;
  readonly primaryBookShortLabelPl: string;
  readonly incomeTaxKind: 'pit_skala' | 'pit_liniowy' | 'ryczalt_ppe' | 'cit' | null;
  readonly incomeTaxLabelPl: string;
  readonly vatMode: 'active_jpk_v7' | 'exempt_limit_monitor' | null;
  readonly vatNavLabelPl: string;
  readonly vatQuickLinkLabelPl: string;
  readonly zusApplicable: boolean;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly supportsKpir: boolean;
  readonly supportsRyczalt: boolean;
  readonly supportsFullLedger: boolean;
}

const REGIME_SPECIFIC_ROUTES: Readonly<Record<string, PrimaryAccountingBookKind>> = {
  '/app/kpir': 'kpir',
  '/accounting/kpir': 'kpir',
  '/app/ryczalt': 'ryczalt',
  '/accounting/ryczalt': 'ryczalt',
  '/app/ledger': 'full_ledger',
  '/accounting/ledger': 'full_ledger',
  '/accounting/reports': 'full_ledger',
};

export function getCompanyCapabilities(
  company: CompanyProfileRecord | null | undefined,
): CompanyCapabilities {
  if (!company) {
    return {
      profileCode: null,
      profileShortBadgePl: 'Brak wybranej firmy',
      primaryBook: null,
      primaryBookHref: '/app',
      primaryBookLabelPl: 'Księgi podatkowe',
      primaryBookShortLabelPl: 'Księgi',
      incomeTaxKind: null,
      incomeTaxLabelPl: 'Podatek dochodowy',
      vatMode: null,
      vatNavLabelPl: 'Podatek VAT i limity',
      vatQuickLinkLabelPl: 'Ewidencja VAT i limity',
      zusApplicable: false,
      canRead: false,
      canWrite: false,
      supportsKpir: false,
      supportsRyczalt: false,
      supportsFullLedger: false,
    };
  }

  const canRead = company.grantedActions.includes('read');
  const canWrite = company.grantedActions.includes('write');
  const isVatActive = company.vatStatus === 'czynny';
  const vatMode = isVatActive ? 'active_jpk_v7' : 'exempt_limit_monitor';
  const vatNavLabelPl = isVatActive ? 'Rejestry VAT i JPK_V7M' : 'Status VAT i limit zwolnienia';
  const vatQuickLinkLabelPl = isVatActive
    ? 'Rejestry VAT i pola deklaracji JPK_V7M(3)'
    : 'Status zwolnienia z VAT i monitor limitu 240 tys. PLN';
  const zusApplicable = company.zusScheme !== 'not_applicable';

  switch (company.profileCode) {
    case 'jdg_kpir_skala':
      return {
        profileCode: company.profileCode,
        profileShortBadgePl: 'JDG · KPiR (skala)',
        primaryBook: 'kpir',
        primaryBookHref: '/app/kpir',
        primaryBookLabelPl: 'KPiR i zaliczka PIT (skala)',
        primaryBookShortLabelPl: 'KPiR (19 / 17 kol.)',
        incomeTaxKind: 'pit_skala',
        incomeTaxLabelPl: 'Zaliczka PIT (skala 12% / 32%)',
        vatMode,
        vatNavLabelPl,
        vatQuickLinkLabelPl,
        zusApplicable,
        canRead,
        canWrite,
        supportsKpir: true,
        supportsRyczalt: false,
        supportsFullLedger: false,
      };
    case 'jdg_kpir_liniowy':
      return {
        profileCode: company.profileCode,
        profileShortBadgePl: 'JDG · KPiR (19%)',
        primaryBook: 'kpir',
        primaryBookHref: '/app/kpir',
        primaryBookLabelPl: 'KPiR i zaliczka PIT (19%)',
        primaryBookShortLabelPl: 'KPiR (19 / 17 kol.)',
        incomeTaxKind: 'pit_liniowy',
        incomeTaxLabelPl: 'Zaliczka PIT (liniowy 19%)',
        vatMode,
        vatNavLabelPl,
        vatQuickLinkLabelPl,
        zusApplicable,
        canRead,
        canWrite,
        supportsKpir: true,
        supportsRyczalt: false,
        supportsFullLedger: false,
      };
    case 'jdg_ryczalt':
      return {
        profileCode: company.profileCode,
        profileShortBadgePl: 'JDG · Ryczałt PPE',
        primaryBook: 'ryczalt',
        primaryBookHref: '/app/ryczalt',
        primaryBookLabelPl: 'Ewidencja przychodów (ryczałt)',
        primaryBookShortLabelPl: 'Ewidencja przychodów',
        incomeTaxKind: 'ryczalt_ppe',
        incomeTaxLabelPl: 'Ryczałt od przychodów ewidencjonowanych',
        vatMode,
        vatNavLabelPl,
        vatQuickLinkLabelPl,
        zusApplicable,
        canRead,
        canWrite,
        supportsKpir: false,
        supportsRyczalt: true,
        supportsFullLedger: false,
      };
    case 'spzoo_pelne_ksiegi':
      return {
        profileCode: company.profileCode,
        profileShortBadgePl: 'Sp. z o.o. · Pełne księgi UoR',
        primaryBook: 'full_ledger',
        primaryBookHref: '/app/ledger',
        primaryBookLabelPl: 'Księga główna, ZOiS i CIT',
        primaryBookShortLabelPl: 'Księga główna UoR i CIT',
        incomeTaxKind: 'cit',
        incomeTaxLabelPl: company.smallTaxpayer
          ? 'Zaliczka CIT (mały podatnik 9% / 19%)'
          : 'Zaliczka CIT (19%)',
        vatMode,
        vatNavLabelPl,
        vatQuickLinkLabelPl,
        zusApplicable,
        canRead,
        canWrite,
        supportsKpir: false,
        supportsRyczalt: false,
        supportsFullLedger: true,
      };
  }
}

export interface BuildWorkspaceNavOptions {
  readonly showOtherRegimesDemo?: boolean | undefined;
}

/**
 * Buduje nawigację kontekstową dopasowaną do aktywnego podmiotu (#120).
 * Nie wyświetla równocześnie KPiR, ryczałtu i pełnych ksiąg dla jednej firmy.
 */
export function buildWorkspaceNavSections(
  activeCompany: CompanyProfileRecord | null | undefined,
  options?: BuildWorkspaceNavOptions,
): readonly NavSection[] {
  if (!activeCompany) {
    return [
      {
        id: 'start-i-logowanie',
        title: 'Start aplikacji',
        items: [
          { id: 'dashboard', label: 'Pulpit startowy', href: '/app' },
          { id: 'login', label: 'Logowanie do ksiąg', href: '/login' },
        ],
      },
      {
        id: 'wiedza-publiczna',
        title: 'Wiedza i przepisy',
        items: [
          { id: 'academy', label: 'Akademia Księgowości', href: '/academy' },
          { id: 'rules', label: 'Katalog reguł prawnych', href: '/app/rules' },
        ],
      },
    ];
  }

  const caps = getCompanyCapabilities(activeCompany);

  const primaryLedgerItem: NavItem =
    caps.primaryBook === 'ryczalt'
      ? { id: 'ryczalt', label: caps.primaryBookLabelPl, href: '/app/ryczalt' }
      : caps.primaryBook === 'full_ledger'
        ? { id: 'ledger', label: caps.primaryBookLabelPl, href: '/app/ledger' }
        : { id: 'kpir', label: caps.primaryBookLabelPl, href: '/app/kpir' };

  const vatItem: NavItem = {
    id: 'vat',
    label: caps.vatNavLabelPl,
    href: '/app/vat',
    ...(caps.vatMode === 'exempt_limit_monitor'
      ? { badge: 'zw.', badgeTone: 'neutral' as const }
      : {}),
  };

  const mainSection: NavSection = {
    id: 'moja-ksiegowosc',
    title: `Moja księgowość · ${caps.profileShortBadgePl}`,
    items: [
      { id: 'dashboard', label: 'Pulpit dziś', href: '/app' },
      { id: 'documents', label: 'Faktury i dokumenty', href: '/app/documents' },
      primaryLedgerItem,
      vatItem,
      { id: 'finance', label: 'Rozrachunki i bank', href: '/app/finance' },
      { id: 'calendar', label: 'Kalendarz i podatki', href: '/app/calendar' },
      { id: 'companies', label: 'Podmioty i uprawnienia', href: '/app/companies' },
    ],
  };

  const moreToolsSection: NavSection = {
    id: 'wiecej-narzedzi',
    title: 'Więcej narzędzi',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { id: 'mcp', label: 'Klienci AI i kolejka MCP', href: '/app/mcp' },
      { id: 'rules', label: 'Katalog reguł „Dlaczego?”', href: '/app/rules' },
      { id: 'notifications', label: 'Powiadomienia i Sandbox', href: '/app/notifications' },
      { id: 'academy', label: 'Akademia Księgowości', href: '/academy' },
    ],
  };

  if (!options?.showOtherRegimesDemo) {
    return [mainSection, moreToolsSection];
  }

  const demoOtherItems: NavItem[] = [];
  if (!caps.supportsKpir) {
    demoOtherItems.push({
      id: 'demo-kpir',
      label: 'KPiR (inny reżim)',
      href: '/app/kpir',
      badge: 'DEMO',
      badgeTone: 'warning',
    });
  }
  if (!caps.supportsRyczalt) {
    demoOtherItems.push({
      id: 'demo-ryczalt',
      label: 'Ryczałt (inny reżim)',
      href: '/app/ryczalt',
      badge: 'DEMO',
      badgeTone: 'warning',
    });
  }
  if (!caps.supportsFullLedger) {
    demoOtherItems.push({
      id: 'demo-ledger',
      label: 'Pełne księgi (inny reżim)',
      href: '/app/ledger',
      badge: 'DEMO',
      badgeTone: 'warning',
    });
  }

  return [
    mainSection,
    moreToolsSection,
    {
      id: 'inne-moduly-demo',
      title: 'Podgląd innych reżimów (DEMO)',
      items: demoOtherItems,
    },
  ];
}

export function isRouteCompatibleWithCompany(
  pathname: string,
  company: CompanyProfileRecord | null | undefined,
): boolean {
  if (!company) return true;
  const cleanPath = pathname.split('?')[0]?.split('#')[0] ?? pathname;
  const requiredBook = REGIME_SPECIFIC_ROUTES[cleanPath];
  if (!requiredBook) return true;
  return getCompanyCapabilities(company).primaryBook === requiredBook;
}

/**
 * Jeśli użytkownik jest na ekranie księgi obcego reżimu (np. /app/ledger) i przełącza
 * aktywną firmę na podmiot z innym reżimem (np. JDG KPiR), zwraca ścieżkę właściwej księgi
 * nowego podmiotu (/app/kpir). Dla tras wspólnych zwraca `null`.
 */
export function resolveCompatibleHrefAfterCompanySwitch(
  currentHref: string,
  nextCompany: CompanyProfileRecord,
): string | null {
  const cleanPath = currentHref.split('?')[0]?.split('#')[0] ?? currentHref;
  const requiredBook = REGIME_SPECIFIC_ROUTES[cleanPath];
  if (!requiredBook) {
    return null;
  }
  const nextCaps = getCompanyCapabilities(nextCompany);
  if (nextCaps.primaryBook === requiredBook) {
    return null;
  }
  return nextCaps.primaryBookHref;
}

export function findAccessibleCompaniesForBook(
  accessibleCompanies: readonly CompanyProfileRecord[],
  book: PrimaryAccountingBookKind,
): readonly CompanyProfileRecord[] {
  return accessibleCompanies.filter(
    (company) => getCompanyCapabilities(company).primaryBook === book,
  );
}
