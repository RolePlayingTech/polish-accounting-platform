import Link from 'next/link';
import { StatusBadge } from '@pap/ui';
import { AcademyDisclaimerBanner, AlertBanner } from '../../components/ui-controls';
import { listAvailablePersonas } from '../../lib/synthetic-workspace';
import { PersonaLoginClient } from './persona-login-client';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const resolvedParams = await searchParams;
  const personas = await listAvailablePersonas();
  const redirectTo =
    typeof resolvedParams.redirectTo === 'string' &&
    resolvedParams.redirectTo.startsWith('/') &&
    !resolvedParams.redirectTo.startsWith('//')
      ? resolvedParams.redirectTo
      : '/app';

  return (
    <div className="min-h-screen bg-[#faf9f5] text-[#191c1a]">
      <header className="border-b border-[#e5e2d9] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="text-sm font-semibold text-[#191c1a] hover:text-[#1d5c42] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            ← Polish Accounting Platform („Księga Współczesna”)
          </Link>
          <div className="flex items-center gap-2">
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
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#636b66]">
            Uwierzytelnianie OIDC · Sesja BFF HttpOnly
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#191c1a] sm:text-3xl">
            Wybierz syntetyczną personę testową
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[#464c48]">
            Logowanie pobiera token z lokalnego dostawcy OIDC (
            <code className="font-mono text-xs">GET /api/v1/oidc/personas</code> →{' '}
            <code className="font-mono text-xs">POST /api/v1/oidc/token</code>) i zapisuje go
            wyłącznie w bezpiecznym ciasteczku serwerowym{' '}
            <code className="font-mono text-xs">HttpOnly; SameSite=Lax; Path=/</code>. Tokeny nigdy
            nie trafiają do <code className="font-mono text-xs">localStorage</code>.
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
