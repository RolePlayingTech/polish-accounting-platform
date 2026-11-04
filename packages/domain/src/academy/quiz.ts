export const ACADEMY_LEGAL_VERIFICATION_DATE = '2026-11-04' as const;
export const DEFAULT_QUIZ_PASSING_THRESHOLD_PERCENT = 67 as const;

export type TaxProfileCode =
  | 'jdg_kpir_skala'
  | 'jdg_kpir_liniowy'
  | 'jdg_ryczalt'
  | 'spolka_cywilna_kpir'
  | 'sp_zoo_pelne_ksiegi_cit_klasyczny'
  | 'sp_zoo_pelne_ksiegi_cit_estonski'
  | 'vat_czynny'
  | 'vat_zwolniony_art113';

export type AudienceScope =
  | {
      readonly type: 'general_education';
      readonly applicableProfiles: readonly TaxProfileCode[];
      readonly scopeNote: string;
    }
  | {
      readonly type: 'profile_specific';
      readonly applicableProfiles: readonly [TaxProfileCode, ...TaxProfileCode[]];
      readonly scopeNote: string;
    };

export type LegalSourceKind = 'statute' | 'official_guidance';

export interface LegalBasisCitation {
  readonly actTitle: string;
  readonly articleRef: string;
  readonly sourceKind: LegalSourceKind;
  readonly officialUrl: string;
  readonly verifiedAt: typeof ACADEMY_LEGAL_VERIFICATION_DATE;
  readonly appliesSummary: string;
}

export interface LessonSection {
  readonly heading: string;
  readonly body: string;
  readonly keyPoints: readonly string[];
}

export interface NumericalStep {
  readonly stepNumber: number;
  readonly label: string;
  readonly calculation: string;
  readonly amountPln: string;
}

export interface NumericalExample {
  readonly title: string;
  readonly scenario: string;
  readonly steps: readonly NumericalStep[];
  readonly finalResultPln: string;
  readonly interpretation: string;
}

export interface ScreenshotSlot {
  readonly slotId: string;
  readonly appRoute: string;
  readonly caption: string;
  readonly captureSelector: string;
  readonly imagePath: `/academy/screenshots/${string}.png`;
}

export type DemoCompanyId = 'demo_jdg_kpir_alfa' | 'demo_jdg_ryczalt_beta' | 'demo_spzoo_gamma';

export interface PracticalExercise {
  readonly title: string;
  readonly demoCompanyId: DemoCompanyId;
  readonly demoCompanyName: string;
  readonly steps: readonly string[];
  readonly expectedOutcome: string;
}

export interface CommonMistake {
  readonly mistake: string;
  readonly consequence: string;
  readonly howToAvoid: string;
}

export type QuizOptionIndex = 0 | 1 | 2 | 3;

export interface QuizQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: readonly [string, string, string, string];
  readonly correctOptionIndex: QuizOptionIndex;
  readonly explanation: string;
}

export interface AcademyLesson {
  readonly id: string;
  readonly slug: string;
  readonly moduleNumber: number;
  readonly lessonNumber: number;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly audienceScope: AudienceScope;
  readonly intro: string;
  readonly sections: readonly LessonSection[];
  readonly numericalExample: NumericalExample;
  readonly legalBasis: readonly LegalBasisCitation[];
  readonly screenshotSlot: ScreenshotSlot;
  readonly practicalExercise: PracticalExercise;
  readonly commonMistakes: readonly CommonMistake[];
  readonly summary: readonly string[];
  readonly quiz: readonly QuizQuestion[];
}

export interface AcademyModule {
  readonly moduleNumber: number;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
  readonly learningObjectives: readonly string[];
  readonly lessons: readonly AcademyLesson[];
}

export interface AcademyCourse {
  readonly courseId: 'akademia-polskiej-ksiegowosci';
  readonly title: string;
  readonly version: string;
  readonly legalStateAsOf: typeof ACADEMY_LEGAL_VERIFICATION_DATE;
  readonly disclaimer: string;
  readonly modules: readonly AcademyModule[];
}

export type GlossaryCategory =
  | 'podstawy'
  | 'podatki_dochodowe'
  | 'vat_i_ksef'
  | 'ewidencje_i_ksiegi'
  | 'zus_i_kadry'
  | 'rozrachunki_i_bank'
  | 'automatyzacja_ai_mcp';

export interface GlossaryTerm {
  readonly id: string;
  readonly term: string;
  readonly shortDefinition: string;
  readonly detailedExplanation: string;
  readonly exampleInPractice: string;
  readonly category: GlossaryCategory;
  readonly relatedLessonSlugs: readonly string[];
}

export interface FieldHelpEntry {
  readonly fieldHelpId: string;
  readonly label: string;
  readonly shortHint: string;
  readonly detailedExplanation: string;
  readonly exampleValue: string;
  readonly warningNote: string;
  readonly audienceScope: AudienceScope;
  readonly legalBasis: LegalBasisCitation;
  readonly relatedLessonSlug: string;
}

