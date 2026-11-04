'use client';

import { useState, type ReactNode } from 'react';
import { LegalBasisPanel, type LegalBasisInfo } from './legal-basis.js';
import { MoneyAmount } from './money.js';
import { Card, StatusBadge, ToneIcon } from './primitives.js';
import { ksiegaTokens } from './tokens.js';

export interface NumericExampleRow {
  readonly label: string;
  readonly amountGrosze?: bigint | number | undefined;
  readonly formattedValue?: string | undefined;
  readonly currency?: string | undefined;
  readonly highlight?: boolean | undefined;
}

export interface NumericExampleData {
  readonly title: string;
  readonly scenario: string;
  readonly rows: readonly NumericExampleRow[];
  readonly conclusion: string;
}

export interface CommonMistakeItem {
  readonly mistake: string;
  readonly consequence: string;
  readonly prevention: string;
}

export interface AppScreenshotFrameData {
  readonly caption: string;
  readonly appRoute: string;
  readonly alt: string;
  readonly imageSrc?: string | undefined;
  readonly callouts?: readonly string[] | undefined;
  readonly fallbackPreview?: ReactNode | undefined;
}

export interface QuizOption {
  readonly id: string;
  readonly label: string;
  readonly explanation: string;
}

export interface QuizQuestion {
  readonly id: string;
  readonly question: string;
  readonly hint: string;
  readonly options: readonly QuizOption[];
  readonly correctOptionId: string;
  readonly legalNote?: string | undefined;
}

export interface InteractiveQuizProps {
  title?: string | undefined;
  questions: readonly QuizQuestion[];
  initialSelectedAnswers?: Readonly<Record<string, string>> | undefined;
  defaultShowHints?: boolean | undefined;
  onAnswerSelect?: ((questionId: string, optionId: string, isCorrect: boolean) => void) | undefined;
}

/**
 * Interaktywny quiz sprawdzający wiedzę księgową ze wskazówkami oraz natychmiastowym wyjaśnieniem odpowiedzi.
 */
