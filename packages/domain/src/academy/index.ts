import {
  ACADEMY_FIELD_HELP_ENTRIES,
  ACADEMY_GLOSSARY_TERMS,
  getFieldHelpById,
  getGlossaryTermById,
  listGlossaryTermsByCategory,
} from './glossary.js';
import { MODULE_10 } from './module-10.js';
import { MODULE_11 } from './module-11.js';
import { MODULE_12 } from './module-12.js';
import { MODULES_01_TO_03 } from './modules-01-03.js';
import { MODULES_04_TO_06 } from './modules-04-06.js';
import { MODULES_07_TO_09 } from './modules-07-09.js';
import {
  ACADEMY_LEGAL_VERIFICATION_DATE,
  DEFAULT_QUIZ_PASSING_THRESHOLD_PERCENT,
  InvalidQuizSubmissionError,
  createScreenshotSlot,
  evaluateLessonQuiz,
  type AcademyCourse,
  type AcademyLesson,
  type AcademyModule,
  type AudienceScope,
  type CommonMistake,
  type DemoCompanyId,
  type FieldHelpEntry,
  type GlossaryCategory,
  type GlossaryTerm,
  type LegalBasisCitation,
  type LegalSourceKind,
  type LessonSection,
  type NumericalExample,
  type NumericalStep,
  type PracticalExercise,
  type QuizEvaluationResult,
  type QuizOptionIndex,
  type QuizQuestion,
  type QuizQuestionFeedback,
  type QuizSubmission,
  type ScreenshotSlot,
  type TaxProfileCode,
} from './quiz.js';

export const ACADEMY_DISCLAIMER =
  'Materiał ma charakter wyłącznie edukacyjny i szkoleniowy (stan prawny zweryfikowany na 2026-11-04 dla przepisów obowiązujących w latach 2025/2026). Nie stanowi doradztwa podatkowego, prawnego ani księgowego w rozumieniu ustawy o doradztwie podatkowym. Wszystkie nazwy firm, osoby, kwoty i numery dokumentów w przykładach są w 100% syntetyczne.' as const;

export const ACADEMY_MODULES: readonly AcademyModule[] = [
  ...MODULES_01_TO_03,
  ...MODULES_04_TO_06,
  ...MODULES_07_TO_09,
  MODULE_10,
  MODULE_11,
  MODULE_12,
];

export const ACADEMY_ALL_LESSONS: readonly AcademyLesson[] = ACADEMY_MODULES.flatMap(
  (academyModule) => academyModule.lessons,
);

export const ACADEMY_COURSE: AcademyCourse = {
  courseId: 'akademia-polskiej-ksiegowosci',
  title: 'Akademia Polskiej Księgowości — Kompletny Kurs i Samouczek Aplikacji',
  version: '1.0.0',
  legalStateAsOf: ACADEMY_LEGAL_VERIFICATION_DATE,
  disclaimer: ACADEMY_DISCLAIMER,
  modules: ACADEMY_MODULES,
};

const moduleByNumberMap = new Map<number, AcademyModule>(
  ACADEMY_MODULES.map((academyModule) => [academyModule.moduleNumber, academyModule]),
);

const moduleBySlugMap = new Map<string, AcademyModule>(
  ACADEMY_MODULES.map((academyModule) => [academyModule.slug, academyModule]),
);

const lessonByIdMap = new Map<string, AcademyLesson>(
  ACADEMY_ALL_LESSONS.map((lesson) => [lesson.id, lesson]),
);

const lessonBySlugMap = new Map<string, AcademyLesson>(
  ACADEMY_ALL_LESSONS.map((lesson) => [lesson.slug, lesson]),
);

export function getAcademyModuleByNumber(moduleNumber: number): AcademyModule | undefined {
  return moduleByNumberMap.get(moduleNumber);
}

export function getAcademyModuleBySlug(slug: string): AcademyModule | undefined {
  return moduleBySlugMap.get(slug);
}

export function getAcademyLessonById(id: string): AcademyLesson | undefined {
  return lessonByIdMap.get(id);
}

export function getAcademyLessonBySlug(slug: string): AcademyLesson | undefined {
  return lessonBySlugMap.get(slug);
}

export function listAcademyLessonsForProfile(profile: TaxProfileCode): readonly AcademyLesson[] {
  return ACADEMY_ALL_LESSONS.filter((lesson) =>
    lesson.audienceScope.applicableProfiles.includes(profile),
  );
}

export interface ResolvedFieldHelp {
  readonly fieldHelp: FieldHelpEntry;
  readonly relatedLesson: AcademyLesson | undefined;
  readonly lessonHref: string;
}

export function resolveFieldHelpWithLesson(fieldHelpId: string): ResolvedFieldHelp | undefined {
  const fieldHelp = getFieldHelpById(fieldHelpId);
  if (!fieldHelp) {
    return undefined;
  }

  const relatedLesson = getAcademyLessonBySlug(fieldHelp.relatedLessonSlug);
  return {
    fieldHelp,
    relatedLesson,
    lessonHref: `/academy/lekcja/${fieldHelp.relatedLessonSlug}`,
  };
}

export function evaluateQuizByLessonSlug(submission: QuizSubmission): QuizEvaluationResult {
  const lesson = getAcademyLessonBySlug(submission.lessonSlug);
  if (!lesson) {
    throw new InvalidQuizSubmissionError(
      `Nie znaleziono lekcji Akademii o identyfikatorze slug "${submission.lessonSlug}".`,
    );
  }

  return evaluateLessonQuiz(lesson, submission);
}

export {
  ACADEMY_FIELD_HELP_ENTRIES,
  ACADEMY_GLOSSARY_TERMS,
  ACADEMY_LEGAL_VERIFICATION_DATE,
  DEFAULT_QUIZ_PASSING_THRESHOLD_PERCENT,
  InvalidQuizSubmissionError,
  MODULE_10,
  MODULE_11,
  MODULE_12,
  MODULES_01_TO_03,
  MODULES_04_TO_06,
  MODULES_07_TO_09,
  createScreenshotSlot,
  evaluateLessonQuiz,
  getFieldHelpById,
  getGlossaryTermById,
  listGlossaryTermsByCategory,
  type AcademyCourse,
  type AcademyLesson,
  type AcademyModule,
  type AudienceScope,
  type CommonMistake,
  type DemoCompanyId,
  type FieldHelpEntry,
  type GlossaryCategory,
  type GlossaryTerm,
  type LegalBasisCitation,
  type LegalSourceKind,
  type LessonSection,
  type NumericalExample,
  type NumericalStep,
  type PracticalExercise,
  type QuizEvaluationResult,
  type QuizOptionIndex,
  type QuizQuestion,
  type QuizQuestionFeedback,
  type QuizSubmission,
  type ScreenshotSlot,
  type TaxProfileCode,
};
