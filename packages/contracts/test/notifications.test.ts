import { describe, expect, it } from 'vitest';
import {
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  NotificationPreferencesSchema,
  RenderedAuxiliaryEmailSchema,
  SafeEmailAddressSchema,
  SafeSenderEmailAddressSchema,
} from '../src/notifications.js';

describe('Notification contracts', () => {
  it('enforces exact non-impersonating sender display name, single-address format, and auxiliary footer constant', () => {
    expect(MANDATORY_AUXILIARY_EMAIL_FOOTER_PL).toContain(
      'Wiadomość nie pochodzi z urzędu skarbowego, Ministerstwa Finansów ani ZUS.',
    );

    expect(
      RenderedAuxiliaryEmailSchema.safeParse({
        fromAddress: 'powiadomienia@pap.local',
        fromDisplayName: 'Urząd Skarbowy',
        toAddress: 'ksiegowosc@pap.local',
        subject: 'Przypomnienie',
        textBody: 'Treść',
        htmlBody: '<p>Treść</p>',
        headers: {},
      }).success,
    ).toBe(false);

    // Reject Punycode xn-- or authority domain in sender
    expect(SafeSenderEmailAddressSchema.safeParse('powiadomienia@xn--gov-9la.pl').success).toBe(
      false,
    );
    expect(SafeSenderEmailAddressSchema.safeParse('powiadomienia@mf.gov.pl').success).toBe(false);

    // Reject CRLF, angle brackets, and comma-separated multiple recipients
    expect(SafeEmailAddressSchema.safeParse('alert@pap.local\r\nBcc: evil@pap.local').success).toBe(
      false,
    );
    expect(SafeEmailAddressSchema.safeParse('<alert@pap.local>').success).toBe(false);
    expect(SafeEmailAddressSchema.safeParse('a@pap.local, b@pap.local').success).toBe(false);

    expect(
      RenderedAuxiliaryEmailSchema.safeParse({
        fromAddress: 'powiadomienia@pap.local',
        fromDisplayName: 'Polish Accounting Platform (Powiadomienia)',
        toAddress: 'ksiegowosc@pap.local',
        subject: 'Przypomnienie o terminie JPK_V7M',
        textBody: `Treść\n${MANDATORY_AUXILIARY_EMAIL_FOOTER_PL}`,
        htmlBody: `<p>Treść</p><footer>${MANDATORY_AUXILIARY_EMAIL_FOOTER_PL}</footer>`,
        headers: { 'Auto-Submitted': 'auto-generated' },
      }).success,
    ).toBe(true);
  });

  it('validates user notification preferences including disabled alerts summary', () => {
    const prefs = NotificationPreferencesSchema.parse({
      tenantId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: '22222222-2222-4222-8222-222222222222',
      userId: '55555555-5555-4555-8555-555555555555',
      recipientEmail: 'alert@pap.local',
      channel: 'email',
      frequency: 'overdue_only',
      optionalRemindersOptedOut: true,
      disabledStages: ['advance_7d', 'urgent_2d'],
      disabledAlertsSummaryPl:
        'Wyłączone powiadomienia opcjonalne: wyprzedzające (-7 dni), pilne (-2 dni).',
      updatedAt: '2026-11-04T09:00:00Z',
    });

    expect(prefs.optionalRemindersOptedOut).toBe(true);
    expect(prefs.disabledStages).toEqual(['advance_7d', 'urgent_2d']);
  });
});
