import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  NotificationObligationInputSchema,
  NotificationPreferencesSchema,
  RenderedAuxiliaryEmailSchema,
  type DeliveryAttemptRecord,
  type NotificationFrequency,
  type NotificationObligationInput,
  type NotificationOutboxEntry,
  type NotificationPreferences,
  type OutboxMessageStatus,
  type ReminderStage,
  type RenderedAuxiliaryEmail,
} from '@pap/contracts/notifications';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { systemClock, type Clock } from './tenant-authorization.js';

export type NotificationsAuditEventKind =
  | 'notification_preferences_updated'
  | 'notification_opt_out_token_issued'
  | 'notification_opt_out_applied'
  | 'notification_opt_out_rejected'
  | 'notification_outbox_enqueued'
  | 'notification_delivered'
  | 'notification_retry_scheduled'
  | 'notification_dead_lettered'
  | 'notification_recipient_blocked_by_sandbox_policy';

export interface NotificationsAuditEvent {
  readonly auditEventId: string;
  readonly occurredAt: string;
  readonly kind: NotificationsAuditEventKind;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly userId: string | null;
  readonly deduplicationKey: string | null;
  readonly outboxId: string | null;
  readonly maskedRecipient: string | null;
  readonly outcome: 'allow' | 'deny' | 'error';
  readonly reasonCode: string;
}

export interface NotificationsAuditSink {
  record(event: NotificationsAuditEvent): Promise<void> | void;
}

export class InMemoryNotificationsAuditSink implements NotificationsAuditSink {
  private readonly events: NotificationsAuditEvent[] = [];

  record(event: NotificationsAuditEvent): void {
    this.events.push(Object.freeze({ ...event }));
  }

  listEvents(): readonly NotificationsAuditEvent[] {
    return [...this.events];
  }
}

export function maskEmailForAudit(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return '***@invalid';
  }
  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1).toLowerCase();
  const safeDomain = domainPart.replace(/[^a-z0-9.-]/g, '?').slice(0, 80);
  const firstChar = localPart[0] ?? '*';
  const safeFirstChar = /[a-zA-Z0-9]/.test(firstChar) ? firstChar.toLowerCase() : '*';
  return `${safeFirstChar}***@${safeDomain}`;
}

