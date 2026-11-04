import { z } from 'zod';
import {
  IsoDateSchema,
  IsoUtcTimestampSchema,
  LegalBasisReferenceSchema,
  UuidSelectorSchema,
} from './mcp-tools.js';

export const NotificationChannelSchema = z.enum(['email']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const ReminderStageSchema = z.enum(['advance_7d', 'urgent_2d', 'overdue_1d']);
export type ReminderStage = z.infer<typeof ReminderStageSchema>;

export const NotificationFrequencySchema = z.enum([
  'standard',
  'urgent_only',
  'overdue_only',
]);
export type NotificationFrequency = z.infer<typeof NotificationFrequencySchema>;

export const NotificationPreferencesSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    userId: UuidSelectorSchema,
    recipientEmail: z.string().min(3).max(254),
    channel: NotificationChannelSchema,
    frequency: NotificationFrequencySchema,
    optionalRemindersOptedOut: z.boolean(),
    disabledStages: z.array(ReminderStageSchema),
    disabledAlertsSummaryPl: z.string().min(1),
    updatedAt: IsoUtcTimestampSchema,
  })
  .strict();

export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const NotificationObligationInputSchema = z
  .object({
    obligationId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    companyMaskedNip: z.string().regex(/^\*{6}\d{4}$/),
    companyProfileLabelPl: z.string().min(1).max(160),
    code: z.string().min(1).max(80),
    namePl: z.string().min(1).max(240),
    dueDate: IsoDateSchema,
    completed: z.boolean(),
    legalBasis: LegalBasisReferenceSchema,
  })
  .strict();

export type NotificationObligationInput = z.infer<typeof NotificationObligationInputSchema>;

export const OutboxMessageStatusSchema = z.enum([
  'pending',
  'sent',
  'retry_scheduled',
  'dead_letter',
  'blocked_recipient_policy',
]);

export type OutboxMessageStatus = z.infer<typeof OutboxMessageStatusSchema>;

export const DeliveryAttemptOutcomeSchema = z.enum([
  'sent',
  'transient_failure',
  'dead_letter',
  'blocked_recipient_policy',
]);

export type DeliveryAttemptOutcome = z.infer<typeof DeliveryAttemptOutcomeSchema>;

export const DeliveryAttemptRecordSchema = z
  .object({
    attemptNumber: z.number().int().positive(),
    attemptedAt: IsoUtcTimestampSchema,
    outcome: DeliveryAttemptOutcomeSchema,
    providerMessageId: z.string().nullable(),
    errorCode: z.string().nullable(),
    errorMessageRedacted: z.string().nullable(),
  })
  .strict();

export type DeliveryAttemptRecord = z.infer<typeof DeliveryAttemptRecordSchema>;

export const RenderedAuxiliaryEmailSchema = z
  .object({
    fromAddress: z.string().min(3).max(254),
    fromDisplayName: z.literal('Polish Accounting Platform (Powiadomienia)'),
    toAddress: z.string().min(3).max(254),
    subject: z.string().min(1).max(200),
    textBody: z.string().min(1),
    htmlBody: z.string().min(1),
    headers: z.record(z.string(), z.string()),
  })
  .strict();

export type RenderedAuxiliaryEmail = z.infer<typeof RenderedAuxiliaryEmailSchema>;

export const NotificationOutboxEntrySchema = z
  .object({
    outboxId: UuidSelectorSchema,
    deduplicationKey: z.string().min(1).max(300),
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    userId: UuidSelectorSchema,
    obligationId: UuidSelectorSchema,
    stage: ReminderStageSchema,
    scheduledForDate: IsoDateSchema,
    status: OutboxMessageStatusSchema,
    retryCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    nextAttemptAt: IsoUtcTimestampSchema.nullable(),
    createdAt: IsoUtcTimestampSchema,
    lastUpdatedAt: IsoUtcTimestampSchema,
    email: RenderedAuxiliaryEmailSchema,
    attempts: z.array(DeliveryAttemptRecordSchema),
  })
  .strict();

export type NotificationOutboxEntry = z.infer<typeof NotificationOutboxEntrySchema>;

export const MANDATORY_AUXILIARY_EMAIL_FOOTER_PL =
  'Powiadomienie pomocnicze z aplikacji Polish Accounting Platform. Wiadomość nie pochodzi z urzędu skarbowego, Ministerstwa Finansów ani ZUS.' as const;
