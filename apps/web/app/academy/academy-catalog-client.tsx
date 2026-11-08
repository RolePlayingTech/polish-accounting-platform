'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type {
  AcademyModule,
  GlossaryCategory,
  GlossaryTerm,
  TaxProfileCode as AcademyTaxProfileCode,
} from '@pap/domain/academy';
import { Card, StatusBadge } from '@pap/ui';
import { Button } from '../../components/ui-controls';
import { ACADEMY_PROFILE_LABELS_PL, getCanonicalLessonHref } from '../../lib/field-help';

const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  podstawy: 'Podstawy księgowości',
  podatki_dochodowe: 'Podatki dochodowe (PIT / CIT / Ryczałt)',
  vat_i_ksef: 'VAT, JPK_V7 i e-faktury KSeF FA(3)',
  ewidencje_i_ksiegi: 'Ewidencje i księgi rachunkowe',
  zus_i_kadry: 'Składki ZUS i zdrowotna',
  rozrachunki_i_bank: 'Rozrachunki, Biała Lista i bank',
  automatyzacja_ai_mcp: 'Automatyzacja AI i protokół MCP',
};

export interface AcademyCatalogClientProps {
  modules: readonly AcademyModule[];
  glossaryTerms: readonly GlossaryTerm[];
}

export function AcademyCatalogClient({ glossaryTerms, modules }: AcademyCatalogClientProps) {
  const [selectedProfile, setSelectedProfile] = useState<'all' | AcademyTaxProfileCode>('all');
  const [glossaryQuery, setGlossaryQuery] = useState('');
  const [glossaryCategory, setGlossaryCategory] = useState<'all' | GlossaryCategory>('all');

  const filteredModules = useMemo(() => {
    if (selectedProfile === 'all') {
      return modules;
    }
    return modules
      .map((mod) => ({
        ...mod,
        lessons: mod.lessons.filter((lesson) =>
          lesson.audienceScope.applicableProfiles.includes(selectedProfile),
        ),
      }))
      .filter((mod) => mod.lessons.length > 0);
  }, [modules, selectedProfile]);

  const totalVisibleLessons = useMemo(
    () => filteredModules.reduce((acc, m) => acc + m.lessons.length, 0),
    [filteredModules],
  );

  const filteredGlossary = useMemo(() => {
    const q = glossaryQuery.trim().toLowerCase();
    return glossaryTerms.filter((term) => {
      if (glossaryCategory !== 'all' && term.category !== glossaryCategory) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        term.term.toLowerCase().includes(q) ||
        term.shortDefinition.toLowerCase().includes(q) ||
        term.detailedExplanation.toLowerCase().includes(q) ||
        term.exampleInPractice.toLowerCase().includes(q)
      );
    });
  }, [glossaryCategory, glossaryQuery, glossaryTerms]);

  const profileKeys = Object.keys(ACADEMY_PROFILE_LABELS_PL) as AcademyTaxProfileCode[];
  const categoryKeys = Object.keys(GLOSSARY_CATEGORY_LABELS) as GlossaryCategory[];

  return (
    <div className="space-y-8">
      <Card
        as="div"
        eyebrow="Filtruj ścieżkę nauki wg profilu podatkowego"
        title={`Program kursu: ${String(filteredModules.length)} modułów · ${String(totalVisibleLessons)} lekcji`}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedProfile === 'all' ? 'primary' : 'secondary'}
            onClick={() => setSelectedProfile('all')}
          >
            Wszystkie profile (37 lekcji)
          </Button>
          {profileKeys.map((code) => (
            <Button
              key={code}
              size="sm"
              variant={selectedProfile === code ? 'primary' : 'secondary'}
              onClick={() => setSelectedProfile(code)}
            >
              {ACADEMY_PROFILE_LABELS_PL[code]}
            </Button>
          ))}
        </div>
      </Card>

      <div className="space-y-5">
        {filteredModules.map((mod) => (
          <Card
            key={mod.slug}
            as="article"
            eyebrow={`Moduł ${String(mod.moduleNumber).padStart(2, '0')} · ${String(mod.lessons.length)} lekcje`}
            title={mod.title}
          >
            <p className="text-sm leading-relaxed text-[#464c48]">{mod.subtitle}</p>

            <ul className="mt-3 flex flex-wrap gap-1.5">
              {mod.learningObjectives.map((obj, idx) => (
                <li
                  key={idx}
                  className="rounded border border-[#e5e2d9] bg-[#faf9f5] px-2.5 py-1 text-xs text-[#464c48]"
                >
                  ✓ {obj}
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {mod.lessons.map((lesson) => (
                <Link
                  key={lesson.id}
                  href={`/academy/${mod.slug}/${lesson.slug}`}
                  className="group flex flex-col justify-between rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-4 transition-colors hover:border-[#1d5c42] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[#1d5c42]">
                        Lekcja {String(mod.moduleNumber)}.{String(lesson.lessonNumber)}
                      </span>
                      <StatusBadge
                        size="sm"
                        tone="neutral"
                        label={`~${String(lesson.estimatedMinutes)} min · quiz (${String(lesson.quiz.length)})`}
                      />
                    </div>
                    <h3 className="text-sm font-semibold text-[#191c1a] group-hover:text-[#1d5c42]">
                      {lesson.title}
                    </h3>
                    <p className="line-clamp-2 text-xs leading-relaxed text-[#464c48]">
                      {lesson.intro}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[#e5e2d9] pt-2 text-xs font-medium text-[#1d5c42]">
                    <span>Przykład w PLN + ćwiczenie w aplikacji</span>
                    <span aria-hidden="true">Otwórz →</span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card
        as="div"
        eyebrow="Przeszukiwalny glosariusz pojęć (ACADEMY_GLOSSARY_TERMS)"
        title={`Słownik pojęć polskiej księgowości i podatków (${String(filteredGlossary.length)})`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="glossary-search" className="block text-xs font-medium text-[#464c48]">
              Szukaj hasła (np. KUP, KSeF, JPK_V7M, MPP, Biała Lista, ryczałt, Wn/Ma)
            </label>
            <input
              id="glossary-search"
              type="search"
              value={glossaryQuery}
              onChange={(e) => setGlossaryQuery(e.target.value)}
              placeholder="Wpisz pojęcie księgowe lub skrót…"
              className="mt-1 min-h-10 w-full rounded-md border border-[#858177] bg-white px-3 py-2 text-sm text-[#191c1a]"
            />
          </div>

          <div>
            <label htmlFor="glossary-category" className="block text-xs font-medium text-[#464c48]">
              Kategoria słownika
            </label>
            <select
              id="glossary-category"
              value={glossaryCategory}
              onChange={(e) => setGlossaryCategory(e.target.value as 'all' | GlossaryCategory)}
              className="mt-1 min-h-10 w-full rounded-md border border-[#858177] bg-white px-3 py-2 text-sm text-[#191c1a]"
            >
              <option value="all">Wszystkie kategorie ({String(glossaryTerms.length)})</option>
              {categoryKeys.map((cat) => (
                <option key={cat} value={cat}>
                  {GLOSSARY_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {filteredGlossary.map((term) => (
            <div key={term.id} className="rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#191c1a]">{term.term}</h3>
                <StatusBadge
                  size="sm"
                  tone="legal"
                  label={GLOSSARY_CATEGORY_LABELS[term.category]}
                />
              </div>
              <p className="mt-1.5 text-xs font-medium text-[#191c1a]">{term.shortDefinition}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#464c48]">
                {term.detailedExplanation}
              </p>
              <p className="mt-2 rounded border border-[#e5e2d9] bg-white px-2.5 py-1.5 text-xs text-[#464c48]">
                <strong className="font-semibold text-[#191c1a]">Przykład w praktyce: </strong>
                {term.exampleInPractice}
              </p>
              {term.relatedLessonSlugs.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {term.relatedLessonSlugs.map((slug) => (
                    <Link
                      key={slug}
                      href={getCanonicalLessonHref(slug)}
                      className="inline-flex min-h-6 items-center text-xs font-semibold text-[#1d5c42] underline underline-offset-4 hover:text-[#164833]"
                    >
                      Powiązana lekcja: {slug} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