export function InteractiveQuiz({
  defaultShowHints = false,
  initialSelectedAnswers = {},
  onAnswerSelect,
  questions,
  title = 'Sprawdź wiedzę w praktyce',
}: InteractiveQuizProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(() => ({
    ...initialSelectedAnswers,
  }));
  const [openHints, setOpenHints] = useState<Record<string, boolean>>(() => {
    if (!defaultShowHints) {
      return {};
    }
    const initial: Record<string, boolean> = {};
    for (const q of questions) {
      initial[q.id] = true;
    }
    return initial;
  });

  const answeredCount = questions.filter((q) => selectedAnswers[q.id] !== undefined).length;
  const correctCount = questions.filter(
    (q) => selectedAnswers[q.id] !== undefined && selectedAnswers[q.id] === q.correctOptionId,
  ).length;

  const handleSelect = (question: QuizQuestion, optionId: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [question.id]: optionId }));
    onAnswerSelect?.(question.id, optionId, optionId === question.correctOptionId);
  };

  const toggleHint = (questionId: string) => {
    setOpenHints((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  return (
    <Card
      actions={
        <span
          className={`rounded-md border border-[#d2cec2] bg-[#faf9f5] px-2.5 py-1 text-xs font-semibold text-[#191c1a] ${ksiegaTokens.typography.tabularNums}`}
        >
          Wynik: {correctCount}/{questions.length} (odpowiedziano: {answeredCount})
        </span>
      }
      eyebrow="Quiz kontrolny Akademii"
      title={title}
      tone="subtle"
    >
      <div className="space-y-5">
        {questions.map((question, qIndex) => {
          const chosenOptionId = selectedAnswers[question.id];
          const chosenOption = question.options.find((opt) => opt.id === chosenOptionId);
          const isCorrect =
            chosenOptionId !== undefined && chosenOptionId === question.correctOptionId;
          const isHintVisible = Boolean(openHints[question.id]);
          const hintPanelId = `quiz-hint-${question.id}`;

          return (
            <fieldset className="rounded-xl border border-[#e5e2d9] bg-white p-4" key={question.id}>
              <legend className="px-1 text-sm font-semibold text-[#191c1a]">
                Pytanie {qIndex + 1}. {question.question}
              </legend>

              <div className="mt-2">
                <button
                  aria-controls={hintPanelId}
                  aria-expanded={isHintVisible}
                  className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border border-[#d2cec2] bg-[#faf9f5] px-2.5 py-1 text-[11px] font-semibold text-[#464c48] hover:text-[#191c1a] ${ksiegaTokens.a11y.focusRing}`}
                  onClick={() => toggleHint(question.id)}
                  type="button"
                >
                  <ToneIcon className="size-3.5" tone="info" />
                  <span>{isHintVisible ? 'Ukryj wskazówkę' : 'Pokaż wskazówkę'}</span>
                </button>

                {isHintVisible && (
                  <p
                    className="mt-2 rounded-lg border border-[#bfdbfe] bg-[#f5f9ff] px-3 py-2 text-xs text-[#1e3a8a]"
                    id={hintPanelId}
                  >
                    <strong>Wskazówka: </strong>
                    {question.hint}
                  </p>
                )}
              </div>

              <div className="mt-3 space-y-2" role="radiogroup">
                {question.options.map((option) => {
                  const isSelected = chosenOptionId === option.id;
                  return (
                    <button
                      aria-checked={isSelected}
                      className={`flex w-full items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-xs ${
                        isSelected
                          ? isCorrect
                            ? 'border-[#b8dec6] bg-[#eaf5ee] font-semibold text-[#165b33]'
                            : 'border-[#f3d38c] bg-[#fef7e6] font-semibold text-[#854d0e]'
                          : 'border-[#e5e2d9] bg-[#faf9f5] text-[#191c1a] hover:bg-[#f4f2ec]'
                      } ${ksiegaTokens.a11y.focusRing} ${ksiegaTokens.a11y.reducedMotion}`}
                      key={option.id}
                      onClick={() => handleSelect(question, option.id)}
                      role="radio"
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                          isSelected ? 'border-current bg-white' : 'border-[#d2cec2] bg-white'
                        }`}
                      >
                        {isSelected && <span className="size-2 rounded-full bg-current" />}
                      </span>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>

              {chosenOption && (
                <div
                  aria-live="polite"
                  className={`mt-3 rounded-lg border p-3 text-xs ${
                    isCorrect
                      ? 'border-[#b8dec6] bg-[#f4faf6] text-[#165b33]'
                      : 'border-[#f3d38c] bg-[#fffbf0] text-[#713f12]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={isCorrect ? 'Poprawna odpowiedź' : 'Sprawdź wyjaśnienie'}
                      size="sm"
                      tone={isCorrect ? 'success' : 'warning'}
                    />
                    {question.legalNote && (
                      <span className="text-[11px] font-medium opacity-90">
                        {question.legalNote}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 leading-relaxed text-[#191c1a]">
                    {chosenOption.explanation}
                  </p>
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
    </Card>
  );
}

export interface AcademyLessonViewProps {
  moduleLabel: string;
  lessonTitle: string;
  lead: string;
  readingTimeMinutes: number;
  applicableProfiles: readonly string[];
  children?: ReactNode | undefined;
  numericExample?: NumericExampleData | undefined;
  legalBasis?: LegalBasisInfo | undefined;
  commonMistakes?: readonly CommonMistakeItem[] | undefined;
  appScreenshot?: AppScreenshotFrameData | undefined;
  relatedFieldHelpIds?: readonly string[] | undefined;
  quiz?: InteractiveQuizProps | undefined;
}

/**
 * Widok lekcji Akademii Polskiej Księgowości (inspirowany spokojnym rytmem Wariantu B w ramach
 * systemu „Księga Współczesna”): wyjaśnienie merytoryczne, karta przykładu liczbowego,
 * podstawa prawna, typowe błędy, ramka prawdziwego zrzutu ekranu z aplikacji oraz quiz.
 */
export function AcademyLessonView({
  applicableProfiles,
  appScreenshot,
  children,
  commonMistakes,
  lead,
  legalBasis,
  lessonTitle,
  moduleLabel,
  numericExample,
  quiz,
  readingTimeMinutes,
  relatedFieldHelpIds,
}: AcademyLessonViewProps) {
  return (
    <article className="space-y-6 text-[#191c1a]">
      {/* Nagłówek lekcji */}
      <header className="rounded-xl border border-[#e5e2d9] bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge label={moduleLabel} size="sm" tone="accent" />
          <span className={`text-xs text-[#636b66] ${ksiegaTokens.typography.tabularNums}`}>
            Czas nauki: ok. {readingTimeMinutes} min
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold tracking-tight text-[#191c1a] sm:text-2xl">
          {lessonTitle}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#464c48]">{lead}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#e5e2d9] pt-3.5 text-xs">
          <span className="font-semibold text-[#636b66]">Dotyczy profili:</span>
          {applicableProfiles.map((profile) => (
            <span
              className="rounded-md border border-[#e5e2d9] bg-[#faf9f5] px-2.5 py-0.5 font-medium text-[#191c1a]"
              key={profile}
            >
              {profile}
            </span>
          ))}
        </div>
      </header>

      {children && (
        <section className="rounded-xl border border-[#e5e2d9] bg-white p-5 text-sm leading-relaxed text-[#191c1a] sm:p-6">
          {children}
        </section>
      )}

      {/* Karta przykładu liczbowego na syntetycznej firmie */}
      {numericExample && (
        <Card
          eyebrow="Przykład liczbowy (dane syntetyczne)"
          title={numericExample.title}
          tone="accent"
        >
          <p className="mb-3.5 text-xs leading-relaxed text-[#464c48]">{numericExample.scenario}</p>
          <dl className="divide-y divide-[#b7d4c5] rounded-lg border border-[#b7d4c5] bg-white">
            {numericExample.rows.map((row, idx) => (
              <div
                className={`flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-xs ${
                  row.highlight ? 'bg-[#e7f1ec] font-semibold' : ''
                }`}
                key={`${idx}-${row.label}`}
              >
                <dt className="text-[#191c1a]">{row.label}</dt>
                <dd className={ksiegaTokens.typography.tabularNums}>
                  {row.amountGrosze !== undefined ? (
                    <MoneyAmount
                      amount={row.amountGrosze}
                      currency={row.currency ?? 'PLN'}
                      inGrosze
                      size="sm"
                    />
                  ) : (
                    <span className="font-semibold text-[#191c1a]">{row.formattedValue}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs font-medium text-[#164833]">{numericExample.conclusion}</p>
        </Card>
      )}

      {/* Ramka podstawy prawnej */}
      {legalBasis && <LegalBasisPanel basis={legalBasis} />}

      {/* Lista typowych błędów */}
      {commonMistakes && commonMistakes.length > 0 && (
        <Card eyebrow="Praktyka księgowa" title="Typowe błędy i jak ich uniknąć" tone="warning">
          <ul className="space-y-3" role="list">
            {commonMistakes.map((item, idx) => (
              <li
                className="rounded-lg border border-[#f3d38c] bg-white p-3.5 text-xs"
                key={`${idx}-${item.mistake}`}
              >
                <div className="flex items-start gap-2 font-semibold text-[#854d0e]">
                  <ToneIcon className="mt-0.5 size-4 shrink-0" tone="warning" />
                  <span>Błąd: {item.mistake}</span>
                </div>
                <p className="mt-1.5 text-[#464c48]">
                  <strong className="font-semibold text-[#191c1a]">Skutek: </strong>
                  {item.consequence}
                </p>
                <p className="mt-1 text-[#165b33]">
                  <strong className="font-semibold">Jak uniknąć: </strong>
                  {item.prevention}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Ramka prawdziwego zrzutu ekranu z działającej aplikacji */}
      {appScreenshot && (
        <figure className="overflow-hidden rounded-xl border border-[#d2cec2] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e2d9] bg-[#f4f2ec] px-4 py-2.5 text-xs">
            <span className="font-semibold text-[#191c1a]">
              Widok w aplikacji Polish Accounting Platform
            </span>
            <code
              className={`rounded bg-white px-2 py-0.5 text-[#464c48] ${ksiegaTokens.typography.ledgerCode}`}
            >
              {appScreenshot.appRoute}
            </code>
          </div>

          <div className="bg-[#faf9f5] p-4">
            {appScreenshot.imageSrc ? (
              <img
                alt={appScreenshot.alt}
                className="w-full rounded-lg border border-[#e5e2d9]"
                src={appScreenshot.imageSrc}
              />
            ) : (
              (appScreenshot.fallbackPreview ?? (
                <div
                  aria-label={appScreenshot.alt}
                  className="rounded-lg border border-dashed border-[#d2cec2] bg-white p-6 text-center text-xs text-[#636b66]"
                  role="img"
                >
                  Miejsce na automatyczny zrzut ekranu Playwright dla ścieżki{' '}
                  <code className="font-mono text-[#191c1a]">{appScreenshot.appRoute}</code> —{' '}
                  {appScreenshot.alt}
                </div>
              ))
            )}
          </div>

          <figcaption className="border-t border-[#e5e2d9] bg-white px-4 py-3 text-xs text-[#464c48]">
            <p className="font-medium text-[#191c1a]">{appScreenshot.caption}</p>
            {appScreenshot.callouts && appScreenshot.callouts.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-2" role="list">
                {appScreenshot.callouts.map((callout) => (
                  <li
                    className="rounded bg-[#f4f2ec] px-2 py-0.5 text-[11px] text-[#464c48]"
                    key={callout}
                  >
                    {callout}
                  </li>
                ))}
              </ul>
            )}
          </figcaption>
        </figure>
      )}

      {relatedFieldHelpIds && relatedFieldHelpIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] px-4 py-3 text-xs">
          <span className="font-semibold text-[#464c48]">
            Powiązane pola pomocy kontekstowej w formularzach:
          </span>
          {relatedFieldHelpIds.map((helpId) => (
            <code
              className={`rounded border border-[#d2cec2] bg-white px-2 py-0.5 text-[#191c1a] ${ksiegaTokens.typography.ledgerCode}`}
              key={helpId}
            >
              {helpId}
            </code>
          ))}
        </div>
      )}

      {quiz && <InteractiveQuiz {...quiz} />}
    </article>
  );
}
