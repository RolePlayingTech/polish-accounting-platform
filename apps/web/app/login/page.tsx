import Link from 'next/link';
import { Card, StatusBadge } from '@pap/ui';
import { AcademyDisclaimerBanner, AlertBanner } from '../../components/ui-controls';
import { sanitizeInternalRedirect } from '../../lib/request-security';
import { isSyntheticPersonaLoginAllowed } from '../../lib/runtime-mode';
import { readServerSession } from '../../lib/session';
import { listAvailablePersonas } from '../../lib/synthetic-workspace';
import { PUBLIC_SYNTHETIC_PERSONAS, type PublicPersonaSummary } from '../../lib/workspace-types';
import { PersonaLoginClient } from './persona-login-client';

const SAFE_INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{24,256}$/;

interface AuthStateNotice {
  readonly tone: 'info' | 'warning' | 'danger';
  readonly title: string;
  readonly description: string;
}

const AUTH_STATE_NOTICES: Readonly<Record<string, AuthStateNotice>> = {
  signed_out: {
    tone: 'info',
    title: 'Wylogowano pomyślnie',
    description: 'Twoja sesja w aplikacji została bezpiecznie zakończona.',
  },
  session_expired_or_invalid: {
    tone: 'warning',
    title: 'Sesja wygasła lub została unieważniona',
    description: 'Zaloguj się ponownie, aby kontynuować pracę w aplikacji.',
  },
  oidc_denied_or_cancelled: {
    tone: 'warning',
    title: 'Logowanie zostało przerwane',
    description:
      'Dostawca tożsamości nie potwierdził autoryzacji lub logowanie zostało anulowane przez użytkownika.',
  },
  invalid_callback_state: {
    tone: 'danger',
    title: 'Nieprawidłowy lub wygasły stan autoryzacji PKCE',
    description:
      'Ze względów bezpieczeństwa odrzucono powrót z logowania (ochrona przed powtórzeniem kodu autoryzacyjnego lub CSRF). Rozpocznij logowanie ponownie.',
  },
  insufficient_permissions: {
    tone: 'danger',
    title: 'Brak aktywnych uprawnień do konta',
    description:
      'Tożsamość została zweryfikowana, lecz konto jest nieaktywne lub uprawnienia dostępu zostały cofnięte.',
  },
  no_tenant_membership: {
    tone: 'warning',
    title: 'Konto nie ma jeszcze przypisanej organizacji',
    description:
      'Zaloguj się i przyjmij jednorazowe zaproszenie otrzymane od właściciela lub administratora organizacji.',
  },
  auth_service_unavailable: {
    tone: 'danger',
    title: 'Usługa uwierzytelniania jest chwilowo niedostępna',
    description:
      'Aplikacja działa w trybie bezpiecznej odmowy (fail-closed), gdy dostawca OIDC lub magazyn sesji nie odpowiada. Spróbuj ponownie za chwilę.',
  },
};

