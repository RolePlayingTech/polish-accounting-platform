import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ACADEMY_ALL_LESSONS,
  ACADEMY_FIELD_HELP_ENTRIES,
  getAcademyLessonBySlug,
  getAcademyModuleBySlug,
} from '@pap/domain/academy';
import { AcademyLessonView, Card, StatusBadge, type QuizQuestion as UiQuizQuestion } from '@pap/ui';
import { AcademyScreenshotPreview } from '../../../../components/academy-screenshot-preview';
import { AcademyDisclaimerBanner } from '../../../../components/ui-controls';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import {
  ACADEMY_PROFILE_LABELS_PL,
  getCanonicalLessonHref,
  mapAcademyCitationsToBasisInfo,
} from '../../../../lib/field-help';
import { readServerSession } from '../../../../lib/session';
import { getDashboardSnapshot } from '../../../../lib/synthetic-workspace';

export default async function AcademyLessonPage({
  params,
}: {
  params: Promise<{ moduleSlug: string; lessonSlug: string }>;
}) {
  const { moduleSlug, lessonSlug } = await params;
  const academyModule = getAcademyModuleBySlug(moduleSlug);
  const lesson = getAcademyLessonBySlug(lessonSlug);

  if (!academyModule || !lesson || lesson.moduleNumber !== academyModule.moduleNumber) {
    notFound();
  }

  const session = await readServerSession();
  let dash: Awaited<ReturnType<typeof getDashboardSnapshot>> | null = null;
  if (session) {
    try {
      dash = await getDashboardSnapshot(session);
    } catch {
      dash = null;
    }
  }

  const flatIndex = ACADEMY_ALL_LESSONS.findIndex((item) => item.id === lesson.id);
  const prevLesson = flatIndex > 0 ? ACADEMY_ALL_LESSONS[flatIndex - 1] : undefined;
  const nextLesson =
    flatIndex >= 0 && flatIndex < ACADEMY_ALL_LESSONS.length - 1
      ? ACADEMY_ALL_LESSONS[flatIndex + 1]
      : undefined;

  const relatedFieldHelpIds = ACADEMY_FIELD_HELP_ENTRIES.filter(
    (fh) => fh.relatedLessonSlug === lesson.slug,
  ).map((fh) => fh.fieldHelpId);

  const uiQuizQuestions: UiQuizQuestion[] = lesson.quiz.map((q) => ({
    id: q.id,
    question: q.question,
    hint: `Przeanalizuj sekcje merytoryczne lekcji „${lesson.title}” oraz przykład liczbowy w PLN.`,
    correctOptionId: `opt-${String(q.correctOptionIndex)}`,
    options: q.options.map((label, idx) => ({
      id: `opt-${String(idx)}`,
      label,
      explanation:
        idx === q.correctOptionIndex
          ? `Poprawna odpowiedź. ${q.explanation}`
          : `Odpowiedź niepoprawna. Wyjaśnienie: ${q.explanation}`,
    })),
    legalNote: lesson.legalBasis[0]
      ? `${lesson.legalBasis[0].actTitle} (${lesson.legalBasis[0].articleRef})`
      : undefined,
  }));

  const profileLabels = lesson.audienceScope.applicableProfiles.map(
    (code) => ACADEMY_PROFILE_LABELS_PL[code] ?? code,
  );

  return (
    <WorkspaceShell
      activeHref="/academy"
      pageEyebrow={`Akademia Księgowości · Moduł ${String(academyModule.moduleNumber)} (${academyModule.title})`}
      pageTitle={lesson.title}
      pageSubtitle={lesson.audienceScope.scopeNote}
      sessionContext={session?.context ?? null}
      activeCompany={dash?.activeCompany ?? null}
      accessibleCompanies={dash?.accessibleCompanies ?? []}
      pageActions={
        <Link
          href="/academy"
          className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
        >
          ← Spis wszystkich 12 modułów
        </Link>
      }
    >
      <div className="space-y-6">
        <AcademyDisclaimerBanner />

        <AcademyLessonView
          moduleLabel={`Moduł ${String(academyModule.moduleNumber)}.${String(lesson.lessonNumber)} · ${academyModule.title}`}
          lessonTitle={lesson.title}
          lead={lesson.intro}
          readingTimeMinutes={lesson.estimatedMinutes}
          applicableProfiles={profileLabels}
          numericExample={{
            title: lesson.numericalExample.title,
            scenario: lesson.numericalExample.scenario,
            rows: [
              ...lesson.numericalExample.steps.map((step) => ({
                label: `${String(step.stepNumber)}. ${step.label} (${step.calculation})`,
                formattedValue: step.amountPln,
              })),
              {
                label: 'Wynik końcowy przykładu',
                formattedValue: lesson.numericalExample.finalResultPln,
                highlight: true,
              },
            ],
            conclusion: lesson.numericalExample.interpretation,
          }}
          legalBasis={mapAcademyCitationsToBasisInfo(lesson.legalBasis, lesson.title)}
          commonMistakes={lesson.commonMistakes.map((cm) => ({
            mistake: cm.mistake,
            consequence: cm.consequence,
            prevention: cm.howToAvoid,
          }))}
          appScreenshot={{
            caption: lesson.screenshotSlot.caption,
            appRoute: lesson.screenshotSlot.appRoute,
            alt: lesson.screenshotSlot.caption,
            fallbackPreview: (
              <AcademyScreenshotPreview
                slotId={lesson.screenshotSlot.slotId}
                imagePath={lesson.screenshotSlot.imagePath}
                appRoute={lesson.screenshotSlot.appRoute}
                captureSelector={lesson.screenshotSlot.captureSelector}
                caption={lesson.screenshotSlot.caption}
                demoCompanyName={lesson.practicalExercise.demoCompanyName}
              />
            ),
          }}
          relatedFieldHelpIds={relatedFieldHelpIds}
          quiz={{
            title: `Sprawdź wiedzę z lekcji (${String(uiQuizQuestions.length)} pytania)`,
            questions: uiQuizQuestions,
          }}
        >
          {lesson.sections.map((sec, idx) => (
            <div key={idx} className="space-y-2 border-b border-[#e5e2d9] pb-4 last:border-b-0">
              <h2 className="text-lg font-semibold text-[#191c1a]">{sec.heading}</h2>
              <p className="text-sm leading-relaxed text-[#464c48]">{sec.body}</p>
              <ul className="mt-2 space-y-1 pl-4 text-xs text-[#191c1a]">
                {sec.keyPoints.map((kp, kpIdx) => (
                  <li key={kpIdx} className="list-disc">
                    {kp}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </AcademyLessonView>

        <Card
          as="div"
          tone="accent"
          eyebrow={`Ćwiczenie warsztatowe · podmiot demo: ${lesson.practicalExercise.demoCompanyName}`}
          title={lesson.practicalExercise.title}
          actions={
            <StatusBadge
              size="sm"
              tone="accent"
              label={`Trasa: ${lesson.screenshotSlot.appRoute}`}
            />
          }
        >
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[#191c1a]">
            {lesson.practicalExercise.steps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
          <p className="mt-3 rounded-lg border border-[#b7d4c5] bg-white px-3.5 py-2.5 text-xs text-[#185a37]">
            <strong>Oczekiwany rezultat w księgach: </strong>
            {lesson.practicalExercise.expectedOutcome}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={lesson.screenshotSlot.appRoute}
              className="inline-flex min-h-10 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-medium text-white hover:bg-[#164833]"
            >
              Wykonaj ćwiczenie na ekranie aplikacji ({lesson.screenshotSlot.appRoute}) →
            </Link>
          </div>
        </Card>

        <Card as="div" eyebrow="Podsumowanie lekcji" title="Najważniejsze wnioski do zapamiętania">
          <ul className="space-y-1.5 text-sm text-[#191c1a]">
            {lesson.summary.map((point, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono font-bold text-[#1d5c42]">✓</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Card>

        <nav
          aria-label="Nawigacja między lekcjami Akademii"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e2d9] bg-white p-4"
        >
          {prevLesson ? (
            <Link
              href={getCanonicalLessonHref(prevLesson.slug)}
              className="inline-flex min-h-6 items-center text-xs font-semibold text-[#1d5c42] hover:underline"
            >
              ← Poprzednia: {prevLesson.title}
            </Link>
          ) : (
            <Link
              href="/academy"
              className="inline-flex min-h-6 items-center text-xs font-semibold text-[#636b66] hover:underline"
            >
              ← Powrót do katalogu Akademii
            </Link>
          )}

          {nextLesson ? (
            <Link
              href={getCanonicalLessonHref(nextLesson.slug)}
              className="inline-flex min-h-6 items-center text-xs font-semibold text-[#1d5c42] hover:underline"
            >
              Następna: {nextLesson.title} →
            </Link>
          ) : (
            <Link
              href="/academy"
              className="inline-flex min-h-6 items-center text-xs font-semibold text-[#1d5c42] hover:underline"
            >
              Zakończ kurs — wróć do spisu modułów →
            </Link>
          )}
        </nav>

        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
