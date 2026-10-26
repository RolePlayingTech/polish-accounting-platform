import Link from 'next/link';
import { Card, StatusBadge } from '@pap/ui';
import { readPublicSystemStatus } from '../../lib/read-system-status';

export const dynamic = 'force-dynamic';

const navigation = [
  { href: '/app', label: 'Przegląd', active: true },
  { href: '/settings', label: 'Ustawienia organizacji', active: false },
  { href: '/platform', label: 'Administracja platformy', active: false },
];

export default async function WorkspacePage() {
  const result = await readPublicSystemStatus();
  const isAvailable = result.state === 'available';

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_1fr]">
      <aside className="hidden border-r border-stone-200 bg-[#fbfcf8] lg:flex lg:flex-col">
        <div className="flex h-[76px] items-center gap-3 border-b border-stone-200 px-6">
          <div className="grid size-9 place-items-center rounded-xl bg-[#236948] text-sm font-bold tracking-tight text-white">
            P
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-stone-950">PAP</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-stone-500">
              Accounting platform
            </p>
          </div>
        </div>

        <div className="px-4 pt-7">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            Obszary
          </p>
          <nav aria-label="Główna nawigacja" className="mt-3 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${
                  item.active
                    ? 'bg-[#eaf1e6] text-[#1d5f40]'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${item.active ? 'bg-[#287451]' : 'bg-stone-300'}`}
                />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-[#e1e8da] bg-[#f2f5ed] p-4">
            <p className="text-xs font-semibold text-[#315940]">Środowisko lokalne</p>
            <p className="mt-1.5 text-[11px] leading-5 text-stone-600">
              Dane demonstracyjne i połączenia produkcyjne są wyłączone.
            </p>
          </div>
          <p className="px-2 pt-4 text-[10px] text-stone-400">Wersja 0.1.0</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex h-[76px] items-center justify-between border-b border-stone-200 bg-white/80 px-5 backdrop-blur sm:px-8 lg:px-10">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="grid size-8 place-items-center rounded-lg bg-[#236948] text-xs font-bold text-white">
              P
            </div>
            <span className="text-sm font-semibold">Polish Accounting Platform</span>
          </div>
          <div className="hidden text-xs text-stone-500 lg:block">
            Obszar roboczy <span className="px-1.5 text-stone-300">/</span>{' '}
            <span className="font-medium text-stone-700">Przegląd systemu</span>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#85a86d]" />
            <span className="text-[11px] font-medium text-stone-600">Etap fundamentu</span>
          </div>
        </header>

        <main className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#558168]">
                Panel roboczy
              </p>
              <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-stone-950 sm:text-[34px]">
                Przegląd systemu
              </h1>
              <p className="mt-2 max-w-[620px] text-sm leading-6 text-stone-600">
                Pierwszy działający przepływ łączy interfejs z API. Dane firm i funkcje księgowe nie
                są jeszcze dostępne.
              </p>
            </div>
            <StatusBadge
              label={isAvailable ? 'API odpowiada' : 'API niedostępne'}
              tone={isAvailable ? 'success' : 'neutral'}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
            <Card className="relative overflow-hidden border-[#dfe8dc] bg-[#f1f5ee] p-6 sm:p-7">
              <div className="absolute -right-10 -top-16 size-48 rounded-full border-[28px] border-white/45" />
              <div className="relative">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#50735b]">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[#4d956a]" />
                  Status platformy
                </div>
                <p className="mt-5 text-[22px] font-semibold tracking-[-0.03em] text-[#1c392a]">
                  {isAvailable ? 'Fundament działa' : 'Oczekiwanie na API'}
                </p>
                <p className="mt-2 max-w-[420px] text-[13px] leading-6 text-stone-600">
                  {isAvailable
                    ? `API zwróciło poprawny kontrakt systemu w wersji ${result.status.version}.`
                    : 'Interfejs nie otrzymał poprawnej odpowiedzi statusowej. Uruchom lokalne API i odśwież widok.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-[10px] font-medium text-stone-600">
                    REST · /api/v1/system/status
                  </span>
                  <span className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-[10px] font-medium text-stone-600">
                    Kontrakt walidowany przez Zod
                  </span>
                </div>
              </div>
            </Card>

            <Card eyebrow="Warstwa domenowa" title="Księgowość">
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-stone-600">Księgi i dokumenty</p>
                <StatusBadge label="Planowane" tone="neutral" />
              </div>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full w-[12%] rounded-full bg-[#b7c8a4]" />
              </div>
              <p className="mt-3 text-[11px] leading-5 text-stone-500">
                Najpierw zostaną wdrożone tożsamość i izolacja firm.
              </p>
            </Card>

            <Card eyebrow="Powierzchnia dostępu" title="MCP z autoryzacją">
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-stone-600">Zdalne narzędzia</p>
                <StatusBadge label="Planowane" tone="neutral" />
              </div>
              <div className="mt-5 flex items-center gap-2">
                <span className="rounded-lg bg-stone-100 px-2.5 py-1.5 font-mono text-[10px] text-stone-500">
                  OAuth · scopes · audit
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-stone-500">
                Lokalny shell udostępnia wyłącznie publiczny status systemu.
              </p>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <Card eyebrow="Dostępność modułów" title="Zakres pierwszego etapu">
              <div className="divide-y divide-stone-100">
                {(
                  [
                    ['Interfejs webowy', 'Połączony z API', true],
                    ['Kontrakt i status API', 'Dostępny', true],
                    ['Tożsamość i izolacja firm', 'Przed implementacją', false],
                    ['Księgowość i dokumenty', 'Nieaktywne', false],
                    ['Zdalny MCP i autoryzacja', 'Nieaktywne', false],
                  ] as const
                ).map(([name, state, ready]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-4 py-3.5 first:pt-1 last:pb-1"
                  >
                    <span className="text-[13px] font-medium text-stone-700">{name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-stone-500">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-stone-300'}`}
                      />
                      {state}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              className="bg-[#fcfbf7]"
              eyebrow="Następny kamień milowy"
              title="Tożsamość i firmy"
            >
              <div className="mt-1 rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold text-stone-800">
                    Tenant · członkostwo · firma
                  </span>
                  <span className="rounded-md bg-[#f1f3ec] px-2 py-1 text-[10px] font-semibold text-stone-500">
                    Issue #6
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-stone-500">
                  Serwerowa autoryzacja poprzedzi dostęp do dokumentów i ksiąg.
                </p>
              </div>
              <p className="mt-4 text-[11px] leading-5 text-stone-500">
                Status widoku pochodzi z API. Nie zawiera danych klientów, NIP ani informacji o
                środowisku produkcyjnym.
              </p>
            </Card>
          </div>

          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-stone-200 pt-5 text-[10px] text-stone-400 sm:flex-row">
            <span>Polish Accounting Platform · Jurysdykcja: Polska</span>
            <span>Wersja 0.1.0 · Dane syntetyczne</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