async function loadPersonasSafe(): Promise<readonly PublicPersonaSummary[]> {
  try {
    return await listAvailablePersonas();
  } catch {
    return PUBLIC_SYNTHETIC_PERSONAS;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; authState?: string; invite?: string }>;
}) {
  const resolvedParams = await searchParams;
  const allowPersonas = isSyntheticPersonaLoginAllowed();
  const rawInvite =
    typeof resolvedParams.invite === 'string' ? resolvedParams.invite.trim() : '';
  const inviteToken = SAFE_INVITE_TOKEN_REGEX.test(rawInvite) ? rawInvite : undefined;

  const fallbackTarget = inviteToken
    ? `/app?invite=${encodeURIComponent(inviteToken)}`
    : '/app';
  const redirectTo = sanitizeInternalRedirect(resolvedParams.redirectTo, fallbackTarget);
  const authStateNotice =
    typeof resolvedParams.authState === 'string'
      ? AUTH_STATE_NOTICES[resolvedParams.authState]
      : undefined;

  if (!allowPersonas) {
    const activeSession = await readServerSession();

    return (
      <div className="min-h-screen bg-[#faf9f5] text-[#191c1a]">
        <header className="border-b border-[#e5e2d9] bg-white">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <Link
              href="/"
              className="inline-flex min-h-6 items-center text-sm font-semibold text-[#191c1a] hover:text-[#1d5c42] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              ← Polish Accounting Platform („Księga Współczesna”)
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge size="sm" tone="legal" label="OIDC + PKCE (S256)" />
              <Link
                href="/academy"
                className="inline-flex min-h-8 items-center rounded-md border border-[#858177] bg-white px-3 py-1 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
              >
                Akademia bez logowania
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
          {authStateNotice ? (
            <AlertBanner tone={authStateNotice.tone} title={authStateNotice.title}>
              {authStateNotice.description}
            </AlertBanner>
          ) : null}

          {inviteToken ? (
            <AlertBanner
              tone="info"
              title="Wykryto jednorazowe zaproszenie do organizacji"
            >
              Po zalogowaniu przez dostawcę tożsamości potwierdzisz przyjęcie lub odrzucenie
              zaproszenia na pulpicie aplikacji.
            </AlertBanner>
          ) : null}

          {activeSession ? (
            <AlertBanner
              tone="info"
              title={`Aktywna sesja: ${activeSession.context.displayName}`}
            >
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <Link
                  href={redirectTo}
                  className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#164833]"
                >
                  Kontynuuj do aplikacji
                </Link>
                <form method="post" action="/api/session/logout">
                  <button
                    type="submit"
                    className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
                  >
                    Wyloguj z bieżącego konta
                  </button>
                </form>
              </div>
            </AlertBanner>
          ) : null}

          <Card
            as="section"
            eyebrow="Bezpieczne uwierzytelnianie aplikacji · Sesja serwerowa HttpOnly"
            title="Zaloguj się do Polish Accounting Platform"
          >
            <div className="space-y-5">
              <p className="text-sm leading-relaxed text-[#464c48]">
                Uwierzytelnianie korzysta ze standardu OAuth 2.0 Authorization Code z{' '}
                <code className="font-mono text-xs">PKCE (S256)</code>. Aplikacja przechowuje
                wyłącznie nieprzezroczysty identyfikator sesji w bezpiecznym ciasteczku{' '}
                <code className="font-mono text-xs">HttpOnly; Secure; SameSite=Lax</code> — żadne
                tokeny dostępowe ani odświeżania nie trafiają do przeglądarkowego JavaScriptu.
              </p>

              <form method="post" action="/api/session/oidc/authorize">
                <input type="hidden" name="returnTo" value={redirectTo} />
                <button
                  type="submit"
                  data-testid="oidc-single-login-submit"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42] sm:w-auto"
                >
                  Zaloguj przez dostawcę tożsamości (OIDC)
                </button>
              </form>

              <div className="border-t border-[#e5e2d9] pt-4 text-xs leading-relaxed text-[#636b66]">
                Dostęp do organizacji i podmiotów prawnych wymaga wcześniejszego utworzenia konta
                właściciela lub przyjęcia jednorazowego zaproszenia wystawionego przez właściciela
                bądź administratora organizacji.
              </div>
            </div>
          </Card>

          <AcademyDisclaimerBanner />
        </main>
      </div>
    );
  }

  const personas = await loadPersonasSafe();

  return (
    <div className="min-h-screen bg-[#faf9f5] text-[#191c1a]">
      <header className="border-b border-[#e5e2d9] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex min-h-6 items-center text-sm font-semibold text-[#191c1a] hover:text-[#1d5c42] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            ← Polish Accounting Platform („Księga Współczesna”)
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge size="sm" tone="warning" label="Dane syntetyczne (OIDC Sandbox)" />
            <Link
              href="/academy"
              className="inline-flex min-h-8 items-center rounded-md border border-[#858177] bg-white px-3 py-1 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
            >
              Akademia bez logowania
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {authStateNotice ? (
          <AlertBanner tone={authStateNotice.tone} title={authStateNotice.title}>
            {authStateNotice.description}
          </AlertBanner>
        ) : null}

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#636b66]">
            Uwierzytelnianie OIDC · Sesja BFF HttpOnly + HMAC-SHA256
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#191c1a] sm:text-3xl">
            Wybierz syntetyczną personę testową
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[#464c48]">
            Logowanie pobiera token z lokalnego dostawcy OIDC (
            <code className="font-mono text-xs">GET /api/v1/oidc/personas</code> →{' '}
            <code className="font-mono text-xs">POST /api/v1/oidc/token</code>) i zapisuje go
            wyłącznie w bezpiecznym ciasteczku serwerowym{' '}
            <code className="font-mono text-xs">HttpOnly; SameSite=Lax; Path=/</code> z podpisem
            kryptograficznym HMAC-SHA256. Tokeny nigdy nie trafiają do przeglądarkowego JS ani{' '}
            <code className="font-mono text-xs">localStorage</code>.
          </p>
        </div>

        <AlertBanner
          tone="info"
          title="Jak przetestować izolację tenantów i uprawnienia księgowego (ADR-003)?"
        >
          Wybierz <strong>Jana Testowego</strong>, aby mieć pełny dostęp właścicielski do 3 firm
          (JDG KPiR + VAT, JDG Ryczałt + zw. VAT, Sp. z o.o. UoR + CIT 9%). Wybierz{' '}
          <strong>Martę Księgową</strong>, aby sprawdzić delegowane granty odczyt/zapis, albo{' '}
          <strong>Piotra Izolacyjnego</strong>, aby zweryfikować twardą separację organizacji Tenant
          2 od Tenant 1.
        </AlertBanner>

        <PersonaLoginClient personas={personas} redirectTo={redirectTo} />

        <AcademyDisclaimerBanner />
      </main>
    </div>
  );
}
