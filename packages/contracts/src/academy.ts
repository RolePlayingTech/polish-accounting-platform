import { z } from 'zod';

export const ACADEMY_LEGAL_VERIFICATION_DATE = '2026-11-04' as const;

const OFFICIAL_POLISH_AUTHORITY_HOST_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?(sejm\.gov\.pl|dziennikustaw\.gov\.pl|podatki\.gov\.pl|zus\.pl|gov\.pl|biznes\.gov\.pl|nbp\.pl|stat\.gov\.pl|uodo\.gov\.pl|ms\.gov\.pl)(\/|$)/;

const KEBAB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLN_FORMATTED_AMOUNT_PATTERN = /^-?\d{1,3}(?: \d{3})*,\d{2} PLN$/;

export const TaxProfileCodeSchema = z.enum([
  'jdg_kpir_skala',
  'jdg_kpir_liniowy',
  'jdg_ryczalt',
  'spolka_cywilna_kpir',
  'sp_zoo_pelne_ksiegi_cit_klasyczny',
  'sp_zoo_pelne_ksiegi_cit_estonski',
  'vat_czynny',
  'vat_zwolniony_art113',
]);

export type TaxProfileCode = z.infer<typeof TaxProfileCodeSchema>;

export const AudienceScopeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('general_education'),
      applicableProfiles: z.array(TaxProfileCodeSchema).readonly(),
      scopeNote: z.string().min(15),
    })
    .strict(),
  z
    .object({
      type: z.literal('profile_specific'),
      applicableProfiles: z.array(TaxProfileCodeSchema).min(1).readonly(),
      scopeNote: z.string().min(15),
    })
    .strict(),
]);

export type AudienceScope = z.infer<typeof AudienceScopeSchema>;

export const LegalSourceKindSchema = z.enum(['statute', 'official_guidance']);

export type LegalSourceKind = z.infer<typeof LegalSourceKindSchema>;

export const LegalBasisCitationSchema = z
  .object({
    actTitle: z.string().min(10),
    articleRef: z.string().min(3),
    sourceKind: LegalSourceKindSchema,
    officialUrl: z
      .string()
      .url()
      .refine(
        (url) => OFFICIAL_POLISH_AUTHORITY_HOST_PATTERN.test(url),
        'Źródło prawne musi wskazywać oficjalny serwis urzędowy RP (np. isap.sejm.gov.pl, dziennikustaw.gov.pl, podatki.gov.pl, zus.pl, biznes.gov.pl, gov.pl).',
      ),
    verifiedAt: z.literal(ACADEMY_LEGAL_VERIFICATION_DATE),
    appliesSummary: z.string().min(20),
  })
  .strict();

export type LegalBasisCitation = z.infer<typeof LegalBasisCitationSchema>;

export const LessonSectionSchema = z
  .object({
    heading: z.string().min(5),
    body: z.string().min(100),
    keyPoints: z.array(z.string().min(10)).min(2).readonly(),
  })
  .strict();

export type LessonSection = z.infer<typeof LessonSectionSchema>;

export const NumericalStepSchema = z
  .object({
    stepNumber: z.number().int().min(1),
    label: z.string().min(5),
    calculation: z.string().min(5),
    amountPln: z
      .string()
      .regex(
        PLN_FORMATTED_AMOUNT_PATTERN,
        'Kwota musi być zapisana w formacie polskim z groszami, np. "12 300,00 PLN".',
      ),
  })
  .strict();

export type NumericalStep = z.infer<typeof NumericalStepSchema>;

export const NumericalExampleSchema = z
  .object({
    title: z.string().min(10),
    scenario: z.string().min(50),
    steps: z.array(NumericalStepSchema).min(3).readonly(),
    finalResultPln: z
      .string()
      .regex(
        PLN_FORMATTED_AMOUNT_PATTERN,
        'Wynik końcowy musi być zapisany w formacie polskim z groszami, np. "2 450,00 PLN".',
      ),
    interpretation: z.string().min(40),
  })
  .strict();

export type NumericalExample = z.infer<typeof NumericalExampleSchema>;

export const ScreenshotSlotSchema = z
  .object({
    slotId: z.string().regex(KEBAB_SLUG_PATTERN),
    appRoute: z.string().regex(/^\/[a-z0-9/_-]*$/),
    caption: z.string().min(20),
    captureSelector: z.string().min(3),
    imagePath: z.string().regex(/^\/academy\/screenshots\/[a-z0-9-]+\.png$/),
  })
  .strict()
  .refine(
    (slot) => slot.imagePath === `/academy/screenshots/${slot.slotId}.png`,
    'Pole imagePath musi być równe "/academy/screenshots/<slotId>.png".',
  );

export type ScreenshotSlot = z.infer<typeof ScreenshotSlotSchema>;

export const DemoCompanyIdSchema = z.enum([
  'demo_jdg_kpir_alfa',
  'demo_jdg_ryczalt_beta',
  'demo_spzoo_gamma',
]);

export type DemoCompanyId = z.infer<typeof DemoCompanyIdSchema>;

export const PracticalExerciseSchema = z
  .object({
    title: z.string().min(10),
    demoCompanyId: DemoCompanyIdSchema,
    demoCompanyName: z.string().min(10),
    steps: z.array(z.string().min(15)).min(3).readonly(),
    expectedOutcome: z.string().min(30),
  })
  .strict();

export type PracticalExercise = z.infer<typeof PracticalExerciseSchema>;

export const CommonMistakeSchema = z
  .object({
    mistake: z.string().min(15),
    consequence: z.string().min(15),
    howToAvoid: z.string().min(15),
  })
  .strict();

export type CommonMistake = z.infer<typeof CommonMistakeSchema>;