function redactErrorText(rawMessage: string): string {
  return rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .slice(0, 240);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseIsoDateToUtcMidnightMs(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Non-existent calendar date: ${isoDate}`);
  }
  return utcMs;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function diffCalendarDays(fromIsoDate: string, toIsoDate: string): number {
  const fromMs = parseIsoDateToUtcMidnightMs(fromIsoDate);
  const toMs = parseIsoDateToUtcMidnightMs(toIsoDate);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

const STAGE_LABELS_PL: Readonly<Record<ReminderStage, string>> = {
  advance_7d: 'przypomnienia wyprzedzające (-7 dni przed terminem)',
  urgent_2d: 'przypomnienia pilne (-2 dni przed terminem)',
  overdue_1d: 'powiadomienia o zaległości (+1 dzień po terminie)',
};

const ALL_STAGES: readonly ReminderStage[] = ['advance_7d', 'urgent_2d', 'overdue_1d'];

export function deriveDisabledStages(input: {
  readonly frequency: NotificationFrequency;
  readonly optionalRemindersOptedOut: boolean;
  readonly explicitDisabledStages?: readonly ReminderStage[] | undefined;
}): ReminderStage[] {
  const disabled = new Set<ReminderStage>(input.explicitDisabledStages ?? []);

  if (input.frequency === 'urgent_only') {
    disabled.add('advance_7d');
  } else if (input.frequency === 'overdue_only') {
    disabled.add('advance_7d');
    disabled.add('urgent_2d');
  }

  if (input.optionalRemindersOptedOut) {
    disabled.add('advance_7d');
    disabled.add('urgent_2d');
  }

  return ALL_STAGES.filter((stage) => disabled.has(stage));
}

export function computeDisabledAlertsSummaryPl(disabledStages: readonly ReminderStage[]): string {
  if (disabledStages.length === 0) {
    return 'Wszystkie przypomnienia pomocnicze są aktywne (-7 dni, -2 dni oraz +1 dzień po terminie).';
  }
  const disabledDescriptions = disabledStages.map((s) => STAGE_LABELS_PL[s]);
  const activeStages = ALL_STAGES.filter((s) => !disabledStages.includes(s));
  if (activeStages.length === 0) {
    return `Wszystkie powiadomienia e-mail zostały wyłączone przez użytkownika (${disabledDescriptions.join(', ')}).`;
  }
  const activeDescriptions = activeStages.map((s) => STAGE_LABELS_PL[s]);
  return `Wyłączone alerty: ${disabledDescriptions.join(', ')}. Aktywne pozostają: ${activeDescriptions.join(', ')}.`;
}

export function buildNotificationDeduplicationKey(params: {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly userId: string;
  readonly obligationId: string;
  readonly dueDate: string;
  readonly stage: ReminderStage;
}): string {
  return [
    'pap-notif-v1',
    params.tenantId.toLowerCase(),
    params.legalEntityId.toLowerCase(),
    params.userId.toLowerCase(),
    params.obligationId.toLowerCase(),
    params.dueDate,
    params.stage,
  ].join(':');
}

const FORBIDDEN_IMPERSONATION_SENDER_PATTERN =
  /(gov\.pl|zus\.pl|podatki|skarbow|ministerstwo|urzad|urząd|ksef)/i;

export interface RenderAuxiliaryReminderEmailInput {
  readonly obligation: NotificationObligationInput;
  readonly stage: ReminderStage;
  readonly toAddress: string;
  readonly fromAddress?: string | undefined;
  readonly preferences: NotificationPreferences;
  readonly optOutHintPl?: string | undefined;
}

export function renderAuxiliaryReminderEmail(
  input: RenderAuxiliaryReminderEmailInput,
): RenderedAuxiliaryEmail {
  const obligation = NotificationObligationInputSchema.parse(input.obligation);
  const fromAddress = (input.fromAddress ?? 'powiadomienia@pap.local').trim();

  if (
    FORBIDDEN_IMPERSONATION_SENDER_PATTERN.test(fromAddress) ||
    /[\r\n]/.test(fromAddress) ||
    /[\r\n]/.test(input.toAddress)
  ) {
    throw new Error('Sender or recipient address violates anti-impersonation or header safety policy');
  }

  const stageHeaderMap: Readonly<
    Record<ReminderStage, { readonly subjectPrefix: string; readonly bannerPl: string }>
  > = {
    advance_7d: {
      subjectPrefix: 'Przypomnienie wyprzedzające',
      bannerPl: 'Przypomnienie wyprzedzające (7 dni przed terminem ustawowym)',
    },
    urgent_2d: {
      subjectPrefix: 'Pilne przypomnienie',
      bannerPl: 'Pilne przypomnienie (2 dni przed terminem ustawowym)',
    },
    overdue_1d: {
      subjectPrefix: 'Alert o przekroczeniu terminu',
      bannerPl: 'Powiadomienie o zaległości (termin ustawowy minął)',
    },
  };

  const stageMeta = stageHeaderMap[input.stage];
  const safeCode = obligation.code.replace(/[\r\n]/g, ' ').trim();
  const subject = `[Polish Accounting Platform] ${stageMeta.subjectPrefix}: ${safeCode} (termin: ${obligation.dueDate}) — podmiot ${obligation.companyMaskedNip}`;

  const optOutNoticePl =
    input.optOutHintPl ??
    'Możesz zmienić częstotliwość lub zrezygnować z opcjonalnych przypomnień w ustawieniach powiadomień aplikacji albo przy użyciu jednorazowego linku rezygnacji (opt-out).';

  const legalBasisLinePl = `${obligation.legalBasis.articleRef} — ${obligation.legalBasis.actTitle} (${obligation.legalBasis.journalOfLawsRef}, wersja reguły: ${obligation.legalBasis.ruleVersion})`;

  const textBody = [
    `Polish Accounting Platform — ${stageMeta.bannerPl}`,
    '====================================================================',
    '',
    `Obowiązek: ${obligation.namePl} (${obligation.code})`,
    `Termin ustawowy: ${obligation.dueDate}`,
    `Profil podmiotu: ${obligation.companyProfileLabelPl} (identyfikator zmaskowany: ${obligation.companyMaskedNip})`,
    '',
    'Podstawa prawna (zweryfikowana reguła w systemie):',
    `  ${legalBasisLinePl}`,
    `  Źródło urzędowe: ${obligation.legalBasis.officialUrl}`,
    `  Okres obowiązywania reguły: od ${obligation.legalBasis.effectiveFrom}${
      obligation.legalBasis.effectiveTo ? ` do ${obligation.legalBasis.effectiveTo}` : ' (bezterminowo)'
    }`,
    '',
    'Szczegółowe kwoty rozliczenia oraz projekty deklaracji są dostępne wyłącznie po zalogowaniu',
    'do uprawnionego konta w aplikacji Polish Accounting Platform (ochrona tajemnicy przedsiębiorstwa i PII).',
    '',
    `Stan ustawień alertów: ${input.preferences.disabledAlertsSummaryPl}`,
    optOutNoticePl,
    '',
    '--------------------------------------------------------------------',
    MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  ].join('\n');

  const htmlBody = [
    '<!DOCTYPE html>',
    '<html lang="pl">',
    '<head><meta charset="utf-8"><title>' + escapeHtml(subject) + '</title></head>',
    '<body style="margin:0;padding:24px;background-color:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;line-height:1.5;">',
    '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:8px;">',
    '    <tr><td style="padding:20px 24px;border-bottom:1px solid #d8dee4;background:#f0f4f8;">',
    '      <p style="margin:0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#334155;">Polish Accounting Platform — Powiadomienie pomocnicze</p>',
    `      <h1 style="margin:8px 0 0;font-size:18px;color:#0f172a;">${escapeHtml(stageMeta.bannerPl)}</h1>`,
    '    </td></tr>',
    '    <tr><td style="padding:24px;">',
    '      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:20px;">',
    `        <tr><td style="padding:6px 0;color:#475569;width:180px;">Obowiązek:</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(obligation.namePl)} (${escapeHtml(obligation.code)})</td></tr>`,
    `        <tr><td style="padding:6px 0;color:#475569;">Termin ustawowy:</td><td style="padding:6px 0;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(obligation.dueDate)}</td></tr>`,
    `        <tr><td style="padding:6px 0;color:#475569;">Profil podmiotu:</td><td style="padding:6px 0;font-variant-numeric:tabular-nums;">${escapeHtml(obligation.companyProfileLabelPl)} (NIP: ${escapeHtml(obligation.companyMaskedNip)})</td></tr>`,
    '      </table>',
    '      <div style="padding:14px 16px;background:#f8fafc;border-left:4px solid #2563eb;border-radius:4px;margin-bottom:20px;">',
    '        <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#1e3a8a;">Podstawa prawna (zweryfikowana reguła)</p>',
    `        <p style="margin:0 0 6px;font-size:14px;">${escapeHtml(legalBasisLinePl)}</p>`,
    `        <p style="margin:0;font-size:13px;"><a href="${escapeHtml(obligation.legalBasis.officialUrl)}" style="color:#1d4ed8;text-decoration:underline;">Otwórz oficjalny tekst aktu prawnego</a></p>`,
    '      </div>',
    '      <p style="margin:0 0 14px;font-size:13px;color:#334155;">Ze względów bezpieczeństwa i ochrony danych finansowych wiadomość e-mail nie zawiera szczegółowych kwot podatku ani danych osobowych kontrahentów. Zaloguj się do aplikacji, aby przejrzeć wyliczenie i zatwierdzić działanie.</p>',
    `      <p style="margin:0 0 8px;font-size:12px;color:#475569;"><strong>Preferencje powiadomień:</strong> ${escapeHtml(input.preferences.disabledAlertsSummaryPl)}</p>`,
    `      <p style="margin:0;font-size:12px;color:#475569;">${escapeHtml(optOutNoticePl)}</p>`,
    '    </td></tr>',
    '    <tr><td style="padding:16px 24px;border-top:1px solid #d8dee4;background:#f8fafc;font-size:12px;color:#475569;">',
    `      <strong>${escapeHtml(MANDATORY_AUXILIARY_EMAIL_FOOTER_PL)}</strong>`,
    '    </td></tr>',
    '  </table>',
    '</body>',
    '</html>',
  ].join('\n');

  return RenderedAuxiliaryEmailSchema.parse({
    fromAddress,
    fromDisplayName: 'Polish Accounting Platform (Powiadomienia)',
    toAddress: input.toAddress.trim(),
    subject,
    textBody,
    htmlBody,
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-PAP-Notification-Kind': 'auxiliary-reminder',
      'X-PAP-Reminder-Stage': input.stage,
    },
  });
}

