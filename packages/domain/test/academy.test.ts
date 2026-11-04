import { describe, expect, it } from 'vitest';
import {
  ACADEMY_ALL_LESSONS,
  ACADEMY_COURSE,
  ACADEMY_FIELD_HELP_ENTRIES,
  ACADEMY_GLOSSARY_TERMS,
  ACADEMY_LEGAL_VERIFICATION_DATE,
  ACADEMY_MODULES,
  InvalidQuizSubmissionError,
  evaluateLessonQuiz,
  evaluateQuizByLessonSlug,
  getAcademyLessonById,
  getAcademyLessonBySlug,
  getAcademyModuleByNumber,
  getAcademyModuleBySlug,
  getFieldHelpById,
  getGlossaryTermById,
  listAcademyLessonsForProfile,
  listGlossaryTermsByCategory,
  resolveFieldHelpWithLesson,
  type GlossaryCategory,
  type QuizOptionIndex,
} from '../src/academy/index.js';

const PLN_AMOUNT_REGEX = /^-?\d{1,3}(?: \d{3})*,\d{2} PLN$/;
const OFFICIAL_POLISH_AUTHORITY_REGEX =
  /^https:\/\/([a-z0-9-]+\.)?(sejm\.gov\.pl|dziennikustaw\.gov\.pl|podatki\.gov\.pl|zus\.pl|gov\.pl|biznes\.gov\.pl|nbp\.pl|stat\.gov\.pl|uodo\.gov\.pl|ms\.gov\.pl)(\/|$)/;