export const QuizOptionIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export type QuizOptionIndex = z.infer<typeof QuizOptionIndexSchema>;

export const QuizQuestionSchema = z
  .object({
    id: z.string().regex(/^q-\d{2}-\d{2}-\d{2}$/),
    question: z.string().min(20),
    options: z
      .tuple([z.string().min(2), z.string().min(2), z.string().min(2), z.string().min(2)])
      .readonly(),
    correctOptionIndex: QuizOptionIndexSchema,
    explanation: z.string().min(40),
  })
  .strict();

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const AcademyLessonSchema = z
  .object({
    id: z.string().regex(/^lesson-\d{2}-\d{2}$/),
    slug: z.string().regex(KEBAB_SLUG_PATTERN),
    moduleNumber: z.number().int().min(1).max(12),
    lessonNumber: z.number().int().min(1).max(10),
    title: z.string().min(10),
    estimatedMinutes: z.number().int().min(5).max(60),
    audienceScope: AudienceScopeSchema,
    intro: z.string().min(80),
    sections: z.array(LessonSectionSchema).min(2).readonly(),
    numericalExample: NumericalExampleSchema,
    legalBasis: z.array(LegalBasisCitationSchema).min(1).readonly(),
    screenshotSlot: ScreenshotSlotSchema,
    practicalExercise: PracticalExerciseSchema,
    commonMistakes: z.array(CommonMistakeSchema).min(3).max(5).readonly(),
    summary: z.array(z.string().min(15)).min(3).max(5).readonly(),
    quiz: z.array(QuizQuestionSchema).min(2).max(4).readonly(),
  })
  .strict();

export type AcademyLesson = z.infer<typeof AcademyLessonSchema>;

export const AcademyModuleSchema = z
  .object({
    moduleNumber: z.number().int().min(1).max(12),
    slug: z.string().regex(KEBAB_SLUG_PATTERN),
    title: z.string().min(10),
    subtitle: z.string().min(20),
    learningObjectives: z.array(z.string().min(15)).min(3).readonly(),
    lessons: z.array(AcademyLessonSchema).min(3).readonly(),
  })
  .strict();

export type AcademyModule = z.infer<typeof AcademyModuleSchema>;

export const AcademyCourseSchema = z
  .object({
    courseId: z.literal('akademia-polskiej-ksiegowosci'),
    title: z.string().min(10),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    legalStateAsOf: z.literal(ACADEMY_LEGAL_VERIFICATION_DATE),
    disclaimer: z.string().min(50),
    modules: z.array(AcademyModuleSchema).length(12).readonly(),
  })
  .strict();

export type AcademyCourse = z.infer<typeof AcademyCourseSchema>;

export const GlossaryCategorySchema = z.enum([
  'podstawy',
  'podatki_dochodowe',
  'vat_i_ksef',
  'ewidencje_i_ksiegi',
  'zus_i_kadry',
  'rozrachunki_i_bank',
  'automatyzacja_ai_mcp',
]);

export type GlossaryCategory = z.infer<typeof GlossaryCategorySchema>;

export const GlossaryTermSchema = z
  .object({
    id: z.string().regex(KEBAB_SLUG_PATTERN),
    term: z.string().min(2),
    shortDefinition: z.string().min(30),
    detailedExplanation: z.string().min(80),
    exampleInPractice: z.string().min(30),
    category: GlossaryCategorySchema,
    relatedLessonSlugs: z.array(z.string().regex(KEBAB_SLUG_PATTERN)).min(1).readonly(),
  })
  .strict();

export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const FieldHelpEntrySchema = z
  .object({
    fieldHelpId: z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
    label: z.string().min(3),
    shortHint: z.string().min(20).max(260),
    detailedExplanation: z.string().min(60),
    exampleValue: z.string().min(1),
    warningNote: z.string().min(15),
    audienceScope: AudienceScopeSchema,
    legalBasis: LegalBasisCitationSchema,
    relatedLessonSlug: z.string().regex(KEBAB_SLUG_PATTERN),
  })
  .strict();

export type FieldHelpEntry = z.infer<typeof FieldHelpEntrySchema>;

export const QuizSubmissionSchema = z
  .object({
    lessonSlug: z.string().regex(KEBAB_SLUG_PATTERN),
    answers: z.record(z.string(), QuizOptionIndexSchema),
    passingThresholdPercent: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type QuizSubmission = z.infer<typeof QuizSubmissionSchema>;

export const QuizQuestionFeedbackSchema = z
  .object({
    questionId: z.string().regex(/^q-\d{2}-\d{2}-\d{2}$/),
    selectedOptionIndex: QuizOptionIndexSchema.nullable(),
    correctOptionIndex: QuizOptionIndexSchema,
    isCorrect: z.boolean(),
    explanation: z.string().min(40),
  })
  .strict();

export type QuizQuestionFeedback = z.infer<typeof QuizQuestionFeedbackSchema>;

export const QuizEvaluationResultSchema = z
  .object({
    lessonId: z.string().regex(/^lesson-\d{2}-\d{2}$/),
    lessonSlug: z.string().regex(KEBAB_SLUG_PATTERN),
    totalQuestions: z.number().int().min(2),
    answeredQuestions: z.number().int().min(0),
    correctAnswers: z.number().int().min(0),
    scorePercent: z.number().int().min(0).max(100),
    passingThresholdPercent: z.number().int().min(1).max(100),
    passed: z.boolean(),
    missingQuestionIds: z.array(z.string()).readonly(),
    questionResults: z.array(QuizQuestionFeedbackSchema).min(2).readonly(),
  })
  .strict();

export type QuizEvaluationResult = z.infer<typeof QuizEvaluationResultSchema>;
