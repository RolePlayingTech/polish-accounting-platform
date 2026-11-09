import Link from 'next/link';
import { Card, StatusBadge } from '@pap/ui';
import { sanitizeInternalRedirect } from '../lib/request-security';
import { isSyntheticPersonaLoginAllowed } from '../lib/runtime-mode';
import { PUBLIC_SYNTHETIC_PERSONAS } from '../lib/workspace-types';

export interface LoginRequiredCardProps {
  returnTo: string;
  screenTitle: string;
}

export function LoginRequiredCard({ returnTo, screenTitle }: LoginRequiredCardProps) {
  const safeReturnTo = sanitizeInternalRedirect(returnTo, '/app');
  const allowPersonas = isSyntheticPersonaLoginAllowed();

  if (!allowPersonas) {
    return (
      <Card
        as="div"
        tone="subtle"
        eyebrow="Wymagana aktywna sesja aplikacji (ciasteczko HttpOnly)"
        title={`Zaloguj się, aby pracować w module: ${screenTitle}`}
      >
        <p className="text-sm leading-relaxed text-[#464c48]">
          Moduł <strong className="font-semibold text-[#191c1a]">{screenTitle}</strong> wymaga
          aktywnej sesji uwierzytelnionej przez dostawcę tożsamości OIDC oraz jawnego uprawnienia do
          podmiotu prawnego.
        </p>

        <div className="mt-4">
          <form method="post" action="/api/session/oidc/authorize">
            <input type="hidden" name="returnTo" value={safeReturnTo} />
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-semibold text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Zaloguj przez dostawcę tożsamości (OIDC)
            </button>
          </form>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e5e2d9] pt-3 text-xs text-[#464c48]">
          <Link
            href={`/login?redirectTo=${encodeURIComponent(safeReturnTo)}`}
            className="font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
          >
            Ekran logowania (/login)
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/academy"
            className="font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
          >
            Otwórz Akademię Księgowości (dostępna bez logowania)
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card
      as="div"
      tone="subtle"
      eyebrow="Wymagana aktywna sesja BFF (ciasteczko HttpOnly)"
      title={`Zaloguj się, aby pracować w module: ${screenTitle}`}
    >
      <p className="text-sm leading-relaxed text-[#464c48]">
        Ten ekran prezentuje dane księgowe konkretnej firmy w izolowanym środowisku testowym.
        Wybierz jedną z syntetycznych person OIDC poniżej, aby otworzyć{' '}
        <strong className="font-semibold text-[#191c1a]">{screenTitle}</strong> bez używania{' '}
        <code className="font-mono text-xs">localStorage</code> (token przekazywany wyłącznie przez
        bezpieczne ciasteczko <code className="font-mono text-xs">HttpOnly; SameSite=Lax</code>).
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {PUBLIC_SYNTHETIC_PERSONAS.map((persona) => (
          <form
            key={persona.personaId}
            method="post"
            action="/api/session/login"
            className="flex flex-col justify-between rounded-xl border border-[#e5e2d9] bg-white p-4"
          >
            <input type="hidden" name="personaId" value={persona.personaId} />
            <input type="hidden" name="redirectTo" value={safeReturnTo} />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#191c1a]">{persona.displayName}</p>
                <StatusBadge
                  size="sm"
                  tone={persona.tenantRole === 'owner' ? 'accent' : 'info'}
                  label={persona.tenantRole === 'owner' ? 'Właściciel' : 'Księgowa'}
                />
              </div>
              <p className="text-xs font-medium text-[#1d5c42]">{persona.roleSummaryPl}</p>
              <p className="text-xs leading-relaxed text-[#464c48]">{persona.descriptionPl}</p>
            </div>
            <button
              type="submit"
              className="mt-4 inline-flex min-h-9 w-full items-center justify-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-2 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Wejdź jako {persona.displayName}
            </button>
          </form>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#e5e2d9] pt-3 text-xs text-[#464c48]">
        <Link
          href="/login"
          className="font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
        >
          Pełny ekran wyboru persony (/login)
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/academy"
          className="font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
        >
          Otwórz Akademię Księgowości (dostępna bez logowania)
        </Link>
      </div>
    </Card>
  );
}