export type EmailTransportDeliveryResult =
  | {
      readonly ok: true;
      readonly outcome: 'sent';
      readonly providerMessageId: string;
    }
  | {
      readonly ok: false;
      readonly outcome: 'transient_failure' | 'blocked_recipient_policy';
      readonly errorCode: string;
      readonly errorMessage: string;
    };

export interface EmailDeliveryTransport {
  sendEmail(
    email: RenderedAuxiliaryEmail,
    metadata: {
      readonly outboxId: string;
      readonly deduplicationKey: string;
      readonly tenantId: string;
      readonly legalEntityId: string;
    },
  ): Promise<EmailTransportDeliveryResult>;
}

export interface StoredSandboxEmailMessage {
  readonly messageId: string;
  readonly outboxId: string;
  readonly deduplicationKey: string;
  readonly deliveredAt: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawRfc822: string;
}

export interface ControlledSandboxMailboxTransportOptions {
  /**
   * Allowed recipient domains in test/staging mode (fail-closed!).
   * Supports exact domain ('example.test') and wildcard subdomain ('*.pap.local' or 'pap.local').
   * Defaults strictly to ['pap.local', '*.pap.local', 'example.test'].
   */
  readonly allowlistedDomains?: readonly string[] | undefined;
  /** Optional explicit allowlisted staging inbox addresses (exact case-insensitive match). */
  readonly allowlistedAddresses?: readonly string[] | undefined;
  readonly auditSink?: NotificationsAuditSink | undefined;
  readonly clock?: Clock | undefined;
}

const SAFE_SINGLE_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

function parseRecipientDomain(rawAddress: string): { readonly normalized: string; readonly domain: string } | null {
  if (/[\r\n<>,"';\s]/.test(rawAddress)) {
    return null;
  }
  if (!SAFE_SINGLE_EMAIL_REGEX.test(rawAddress)) {
    return null;
  }
  const atIndex = rawAddress.indexOf('@');
  if (atIndex <= 0 || rawAddress.indexOf('@', atIndex + 1) !== -1) {
    return null;
  }
  const domain = rawAddress.slice(atIndex + 1).toLowerCase();
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return null;
  }
  return {
    normalized: `${rawAddress.slice(0, atIndex)}@${domain}`,
    domain,
  };
}

function isDomainAllowlisted(domain: string, allowlistedDomains: readonly string[]): boolean {
  for (const rawPattern of allowlistedDomains) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) {
      continue;
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (suffix.length > 0 && (domain === suffix || domain.endsWith(`.${suffix}`))) {
        return true;
      }
    } else if (domain === pattern) {
      return true;
    }
  }
  return false;
}

export class ControlledSandboxMailboxTransport implements EmailDeliveryTransport {
  private readonly allowlistedDomains: readonly string[];
  private readonly allowlistedAddresses: ReadonlySet<string>;
  private readonly auditSink: NotificationsAuditSink | undefined;
  private readonly clock: Clock;
  private readonly deliveredMessages: StoredSandboxEmailMessage[] = [];
  private simulatedTransientFailuresRemaining = 0;

  constructor(options: ControlledSandboxMailboxTransportOptions = {}) {
    this.allowlistedDomains = Object.freeze(
      options.allowlistedDomains
        ? [...options.allowlistedDomains]
        : ['pap.local', '*.pap.local', 'example.test'],
    );
    this.allowlistedAddresses = new Set(
      (options.allowlistedAddresses ?? []).map((addr) => addr.trim().toLowerCase()),
    );
    this.auditSink = options.auditSink;
    this.clock = options.clock ?? systemClock;
  }

  /** Test helper to simulate temporary SMTP / network outages for retry/backoff verification. */
  simulateNextTransientFailures(count: number): void {
    this.simulatedTransientFailuresRemaining = Math.max(0, Math.floor(count));
  }

