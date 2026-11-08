'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, FormField, StatusBadge } from '@pap/ui';
import { AlertBanner, Button } from '../../../components/ui-controls';
import type {
  NotificationFrequency,
  NotificationOutboxEntry,
  NotificationPrefsState,
  ReminderStage,
} from '../../../lib/workspace-types';

const STAGE_LABELS: Record<ReminderStage, string> = {
  upcoming_7d: 'Wyprzedzenie 7 dni przed terminem',
  urgent_2d: 'Pilne przypomnienie 2 dni przed terminem',
  due_today: 'W dniu ustawowego terminu (0 dni)',
  overdue_3d: 'Monit zaległości 3 dni po terminie',
};

export interface NotificationsWorkbenchProps {
  period: string;
  canWrite: boolean;
  preferences: NotificationPrefsState;
  outbox: readonly NotificationOutboxEntry[];
}

export function NotificationsWorkbench({
  canWrite,
  outbox,
  period,
  preferences,
}: NotificationsWorkbenchProps) {
  const router = useRouter();
  const [frequency, setFrequency] = useState<NotificationFrequency>(preferences.frequency);
  const [optedOut, setOptedOut] = useState<boolean>(preferences.optionalRemindersOptedOut);
  const [disabledStages, setDisabledStages] = useState<ReminderStage[]>([
    ...preferences.disabledStages,
  ]);
  const [selectedOutboxId, setSelectedOutboxId] = useState<string | null>(
    outbox[0]?.outboxId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    title: string;
    detail: string;
  } | null>(null);

  const selectedMessage = outbox.find((m) => m.outboxId === selectedOutboxId) ?? outbox[0] ?? null;

  function toggleStage(stage: ReminderStage) {
    setDisabledStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  }

  async function savePreferences(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_notification_prefs',
          frequency,
          optionalRemindersOptedOut: optedOut,
          disabledStages,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: 'Błąd zapisu preferencji powiadomień',
          detail: data.error ?? 'Nie udało się zapisać ustawień.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Zaktualizowano preferencje przypomnień e-mail',
          detail: optedOut
            ? 'Włączono opt-out — opcjonalne przypomnienia zostaną wstrzymane (suppressed_by_preferences).'
            : `Zapisano częstotliwość: ${frequency}.`,
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function dispatchDueNow() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dispatch_due_notifications' }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: 'Nie udało się uruchomić wysyłki przypomnień',
          detail: data.error ?? 'Błąd operacji dispatch-due.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Wygenerowano wiadomość RFC 5322 w Skrzynce Sandbox',
          detail:
            'Żadna wiadomość nie opuściła środowiska testowego przez zewnętrzny serwer SMTP — podgląd dostępny poniżej.',
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <Card
            as="div"
            eyebrow="Preferencje użytkownika · wyprzedzenia i opt-out"
            title="Ustawienia przypomnień podatkowych"
          >
            <form className="space-y-4" onSubmit={(e) => void savePreferences(e)}>
              <FormField id="notif-frequency" label="Tryb wysyłki przypomnień">
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as NotificationFrequency)}
                  >
                    <option value="standard">
                      Standardowy — pojedyncze przypomnienia per termin
                    </option>
                    <option value="daily_digest">Zbiorczy skrót dzienny (daily digest)</option>
                    <option value="disabled">Wyciszony</option>
                  </select>
                )}
              </FormField>

              <label
                htmlFor="notif-opt-out-all"
                className="flex items-start gap-2.5 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3 text-xs text-[#191c1a]"
              >
                <input
                  id="notif-opt-out-all"
                  type="checkbox"
                  checked={optedOut}
                  onChange={(e) => setOptedOut(e.target.checked)}
                  className="mt-0.5 h-6 w-6 shrink-0 accent-[#1d5c42]"
                />
                <span>
                  <strong className="font-semibold">
                    Całkowite wyłączenie przypomnień (opt-out)
                  </strong>
                  <span className="mt-0.5 block text-[#464c48]">
                    Kolejka zarejestruje próbę ze statusem{' '}
                    <code className="font-mono">suppressed_by_preferences</code> bez wysyłki.
                  </span>
                </span>
              </label>

              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-[#191c1a]">
                  Aktywne progi wyprzedzenia dla okresu {period}:
                </legend>
                {(Object.keys(STAGE_LABELS) as ReminderStage[]).map((stage) => {
                  const enabled = !disabledStages.includes(stage);
                  return (
                    <label
                      key={stage}
                      htmlFor={`notif-stage-${stage}`}
                      className="flex items-center gap-2 text-xs text-[#464c48]"
                    >
                      <input
                        id={`notif-stage-${stage}`}
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleStage(stage)}
                        className="h-6 w-6 shrink-0 accent-[#1d5c42]"
                      />
                      <span>{STAGE_LABELS[stage]}</span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" type="submit" disabled={busy || !canWrite}>
                  Zapisz preferencje
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !canWrite}
                  onClick={() => void dispatchDueNow()}
                >
                  Uruchom wysyłkę zaległych (dispatch-due)
                </Button>
              </div>
            </form>
          </Card>

          <Card
            as="div"
            eyebrow={`Kolejka Outbox (${String(outbox.length)})`}
            title="Lista wiadomości w Skrzynce Sandbox"
          >
            <ul className="space-y-2">
              {outbox.map((item) => {
                const isSelected = selectedMessage?.outboxId === item.outboxId;
                return (
                  <li key={item.outboxId}>
                    <button
                      type="button"
                      onClick={() => setSelectedOutboxId(item.outboxId)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-[#1d5c42] bg-[#e7f1ec]/70'
                          : 'border-[#e5e2d9] bg-[#faf9f5] hover:border-[#858177]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge
                          size="sm"
                          tone={item.status === 'sent' ? 'success' : 'warning'}
                          label={
                            item.status === 'sent'
                              ? 'Wysłano do Sandbox'
                              : `Wstrzymano (${item.status})`
                          }
                        />
                        <span className="font-mono text-[11px] tabular-nums text-[#636b66]">
                          {item.scheduledForDate}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold text-[#191c1a]">
                        {item.email.subject}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#464c48]">
                        Do: {item.email.toAddress}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="lg:col-span-7">
          {selectedMessage ? (
            <Card
              as="div"
              eyebrow="Podgląd wiadomości RFC 5322 · bez zewnętrznego SMTP"
              title="Skrzynka Sandbox Mailbox (inspektor MIME i stopki anty-phishingowej)"
            >
              <div className="space-y-4">
                <dl className="grid gap-2 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-[#636b66]">Nadawca (From):</dt>
                    <dd className="font-mono text-[#191c1a]">
                      {selectedMessage.email.fromDisplayName} &lt;
                      {selectedMessage.email.fromAddress}&gt;
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#636b66]">Odbiorca (To):</dt>
                    <dd className="font-mono text-[#191c1a]">{selectedMessage.email.toAddress}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[#636b66]">Temat (Subject):</dt>
                    <dd className="font-semibold text-[#191c1a]">
                      {selectedMessage.email.subject}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-[#636b66]">
                      Klucz deduplikacji (idempotentność):
                    </dt>
                    <dd className="break-all font-mono text-[11px] text-[#464c48]">
                      {selectedMessage.deduplicationKey}
                    </dd>
                  </div>
                </dl>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#636b66]">
                    Treść tekstowa (text/plain · zamaskowany NIP + link do podstawy prawnej + stopka
                    anty-podszywania)
                  </p>
                  <pre className="mt-1.5 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[#e5e2d9] bg-white p-3.5 font-mono text-xs leading-relaxed text-[#191c1a]">
                    {selectedMessage.email.textBody}
                  </pre>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#636b66]">
                    Nagłówki protokołu RFC 5322 / MIME
                  </p>
                  <pre className="mt-1.5 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[#e5e2d9] bg-[#f4f2ec] p-3 font-mono text-[11px] leading-relaxed text-[#464c48] sm:whitespace-pre">
                    {Object.entries(selectedMessage.email.headers)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('\n')}
                  </pre>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
