'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import type { RyczaltRateCode, TaxProfileCode, VatRateCode } from '@pap/domain';
import { LegalBasisPanel, StatusBadge, ToneIcon } from '@pap/ui';
import {
  RYCZALT_RATE_GUIDANCE_ITEMS,
  VAT_RATE_GUIDANCE_ITEMS,
  buildTemporalTaxContextGuide,
} from '../lib/tax-contextual-help';

export interface VatRateGuideTriggerProps {
  readonly selectedRate: VatRateCode;
  readonly eventDate?: string | undefined;
  readonly profileCode?: TaxProfileCode | undefined;
}

/**
 * Kontekstowy przewodnik „Kiedy stosuje się tę stawkę?” przy polu Stawka VAT (#103).
 * Wyraźnie odróżnia 0% vs zw. vs np. i respektuje stan prawny na datę dokumentu (2025 vs 2026).
 */
export function VatRateGuideTrigger({
  eventDate,
  profileCode,
  selectedRate,
}: VatRateGuideTriggerProps) {
  const [open, setOpen] = useState(false);
  const [customInspectedRate, setCustomInspectedRate] = useState<VatRateCode | null>(null);
  const panelId = useId();
  const effectiveInspectedRate = customInspectedRate ?? selectedRate;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const guide = useMemo(
    () => buildTemporalTaxContextGuide(eventDate, profileCode),
    [eventDate, profileCode],
  );

  const activeItem =
    VAT_RATE_GUIDANCE_ITEMS.find((i) => i.rate === effectiveInspectedRate) ??
    VAT_RATE_GUIDANCE_ITEMS[0]!;

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="vat-rate-contextual-guide-trigger"
        onClick={() => {
          setCustomInspectedRate(null);
          setOpen((prev) => !prev);
        }}
        className="inline-flex min-h-6 items-center gap-1 rounded border border-[#dcd3b8] bg-[#f7f4ea] px-2 py-0.5 text-[11px] font-semibold text-[#5b4618] hover:bg-[#efe9d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
      >
        <span aria-hidden="true" className="font-serif font-bold">
          §
        </span>
        <span>{open ? 'Ukryj przewodnik stawek VAT' : 'Kiedy stosuje się tę stawkę?'}</span>
      </button>

      {open ? (
        <section
          id={panelId}
          aria-label="Kontekstowy przewodnik stawek podatku VAT"
          data-testid="vat-rate-contextual-guide-panel"
          className="space-y-3 rounded-xl border border-[#dcd3b8] bg-[#faf8f1] p-3.5 text-xs text-[#191c1a]"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#e5dec8] pb-2.5">
            <div>
              <p className="font-semibold text-[#191c1a]">
                Przewodnik stawek VAT (nie mylić ze stawką PIT / ryczałtu / CIT)
              </p>
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#5b4618]">
                Stan przepisów na datę dokumentu: {guide.referenceDate} · Limit zwolnienia art. 113
                VAT w {String(guide.effectiveYear)} r.:{' '}
                {guide.vatExemptionLimitPln.toLocaleString('pl-PL')} PLN
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-6 items-center rounded border border-[#858177] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#191c1a] hover:bg-[#f4f2ec]"
            >
              Zamknij (Esc)
            </button>
          </div>

          <div
            role="group"
            aria-label="Wybierz stawkę VAT do objaśnienia"
            className="flex flex-wrap gap-1.5"
          >
            {VAT_RATE_GUIDANCE_ITEMS.map((item) => {
              const active = item.rate === activeItem.rate;
              return (
                <button
                  key={item.rate}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCustomInspectedRate(item.rate)}
                  className={`min-h-7 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums ${
                    active
                      ? 'border-[#1d5c42] bg-[#1d5c42] text-white'
                      : 'border-[#858177] bg-white text-[#191c1a] hover:bg-[#f4f2ec]'
                  }`}
                >
                  {item.badgeLabel}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5 rounded-lg border border-[#e5dec8] bg-white p-3">
            <p className="font-semibold text-[#164833]">{activeItem.titlePl}</p>
            <p className="leading-relaxed text-[#191c1a]">{activeItem.whenAppliesPl}</p>
            <p className="leading-relaxed text-[#464c48]">
              <strong className="text-[#191c1a]">Przykłady i warunki ustawowe: </strong>
              {activeItem.examplesAndConditionsPl}
            </p>
            <p className="rounded bg-[#fdf4e3] px-2.5 py-1.5 text-[11px] text-[#7c4d00]">
              <strong>Skutek dla odliczenia VAT: </strong>
              {activeItem.rightToDeductNotePl}
            </p>
          </div>

          <div className="rounded-lg border border-[#e5dec8] bg-white p-3">
            <p className="font-semibold text-[#191c1a]">
              Szybkie rozróżnienie: <code className="font-mono">0%</code> vs{' '}
              <code className="font-mono">zw.</code> vs <code className="font-mono">np.</code>
            </p>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-[#464c48]">
              <li>
                • <strong className="font-mono text-[#191c1a]">0%</strong> — czynność{' '}
                <strong>opodatkowana</strong> (np. WDT, eksport z kompletem dokumentów wywozowych);
                zachowujesz prawo do odliczenia VAT od zakupów.
              </li>
              <li>
                • <strong className="font-mono text-[#191c1a]">zw.</strong> — czynność{' '}
                <strong>zwolniona z VAT</strong> (limit podmiotowy art. 113 albo przedmiotowo art.
                43 ust. 1); co do zasady nie daje prawa do odliczenia VAT od powiązanych zakupów.
              </li>
              <li>
                • <strong className="font-mono text-[#191c1a]">np.</strong> — czynność{' '}
                <strong>poza zakresem polskiego VAT</strong> (np. usługa B2B z miejscem świadczenia
                w kraju nabywcy wg art. 28b VAT — odwrotne obciążenie).
              </li>
            </ul>
          </div>

          <LegalBasisPanel
            basis={activeItem.rate === 'zw' ? guide.vatExemptionBasis : guide.vatRatesBasis}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5dec8] pt-2 text-[11px] text-[#464c48]">
            <span>{guide.disclaimerPl}</span>
            <div className="flex flex-wrap items-center gap-3 font-semibold text-[#164833]">
              <Link href={guide.vatLessonHref} className="underline underline-offset-2">
                Lekcja w Akademii →
              </Link>
              <Link href={guide.rulesCatalogHref} className="underline underline-offset-2">
                Katalog reguł /app/rules →
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export interface RyczaltRateGuideTriggerProps {
  readonly selectedRate: RyczaltRateCode;
  readonly eventDate?: string | undefined;
}

/**
 * Osobny przewodnik „Stawka ryczałtu a rodzaj usługi / PKWiU” wyłącznie dla ryczałtu (#103).
 */
export function RyczaltRateGuideTrigger({ eventDate, selectedRate }: RyczaltRateGuideTriggerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const guide = useMemo(() => buildTemporalTaxContextGuide(eventDate, 'jdg_ryczalt'), [eventDate]);

  const selectedMeta = RYCZALT_RATE_GUIDANCE_ITEMS.find((r) => r.rate === selectedRate);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="ryczalt-pkwiu-guide-trigger"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex min-h-6 items-center gap-1 rounded border border-[#dcd3b8] bg-[#f7f4ea] px-2 py-0.5 text-[11px] font-semibold text-[#5b4618] hover:bg-[#efe9d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
      >
        <span aria-hidden="true" className="font-serif font-bold">
          §
        </span>
        <span>
          {open ? 'Ukryj przewodnik stawek ryczałtu' : 'Stawka ryczałtu a rodzaj usługi / PKWiU'}
        </span>
      </button>

      {open ? (
        <section
          id={panelId}
          aria-label="Przewodnik stawek ryczałtu wg PKWiU"
          data-testid="ryczalt-pkwiu-guide-panel"
          className="space-y-3 rounded-xl border border-[#dcd3b8] bg-[#faf8f1] p-3.5 text-xs text-[#191c1a]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5dec8] pb-2">
            <div>
              <p className="font-semibold text-[#191c1a]">
                Stawka ryczałtu od przychodów (podatek dochodowy PPE — NIE stawka VAT)
              </p>
              <p className="text-[11px] text-[#464c48]">
                Stawka zależy od rzeczywistego rodzaju wykonanej usługi lub sprzedanego towaru wg
                PKWiU i definicji w art. 12 ust. 1 ustawy o ryczałcie, a nie od głównego kodu PKD
                firmy.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-6 items-center rounded border border-[#858177] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#191c1a]"
            >
              Zamknij
            </button>
          </div>

          {selectedMeta ? (
            <div className="rounded-lg border border-[#1d5c42] bg-[#e7f1ec]/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[#164833]">
                  Wybrana stawka: {selectedMeta.titlePl}
                </p>
                <StatusBadge size="sm" tone="legal" label={selectedMeta.legalRefPl} />
              </div>
              <p className="mt-1 leading-relaxed text-[#191c1a]">{selectedMeta.typicalScopePl}</p>
              <p className="mt-1 text-[11px] text-[#7c4d00]">
                <strong>Wyjątki i ostrożność: </strong>
                {selectedMeta.cautionPl}
              </p>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            {RYCZALT_RATE_GUIDANCE_ITEMS.map((item) => (
              <div
                key={item.rate}
                className="rounded-lg border border-[#e5dec8] bg-white p-2.5 text-[11px]"
              >
                <p className="font-semibold text-[#191c1a]">{item.titlePl}</p>
                <p className="font-mono text-[10px] text-[#5b4618]">{item.legalRefPl}</p>
                <p className="mt-1 leading-relaxed text-[#464c48]">{item.typicalScopePl}</p>
              </div>
            ))}
          </div>

          <LegalBasisPanel basis={guide.ryczaltBasis} />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5dec8] pt-2 text-[11px] text-[#464c48]">
            <span>{guide.dueVsPaidSummaryPl}</span>
            <div className="flex items-center gap-3 font-semibold text-[#164833]">
              <Link href={guide.ryczaltLessonHref} className="underline underline-offset-2">
                Lekcja o ryczałcie i PKWiU →
              </Link>
              <Link href={guide.rulesCatalogHref} className="underline underline-offset-2">
                Katalog reguł /app/rules →
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export interface PurchaseQualificationHelpNoticeProps {
  readonly profileCode: TaxProfileCode;
  readonly vatStatus: 'czynny' | 'zwolniony_art_113' | 'zwolniony_przedmiotowo';
  readonly eventDate?: string | undefined;
}

/**
 * Zwięzła weryfikacja dwóch odrębnych pytań przy zakupach (#103):
 * 1) Czy to koszt podatkowy (KUP / NKUP)?
 * 2) Czy VAT naliczony podlega odliczeniu?
 */
export function PurchaseQualificationHelpNotice({
  eventDate,
  profileCode,
  vatStatus,
}: PurchaseQualificationHelpNoticeProps) {
  const [showBasis, setShowBasis] = useState(false);
  const guide = useMemo(
    () => buildTemporalTaxContextGuide(eventDate, profileCode),
    [eventDate, profileCode],
  );

  return (
    <div
      data-testid="purchase-dual-tax-decision-help"
      className="space-y-2 rounded-lg border border-[#dcd3b8] bg-[#faf8f1] p-3 text-xs text-[#191c1a]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <ToneIcon tone="legal" className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-[#191c1a]">
              Dwie niezależne decyzje podatkowe przy zakupie (wymagają potwierdzenia człowieka):
            </p>
            <ul className="space-y-1 text-[11px] leading-relaxed text-[#464c48]">
              <li>
                <strong>1. Podatek dochodowy (Czy to KUP i w jakiej części?):</strong>{' '}
                {profileCode === 'jdg_ryczalt'
                  ? 'Aktywna firma rozlicza ryczałt — wydatki zakupowe nie pomniejszają przychodu do opodatkowania ryczałtem (przechowuj dowody zakupów na potrzeby VAT lub ewidencji majątku).'
                  : 'Oceń związek wydatku z przychodem (100% KUP towary lub pozostałe wydatki, 75% KUP eksploatacja samochodu osobowego mieszanego wg art. 23 ust. 1 pkt 46a PIT / art. 16 ust. 1 pkt 51 CIT, albo 0% NKUP np. reprezentacja).'}
              </li>
              <li>
                <strong>2. Podatek VAT (Czy VAT z faktury podlega odliczeniu?):</strong>{' '}
                {vatStatus !== 'czynny'
                  ? 'Aktywna firma korzysta ze zwolnienia z VAT — podatek VAT z faktury zakupu nie podlega odliczeniu w JPK_V7 (dla KPiR/CIT zwiększa wartość kosztu brutto, o ile wydatek stanowi KUP).'
                  : 'Sama stawka 23% lub 8% na fakturze zakupu NIE daje automatycznie prawa do odliczenia. Sprawdź związek z czynnościami opodatkowanymi (art. 86 ust. 1), limit 50% dla aut osobowych (art. 86a) oraz wyłączenia z art. 88 (np. usługi noclegowe i gastronomiczne = 0% odliczenia).'}
              </li>
            </ul>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowBasis((prev) => !prev)}
          className="inline-flex min-h-6 shrink-0 items-center rounded border border-[#858177] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#5b4618] hover:bg-[#f4f2ec]"
        >
          {showBasis ? 'Ukryj podstawę prawną' : '§ Podstawa prawna KUP / VAT'}
        </button>
      </div>

      {showBasis ? (
        <div className="grid gap-3 pt-2 lg:grid-cols-2">
          <LegalBasisPanel basis={guide.purchaseKupBasis} />
          <LegalBasisPanel basis={guide.purchaseVatDeductionBasis} />
        </div>
      ) : null}
    </div>
  );
}
