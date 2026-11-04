import { describe, expect, it } from 'vitest';
import {
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  type NotificationObligationInput,
} from '@pap/contracts/notifications';
import {
  ControlledSandboxMailboxTransport,
  InMemoryNotificationsAuditSink,
  NotificationsEngine,
  renderAuxiliaryReminderEmail,
} from '../src/notifications-engine.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const ENTITY_A = '22222222-2222-4222-8222-222222222222';
const USER_A = '55555555-5555-4555-8555-555555555555';
const OBLIGATION_JPK = '77777777-7777-4777-8777-777777777777';
const OBLIGATION_ZUS = '88888888-8888-4888-8888-888888888888';

function createSampleObligation(
  overrides: Partial<NotificationObligationInput> = {},
): NotificationObligationInput {
  return {
    obligationId: OBLIGATION_JPK,
    tenantId: TENANT_A,
    legalEntityId: ENTITY_A,
    companyMaskedNip: '******8901',
    companyProfileLabelPl: 'JDG — KPiR (czynny podatnik VAT)',
    code: 'JPK_V7M',
    namePl: 'Jednolity Plik Kontrolny JPK_V7M za październik 2026',
    dueDate: '2026-11-25',
    completed: false,
    legalBasis: {
      ruleId: 'VAT_JPK_V7M_2026',
      ruleVersion: '2026.1',
      actTitle: 'Ustawa o podatku od towarów i usług',
      articleRef: 'art. 109 ust. 3b',
      journalOfLawsRef: 'Dz.U. 2024 poz. 361 ze zm.',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
      effectiveFrom: '2020-10-01',
      effectiveTo: null,
      verificationStatus: 'verified',
    },
    ...overrides,
  };
}