  listDeliveredMessages(): readonly StoredSandboxEmailMessage[] {
    return [...this.deliveredMessages];
  }

  clear(): void {
    this.deliveredMessages.length = 0;
  }

  async sendEmail(
    email: RenderedAuxiliaryEmail,
    metadata: {
      readonly outboxId: string;
      readonly deduplicationKey: string;
      readonly tenantId: string;
      readonly legalEntityId: string;
    },
  ): Promise<EmailTransportDeliveryResult> {
    const nowIso = this.clock.now().toISOString();
    const parsedRecipient = parseRecipientDomain(email.toAddress);

    const isAllowed =
      parsedRecipient !== null &&
      (this.allowlistedAddresses.has(parsedRecipient.normalized.toLowerCase()) ||
        isDomainAllowlisted(parsedRecipient.domain, this.allowlistedDomains));

    if (!isAllowed) {
      if (this.auditSink) {
        await this.auditSink.record({
          auditEventId: randomUUID(),
          occurredAt: nowIso,
          kind: 'notification_recipient_blocked_by_sandbox_policy',
          tenantId: metadata.tenantId,
          legalEntityId: metadata.legalEntityId,
          userId: null,
          deduplicationKey: metadata.deduplicationKey,
          outboxId: metadata.outboxId,
          maskedRecipient: maskEmailForAudit(email.toAddress),
          outcome: 'deny',
          reasonCode: 'blocked_recipient_policy',
        });
      }
      return {
        ok: false,
        outcome: 'blocked_recipient_policy',
        errorCode: 'blocked_recipient_policy',
        errorMessage:
          'Adres odbiorcy spoza dozwolonej listy domen testowych został zablokowany (fail-closed).',
      };
    }

    if (this.simulatedTransientFailuresRemaining > 0) {
      this.simulatedTransientFailuresRemaining -= 1;
      return {
        ok: false,
        outcome: 'transient_failure',
        errorCode: 'sandbox_transient_smtp_unavailable',
        errorMessage: 'Tymczasowy błąd połączenia z serwerem pocztowym (symulowany).',
      };
    }

    const messageId = `<${randomUUID()}@sandbox.pap.local>`;
    const boundary = `pap-mime-${randomBytes(8).toString('hex')}`;
    const formattedFrom = `"${email.fromDisplayName}" <${email.fromAddress}>`;
    const extraHeaderLines = Object.entries(email.headers).map(
      ([key, val]) => `${key.replace(/[\r\n:]/g, '')}: ${val.replace(/[\r\n]/g, '')}`,
    );

    const rawRfc822 = [
      `Date: ${new Date(nowIso).toUTCString()}`,
      `Message-ID: ${messageId}`,
      `From: ${formattedFrom}`,
      `To: <${parsedRecipient.normalized}>`,
      `Subject: ${email.subject.replace(/[\r\n]/g, ' ')}`,
      'MIME-Version: 1.0',
      ...extraHeaderLines,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      email.textBody,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      email.htmlBody,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const stored: StoredSandboxEmailMessage = Object.freeze({
      messageId,
      outboxId: metadata.outboxId,
      deduplicationKey: metadata.deduplicationKey,
      deliveredAt: nowIso,
      from: formattedFrom,
      to: parsedRecipient.normalized,
      subject: email.subject,
      textBody: email.textBody,
      htmlBody: email.htmlBody,
      headers: Object.freeze({ ...email.headers }),
      rawRfc822,
    });

    this.deliveredMessages.push(stored);

    return {
      ok: true,
      outcome: 'sent',
      providerMessageId: messageId,
    };
  }
}

interface StoredOptOutToken {
  readonly tokenId: string;
  readonly tokenSha256Hex: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly userId: string;
  readonly expiresAtMs: number;
  usedAtIso: string | null;
}

export interface NotificationsEngineOptions {
  readonly transport: EmailDeliveryTransport;
  readonly auditSink?: NotificationsAuditSink | undefined;
  readonly clock?: Clock | undefined;
  readonly defaultMaxAttempts?: number | undefined;
  readonly baseRetryBackoffMs?: number | undefined;
  readonly maxRetryBackoffMs?: number | undefined;
  readonly fromAddress?: string | undefined;
}

export interface EnqueueScheduledRemindersInput {
  readonly evaluationDate: string;
  readonly userId: string;
  readonly recipientEmail: string;
  readonly obligations: readonly NotificationObligationInput[];
}

export interface EnqueueScheduledRemindersResult {
  readonly enqueuedEntries: readonly NotificationOutboxEntry[];
  readonly skippedDuplicatesCount: number;
  readonly skippedByPreferencesCount: number;
  readonly skippedCompletedCount: number;
  readonly skippedUnverifiedRulesCount: number;
}

export type ApplyOptOutResult =
  | {
      readonly ok: true;
      readonly preferences: NotificationPreferences;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_opt_out_token'
        | 'opt_out_token_expired'
        | 'opt_out_token_already_used';
    };

export interface ProcessOutboxSummary {
  readonly processedCount: number;
  readonly sentCount: number;
  readonly retryScheduledCount: number;
  readonly deadLetteredCount: number;
  readonly blockedByPolicyCount: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeHexEquals(leftHex: string, rightHex: string): boolean {
  if (leftHex.length !== rightHex.length) {
    return false;
  }
  const leftBuf = Buffer.from(leftHex, 'hex');
  const rightBuf = Buffer.from(rightHex, 'hex');
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function resolveStageForEvaluationDate(
  evaluationDate: string,
  dueDate: string,
): ReminderStage | null {
  const daysUntilDue = diffCalendarDays(evaluationDate, dueDate);
  if (daysUntilDue === 7) {
    return 'advance_7d';
  }
  if (daysUntilDue === 2) {
    return 'urgent_2d';
  }
  if (daysUntilDue <= -1) {
    return 'overdue_1d';
  }
  return null;
}

function isLegalBasisVerifiedAndActiveForDate(
  obligation: NotificationObligationInput,
): boolean {
  const { legalBasis, dueDate } = obligation;
  if (legalBasis.verificationStatus !== 'verified') {
    return false;
  }
  if (diffCalendarDays(legalBasis.effectiveFrom, dueDate) < 0) {
    return false;
  }
  if (legalBasis.effectiveTo !== null && diffCalendarDays(dueDate, legalBasis.effectiveTo) < 0) {
    return false;
  }
  return true;
}

export class NotificationsEngine {
  private readonly transport: EmailDeliveryTransport;
  private readonly auditSink: NotificationsAuditSink;
  private readonly clock: Clock;
  private readonly defaultMaxAttempts: number;
  private readonly baseRetryBackoffMs: number;
  private readonly maxRetryBackoffMs: number;
  private readonly fromAddress: string;

  private readonly preferencesByKey = new Map<string, NotificationPreferences>();
  private readonly optOutTokens = new Map<string, StoredOptOutToken>();
  private readonly outboxByDedupKey = new Map<string, NotificationOutboxEntry>();
  private readonly outboxById = new Map<string, NotificationOutboxEntry>();

  constructor(options: NotificationsEngineOptions) {
    this.transport = options.transport;
    this.auditSink = options.auditSink ?? new InMemoryNotificationsAuditSink();
    this.clock = options.clock ?? systemClock;
    this.defaultMaxAttempts = Math.max(1, options.defaultMaxAttempts ?? 3);
    this.baseRetryBackoffMs = Math.max(1_000, options.baseRetryBackoffMs ?? 60_000);
    this.maxRetryBackoffMs = Math.max(
      this.baseRetryBackoffMs,
      options.maxRetryBackoffMs ?? 3_600_000,
    );
    this.fromAddress = options.fromAddress ?? 'powiadomienia@pap.local';
  }

  private prefKey(tenantIdVal: string, legalEntityIdVal: string, userIdVal: string): string {
    const t = parseTenantId(tenantIdVal);
    const e = parseLegalEntityId(legalEntityIdVal);
    const u = parseUserId(userIdVal);
    return `${t}:${e}:${u}`;
  }

  getOrDefaultPreferences(input: {
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly userId: string;
    readonly recipientEmail: string;
  }): NotificationPreferences {
    const key = this.prefKey(input.tenantId, input.legalEntityId, input.userId);
    const existing = this.preferencesByKey.get(key);
    if (existing) {
      return existing;
    }
    const disabledStages = deriveDisabledStages({
      frequency: 'standard',
      optionalRemindersOptedOut: false,
    });
    const created = NotificationPreferencesSchema.parse({
      tenantId: parseTenantId(input.tenantId),
      legalEntityId: parseLegalEntityId(input.legalEntityId),
      userId: parseUserId(input.userId),
      recipientEmail: input.recipientEmail.trim(),
      channel: 'email',
      frequency: 'standard',
      optionalRemindersOptedOut: false,
      disabledStages,
      disabledAlertsSummaryPl: computeDisabledAlertsSummaryPl(disabledStages),
      updatedAt: this.clock.now().toISOString(),
    });
    this.preferencesByKey.set(key, created);
    return created;
  }

  async configurePreferences(input: {
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly userId: string;
    readonly recipientEmail: string;
    readonly frequency: NotificationFrequency;
    readonly optionalRemindersOptedOut: boolean;
    readonly explicitDisabledStages?: readonly ReminderStage[] | undefined;
  }): Promise<NotificationPreferences> {
    const key = this.prefKey(input.tenantId, input.legalEntityId, input.userId);
    const disabledStages = deriveDisabledStages({
      frequency: input.frequency,
      optionalRemindersOptedOut: input.optionalRemindersOptedOut,
      explicitDisabledStages: input.explicitDisabledStages,
    });
    const nowIso = this.clock.now().toISOString();
    const updated = NotificationPreferencesSchema.parse({
      tenantId: parseTenantId(input.tenantId),
      legalEntityId: parseLegalEntityId(input.legalEntityId),
      userId: parseUserId(input.userId),
      recipientEmail: input.recipientEmail.trim(),
      channel: 'email',
      frequency: input.frequency,
      optionalRemindersOptedOut: input.optionalRemindersOptedOut,
      disabledStages,
      disabledAlertsSummaryPl: computeDisabledAlertsSummaryPl(disabledStages),
      updatedAt: nowIso,
    });
    this.preferencesByKey.set(key, updated);

    await this.auditSink.record({
      auditEventId: randomUUID(),
      occurredAt: nowIso,
      kind: 'notification_preferences_updated',
      tenantId: updated.tenantId,
      legalEntityId: updated.legalEntityId,
      userId: updated.userId,
      deduplicationKey: null,
      outboxId: null,
      maskedRecipient: maskEmailForAudit(updated.recipientEmail),
      outcome: 'allow',
      reasonCode: updated.optionalRemindersOptedOut ? 'optional_opted_out' : 'preferences_saved',
    });

    return updated;
  }

  async issueOptOutToken(input: {
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly userId: string;
    readonly recipientEmail: string;
    readonly ttlMinutes?: number | undefined;
  }): Promise<{
    readonly tokenId: string;
    readonly rawOptOutToken: string;
    readonly expiresAt: string;
  }> {
    this.getOrDefaultPreferences({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      userId: input.userId,
      recipientEmail: input.recipientEmail,
    });

    const t = parseTenantId(input.tenantId);
    const e = parseLegalEntityId(input.legalEntityId);
    const u = parseUserId(input.userId);
    const now = this.clock.now();
    const ttlMs = Math.max(1, input.ttlMinutes ?? 60 * 24 * 7) * 60_000;
    const expiresAtMs = now.getTime() + ttlMs;
    const tokenId = randomUUID();
    const secretPart = randomBytes(24).toString('base64url');
    const rawOptOutToken = `pap_optout_${tokenId}.${secretPart}`;

    this.optOutTokens.set(tokenId, {
      tokenId,
      tokenSha256Hex: sha256Hex(rawOptOutToken),
      tenantId: t,
      legalEntityId: e,
      userId: u,
      expiresAtMs,
      usedAtIso: null,
    });

    await this.auditSink.record({
      auditEventId: randomUUID(),
      occurredAt: now.toISOString(),
      kind: 'notification_opt_out_token_issued',
      tenantId: t,
      legalEntityId: e,
      userId: u,
      deduplicationKey: null,
      outboxId: null,
      maskedRecipient: maskEmailForAudit(input.recipientEmail),
      outcome: 'allow',
      reasonCode: 'one_time_opt_out_token_created',
    });

    return {
      tokenId,
      rawOptOutToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async applyOptOutWithToken(input: {
    readonly rawOptOutToken: string;
    readonly disableOverdueAlerts?: boolean | undefined;
  }): Promise<ApplyOptOutResult> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const match = /^pap_optout_([0-9a-f-]{36})\.[A-Za-z0-9_-]{16,}$/i.exec(
      input.rawOptOutToken.trim(),
    );

    if (!match?.[1]) {
      await this.auditSink.record({
        auditEventId: randomUUID(),
        occurredAt: nowIso,
        kind: 'notification_opt_out_rejected',
        tenantId: null,
        legalEntityId: null,
        userId: null,
        deduplicationKey: null,
        outboxId: null,
        maskedRecipient: null,
        outcome: 'deny',
        reasonCode: 'invalid_opt_out_token',
      });
      return { ok: false, reason: 'invalid_opt_out_token' };
    }

    const record = this.optOutTokens.get(match[1].toLowerCase());
    const providedHash = sha256Hex(input.rawOptOutToken.trim());

    if (!record || !constantTimeHexEquals(record.tokenSha256Hex, providedHash)) {
      await this.auditSink.record({
        auditEventId: randomUUID(),
        occurredAt: nowIso,
        kind: 'notification_opt_out_rejected',
        tenantId: record?.tenantId ?? null,
        legalEntityId: record?.legalEntityId ?? null,
        userId: record?.userId ?? null,
        deduplicationKey: null,
        outboxId: null,
        maskedRecipient: null,
        outcome: 'deny',
        reasonCode: 'invalid_opt_out_token',
      });
      return { ok: false, reason: 'invalid_opt_out_token' };
    }

    if (record.usedAtIso !== null) {
      await this.auditSink.record({
        auditEventId: randomUUID(),
        occurredAt: nowIso,
        kind: 'notification_opt_out_rejected',
        tenantId: record.tenantId,
        legalEntityId: record.legalEntityId,
        userId: record.userId,
        deduplicationKey: null,
        outboxId: null,
        maskedRecipient: null,
        outcome: 'deny',
        reasonCode: 'opt_out_token_already_used',
      });
      return { ok: false, reason: 'opt_out_token_already_used' };
    }

    if (now.getTime() >= record.expiresAtMs) {
      await this.auditSink.record({
        auditEventId: randomUUID(),
        occurredAt: nowIso,
        kind: 'notification_opt_out_rejected',
        tenantId: record.tenantId,
        legalEntityId: record.legalEntityId,
        userId: record.userId,
        deduplicationKey: null,
        outboxId: null,
        maskedRecipient: null,
        outcome: 'deny',
        reasonCode: 'opt_out_token_expired',
      });
      return { ok: false, reason: 'opt_out_token_expired' };
    }

    record.usedAtIso = nowIso;

    const key = this.prefKey(record.tenantId, record.legalEntityId, record.userId);
    const current = this.preferencesByKey.get(key);
    const recipientEmail = current?.recipientEmail ?? 'opted-out@pap.local';
    const explicitDisabled: ReminderStage[] = input.disableOverdueAlerts
      ? ['advance_7d', 'urgent_2d', 'overdue_1d']
      : ['advance_7d', 'urgent_2d'];

    const disabledStages = deriveDisabledStages({
      frequency: current?.frequency ?? 'overdue_only',
      optionalRemindersOptedOut: true,
      explicitDisabledStages: explicitDisabled,
    });

    const updated = NotificationPreferencesSchema.parse({
      tenantId: record.tenantId,
      legalEntityId: record.legalEntityId,
      userId: record.userId,
      recipientEmail,
      channel: 'email',
      frequency: 'overdue_only',
      optionalRemindersOptedOut: true,
      disabledStages,
      disabledAlertsSummaryPl: computeDisabledAlertsSummaryPl(disabledStages),
      updatedAt: nowIso,
    });

    this.preferencesByKey.set(key, updated);

    await this.auditSink.record({
      auditEventId: randomUUID(),
      occurredAt: nowIso,
      kind: 'notification_opt_out_applied',
      tenantId: record.tenantId,
      legalEntityId: record.legalEntityId,
      userId: record.userId,
      deduplicationKey: null,
      outboxId: null,
      maskedRecipient: maskEmailForAudit(recipientEmail),
      outcome: 'allow',
      reasonCode: 'one_time_opt_out_applied',
    });

    return { ok: true, preferences: updated };
  }

  async enqueueScheduledReminders(
    input: EnqueueScheduledRemindersInput,
  ): Promise<EnqueueScheduledRemindersResult> {
    parseIsoDateToUtcMidnightMs(input.evaluationDate);
    const normalizedUserId = parseUserId(input.userId);

    const enqueuedEntries: NotificationOutboxEntry[] = [];
    let skippedDuplicatesCount = 0;
    let skippedByPreferencesCount = 0;
    let skippedCompletedCount = 0;
    let skippedUnverifiedRulesCount = 0;

    for (const rawObligation of input.obligations) {
      const obligation = NotificationObligationInputSchema.parse(rawObligation);

      if (obligation.completed) {
        skippedCompletedCount += 1;
        continue;
      }

      if (!isLegalBasisVerifiedAndActiveForDate(obligation)) {
        skippedUnverifiedRulesCount += 1;
        continue;
      }

      const stage = resolveStageForEvaluationDate(input.evaluationDate, obligation.dueDate);
      if (stage === null) {
        continue;
      }

      const preferences = this.getOrDefaultPreferences({
        tenantId: obligation.tenantId,
        legalEntityId: obligation.legalEntityId,
        userId: normalizedUserId,
        recipientEmail: input.recipientEmail,
      });

      if (preferences.disabledStages.includes(stage)) {
        skippedByPreferencesCount += 1;
        continue;
      }

      const deduplicationKey = buildNotificationDeduplicationKey({
        tenantId: obligation.tenantId,
        legalEntityId: obligation.legalEntityId,
        userId: normalizedUserId,
        obligationId: obligation.obligationId,
        dueDate: obligation.dueDate,
        stage,
      });

      if (this.outboxByDedupKey.has(deduplicationKey)) {
        skippedDuplicatesCount += 1;
        continue;
      }

      const email = renderAuxiliaryReminderEmail({
        obligation,
        stage,
        toAddress: preferences.recipientEmail,
        fromAddress: this.fromAddress,
        preferences,
      });

      const nowIso = this.clock.now().toISOString();
      const outboxId = randomUUID();
      const entry: NotificationOutboxEntry = {
        outboxId,
        deduplicationKey,
        tenantId: obligation.tenantId,
        legalEntityId: obligation.legalEntityId,
        userId: normalizedUserId,
        obligationId: obligation.obligationId,
        stage,
        scheduledForDate: input.evaluationDate,
        status: 'pending',
        retryCount: 0,
        maxAttempts: this.defaultMaxAttempts,
        nextAttemptAt: nowIso,
        createdAt: nowIso,
        lastUpdatedAt: nowIso,
        email,
        attempts: [],
      };

      this.outboxByDedupKey.set(deduplicationKey, entry);
      this.outboxById.set(outboxId, entry);
      enqueuedEntries.push(this.cloneOutboxEntry(entry));

      await this.auditSink.record({
        auditEventId: randomUUID(),
        occurredAt: nowIso,
        kind: 'notification_outbox_enqueued',
        tenantId: entry.tenantId,
        legalEntityId: entry.legalEntityId,
        userId: entry.userId,
        deduplicationKey: entry.deduplicationKey,
        outboxId: entry.outboxId,
        maskedRecipient: maskEmailForAudit(entry.email.toAddress),
        outcome: 'allow',
        reasonCode: `scheduled_${stage}`,
      });
    }

    return {
      enqueuedEntries,
      skippedDuplicatesCount,
      skippedByPreferencesCount,
      skippedCompletedCount,
      skippedUnverifiedRulesCount,
    };
  }

  async processDueOutboxMessages(): Promise<ProcessOutboxSummary> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    let processedCount = 0;
    let sentCount = 0;
    let retryScheduledCount = 0;
    let deadLetteredCount = 0;
    let blockedByPolicyCount = 0;

    for (const entry of this.outboxById.values()) {
      const isDue =
        entry.status === 'pending' ||
        (entry.status === 'retry_scheduled' &&
          entry.nextAttemptAt !== null &&
          new Date(entry.nextAttemptAt).getTime() <= nowMs);

      if (!isDue) {
        continue;
      }

      processedCount += 1;
      const attemptNumber = entry.attempts.length + 1;

      let deliveryResult: EmailTransportDeliveryResult;
      try {
        deliveryResult = await this.transport.sendEmail(entry.email, {
          outboxId: entry.outboxId,
          deduplicationKey: entry.deduplicationKey,
          tenantId: entry.tenantId,
          legalEntityId: entry.legalEntityId,
        });
      } catch (err) {
        deliveryResult = {
          ok: false,
          outcome: 'transient_failure',
          errorCode: 'transport_exception',
          errorMessage: err instanceof Error ? err.message : 'Unknown transport failure',
        };
      }

      if (deliveryResult.ok) {
        const attempt: DeliveryAttemptRecord = {
          attemptNumber,
          attemptedAt: nowIso,
          outcome: 'sent',
          providerMessageId: deliveryResult.providerMessageId,
          errorCode: null,
          errorMessageRedacted: null,
        };
        this.mutateOutboxEntry(entry.outboxId, {
          status: 'sent',
          nextAttemptAt: null,
          lastUpdatedAt: nowIso,
          attempts: [...entry.attempts, attempt],
        });
        sentCount += 1;

        await this.auditSink.record({
          auditEventId: randomUUID(),
          occurredAt: nowIso,
          kind: 'notification_delivered',
          tenantId: entry.tenantId,
          legalEntityId: entry.legalEntityId,
          userId: entry.userId,
          deduplicationKey: entry.deduplicationKey,
          outboxId: entry.outboxId,
          maskedRecipient: maskEmailForAudit(entry.email.toAddress),
          outcome: 'allow',
          reasonCode: 'delivered',
        });
        continue;
      }

      const redactedError = redactErrorText(deliveryResult.errorMessage);

      if (deliveryResult.outcome === 'blocked_recipient_policy') {
        const attempt: DeliveryAttemptRecord = {
          attemptNumber,
          attemptedAt: nowIso,
          outcome: 'blocked_recipient_policy',
          providerMessageId: null,
          errorCode: deliveryResult.errorCode,
          errorMessageRedacted: redactedError,
        };
        this.mutateOutboxEntry(entry.outboxId, {
          status: 'blocked_recipient_policy',
          nextAttemptAt: null,
          lastUpdatedAt: nowIso,
          attempts: [...entry.attempts, attempt],
        });
        blockedByPolicyCount += 1;
        continue;
      }

      const nextRetryCount = entry.retryCount + 1;
      if (nextRetryCount >= entry.maxAttempts) {
        const attempt: DeliveryAttemptRecord = {
          attemptNumber,
          attemptedAt: nowIso,
          outcome: 'dead_letter',
          providerMessageId: null,
          errorCode: deliveryResult.errorCode,
          errorMessageRedacted: redactedError,
        };
        this.mutateOutboxEntry(entry.outboxId, {
          status: 'dead_letter',
          retryCount: nextRetryCount,
          nextAttemptAt: null,
          lastUpdatedAt: nowIso,
          attempts: [...entry.attempts, attempt],
        });
        deadLetteredCount += 1;

        await this.auditSink.record({
          auditEventId: randomUUID(),
          occurredAt: nowIso,
          kind: 'notification_dead_lettered',
          tenantId: entry.tenantId,
          legalEntityId: entry.legalEntityId,
          userId: entry.userId,
          deduplicationKey: entry.deduplicationKey,
          outboxId: entry.outboxId,
          maskedRecipient: maskEmailForAudit(entry.email.toAddress),
          outcome: 'error',
          reasonCode: deliveryResult.errorCode,
        });
      } else {
        const backoffDelayMs = Math.min(
          this.maxRetryBackoffMs,
          this.baseRetryBackoffMs * Math.pow(2, nextRetryCount - 1),
        );
        const nextAttemptAtIso = new Date(nowMs + backoffDelayMs).toISOString();
        const attempt: DeliveryAttemptRecord = {
          attemptNumber,
          attemptedAt: nowIso,
          outcome: 'transient_failure',
          providerMessageId: null,
          errorCode: deliveryResult.errorCode,
          errorMessageRedacted: redactedError,
        };
        this.mutateOutboxEntry(entry.outboxId, {
          status: 'retry_scheduled',
          retryCount: nextRetryCount,
          nextAttemptAt: nextAttemptAtIso,
          lastUpdatedAt: nowIso,
          attempts: [...entry.attempts, attempt],
        });
        retryScheduledCount += 1;

        await this.auditSink.record({
          auditEventId: randomUUID(),
          occurredAt: nowIso,
          kind: 'notification_retry_scheduled',
          tenantId: entry.tenantId,
          legalEntityId: entry.legalEntityId,
          userId: entry.userId,
          deduplicationKey: entry.deduplicationKey,
          outboxId: entry.outboxId,
          maskedRecipient: maskEmailForAudit(entry.email.toAddress),
          outcome: 'error',
          reasonCode: deliveryResult.errorCode,
        });
      }
    }

    return {
      processedCount,
      sentCount,
      retryScheduledCount,
      deadLetteredCount,
      blockedByPolicyCount,
    };
  }

  listOutboxEntries(filter?: {
    readonly tenantId?: string | undefined;
    readonly legalEntityId?: string | undefined;
    readonly status?: OutboxMessageStatus | undefined;
  }): readonly NotificationOutboxEntry[] {
    const result: NotificationOutboxEntry[] = [];
    for (const entry of this.outboxById.values()) {
      if (filter?.tenantId && entry.tenantId !== filter.tenantId.toLowerCase()) {
        continue;
      }
      if (filter?.legalEntityId && entry.legalEntityId !== filter.legalEntityId.toLowerCase()) {
        continue;
      }
      if (filter?.status && entry.status !== filter.status) {
        continue;
      }
      result.push(this.cloneOutboxEntry(entry));
    }
    return result;
  }

  private mutateOutboxEntry(
    outboxId: string,
    patch: Partial<
      Pick<
        NotificationOutboxEntry,
        'status' | 'retryCount' | 'nextAttemptAt' | 'lastUpdatedAt' | 'attempts'
      >
    >,
  ): void {
    const existing = this.outboxById.get(outboxId);
    if (!existing) {
      return;
    }
    const updated: NotificationOutboxEntry = {
      ...existing,
      ...patch,
    };
    this.outboxById.set(outboxId, updated);
    this.outboxByDedupKey.set(updated.deduplicationKey, updated);
  }

  private cloneOutboxEntry(entry: NotificationOutboxEntry): NotificationOutboxEntry {
    return {
      ...entry,
      email: {
        ...entry.email,
        headers: { ...entry.email.headers },
      },
      attempts: entry.attempts.map((a) => ({ ...a })),
    };
  }
}
