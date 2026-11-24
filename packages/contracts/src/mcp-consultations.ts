import { z } from 'zod';
import {
  IsoUtcTimestampSchema,
  UntrustedDocumentTextEnvelopeSchema,
  UuidSelectorSchema,
  YearMonthSchema,
} from './mcp-tools-core.js';

export const ConsultationCaseTypeSchema = z.enum([
  'question',
  'document_review',
  'correction_request',
  'month_close',
]);
export type ConsultationCaseType = z.infer<typeof ConsultationCaseTypeSchema>;

export const ConsultationCaseStatusSchema = z.enum([
  'open',
  'waiting_for_accountant',
  'waiting_for_client',
  'resolved',
  'closed',
  'reopened',
]);
export type ConsultationCaseStatus = z.infer<typeof ConsultationCaseStatusSchema>;

export const ConsultationCasePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type ConsultationCasePriority = z.infer<typeof ConsultationCasePrioritySchema>;

export const ConsultationAuthorRoleSchema = z.enum(['company_client', 'assigned_accountant']);
export type ConsultationAuthorRole = z.infer<typeof ConsultationAuthorRoleSchema>;

export const ConsultationStorageModeSchema = z.literal('synthetic_in_memory_stage_ab');
export type ConsultationStorageMode = z.infer<typeof ConsultationStorageModeSchema>;

export const ConsultationAssignedAccountantStatusSchema = z.enum([
  'active_grant_present',
  'no_accountant_assigned',
]);
export type ConsultationAssignedAccountantStatus = z.infer<
  typeof ConsultationAssignedAccountantStatusSchema
>;

export const ConsultationMessageItemSchema = z
  .object({
    messageId: UuidSelectorSchema,
    caseId: UuidSelectorSchema,
    authorUserId: UuidSelectorSchema,
    authorRole: ConsultationAuthorRoleSchema,
    body: UntrustedDocumentTextEnvelopeSchema,
    createdAt: IsoUtcTimestampSchema,
    ledgerMutationPerformed: z.literal(false),
  })
  .strict();
export type ConsultationMessageItem = z.infer<typeof ConsultationMessageItemSchema>;

export const ConsultationCaseSummarySchema = z
  .object({
    caseId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    caseType: ConsultationCaseTypeSchema,
    status: ConsultationCaseStatusSchema,
    priority: ConsultationCasePrioritySchema,
    subject: UntrustedDocumentTextEnvelopeSchema,
    taxPeriod: YearMonthSchema.nullable(),
    relatedDocumentId: UuidSelectorSchema.nullable(),
    createdByUserId: UuidSelectorSchema,
    assignedAccountantStatus: ConsultationAssignedAccountantStatusSchema,
    lastMessageAuthorRole: ConsultationAuthorRoleSchema,
    messagesCount: z.number().int().positive(),
    version: z.number().int().positive(),
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
    ledgerMutationPerformed: z.literal(false),
    storageMode: ConsultationStorageModeSchema,
    syntheticPrototypeDisclaimerPl: z.string().min(1).max(600),
  })
  .strict();
export type ConsultationCaseSummary = z.infer<typeof ConsultationCaseSummarySchema>;

export const ConsultationCaseDetailSchema = ConsultationCaseSummarySchema.extend({
  messages: z.array(ConsultationMessageItemSchema).min(1),
}).strict();
export type ConsultationCaseDetail = z.infer<typeof ConsultationCaseDetailSchema>;

/** 19. list_my_cases (#121 Stage A/B) */
export const ListMyConsultationCasesInputSchema = z
  .object({
    tenantId: UuidSelectorSchema.optional(),
    legalEntityId: UuidSelectorSchema.optional(),
    statusFilter: ConsultationCaseStatusSchema.optional(),
    roleView: z.enum(['all', 'client', 'accountant_queue']).optional(),
    cursor: z.string().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type ListMyConsultationCasesInput = z.infer<typeof ListMyConsultationCasesInputSchema>;

export const ListMyConsultationCasesOutputSchema = z
  .object({
    cases: z.array(ConsultationCaseSummarySchema),
    nextCursor: z.string().min(1).max(128).nullable(),
    promptInjectionWarningsCount: z.number().int().nonnegative(),
    storageMode: ConsultationStorageModeSchema,
    auditEventId: z.string().min(1),
  })
  .strict();
export type ListMyConsultationCasesOutput = z.infer<typeof ListMyConsultationCasesOutputSchema>;

/** 20. get_consultation_case (#121 Stage A/B) */
export const GetConsultationCaseInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    caseId: UuidSelectorSchema,
  })
  .strict();
export type GetConsultationCaseInput = z.infer<typeof GetConsultationCaseInputSchema>;

export const GetConsultationCaseOutputSchema = z
  .object({
    caseDetail: ConsultationCaseDetailSchema,
    auditEventId: z.string().min(1),
  })
  .strict();
export type GetConsultationCaseOutput = z.infer<typeof GetConsultationCaseOutputSchema>;

/** 21. create_consultation_draft (#121 Stage A/B) */
export const CreateConsultationDraftInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    caseType: ConsultationCaseTypeSchema,
    priority: ConsultationCasePrioritySchema.optional(),
    subject: z.string().min(3).max(200),
    initialMessage: z.string().min(3).max(4000),
    taxPeriod: YearMonthSchema.optional(),
    relatedDocumentId: UuidSelectorSchema.optional(),
  })
  .strict();
export type CreateConsultationDraftInput = z.infer<typeof CreateConsultationDraftInputSchema>;

export const CreateConsultationDraftOutputSchema = z
  .object({
    caseDetail: ConsultationCaseDetailSchema,
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    ledgerMutationPerformed: z.literal(false),
    aiSimulatedAccountantReplyGenerated: z.literal(false),
    auditEventId: z.string().min(1),
  })
  .strict();
export type CreateConsultationDraftOutput = z.infer<typeof CreateConsultationDraftOutputSchema>;

/** 22. reply_to_consultation_case (#121 Stage A/B) */
export const ReplyToConsultationCaseInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    caseId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    expectedVersion: z.number().int().positive(),
    message: z.string().min(2).max(4000),
    nextStatus: z
      .enum(['waiting_for_client', 'waiting_for_accountant', 'resolved', 'closed'])
      .optional(),
  })
  .strict();
export type ReplyToConsultationCaseInput = z.infer<typeof ReplyToConsultationCaseInputSchema>;

export const ReplyToConsultationCaseOutputSchema = z
  .object({
    caseDetail: ConsultationCaseDetailSchema,
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    ledgerMutationPerformed: z.literal(false),
    aiSimulatedAccountantReplyGenerated: z.literal(false),
    auditEventId: z.string().min(1),
  })
  .strict();
export type ReplyToConsultationCaseOutput = z.infer<typeof ReplyToConsultationCaseOutputSchema>;