describe('NotificationsEngine & ControlledSandboxMailboxTransport', () => {
  it('generates -7d, -2d, and +1d overdue reminders from verified rules and skips completed or unverified rules', async () => {
    let currentTime = new Date('2026-11-18T08:00:00Z');
    const clock = { now: () => currentTime };
    const auditSink = new InMemoryNotificationsAuditSink();
    const mailbox = new ControlledSandboxMailboxTransport({ auditSink, clock });
    const engine = new NotificationsEngine({ transport: mailbox, auditSink, clock });

    const jpkObligation = createSampleObligation({ dueDate: '2026-11-25' });
    const completedZus = createSampleObligation({
      obligationId: OBLIGATION_ZUS,
      code: 'ZUS_DRA',
      dueDate: '2026-11-25',
      completed: true,
    });
    const unverifiedRuleObligation = createSampleObligation({
      obligationId: '99999999-9999-4999-8999-999999999999',
      code: 'EXP_TAX',
      dueDate: '2026-11-25',
      legalBasis: {
        ...jpkObligation.legalBasis,
        verificationStatus: 'experimental',
      },
    });

    // -7 days before 2026-11-25 -> 2026-11-18
    const advResult = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-18',
      userId: USER_A,
      recipientEmail: 'ksiegowa@pap.local',
      obligations: [jpkObligation, completedZus, unverifiedRuleObligation],
    });

    expect(advResult.enqueuedEntries).toHaveLength(1);
    expect(advResult.enqueuedEntries[0]?.stage).toBe('advance_7d');
    expect(advResult.skippedCompletedCount).toBe(1);
    expect(advResult.skippedUnverifiedRulesCount).toBe(1);

    // -2 days before 2026-11-25 -> 2026-11-23
    currentTime = new Date('2026-11-23T08:00:00Z');
    const urgentResult = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-23',
      userId: USER_A,
      recipientEmail: 'ksiegowa@pap.local',
      obligations: [jpkObligation],
    });
    expect(urgentResult.enqueuedEntries).toHaveLength(1);
    expect(urgentResult.enqueuedEntries[0]?.stage).toBe('urgent_2d');

    // +1 day overdue -> 2026-11-26
    currentTime = new Date('2026-11-26T08:00:00Z');
    const overdueResult = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-26',
      userId: USER_A,
      recipientEmail: 'ksiegowa@pap.local',
      obligations: [jpkObligation],
    });
    expect(overdueResult.enqueuedEntries).toHaveLength(1);
    expect(overdueResult.enqueuedEntries[0]?.stage).toBe('overdue_1d');

    const delivery = await engine.processDueOutboxMessages();
    expect(delivery.sentCount).toBe(3);
    expect(mailbox.listDeliveredMessages()).toHaveLength(3);
  });

  it('guarantees outbox idempotency (no duplicate emails when scheduler runs multiple times)', async () => {
    const clock = { now: () => new Date('2026-11-18T09:00:00Z') };
    const mailbox = new ControlledSandboxMailboxTransport({ clock });
    const engine = new NotificationsEngine({ transport: mailbox, clock });
    const obligation = createSampleObligation({ dueDate: '2026-11-25' });

    const first = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-18',
      userId: USER_A,
      recipientEmail: 'alert@staging.pap.local',
      obligations: [obligation],
    });
    const second = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-18',
      userId: USER_A,
      recipientEmail: 'alert@staging.pap.local',
      obligations: [obligation],
    });

    expect(first.enqueuedEntries).toHaveLength(1);
    expect(second.enqueuedEntries).toHaveLength(0);
    expect(second.skippedDuplicatesCount).toBe(1);

    await engine.processDueOutboxMessages();
    await engine.processDueOutboxMessages();
    expect(mailbox.listDeliveredMessages()).toHaveLength(1);
  });

  it('renders Polish HTML & Plain Text emails with legal basis, masked company ID, privacy-safe headers, and anti-impersonation footer', () => {
    const clock = { now: () => new Date('2026-11-18T09:00:00Z') };
    const mailbox = new ControlledSandboxMailboxTransport({ clock });
    const engine = new NotificationsEngine({ transport: mailbox, clock });
    const prefs = engine.getOrDefaultPreferences({
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A,
      userId: USER_A,
      recipientEmail: 'biuro@example.test',
    });

    const obligation = createSampleObligation({
      namePl: 'JPK_V7M <test-escaping>',
    });
    const rendered = renderAuxiliaryReminderEmail({
      obligation,
      stage: 'urgent_2d',
      toAddress: 'biuro@example.test',
      preferences: prefs,
    });

    expect(rendered.fromDisplayName).toBe('Polish Accounting Platform (Powiadomienia)');
    expect(rendered.subject).toContain('JPK_V7M');
    expect(rendered.subject).toContain('2026-11-25');
    expect(rendered.subject).toContain('******8901');
    // Subject and headers must never leak full 10-digit NIP or PLN amounts
    expect(rendered.subject).not.toMatch(/\b\d{10}\b/);
    expect(rendered.subject).not.toContain('PLN');

    expect(rendered.textBody).toContain('art. 109 ust. 3b');
    expect(rendered.textBody).toContain('Dz.U. 2024 poz. 361');
    expect(rendered.textBody).toContain('https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361');
    expect(rendered.textBody).toContain(MANDATORY_AUXILIARY_EMAIL_FOOTER_PL);

    expect(rendered.htmlBody).toContain('&lt;test-escaping&gt;');
    expect(rendered.htmlBody).not.toContain('<test-escaping>');
    expect(rendered.htmlBody).toContain(MANDATORY_AUXILIARY_EMAIL_FOOTER_PL);

    // Reject sender address impersonating tax authorities
    expect(() =>
      renderAuxiliaryReminderEmail({
        obligation,
        stage: 'urgent_2d',
        toAddress: 'biuro@example.test',
        fromAddress: 'powiadomienia@mf.gov.pl',
        preferences: prefs,
      }),
    ).toThrow();
  });

  it('supports user preference frequency and one-time opt-out token with clear disabled-alerts summary', async () => {
    let nowMs = Date.parse('2026-11-18T09:00:00Z');
    const clock = { now: () => new Date(nowMs) };
    const auditSink = new InMemoryNotificationsAuditSink();
    const mailbox = new ControlledSandboxMailboxTransport({ auditSink, clock });
    const engine = new NotificationsEngine({ transport: mailbox, auditSink, clock });

    const issued = await engine.issueOptOutToken({
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A,
      userId: USER_A,
      recipientEmail: 'klient@pap.local',
      ttlMinutes: 60,
    });

    // Tampered token is rejected
    const tampered = await engine.applyOptOutWithToken({
      rawOptOutToken: `${issued.rawOptOutToken}tamper`,
    });
    expect(tampered).toEqual({ ok: false, reason: 'invalid_opt_out_token' });

    // Valid one-time opt-out disables optional advance & urgent reminders while keeping overdue alerts clear
    const applied = await engine.applyOptOutWithToken({
      rawOptOutToken: issued.rawOptOutToken,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.preferences.optionalRemindersOptedOut).toBe(true);
      expect(applied.preferences.disabledStages).toEqual(['advance_7d', 'urgent_2d']);
      expect(applied.preferences.disabledAlertsSummaryPl).toContain('Wyłączone alerty');
      expect(applied.preferences.disabledAlertsSummaryPl).toContain('Aktywne pozostają');
    }

    // Replaying the same one-time token is rejected
    const replay = await engine.applyOptOutWithToken({
      rawOptOutToken: issued.rawOptOutToken,
    });
    expect(replay).toEqual({ ok: false, reason: 'opt_out_token_already_used' });

    // Advance -7d reminder is now suppressed by opt-out, while +1d overdue still works
    const obligation = createSampleObligation({ dueDate: '2026-11-25' });
    const enqAdv = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-18',
      userId: USER_A,
      recipientEmail: 'klient@pap.local',
      obligations: [obligation],
    });
    expect(enqAdv.enqueuedEntries).toHaveLength(0);
    expect(enqAdv.skippedByPreferencesCount).toBe(1);

    nowMs = Date.parse('2026-11-26T09:00:00Z');
    const enqOverdue = await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-26',
      userId: USER_A,
      recipientEmail: 'klient@pap.local',
      obligations: [obligation],
    });
    expect(enqOverdue.enqueuedEntries).toHaveLength(1);
    expect(enqOverdue.enqueuedEntries[0]?.stage).toBe('overdue_1d');
  });

  it('retries transient failures with exponential backoff and moves exhausted messages to dead_letter', async () => {
    let nowMs = Date.parse('2026-11-23T10:00:00Z');
    const clock = { now: () => new Date(nowMs) };
    const auditSink = new InMemoryNotificationsAuditSink();
    const mailbox = new ControlledSandboxMailboxTransport({ auditSink, clock });
    const engine = new NotificationsEngine({
      transport: mailbox,
      auditSink,
      clock,
      defaultMaxAttempts: 3,
      baseRetryBackoffMs: 10_000,
      maxRetryBackoffMs: 60_000,
    });

    const obligation = createSampleObligation({ dueDate: '2026-11-25' });
    await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-23',
      userId: USER_A,
      recipientEmail: 'retry-test@pap.local',
      obligations: [obligation],
    });

    // Simulate 2 transient failures followed by recovery on 3rd attempt
    mailbox.simulateNextTransientFailures(2);

    const run1 = await engine.processDueOutboxMessages();
    expect(run1.retryScheduledCount).toBe(1);
    expect(engine.listOutboxEntries()[0]?.retryCount).toBe(1);

    // Before backoff window (5s < 10s) -> not processed yet
    nowMs += 5_000;
    const prematureRun = await engine.processDueOutboxMessages();
    expect(prematureRun.processedCount).toBe(0);

    // At +10s -> 2nd attempt fails, schedules +20s exponential backoff
    nowMs += 5_000;
    const run2 = await engine.processDueOutboxMessages();
    expect(run2.retryScheduledCount).toBe(1);
    expect(engine.listOutboxEntries()[0]?.retryCount).toBe(2);

    // At +20s -> 3rd attempt succeeds!
    nowMs += 20_000;
    const run3 = await engine.processDueOutboxMessages();
    expect(run3.sentCount).toBe(1);
    const deliveredEntry = engine.listOutboxEntries()[0]!;
    expect(deliveredEntry.status).toBe('sent');
    expect(deliveredEntry.attempts).toHaveLength(3);

    // Now test dead-lettering when all 3 attempts fail
    const deadObligation = createSampleObligation({
      obligationId: OBLIGATION_ZUS,
      code: 'ZUS_DRA',
      dueDate: '2026-11-25',
    });
    await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-23',
      userId: USER_A,
      recipientEmail: 'deadletter@pap.local',
      obligations: [deadObligation],
    });
    mailbox.simulateNextTransientFailures(5);

    await engine.processDueOutboxMessages(); // attempt 1
    nowMs += 10_000;
    await engine.processDueOutboxMessages(); // attempt 2
    nowMs += 20_000;
    const finalRun = await engine.processDueOutboxMessages(); // attempt 3 -> dead_letter
    expect(finalRun.deadLetteredCount).toBe(1);

    const deadEntries = engine.listOutboxEntries({ status: 'dead_letter' });
    expect(deadEntries).toHaveLength(1);
    expect(deadEntries[0]?.attempts).toHaveLength(3);
    expect(deadEntries[0]?.attempts[2]?.outcome).toBe('dead_letter');
  });

  it('enforces fail-closed sandbox domain policy blocking external/real addresses and auditing redaction', async () => {
    const clock = { now: () => new Date('2026-11-23T10:00:00Z') };
    const auditSink = new InMemoryNotificationsAuditSink();
    const mailbox = new ControlledSandboxMailboxTransport({ auditSink, clock });
    const engine = new NotificationsEngine({ transport: mailbox, auditSink, clock });

    const obligation = createSampleObligation({ dueDate: '2026-11-25' });
    await engine.enqueueScheduledReminders({
      evaluationDate: '2026-11-23',
      userId: USER_A,
      recipientEmail: 'jan.kowalski@gmail.com',
      obligations: [obligation],
    });

    const summary = await engine.processDueOutboxMessages();
    expect(summary.blockedByPolicyCount).toBe(1);
    expect(summary.sentCount).toBe(0);
    expect(mailbox.listDeliveredMessages()).toHaveLength(0);

    const blockedEntry = engine.listOutboxEntries({ status: 'blocked_recipient_policy' });
    expect(blockedEntry).toHaveLength(1);

    const policyEvents = auditSink
      .listEvents()
      .filter((e) => e.kind === 'notification_recipient_blocked_by_sandbox_policy');
    expect(policyEvents).toHaveLength(1);
    expect(policyEvents[0]?.maskedRecipient).toBe('j***@gmail.com');
    expect(JSON.stringify(auditSink.listEvents())).not.toContain('jan.kowalski@gmail.com');
  });
});