describe('Akademia Polskiej Księgowości — kompletność kursu i integralność domenowa', () => {
  it('zawiera dokładnie 12 kolejnych modułów i 37 kompletnych lekcji z zastrzeżeniem edukacyjnym', () => {
    expect(ACADEMY_COURSE.courseId).toBe('akademia-polskiej-ksiegowosci');
    expect(ACADEMY_COURSE.legalStateAsOf).toBe(ACADEMY_LEGAL_VERIFICATION_DATE);
    expect(ACADEMY_COURSE.disclaimer).toContain('Nie stanowi doradztwa podatkowego');
    expect(ACADEMY_COURSE.disclaimer).toContain('syntetyczne');
    expect(ACADEMY_MODULES).toHaveLength(12);

    const moduleNumbers = ACADEMY_MODULES.map((m) => m.moduleNumber);
    expect(moduleNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    for (const mod of ACADEMY_MODULES) {
      expect(mod.learningObjectives.length).toBeGreaterThanOrEqual(3);
      if (mod.moduleNumber === 12) {
        expect(mod.lessons).toHaveLength(4);
      } else {
        expect(mod.lessons.length).toBeGreaterThanOrEqual(3);
      }
    }

    expect(ACADEMY_ALL_LESSONS).toHaveLength(37);
  });

  it('gwarantuje unikalność id, slug, slotów zrzutów ekranu oraz id pytań w całym kursie', () => {
    const moduleSlugs = new Set<string>();
    const lessonIds = new Set<string>();
    const lessonSlugs = new Set<string>();
    const screenshotSlots = new Set<string>();
    const quizQuestionIds = new Set<string>();

    for (const mod of ACADEMY_MODULES) {
      expect(moduleSlugs.has(mod.slug)).toBe(false);
      moduleSlugs.add(mod.slug);

      mod.lessons.forEach((lesson, idx) => {
        expect(lesson.moduleNumber).toBe(mod.moduleNumber);
        expect(lesson.lessonNumber).toBe(idx + 1);
        expect(lesson.id).toBe(
          `lesson-${String(mod.moduleNumber).padStart(2, '0')}-${String(idx + 1).padStart(2, '0')}`,
        );

        expect(lessonIds.has(lesson.id)).toBe(false);
        lessonIds.add(lesson.id);

        expect(lessonSlugs.has(lesson.slug)).toBe(false);
        lessonSlugs.add(lesson.slug);

        expect(screenshotSlots.has(lesson.screenshotSlot.slotId)).toBe(false);
        screenshotSlots.add(lesson.screenshotSlot.slotId);
        expect(lesson.screenshotSlot.imagePath).toBe(
          `/academy/screenshots/${lesson.screenshotSlot.slotId}.png`,
        );
        expect(lesson.screenshotSlot.appRoute).toMatch(/^\/[a-z0-9/_-]*$/);
        expect(lesson.screenshotSlot.captureSelector.length).toBeGreaterThanOrEqual(3);

        for (const question of lesson.quiz) {
          expect(quizQuestionIds.has(question.id)).toBe(false);
          quizQuestionIds.add(question.id);
        }
      });
    }
  });

  it('weryfikuje przykłady liczbowe w PLN, oficjalne źródła prawa RP oraz integralność quizów w każdej lekcji', () => {
    for (const lesson of ACADEMY_ALL_LESSONS) {
      expect(lesson.intro.length).toBeGreaterThanOrEqual(80);
      expect(lesson.sections.length).toBeGreaterThanOrEqual(2);
      expect(lesson.numericalExample.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.numericalExample.finalResultPln).toMatch(PLN_AMOUNT_REGEX);

      lesson.numericalExample.steps.forEach((step, idx) => {
        expect(step.stepNumber).toBe(idx + 1);
        expect(step.amountPln).toMatch(PLN_AMOUNT_REGEX);
      });

      expect(lesson.legalBasis.length).toBeGreaterThanOrEqual(1);
      for (const citation of lesson.legalBasis) {
        expect(citation.officialUrl).toMatch(OFFICIAL_POLISH_AUTHORITY_REGEX);
        expect(citation.verifiedAt).toBe(ACADEMY_LEGAL_VERIFICATION_DATE);
        expect(citation.appliesSummary.length).toBeGreaterThanOrEqual(20);
      }

      expect(lesson.practicalExercise.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.practicalExercise.demoCompanyName.toLowerCase()).toContain('syntetyczn');
      expect(lesson.commonMistakes.length).toBeGreaterThanOrEqual(3);
      expect(lesson.summary.length).toBeGreaterThanOrEqual(3);

      expect(lesson.quiz.length).toBeGreaterThanOrEqual(2);
      for (const q of lesson.quiz) {
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect([0, 1, 2, 3]).toContain(q.correctOptionIndex);
        expect(q.options[q.correctOptionIndex]?.trim().length).toBeGreaterThan(0);
        expect(q.explanation.trim().length).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('udostępnia działające helpery wyszukiwania modułów, lekcji i filtrowania po profilu podatkowym', () => {
    const module10 = getAcademyModuleByNumber(10);
    expect(module10?.slug).toBe('rozrachunki-zatory-platnicze-bank-i-plynnosc');
    expect(getAcademyModuleBySlug('automatyzacja-ai-ocr-i-bezpieczny-mcp')?.moduleNumber).toBe(11);
    expect(getAcademyModuleByNumber(99)).toBeUndefined();

    const badDebtLesson = getAcademyLessonBySlug('ulga-na-zle-dlugi-90-dni-vat-pit-cit');
    expect(badDebtLesson?.id).toBe('lesson-10-02');
    expect(getAcademyLessonById('lesson-12-04')?.moduleNumber).toBe(12);
    expect(getAcademyLessonBySlug('nieistniejaca-lekcja')).toBeUndefined();

    const ryczaltLessons = listAcademyLessonsForProfile('jdg_ryczalt');
    expect(ryczaltLessons.length).toBeGreaterThan(10);
    expect(ryczaltLessons.some((l) => l.moduleNumber === 6)).toBe(true);
  });

  it('obsługuje mapowanie fieldHelpId oraz słownik pojęć ze spójnymi referencjami do lekcji', () => {
    const requiredFieldHelpIds = [
      'nip',
      'ksef_reference',
      'gtu_code',
      'kpir_col_7',
      'kpir_col_13',
      'vehicle_75_kup',
      'vat_50_vehicle',
      'ryczalt_rate',
      'wn_ma_balance',
      'split_payment_mpp',
      'jpk_v7m',
    ];

    for (const id of requiredFieldHelpIds) {
      const resolved = resolveFieldHelpWithLesson(id);
      expect(resolved, `Brak wpisu fieldHelpId: ${id}`).toBeDefined();
      expect(resolved?.relatedLesson, `Brak lekcji dla fieldHelpId: ${id}`).toBeDefined();
      expect(resolved?.lessonHref).toBe(`/academy/lekcja/${resolved?.fieldHelp.relatedLessonSlug}`);
      expect(resolved?.fieldHelp.legalBasis.officialUrl).toMatch(OFFICIAL_POLISH_AUTHORITY_REGEX);
    }

    expect(getFieldHelpById('unknown_field_id')).toBeUndefined();
    expect(resolveFieldHelpWithLesson('unknown_field_id')).toBeUndefined();

    const categories: readonly GlossaryCategory[] = [
      'podstawy',
      'podatki_dochodowe',
      'vat_i_ksef',
      'ewidencje_i_ksiegi',
      'zus_i_kadry',
      'rozrachunki_i_bank',
      'automatyzacja_ai_mcp',
    ];
    for (const category of categories) {
      expect(listGlossaryTermsByCategory(category).length).toBeGreaterThanOrEqual(1);
    }

    const glossaryIds = new Set<string>();
    for (const term of ACADEMY_GLOSSARY_TERMS) {
      expect(glossaryIds.has(term.id)).toBe(false);
      glossaryIds.add(term.id);
      expect(getGlossaryTermById(term.id)?.term).toBe(term.term);

      for (const slug of term.relatedLessonSlugs) {
        expect(
          getAcademyLessonBySlug(slug),
          `Słownik (${term.id}) wskazuje nieistniejący slug lekcji: ${slug}`,
        ).toBeDefined();
      }
    }

    expect(ACADEMY_FIELD_HELP_ENTRIES.length).toBeGreaterThanOrEqual(requiredFieldHelpIds.length);
  });

  it('ocenia quizy pozytywnie i odrzuca niepoprawne zgłoszenia (scenariusze negatywne)', () => {
    const lesson = getAcademyLessonById('lesson-10-02');
    expect(lesson).toBeDefined();
    if (!lesson) {
      return;
    }

    const perfectAnswers: Record<string, QuizOptionIndex> = {};
    for (const q of lesson.quiz) {
      perfectAnswers[q.id] = q.correctOptionIndex;
    }

    const passedResult = evaluateQuizByLessonSlug({
      lessonSlug: lesson.slug,
      answers: perfectAnswers,
    });
    expect(passedResult.passed).toBe(true);
    expect(passedResult.scorePercent).toBe(100);
    expect(passedResult.missingQuestionIds).toHaveLength(0);

    // Brak odpowiedzi na drugie pytanie -> quiz niezony mimo częściowej poprawności
    const firstQuestion = lesson.quiz[0];
    expect(firstQuestion).toBeDefined();
    if (!firstQuestion) {
      return;
    }

    const incompleteResult = evaluateLessonQuiz(lesson, {
      lessonSlug: lesson.slug,
      answers: { [firstQuestion.id]: firstQuestion.correctOptionIndex },
      passingThresholdPercent: 50,
    });
    expect(incompleteResult.passed).toBe(false);
    expect(incompleteResult.missingQuestionIds.length).toBeGreaterThan(0);

    // Scenariusze negatywne walidacji wejścia
    expect(() =>
      evaluateLessonQuiz(lesson, {
        lessonSlug: 'inny-slug-lekcji',
        answers: perfectAnswers,
      }),
    ).toThrow(InvalidQuizSubmissionError);

    expect(() =>
      evaluateLessonQuiz(lesson, {
        lessonSlug: lesson.slug,
        answers: { 'q-99-99-99': 0 },
      }),
    ).toThrow(InvalidQuizSubmissionError);

    expect(() =>
      evaluateLessonQuiz(lesson, {
        lessonSlug: lesson.slug,
        answers: { [firstQuestion.id]: 4 as unknown as QuizOptionIndex },
      }),
    ).toThrow(InvalidQuizSubmissionError);

    expect(() =>
      evaluateLessonQuiz(lesson, {
        lessonSlug: lesson.slug,
        answers: perfectAnswers,
        passingThresholdPercent: 0,
      }),
    ).toThrow(InvalidQuizSubmissionError);

    expect(() =>
      evaluateQuizByLessonSlug({
        lessonSlug: 'brak-takiej-lekcji',
        answers: {},
      }),
    ).toThrow(InvalidQuizSubmissionError);
  });
});
