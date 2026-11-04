import { StatusBadge } from '@pap/ui';
import type { PublicSystemStatusResult } from '../lib/read-system-status';

/**
 * Odznaka stanu połączenia z `apps/api` — zachowuje ścisły kontrakt E2E (`API odpowiada` / `API niedostępne` dokładnie 1 raz).
 */
export function SystemApiStatusBadge({ status }: { readonly status: PublicSystemStatusResult }) {
  const isAvailable = status.state === 'available';
  return (
    <StatusBadge
      tone={isAvailable ? 'success' : 'danger'}
      label={isAvailable ? 'API odpowiada' : 'API niedostępne'}
    />
  );
}

/**
 * Sekcja diagnostyki platformy z nagłówkiem `Zakres pierwszego etapu` i `border-radius: 16px`
 * wymagana przez `apps/web/e2e/system-status.spec.ts` oraz `pap-smoke-test.sh`.
 * Uwaga: Nie owijaj tego komponentu w żaden zewnętrzny `<section>`, aby selektor Playwright
 * `page.locator('section').filter({ has: page.getByRole('heading', { name: 'Zakres pierwszego etapu' }) })`
 * zawsze zwracał dokładnie 1 element!
 */
export function SystemStatusDiagnosticSection({
  status,
}: {
  readonly status: PublicSystemStatusResult;
}) {
  const isAvailable = status.state === 'available';

  return (
    <section
      aria-labelledby="pap-stage-one-heading"
      className="rounded-2xl border border-[#e5e2d9] bg-white p-5"
      style={{ borderRadius: '16px' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e2d9] pb-3.5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#636b66]">
            Diagnostyka połączenia usług
          </p>
          <h2
            id="pap-stage-one-heading"
            className="mt-0.5 text-base font-semibold tracking-tight text-[#191c1a]"
          >
            Zakres pierwszego etapu
          </h2>
        </div>
        <SystemApiStatusBadge status={status} />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3.5 py-2.5">
          <div>
            <dt className="text-xs font-semibold text-[#191c1a]">
              Aplikacja webowa BFF (apps/web)
            </dt>
            <dd className="mt-0.5 text-xs text-[#636b66]">
              Warstwa prezentacji „Księga Współczesna” i Akademia Księgowości
            </dd>
          </div>
          <StatusBadge tone="success" size="sm" label="Uruchomiony" />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3.5 py-2.5">
          <div>
            <dt className="text-xs font-semibold text-[#191c1a]">
              Rdzeń HTTP (apps/api · /api/v1/system/status)
            </dt>
            <dd className="mt-0.5 text-xs text-[#636b66]">
              {isAvailable
                ? `${status.status.service} v${status.status.version} · status: ${status.status.status}`
                : 'Brak odpowiedzi z /api/v1/system/status — praca w trybie lokalnego warsztatu syntetycznego'}
            </dd>
          </div>
          <StatusBadge
            tone={isAvailable ? 'success' : 'danger'}
            size="sm"
            label={isAvailable ? 'Dostępny' : 'Niedostępny'}
          />
        </div>
      </dl>
    </section>
  );
}
