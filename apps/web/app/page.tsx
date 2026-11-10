import Link from 'next/link';
import { ACADEMY_ALL_LESSONS, ACADEMY_MODULES } from '@pap/domain/academy';
import { POLISH_LEGAL_RULES_REGISTRY } from '@pap/domain';
import { Card, MoneyAmount, StatusBadge } from '@pap/ui';
import { AcademyDisclaimerBanner } from '../components/ui-controls';
import { isSyntheticPersonaLoginAllowed, resolveWebRuntimeMode } from '../lib/runtime-mode';
import { readServerSession } from '../lib/session';

export default async function ProductHomePage() {
  const session = await readServerSession();
  const allowPersonas = isSyntheticPersonaLoginAllowed();
  const runtimeMode = resolveWebRuntimeMode();
  const primaryLoginLabel = allowPersonas
    ? 'Zaloguj się do środowiska testowego'
    : 'Zaloguj się';
  const heroLoginLabel = session
    ? 'Otwórz pulpit księgowy (/app)'
    : allowPersonas
      ? 'Zaloguj się do środowiska testowego (3 persony OIDC)'
      : 'Zaloguj się do aplikacji';
  const envBadgeLabel = allowPersonas
    ? 'Środowisko syntetyczne — brak prawdziwych rozliczeń'
    : runtimeMode === 'PRODUCTION' || runtimeMode === 'PUBLIC_DEMO'
      ? 'Bezpieczne logowanie OIDC + PKCE'
      : 'Prywatne środowisko testowe — dane syntetyczne';

  return (
    <div className="min-h-screen bg-[#faf9f5] text-[#191c1a]">
      <header className="border-b border-[#e5e2d9] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#1d5c42] bg-[#1d5c42] font-mono text-xs font-bold tracking-wider text-white"
            >
              PAP
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-[#191c1a]">
                Polish Accounting Platform
              </p>
              <p className="text-xs text-[#636b66]">
                System projektowy „Księga Współczesna” · Polska jurysdykcja 2025/2026
              </p>
            </div>
          </div>

          <nav
            aria-label="Nawigacja strony głównej"
            className="flex flex-wrap items-center gap-2.5"
          >
            <Link
              href="/academy"
              className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-2 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Akademia Księgowości ({String(ACADEMY_ALL_LESSONS.length)} lekcji)
            </Link>
            <Link
              href="/app"
              className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-2 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Pulpit aplikacji (/app)
            </Link>
            <Link
              href={session ? '/app' : '/login'}
              className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              {session ? `Kontynuuj jako ${session.context.displayName}` : primaryLoginLabel}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-[#e5e2d9] bg-white p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={allowPersonas ? 'warning' : 'info'}
              label={envBadgeLabel}
            />
            <StatusBadge
              tone="legal"
              label={`${String(POLISH_LEGAL_RULES_REGISTRY.length)} zweryfikowane reguły prawne`}
            />
            <StatusBadge tone="accent" label="AI i MCP wyłącznie proponują" />
          </div>

          <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.025em] text-[#191c1a] sm:text-4xl">
            Spokojny dziennik finansowy i warsztat polskiej księgowości dla JDG oraz Sp. z o.o.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#464c48]">
            Jedno spójne jądro domenowe obsługuje KPiR (układ 19 kolumn KSeF 2026 oraz 17 kolumn
            2019), ryczałt ewidencjonowany z kontrolą limitu zwolnienia VAT{' '}
            <MoneyAmount amount={24000000} inGrosze size="sm" />, pełne księgi rachunkowe UoR z CIT
            9%/19%, weryfikację e-faktur <code className="font-mono text-sm">FA(3)</code>, rejestry{' '}
            <code className="font-mono text-sm">JPK_V7M(3)</code> oraz adapter MCP dla zewnętrznych
            agentów AI.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={session && !allowPersonas ? '/app' : '/login'}
              className="inline-flex min-h-11 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              {heroLoginLabel}
            </Link>
            <Link
              href="/academy"
              className="inline-flex min-h-11 items-center rounded-md border border-[#858177] bg-white px-5 py-2.5 text-sm font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Otwórz Akademię Księgowości ({String(ACADEMY_MODULES.length)} modułów bez logowania)
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card
            as="article"
            eyebrow="Reżimy podatkowe 2026"
            title="JDG (KPiR / Ryczałt) i Sp. z o.o. (UoR)"
          >
            <p className="text-sm leading-relaxed text-[#464c48]">
              Obsługa skali podatkowej 12%/32%, podatku liniowego 19%, ryczałtu PPE, rozliczenia
              samochodów osobowych (50% VAT / 75% KUP wg art. 23 ust. 1 pkt 46a PIT) oraz podwójnego
              zapisu Wn = Ma dla spółek kapitałowych.
            </p>
          </Card>

          <Card
            as="article"
            eyebrow="Wyjaśnialność prawa"
            title="Przycisk „§ Dlaczego?” przy każdym wyliczeniu"
          >
            <p className="text-sm leading-relaxed text-[#464c48]">
              Każda kwota podatku, składki ZUS, kwalifikacji kosztu i przesunięcia terminu z art. 12
              § 5 Ordynacji podatkowej posiada pełną ścieżkę obliczeniową oraz link do ISAP / Dz.U.
              / podatki.gov.pl.
            </p>
          </Card>

          <Card
            as="article"
            eyebrow="Bezpieczeństwo i MCP (ADR-001)"
            title="Izolacja tenantów i autoryzacja człowieka"
          >
            <p className="text-sm leading-relaxed text-[#464c48]">
              Sesja BFF korzysta wyłącznie z ciasteczek{' '}
              <code className="font-mono text-xs">HttpOnly</code>. Agenci Claude, Cursor, ChatGPT i
              Gemini łączą się przez Streamable HTTP MCP i mogą jedynie przygotować szkic do
              zatwierdzenia przez człowieka.
            </p>
          </Card>
        </div>

        <AcademyDisclaimerBanner />
      </main>
    </div>
  );
}