export interface QuizSubmission {
  readonly lessonSlug: string;
  readonly answers: Readonly<Record<string, QuizOptionIndex>>;
  readonly passingThresholdPercent?: number | undefined;
}

export interface QuizQuestionFeedback {
  readonly questionId: string;
  readonly selectedOptionIndex: QuizOptionIndex | null;
  readonly correctOptionIndex: QuizOptionIndex;
  readonly isCorrect: boolean;
  readonly explanation: string;
}

export interface QuizEvaluationResult {
  readonly lessonId: string;
  readonly lessonSlug: string;
  readonly totalQuestions: number;
  readonly answeredQuestions: number;
  readonly correctAnswers: number;
  readonly scorePercent: number;
  readonly passingThresholdPercent: number;
  readonly passed: boolean;
  readonly missingQuestionIds: readonly string[];
  readonly questionResults: readonly QuizQuestionFeedback[];
}

export class InvalidQuizSubmissionError extends Error {
  public readonly code = 'INVALID_QUIZ_SUBMISSION' as const;

  public constructor(message: string) {
    super(message);
    this.name = 'InvalidQuizSubmissionError';
  }
}

function isValidQuizOptionIndex(value: unknown): value is QuizOptionIndex {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function createScreenshotSlot(
  slotId: string,
  appRoute: string,
  caption: string,
  captureSelector: string,
): ScreenshotSlot {
  return {
    slotId,
    appRoute,
    caption,
    captureSelector,
    imagePath: `/academy/screenshots/${slotId}.png`,
  };
}

export function evaluateLessonQuiz(
  lesson: Pick<AcademyLesson, 'id' | 'slug' | 'quiz'>,
  submission: QuizSubmission,
): QuizEvaluationResult {
  if (submission.lessonSlug !== lesson.slug) {
    throw new InvalidQuizSubmissionError(
      `Zgłoszenie quizu dotyczy lekcji "${submission.lessonSlug}", a oceniana jest lekcja "${lesson.slug}".`,
    );
  }

  if (lesson.quiz.length === 0) {
    throw new InvalidQuizSubmissionError(
      `Lekcja "${lesson.slug}" nie posiada pytań kontrolnych do oceny.`,
    );
  }

  const passingThresholdPercent =
    submission.passingThresholdPercent ?? DEFAULT_QUIZ_PASSING_THRESHOLD_PERCENT;

  if (
    !Number.isInteger(passingThresholdPercent) ||
    passingThresholdPercent < 1 ||
    passingThresholdPercent > 100
  ) {
    throw new InvalidQuizSubmissionError(
      `Próg zaliczenia quizu musi być liczbą całkowitą z zakresu 1–100 (otrzymano: ${String(passingThresholdPercent)}).`,
    );
  }

  const knownQuestionIds = new Set(lesson.quiz.map((question) => question.id));

  for (const [submittedQuestionId, selectedIndex] of Object.entries(submission.answers)) {
    if (!knownQuestionIds.has(submittedQuestionId)) {
      throw new InvalidQuizSubmissionError(
        `Odpowiedź odwołuje się do nieznanego pytania "${submittedQuestionId}" w lekcji "${lesson.slug}".`,
      );
    }
    if (!isValidQuizOptionIndex(selectedIndex)) {
      throw new InvalidQuizSubmissionError(
        `Odpowiedź na pytanie "${submittedQuestionId}" musi być indeksem 0, 1, 2 lub 3.`,
      );
    }
  }

  let answeredQuestions = 0;
  let correctAnswers = 0;
  const missingQuestionIds: string[] = [];
  const questionResults: QuizQuestionFeedback[] = [];

  for (const question of lesson.quiz) {
    const rawSelected = Object.prototype.hasOwnProperty.call(submission.answers, question.id)
      ? submission.answers[question.id]
      : undefined;

    if (rawSelected === undefined) {
      missingQuestionIds.push(question.id);
      questionResults.push({
        questionId: question.id,
        selectedOptionIndex: null,
        correctOptionIndex: question.correctOptionIndex,
        isCorrect: false,
        explanation: question.explanation,
      });
      continue;
    }

    answeredQuestions += 1;
    const isCorrect = rawSelected === question.correctOptionIndex;
    if (isCorrect) {
      correctAnswers += 1;
    }

    questionResults.push({
      questionId: question.id,
      selectedOptionIndex: rawSelected,
      correctOptionIndex: question.correctOptionIndex,
      isCorrect,
      explanation: question.explanation,
    });
  }

  const totalQuestions = lesson.quiz.length;
  const scorePercent = Math.round((correctAnswers / totalQuestions) * 100);
  const passed = missingQuestionIds.length === 0 && scorePercent >= passingThresholdPercent;

  return {
    lessonId: lesson.id,
    lessonSlug: lesson.slug,
    totalQuestions,
    answeredQuestions,
    correctAnswers,
    scorePercent,
    passingThresholdPercent,
    passed,
    missingQuestionIds,
    questionResults,
  };
}
