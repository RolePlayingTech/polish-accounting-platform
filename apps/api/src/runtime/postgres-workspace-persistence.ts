import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccessMutationResponseSchema,
  CreateCompanyRequestSchema,
  GrantCompanyAccessRequestSchema,
  RevokeCompanyAccessRequestSchema,
  type AccessMutationResponse,
  type ApproveAndPostDocumentRequest,
  type CalendarObligationItemContract,
  type CalendarViewResponse,
  type CompanyAccessResponse,
  type CompanyAuditListResponse,
  type CompanyDocumentItemContract,
  type CompanyOverviewResponse,
  type CompanySettingsResponse,
  type ConfirmMcpProposalRequest,
  type ConfirmMcpProposalResponse,
  type CreateCompanyRequest,
  type CreateCompanyResponse,
  type CreateDocumentRequest,
  type CreateJournalEntryRequest,
  type CreateKpirEntryRequest,
  type CreateRyczaltEntryRequest,
  type DispatchDueNotificationsRequest,
  type DispatchDueNotificationsResponse,
  type DocumentsListResponse,
  type ExplainLegalRuleRequest,
  type ExplainLegalRuleResponse,
  type FinanceViewResponse,
  type GetAcademyCourseResponse,
  type GetLegalRuleDetailResponse,
  type GetMyCompaniesResponse,
  type GradeAcademyLessonRequest,
  type GradeAcademyLessonResponse,
  type GrantCompanyAccessRequest,
  type ImportBankStatementRequest,
  type ImportBankStatementResponse,
  type IssueMcpChallengeResponse,
  type KpirViewResponse,
  type LedgerViewResponse,
  type ListLegalRulesResponse,
  type ListSandboxPersonasResponse,
  type McpProposalsListResponse,
  type NotificationsViewResponse,
  type ReconcileBankRequest,
  type RejectMcpProposalRequest,
  type RejectMcpProposalResponse,
  type RevokeCompanyAccessRequest,
  type RyczaltViewResponse,
  type SandboxMailboxMessageContract,
  type TaxProfileCode,
  type UpdateCompanySettingsRequest,
  type UpdateNotificationPreferencesRequest,
  type UpdateObligationStatusRequest,
  type VatViewResponse,
} from '@pap/contracts';
import type {
  McpToolErrorCode,
  PrepareInvoiceAndPostingProposalInput,
  PrepareInvoiceAndPostingProposalOutput,
} from '@pap/contracts/mcp-tools';
import type { ReminderStage } from '@pap/contracts/notifications';
import {
  AccountingWorkspaceAccessError,
  AccountingWorkspaceConflictError,
  AccountingWorkspaceService,
  AccountingWorkspaceValidationError,
  COMPANY_JDG_KPIR_ID,
  COMPANY_TENANT_2_ID,
  DEMO_DEFAULT_PERIOD,
  TENANT_1_ID,
  TENANT_2_ID,
  auditIdentifier,
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  executeAuthorizedCompanyAction,
  manageAccess,
  type AccountingWorkspaceStorePort,
  type ExecuteAuthorizedCompanyActionResult,
  type OidcAccessTokenVerifier,
  type WorkspaceActorContext,
} from '@pap/application';
import type {
  JournalEntryContract,
  KpirEntryContract,
  RyczaltEntryContract,
} from '@pap/contracts/accounting';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import {
  discoverActorAccessibleEntities,
  provisionCompanyInPostgres,
  type PostgresAccountingScope,
} from '@pap/db';
import {
  InvalidIdentifierError,
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import {
  createTransactionIsolatedWorkspaceFromScope,
  discoverAndHydrateMissingCompaniesForTenants,
  hydrateCompanyIntoWorkspaceIfMissing,
  syncCommittedTxWorkspaceToInner,
} from './postgres-company-hydrator.js';
import {
  ensureLedgerAccountsInScope,
  persistCompanyTaxSettingsToScope,
  persistDocumentItemToScope,
  persistJournalEntryToScope,
  persistKpirEntryToScope,
  persistMcpProposalWithIndexToScope,
  persistRyczaltEntryToScope,
} from './postgres-demo-seed.js';
import {
  INTERNAL_COMMAND_RECEIPT_INDEX_CATEGORY,
  canonicalJsonStringify,
  deterministicUuidV4,
  sha256Hex,
} from './postgres-mappers.js';
import {
  AsyncMutationMutex,
  captureWorkspaceRamSnapshot,
  restoreWorkspaceRamSnapshot,
} from './postgres-ram-snapshot.js';
import type { ConnectedPostgresRuntime } from './postgres-runtime-config.js';
import {
  persistApproveAndPostDocumentMutation,
  persistBankImportMutation,
  persistBankReconciliationMatchesAndSettlements,
  persistCalendarObligationStatusMutation,
  persistConfirmMcpProposalMutation,
  persistMcpChallengeMutation,
  persistNotificationsStateMutation,
  persistSandboxTestEmailMutation,
  provisionNewCompanyDirectoryWithMigrator,
} from './postgres-workspace-mutations.js';

type MaybePromise<T> = T | Promise<T>;
type WorkspacePeriodParam = typeof DEMO_DEFAULT_PERIOD;

export interface CompanyOperationOptions {
  readonly actionKind?: string | undefined;
  readonly payload?: unknown;
  readonly skipInitialHydration?: boolean | undefined;
}

interface StoredCommandIdempotencyReceipt {
  readonly receiptVersion: 1;
  readonly idempotencyKey: string;
  readonly actorUserId: string;
  readonly actionKind: string;
  readonly payloadHash: string;
  readonly responseJson: unknown;
  readonly recordedAt: string;
}

type AsyncableWorkspaceMethodKeys =
  | 'listLegalRules'
  | 'getLegalRuleDetail'
  | 'explainLegalRule'
  | 'getAcademyCourse'
  | 'gradeAcademyLesson'
  | 'getMyCompanies'
  | 'listTenantCompanies'
  | 'createCompany'
  | 'getCompanyOverview'
  | 'getCompanySettings'
  | 'updateCompanySettings'
  | 'getCompanyAccess'
  | 'grantCompanyAccess'
  | 'revokeCompanyAccess'
  | 'getAuditLog'
  | 'listDocuments'
  | 'createDocument'
  | 'getDocument'
  | 'approveAndPostDocument'
  | 'getKpirView'
  | 'createKpirManualEntry'
  | 'calculateCompanyZus'
  | 'getRyczaltView'
  | 'createRyczaltManualEntry'
  | 'getVatView'
  | 'getLedgerView'
  | 'createJournalEntry'
  | 'getFinanceView'
  | 'importBankStatement'
  | 'reconcileBank'
  | 'getCalendarView'
  | 'updateObligationStatus'
  | 'getNotificationsView'
  | 'updateNotificationPreferences'
  | 'dispatchDueNotifications'
  | 'sendSandboxReminderEmailFailClosed'
  | 'listMcpProposals'
  | 'prepareMcpProposal'
  | 'issueMcpProposalChallenge'
  | 'confirmMcpProposal'
  | 'rejectMcpProposal';

export type WorkspaceRuntimePort = {
  readonly store: AccountingWorkspaceStorePort;
  listSandboxPersonas: AccountingWorkspaceService['listSandboxPersonas'];
} & {
  [K in AsyncableWorkspaceMethodKeys]: (
    ...args: Parameters<AccountingWorkspaceService[K]>
  ) => MaybePromise<Awaited<ReturnType<AccountingWorkspaceService[K]>>>;
};
export interface PostgresBackedWorkspaceServiceOptions {
  readonly runtime: ConnectedPostgresRuntime;
  readonly innerWorkspace: AccountingWorkspaceService;
  readonly oidcVerifier: OidcAccessTokenVerifier;
  readonly sandboxIssuer: string;
  readonly migratorDatabaseUrl?: string | undefined;
}

export class PostgresBackedWorkspaceService implements WorkspaceRuntimePort {
  readonly store: AccountingWorkspaceStorePort;
  private readonly runtime: ConnectedPostgresRuntime;
  private readonly innerWorkspace: AccountingWorkspaceService;
  private readonly oidcVerifier: OidcAccessTokenVerifier;
  private readonly sandboxIssuer: string;
  private readonly migratorDatabaseUrl: string | undefined;
  private readonly mutationMutex = new AsyncMutationMutex();
  private readonly boundGateways = new Set<PapMcpGateway>();
  private readonly inFlightBatchSync = new Map<string, Promise<boolean>>();
  private readonly lastBatchSyncAtMs = new Map<string, number>();

  /**
   * Test-only hook invoked inside the active PostgreSQL transaction after business DML
   * and `recordOperationProbe()`, immediately before `recordAuthorizationDecision` and `COMMIT`.
   */
  public beforeCommitHook:
    | ((info: {
        readonly tenantId: string;
        readonly legalEntityId: string;
        readonly action: 'read' | 'write';
        readonly actionKind: string | undefined;
      }) => Promise<void> | void)
    | undefined;

  /**
   * Test-only hook invoked immediately after the underlying PostgreSQL transaction commits
   * inside `unitOfWork.runCompanyActionInTransaction`, allowing adversarial tests to simulate
   * a lost `COMMIT` acknowledgement (`TransactionOutcomeUnknownError`).
   */
  public afterDbCommitFaultHook:
    | ((info: {
        readonly tenantId: string;
        readonly legalEntityId: string;
        readonly action: 'read' | 'write';
        readonly actionKind: string | undefined;
      }) => Promise<void> | void)
    | undefined;

  constructor(options: PostgresBackedWorkspaceServiceOptions) {
    this.runtime = options.runtime;
    this.innerWorkspace = options.innerWorkspace;
    this.store = options.innerWorkspace.store;
    this.oidcVerifier = options.oidcVerifier;
    this.sandboxIssuer = options.sandboxIssuer;
    this.migratorDatabaseUrl = options.migratorDatabaseUrl?.trim() || undefined;

    const origPortFactory = this.innerWorkspace.createWorkspaceMcpDomainPort.bind(
      this.innerWorkspace,
    );
    this.innerWorkspace.createWorkspaceMcpDomainPort = () => {
      const base = origPortFactory();
      return {
        ...base,
        listCandidateCompaniesForUser: async (uId) => {
          const syncedBatch = await this.syncActorAccessibleGrantsBatch([uId], undefined, true);
          if (!syncedBatch) {
            await discoverAndHydrateMissingCompaniesForTenants(
              this.runtime,
              this.innerWorkspace,
              this.getKnownTenantIds(),
              [uId],
            );
            for (const comp of this.store.listAllCompanies()) {
              await this.syncCompanyGrantsIntoMemory(uId, comp.tenantId, comp.legalEntityId);
            }
          }
          return base.listCandidateCompaniesForUser(uId);
        },
        getCompanyTaxProfile: async (tId, leId) => {
          await this.ensureCompanyHydratedIfValid(tId, leId, undefined, true);
          return base.getCompanyTaxProfile ? base.getCompanyTaxProfile(tId, leId) : null;
        },
        listUnpaidInvoices: async (tId, leId) => {
          await this.ensureCompanyHydratedIfValid(tId, leId, undefined, true);
          return base.listUnpaidInvoices(tId, leId);
        },
        listMonthlyTaxObligations: async (tId, leId, period) => {
          await this.ensureCompanyHydratedIfValid(tId, leId, undefined, true);
          return base.listMonthlyTaxObligations(tId, leId, period);
        },
        getAccountingItemExplanation: async (tId, leId, accountingItemId) => {
          await this.ensureCompanyHydratedIfValid(tId, leId, undefined, true);
          return base.getAccountingItemExplanation
            ? base.getAccountingItemExplanation(tId, leId, accountingItemId)
            : null;
        },
        getMonthCloseRawData: async (tId, leId, period) => {
          await this.ensureCompanyHydratedIfValid(tId, leId, undefined, true);
          return base.getMonthCloseRawData(tId, leId, period);
        },
        resolveVerifiedIdentity: (identity) =>
          this.runtime.securityServices.identityResolver.resolveVerifiedIdentity(identity),
        getFacts: (query) => this.runtime.securityServices.authorizationDataSource.getFacts(query),
        recordDecision: async (event) => {
          await base.recordDecision(event);
          await this.runtime.securityServices.securityAudit.recordDecision(event);
        },
      };
    };
  }

  private runAtomicMutation<T>(work: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(async () => {
      this.lastBatchSyncAtMs.clear();
      const snapshot = captureWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways);
      try {
        return await work();
      } catch (error) {
        restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
        throw error;
      } finally {
        this.lastBatchSyncAtMs.clear();
      }
    });
  }

  private resolveVerifierAndTokenForActor(actor: WorkspaceActorContext): {
    readonly rawBearerToken: string;
    readonly verifier: OidcAccessTokenVerifier;
  } {
    if (actor.rawBearerToken && actor.rawBearerToken.length > 0) {
      return {
        rawBearerToken: actor.rawBearerToken,
        verifier: this.oidcVerifier,
      };
    }
    const syntheticToken = `internal:${actor.userId}`;
    const defaultIssuer = this.sandboxIssuer;
    const fallbackVerifier: OidcAccessTokenVerifier = {
      async verifyAccessToken(token) {
        if (token !== syntheticToken) {
          return { ok: false, reason: 'oidc_configuration_unavailable' };
        }
        return {
          ok: true,
          identity: Object.freeze({
            issuer: actor.issuer || defaultIssuer,
            subject: actor.subject ?? actor.userId,
            ...(actor.scopes ? { scopes: actor.scopes } : {}),
          }),
        };
      },
    };
    return {
      rawBearerToken: syntheticToken,
      verifier: fallbackVerifier,
    };
  }

  private mapDeniedResultToError(
    res: Exclude<ExecuteAuthorizedCompanyActionResult<unknown>, { readonly allowed: true }>,
  ): never {
    if (res.status === 'invalid_selector') {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_selector',
        'Niepoprawny identyfikator organizacji lub firmy.',
      );
    }
    if (res.status === 'unavailable') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: res.reason,
        message: 'Podsystem autoryzacji lub audytu PostgreSQL jest niedostępny (fail-closed).',
      });
    }
    if (res.status === 'unauthenticated') {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: res.reason,
        message: 'Weryfikacja tożsamości OIDC zakończyła się odmową.',
      });
    }
    throw new AccountingWorkspaceAccessError(
      403,
      res.reason,
      'Brak aktywnego członkostwa lub jawnego grantu do firmy w bieżącej organizacji.',
    );
  }

  private async executeCompanyOperationUnlocked<TOutput>(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    action: 'read' | 'write',
    work: (
      scope: PostgresAccountingScope,
      txWorkspace: AccountingWorkspaceService,
    ) => Promise<TOutput> | TOutput,
    options?: CompanyOperationOptions,
  ): Promise<TOutput> {
    await this.syncCompanyGrantsIntoMemory(actor.userId, rawTenantId, rawLegalEntityId);
    const { rawBearerToken, verifier } = this.resolveVerifierAndTokenForActor(actor);
    let capturedDomainError: unknown = null;
    let committedTxWorkspace: AccountingWorkspaceService | null = null;

    const baseUnitOfWork = this.runtime.securityServices.unitOfWork;
    const afterCommitHook = this.afterDbCommitFaultHook;
    const unitOfWork = afterCommitHook
      ? {
          recordDeniedDecision: (event: Parameters<typeof baseUnitOfWork.recordDeniedDecision>[0]) =>
            baseUnitOfWork.recordDeniedDecision(event),
          runCompanyActionInTransaction: async <TResult>(
            txWork: Parameters<typeof baseUnitOfWork.runCompanyActionInTransaction<TResult>>[0],
            shouldCommit: Parameters<
              typeof baseUnitOfWork.runCompanyActionInTransaction<TResult>
            >[1],
          ): Promise<TResult> => {
            const txResInner = await baseUnitOfWork.runCompanyActionInTransaction(
              txWork,
              shouldCommit,
            );
            if (shouldCommit(txResInner)) {
              await afterCommitHook({
                tenantId: rawTenantId,
                legalEntityId: rawLegalEntityId,
                action,
                actionKind: options?.actionKind,
              });
            }
            return txResInner;
          },
        }
      : baseUnitOfWork;

    const txRes = await executeAuthorizedCompanyAction(
      {
        rawBearerToken,
        requestId: actor.requestId ?? randomUUID(),
        operationId: randomUUID(),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        action,
      },
      {
        ...this.runtime.securityServices,
        unitOfWork,
        verifier,
      },
      async (ctx, scope) => {
        try {
          if (action === 'write' && !options?.skipInitialHydration) {
            await scope.lockCompanyTaxSettingsForUpdate();
          }

          const idempotencyKey =
            action === 'write' &&
            options?.actionKind &&
            typeof actor.idempotencyKey === 'string' &&
            actor.idempotencyKey.length > 0
              ? actor.idempotencyKey
              : undefined;
          const receiptDocId = idempotencyKey
            ? deterministicUuidV4(
                `cmd-receipt:${ctx.tenantId}:${ctx.legalEntityId}:${ctx.userId}:${idempotencyKey}`,
              )
            : undefined;
          const payloadHash = idempotencyKey
            ? sha256Hex(
                `${options?.actionKind ?? 'write'}:${canonicalJsonStringify(options?.payload ?? null)}`,
              )
            : undefined;

          if (idempotencyKey && receiptDocId && payloadHash) {
            const existingReceiptDoc = await scope.getAccountingDocumentById(receiptDocId);
            if (
              existingReceiptDoc &&
              existingReceiptDoc.categoryCode === INTERNAL_COMMAND_RECEIPT_INDEX_CATEGORY
            ) {
              const storedReceipt = existingReceiptDoc.aiProposalJson as
                | Partial<StoredCommandIdempotencyReceipt>
                | null
                | undefined;
              if (
                !storedReceipt ||
                storedReceipt.actionKind !== options?.actionKind ||
                storedReceipt.payloadHash !== payloadHash
              ) {
                throw new AccountingWorkspaceConflictError(
                  'idempotency_payload_mismatch',
                  'Klucz Idempotency-Key został już użyty dla innej operacji lub innych parametrów wejściowych.',
                );
              }
              if (!options?.skipInitialHydration) {
                const isolated = await createTransactionIsolatedWorkspaceFromScope({
                  scope,
                  baseWorkspace: this.innerWorkspace,
                  actor,
                  rawTenantId: ctx.tenantId,
                  rawLegalEntityId: ctx.legalEntityId,
                  action,
                });
                committedTxWorkspace = isolated.txWorkspace;
              }
              await scope.recordOperationProbe();
              if (this.beforeCommitHook) {
                await this.beforeCommitHook({
                  tenantId: ctx.tenantId,
                  legalEntityId: ctx.legalEntityId,
                  action,
                  actionKind: options?.actionKind,
                });
              }
              return storedReceipt.responseJson as TOutput;
            }
          }

          const txWorkspace = options?.skipInitialHydration
            ? this.innerWorkspace
            : (
                await createTransactionIsolatedWorkspaceFromScope({
                  scope,
                  baseWorkspace: this.innerWorkspace,
                  actor,
                  rawTenantId: ctx.tenantId,
                  rawLegalEntityId: ctx.legalEntityId,
                  action,
                })
              ).txWorkspace;

          const result = await work(scope, txWorkspace);
          committedTxWorkspace = txWorkspace;

          if (idempotencyKey && receiptDocId && payloadHash && options?.actionKind) {
            const receiptPayload: StoredCommandIdempotencyReceipt = {
              receiptVersion: 1,
              idempotencyKey,
              actorUserId: ctx.userId,
              actionKind: options.actionKind,
              payloadHash,
              responseJson: JSON.parse(JSON.stringify(result)),
              recordedAt: new Date().toISOString(),
            };
            await scope.createAccountingDocument({
              id: receiptDocId,
              documentType: 'internal_note',
              documentNumber: `CMD-RECEIPT-${receiptDocId.slice(0, 12)}`,
              issueDate: '2026-01-01',
              saleDate: '2026-01-01',
              counterpartyName: 'PAP Idempotency Receipt',
              netGrosze: 0,
              vatGrosze: 0,
              grossGrosze: 0,
              sha256Hash: payloadHash,
              status: 'draft',
              categoryCode: INTERNAL_COMMAND_RECEIPT_INDEX_CATEGORY,
              description: 'Command Idempotency Receipt',
              aiProposalJson: receiptPayload as unknown as Record<string, unknown>,
            });
          }

          if (action === 'write') {
            await scope.recordOperationProbe();
          }

          if (this.beforeCommitHook) {
            await this.beforeCommitHook({
              tenantId: ctx.tenantId,
              legalEntityId: ctx.legalEntityId,
              action,
              actionKind: options?.actionKind,
            });
          }

          return result;
        } catch (err) {
          capturedDomainError = err;
          throw err;
        }
      },
    );

    if (capturedDomainError !== null) {
      throw capturedDomainError;
    }
    if (!txRes.allowed) {
      return this.mapDeniedResultToError(txRes);
    }
    if (committedTxWorkspace && committedTxWorkspace !== this.innerWorkspace) {
      await syncCommittedTxWorkspaceToInner({
        txWorkspace: committedTxWorkspace,
        innerWorkspace: this.innerWorkspace,
        rawTenantId,
        rawLegalEntityId,
        actorUserId: actor.userId,
      });
    }
    return txRes.data;
  }

  private getKnownTenantIds(extraTenantId?: string): string[] {
    const ids = new Set<string>([TENANT_1_ID, TENANT_2_ID]);
    for (const comp of this.store.listAllCompanies()) {
      ids.add(comp.tenantId);
    }
    if (extraTenantId) {
      ids.add(extraTenantId);
    }
    return Array.from(ids);
  }

  private async ensureCompanyHydratedIfValid(
    rawTenantId: string,
    rawLegalEntityId: string,
    preferredActorUserId?: string,
    forceFresh = false,
  ): Promise<void> {
    let tId;
    let leId;
    try {
      tId = parseTenantId(rawTenantId);
      leId = parseLegalEntityId(rawLegalEntityId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        return;
      }
      throw err;
    }
    if (!forceFresh && this.store.getCompany(tId, leId) !== null) {
      return;
    }
    await hydrateCompanyIntoWorkspaceIfMissing(
      this.runtime,
      this.innerWorkspace,
      tId,
      leId,
      preferredActorUserId,
      { forceFresh },
    );
    this.innerWorkspace.syncStoreMcpProposalsToBoundGateways(tId, leId);
  }

  private async runCompanyOperation<TOutput>(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    action: 'read' | 'write',
    work: (
      scope: PostgresAccountingScope,
      txWorkspace: AccountingWorkspaceService,
    ) => Promise<TOutput> | TOutput,
    options?: CompanyOperationOptions,
  ): Promise<TOutput> {
    if (action === 'write') {
      this.lastBatchSyncAtMs.clear();
    }
    return this.executeCompanyOperationUnlocked(
      actor,
      rawTenantId,
      rawLegalEntityId,
      action,
      work,
      options,
    );
  }

  private async syncCompanyGrantsIntoMemory(
    userIdStr: string,
    tenantIdStr: string,
    legalEntityIdStr: string,
  ): Promise<void> {
    let uId;
    let tId;
    let leId;
    try {
      uId = parseUserId(userIdStr);
      tId = parseTenantId(tenantIdStr);
      leId = parseLegalEntityId(legalEntityIdStr);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        return;
      }
      throw err;
    }

    const syncedBatch = await this.syncActorAccessibleGrantsBatch([uId], tId);
    if (syncedBatch) {
      return;
    }

    const [readFacts, writeFacts] = await Promise.all([
      this.runtime.securityServices.authorizationDataSource.getFacts({
        userId: uId,
        tenantId: tId,
        legalEntityId: leId,
        action: 'read',
      }),
      this.runtime.securityServices.authorizationDataSource.getFacts({
        userId: uId,
        tenantId: tId,
        legalEntityId: leId,
        action: 'write',
      }),
    ]);

    const membership = readFacts.membership ?? writeFacts.membership;
    if (membership) {
      this.store.upsertMembership(membership);
    } else {
      const cachedMembership = this.store.getMembership(tId, uId);
      if (cachedMembership && cachedMembership.status === 'active') {
        this.store.upsertMembership({
          ...cachedMembership,
          status: 'revoked',
        });
      }
    }

    const dbGrants = [...readFacts.grants, ...writeFacts.grants];
    const seenGrantIds = new Set<string>();
    for (const g of dbGrants) {
      seenGrantIds.add(g.grantId);
      this.store.upsertGrant(g);
    }

    const now = new Date();
    for (const cached of this.store.listGrantsForCompany(tId, leId)) {
      if (cached.userId === uId && cached.revokedAt === null && !seenGrantIds.has(cached.grantId)) {
        this.store.upsertGrant({
          ...cached,
          revokedAt: now,
        });
      }
    }
  }

  listSandboxPersonas(issuer?: string): ListSandboxPersonasResponse {
    return this.innerWorkspace.listSandboxPersonas(issuer);
  }

  listLegalRules(asOfDate?: string, profile?: TaxProfileCode): ListLegalRulesResponse {
    return this.innerWorkspace.listLegalRules(asOfDate, profile);
  }

  getLegalRuleDetail(ruleCode: string, asOfDate?: string): GetLegalRuleDetailResponse {
    return this.innerWorkspace.getLegalRuleDetail(ruleCode, asOfDate);
  }

  explainLegalRule(req: ExplainLegalRuleRequest): ExplainLegalRuleResponse {
    return this.innerWorkspace.explainLegalRule(req);
  }

  getAcademyCourse(): GetAcademyCourseResponse {
    return this.innerWorkspace.getAcademyCourse();
  }

  gradeAcademyLesson(
    lessonSlug: string,
    req: GradeAcademyLessonRequest,
  ): GradeAcademyLessonResponse {
    return this.innerWorkspace.gradeAcademyLesson(lessonSlug, req);
  }

  private resolveDynamicAnchorEntityId(
    tId: ReturnType<typeof parseTenantId>,
  ): ReturnType<typeof parseLegalEntityId> {
    const existing = this.store.listCompaniesForTenant(tId)[0];
    if (existing) {
      return existing.legalEntityId;
    }
    return tId === TENANT_2_ID
      ? parseLegalEntityId(COMPANY_TENANT_2_ID)
      : parseLegalEntityId(COMPANY_JDG_KPIR_ID);
  }

  private async syncActorAccessibleGrantsBatch(
    actorUserIds: readonly string[],
    tenantIdFilter?: string,
    forceFresh = false,
  ): Promise<boolean> {
    const cacheKey = `${actorUserIds.join(',')}|${tenantIdFilter ?? '*'}`;
    const universalKey = `${actorUserIds.join(',')}|*`;
    const existingInFlight =
      this.inFlightBatchSync.get(cacheKey) ?? this.inFlightBatchSync.get(universalKey);
    if (!forceFresh && existingInFlight) {
      return existingInFlight;
    }
    const lastMs = Math.max(
      this.lastBatchSyncAtMs.get(cacheKey) ?? 0,
      this.lastBatchSyncAtMs.get(universalKey) ?? 0,
    );
    if (!forceFresh && Date.now() - lastMs < 800) {
      return true;
    }

    const runPromise = (async () => {
      const discovered = await discoverActorAccessibleEntities(
        this.runtime.connection.db,
        this.runtime.signer,
        actorUserIds,
        tenantIdFilter,
      ).catch(() => null);
      if (!discovered || (discovered.memberships.length === 0 && discovered.grants.length === 0)) {
        return false;
      }
      const seenUsers = new Set<string>();
      for (const m of discovered.memberships) {
        seenUsers.add(`${m.tenantId}:${m.userId}`);
        this.store.upsertMembership({
          ...m,
          tenantId: parseTenantId(m.tenantId),
          userId: parseUserId(m.userId),
        });
      }
      const seenGrants = new Set<string>();
      for (const g of discovered.grants) {
        seenGrants.add(g.grantId);
        this.store.upsertGrant({
          grantId: g.grantId,
          tenantId: parseTenantId(g.tenantId),
          userId: parseUserId(g.userId),
          legalEntityId: parseLegalEntityId(g.legalEntityId),
          action: g.action,
          validFrom: g.validFrom,
          validUntil: g.validUntil,
          revokedAt: g.revokedAt,
        });
      }
      for (const ent of discovered.entities) {
        const tId = parseTenantId(ent.tenantId);
        const leId = parseLegalEntityId(ent.legalEntityId);
        if (this.store.getCompany(tId, leId) === null) {
          await hydrateCompanyIntoWorkspaceIfMissing(
            this.runtime,
            this.innerWorkspace,
            tId,
            leId,
            actorUserIds[0],
          );
        }
      }
      const now = new Date();
      const candidateUserSet = new Set(actorUserIds.map((u) => parseUserId(u)));
      const targetCompanies = tenantIdFilter
        ? this.store.listCompaniesForTenant(parseTenantId(tenantIdFilter))
        : this.store.listAllCompanies();
      for (const comp of targetCompanies) {
        for (const cached of this.store.listGrantsForCompany(comp.tenantId, comp.legalEntityId)) {
          if (
            candidateUserSet.has(cached.userId) &&
            seenUsers.has(`${comp.tenantId}:${cached.userId}`) &&
            cached.revokedAt === null &&
            !seenGrants.has(cached.grantId)
          ) {
            this.store.upsertGrant({
              ...cached,
              revokedAt: now,
            });
          }
        }
      }
      this.lastBatchSyncAtMs.set(cacheKey, Date.now());
      return true;
    })();

    this.inFlightBatchSync.set(cacheKey, runPromise);
    try {
      return await runPromise;
    } finally {
      if (this.inFlightBatchSync.get(cacheKey) === runPromise) {
        this.inFlightBatchSync.delete(cacheKey);
      }
    }
  }

  async getMyCompanies(actor: WorkspaceActorContext): Promise<GetMyCompaniesResponse> {
    const syncedBatch = await this.syncActorAccessibleGrantsBatch([actor.userId], undefined, true);
    if (!syncedBatch) {
      await discoverAndHydrateMissingCompaniesForTenants(
        this.runtime,
        this.innerWorkspace,
        this.getKnownTenantIds(),
        [actor.userId],
      );
      for (const comp of this.store.listAllCompanies()) {
        await this.syncCompanyGrantsIntoMemory(actor.userId, comp.tenantId, comp.legalEntityId);
      }
    }
    return this.innerWorkspace.getMyCompanies(actor);
  }

  async listTenantCompanies(
    actor: WorkspaceActorContext,
    rawTenantId: string,
  ): Promise<GetMyCompaniesResponse> {
    let tId;
    try {
      tId = parseTenantId(rawTenantId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_tenant_id',
          'Niepoprawny identyfikator organizacji (tenantId).',
        );
      }
      throw err;
    }

    const uId = parseUserId(actor.userId);
    const batchDiscovered = await discoverActorAccessibleEntities(
      this.runtime.connection.db,
      this.runtime.signer,
      [uId],
      tId,
    ).catch(() => null);
    const batchMembership = batchDiscovered?.memberships.find(
      (m) => m.tenantId === tId && m.userId === uId,
    );

    const anchorEntityId = this.resolveDynamicAnchorEntityId(tId);
    const facts = batchMembership
      ? {
          membership: {
            ...batchMembership,
            tenantId: parseTenantId(batchMembership.tenantId),
            userId: parseUserId(batchMembership.userId),
          },
        }
      : await this.runtime.securityServices.authorizationDataSource.getFacts({
          userId: uId,
          tenantId: tId,
          legalEntityId: anchorEntityId,
          action: 'read',
        });

    if (!facts.membership || facts.membership.status !== 'active') {
      await this.runtime.securityServices.securityAudit.recordDecision({
        requestId: actor.requestId ?? randomUUID(),
        actorId: uId,
        tenantId: auditIdentifier(rawTenantId),
        legalEntityId: null,
        action: 'read',
        kind: 'company',
        decision: 'deny',
        outcome: 'denied',
        reason: 'active_membership_required',
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'active_membership_required',
        'Brak aktywnego członkostwa w organizacji.',
      );
    }

    this.store.upsertMembership(facts.membership);
    await discoverAndHydrateMissingCompaniesForTenants(
      this.runtime,
      this.innerWorkspace,
      [tId],
      [actor.userId],
    );
    const syncedBatch = await this.syncActorAccessibleGrantsBatch([actor.userId], tId, true);
    if (!syncedBatch) {
      for (const comp of this.store.listCompaniesForTenant(tId)) {
        await this.syncCompanyGrantsIntoMemory(actor.userId, tId, comp.legalEntityId);
      }
    }
    return this.innerWorkspace.listTenantCompanies(actor, rawTenantId);
  }

  async createCompany(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    req: CreateCompanyRequest,
  ): Promise<CreateCompanyResponse> {
    let tId;
    try {
      tId = parseTenantId(rawTenantId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_tenant_id',
          'Niepoprawny identyfikator organizacji (tenantId).',
        );
      }
      throw err;
    }

    const parsedReq = CreateCompanyRequestSchema.safeParse(req);
    if (!parsedReq.success) {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_company_request',
        parsedReq.error.issues[0]?.message ?? 'Niepoprawne dane tworzonego podmiotu prawnego.',
      );
    }

    const uId = parseUserId(actor.userId);
    const batchDiscovered = await discoverActorAccessibleEntities(
      this.runtime.connection.db,
      this.runtime.signer,
      [uId],
      tId,
    ).catch(() => null);
    const batchMembership = batchDiscovered?.memberships.find(
      (m) => m.tenantId === tId && m.userId === uId,
    );

    const anchorEntityId = this.resolveDynamicAnchorEntityId(tId);
    const facts = batchMembership
      ? {
          membership: {
            ...batchMembership,
            tenantId: parseTenantId(batchMembership.tenantId),
            userId: parseUserId(batchMembership.userId),
          },
        }
      : await this.runtime.securityServices.authorizationDataSource.getFacts({
          userId: uId,
          tenantId: tId,
          legalEntityId: anchorEntityId,
          action: 'write',
        });

    if (
      !facts.membership ||
      facts.membership.status !== 'active' ||
      (facts.membership.role !== 'tenant_owner' && facts.membership.role !== 'tenant_admin')
    ) {
      const auditReason =
        !facts.membership || facts.membership.status !== 'active'
          ? 'active_membership_required'
          : 'access_management_denied';
      const errorReason =
        !facts.membership || facts.membership.status !== 'active'
          ? 'active_membership_required'
          : 'admin_role_required';
      await this.runtime.securityServices.securityAudit.recordDecision({
        requestId: actor.requestId ?? randomUUID(),
        actorId: uId,
        tenantId: auditIdentifier(rawTenantId),
        legalEntityId: null,
        action: 'write',
        kind: 'company',
        decision: 'deny',
        outcome: 'denied',
        reason: auditReason,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        errorReason,
        'Tworzenie nowej firmy wymaga aktywnej roli właściciela lub administratora tenanta.',
      );
    }

    const verifiedMembership = facts.membership;
    await discoverAndHydrateMissingCompaniesForTenants(
      this.runtime,
      this.innerWorkspace,
      [tId],
      [actor.userId],
    );

    return this.runAtomicMutation(async () => {
      this.store.upsertMembership(verifiedMembership);
      const created = this.innerWorkspace.createCompany(actor, rawTenantId, parsedReq.data);

      const companyMetaPayload = {
        displayName: created.company.displayName,
        nip: created.company.nip,
        legalForm: created.company.legalForm,
        taxRegime: created.company.taxRegime,
        vatStatusSimple: created.company.vatStatus,
        taxProfile: created.taxProfile,
        settingsHistory: [],
        ...(created.address !== undefined ? { address: created.address } : {}),
      };

      let provisionedViaRuntime: boolean;
      try {
        const provisionRes = await provisionCompanyInPostgres(
          this.runtime.connection.db,
          this.runtime.signer,
          {
            operationId: randomUUID(),
            requestId: actor.requestId ?? randomUUID(),
            actorUserId: actor.userId,
            tenantId: created.company.tenantId,
            legalEntityId: created.company.legalEntityId,
            displayName: created.company.displayName,
            profileCode: created.taxProfile.profileCode,
            nip: created.company.nip,
            profileJson: companyMetaPayload as unknown as Record<string, unknown>,
          },
        );
        if (!provisionRes.ok) {
          if (provisionRes.reason === 'duplicate_company_nip') {
            throw new AccountingWorkspaceConflictError(
              'duplicate_company_nip',
              `W tej organizacji istnieje już podmiot z numerem NIP ${created.company.nip}.`,
            );
          }
          if (provisionRes.reason === 'operation_conflict') {
            throw new AccountingWorkspaceConflictError(
              'operation_conflict',
              'Konflikt idempotencji operacji tworzenia firmy w PostgreSQL.',
            );
          }
          if (provisionRes.reason === 'invalid_command') {
            throw new AccountingWorkspaceValidationError(
              400,
              'invalid_company_request',
              'Niepoprawne dane tworzonego podmiotu prawnego.',
            );
          }
          throw new AccountingWorkspaceAccessError(
            403,
            provisionRes.reason === 'active_membership_required'
              ? 'active_membership_required'
              : 'admin_role_required',
            'Odmowa utworzenia nowego podmiotu prawnego w bieżącej organizacji.',
          );
        }
        provisionedViaRuntime = true;
      } catch (err) {
        if (
          err instanceof AccountingWorkspaceConflictError ||
          err instanceof AccountingWorkspaceValidationError ||
          err instanceof AccountingWorkspaceAccessError
        ) {
          throw err;
        }
        if (this.migratorDatabaseUrl) {
          await provisionNewCompanyDirectoryWithMigrator({
            migratorUrl: this.migratorDatabaseUrl,
            databaseEnv: this.runtime.databaseEnv,
            dataSchema: this.runtime.dataSchema,
            tenantId: created.company.tenantId,
            legalEntityId: created.company.legalEntityId,
            displayName: created.company.displayName,
            profileCode: created.taxProfile.profileCode,
            ownerUserId: actor.userId,
          });
          provisionedViaRuntime = true;
        } else {
          throw err;
        }
      }

      if (provisionedViaRuntime) {
        await this.executeCompanyOperationUnlocked(
          actor,
          created.company.tenantId,
          created.company.legalEntityId,
          'write',
          async (scope, txWorkspace) => {
            const comp = txWorkspace.store.getCompany(
              parseTenantId(created.company.tenantId),
              parseLegalEntityId(created.company.legalEntityId),
            );
            if (comp) {
              await persistCompanyTaxSettingsToScope(scope, comp);
              await ensureLedgerAccountsInScope(scope, comp);
              await scope.upsertNotificationPreference({
                id: deterministicUuidV4(
                  `notif-pref:${comp.tenantId}:${comp.legalEntityId}:${actor.userId}`,
                ),
                userId: actor.userId,
                recipientEmail: actor.email || 'powiadomienia-sandbox@pap.example',
                frequency: 'standard',
                optOut: false,
              });
            }
          },
          { skipInitialHydration: true },
        );
      }

      await this.syncCompanyGrantsIntoMemory(
        actor.userId,
        created.company.tenantId,
        created.company.legalEntityId,
      );

      return created;
    });
  }

  getCompanyOverview(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<CompanyOverviewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) =>
        txWorkspace.getCompanyOverview(actor, tenantId, legalEntityId, period),
    );
  }

  getCompanySettings(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<CompanySettingsResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getCompanySettings(actor, tenantId, legalEntityId),
    );
  }

  updateCompanySettings(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: UpdateCompanySettingsRequest,
  ): Promise<CompanySettingsResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const updated = txWorkspace.updateCompanySettings(
          actor,
          tenantId,
          legalEntityId,
          req,
        );
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistCompanyTaxSettingsToScope(scope, comp);
        }
        return updated;
      },
      { actionKind: 'updateCompanySettings', payload: req },
    );
  }

  getCompanyAccess(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<CompanyAccessResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      async (_scope, txWorkspace) => {
        const allUserIds = this.store.listUsers().map((u) => u.userId);
        const syncedBatch = await this.syncActorAccessibleGrantsBatch(allUserIds, tenantId, true);
        if (!syncedBatch) {
          for (const user of this.store.listUsers()) {
            await this.syncCompanyGrantsIntoMemory(user.userId, tenantId, legalEntityId);
          }
        }
        const tId = parseTenantId(tenantId);
        const leId = parseLegalEntityId(legalEntityId);
        for (const m of this.store.listTenantMemberships(tId)) {
          txWorkspace.store.upsertMembership(m);
        }
        for (const g of this.store.listGrantsForCompany(tId, leId)) {
          txWorkspace.store.upsertGrant(g);
        }
        return txWorkspace.getCompanyAccess(actor, tenantId, legalEntityId);
      },
    );
  }

  async grantCompanyAccess(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: GrantCompanyAccessRequest,
  ): Promise<AccessMutationResponse> {
    await this.ensureCompanyHydratedIfValid(tenantId, legalEntityId, actor.userId);
    return this.runAtomicMutation(async () => {
      const parsed = GrantCompanyAccessRequestSchema.parse(req);
      const tId = parseTenantId(tenantId);
      const leId = parseLegalEntityId(legalEntityId);
      const targetUserId = parseUserId(parsed.targetUserId);
      const { rawBearerToken, verifier } = this.resolveVerifierAndTokenForActor(actor);

      const result = await manageAccess(
        {
          kind: 'grant',
          operationId: parsed.operationId ?? randomUUID(),
          tenantId: tId,
          userId: targetUserId,
          grantId: parsed.grantId ?? randomUUID(),
          legalEntityId: leId,
          action: parsed.action,
          validFrom: parsed.validFrom ?? null,
          validUntil: parsed.validUntil ?? null,
        },
        {
          store: this.runtime.accessManagementStore,
          actors: createOidcAccessManagementActorSource(rawBearerToken, {
            verifier,
            identityResolver: this.runtime.securityServices.identityResolver,
          }),
          authorizer: createTenantAccessManagementAuthorizer(undefined),
        },
      );

      if (!result.ok) {
        if (result.reason === 'invalid_command') {
          throw new AccountingWorkspaceValidationError(
            400,
            'invalid_command',
            'Niepoprawna komenda nadania grantu dostępu.',
          );
        }
        if (result.reason === 'operation_conflict') {
          throw new AccountingWorkspaceConflictError(
            'operation_conflict',
            'Konflikt idempotencji operacji administracyjnej nadania grantu.',
          );
        }
        if (
          result.reason === 'access_management_unavailable' ||
          result.reason === 'authorization_audit_unavailable' ||
          result.reason === 'transaction_outcome_unknown'
        ) {
          throw new ServiceUnavailableException({
            statusCode: 503,
            error: 'service_unavailable',
            reasonCode: result.reason,
            message: 'Podsystem zarządzania dostępem PostgreSQL jest niedostępny (fail-closed).',
          });
        }
        throw new AccountingWorkspaceAccessError(
          403,
          result.reason,
          'Odmowa nadania grantu dostępu do firmy w bieżącej organizacji.',
        );
      }

      await this.syncCompanyGrantsIntoMemory(targetUserId, tId, leId);
      return AccessMutationResponseSchema.parse({
        ok: true,
        receipt: result.receipt,
      });
    });
  }

  async revokeCompanyAccess(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: RevokeCompanyAccessRequest,
  ): Promise<AccessMutationResponse> {
    await this.ensureCompanyHydratedIfValid(tenantId, legalEntityId, actor.userId);
    return this.runAtomicMutation(async () => {
      const parsed = RevokeCompanyAccessRequestSchema.parse(req);
      const tId = parseTenantId(tenantId);
      const leId = parseLegalEntityId(legalEntityId);

      const candidateUserIds = new Set<string>(this.store.listUsers().map((u) => u.userId));
      for (const m of this.store.listTenantMemberships(tId)) {
        candidateUserIds.add(m.userId);
      }
      if (parsed.targetUserId) {
        candidateUserIds.add(parsed.targetUserId);
      }
      for (const candidateUserId of candidateUserIds) {
        await this.syncCompanyGrantsIntoMemory(candidateUserId, tId, leId);
      }

      const companyGrants = this.store.listGrantsForCompany(tId, leId);
      const matchedGrant = parsed.grantId
        ? companyGrants.find((g) => g.grantId === parsed.grantId)
        : parsed.targetUserId
          ? companyGrants.find((g) => g.userId === parsed.targetUserId && g.revokedAt === null)
          : undefined;

      const resolvedGrantId = parsed.grantId ?? matchedGrant?.grantId;
      const resolvedTargetUserStr =
        parsed.targetUserId ?? matchedGrant?.userId ?? (parsed.grantId ? actor.userId : undefined);
      if (!resolvedGrantId || !resolvedTargetUserStr) {
        throw new AccountingWorkspaceValidationError(
          400,
          'missing_revoke_grant_selector',
          'Wymagane jest wskazanie grantId lub aktywnego grantu użytkownika do cofnięcia.',
        );
      }

      const targetUserId = parseUserId(resolvedTargetUserStr);
      const { rawBearerToken, verifier } = this.resolveVerifierAndTokenForActor(actor);

      const result = await manageAccess(
        {
          kind: 'revoke_grant',
          operationId: parsed.operationId ?? randomUUID(),
          tenantId: tId,
          userId: targetUserId,
          grantId: resolvedGrantId,
        },
        {
          store: this.runtime.accessManagementStore,
          actors: createOidcAccessManagementActorSource(rawBearerToken, {
            verifier,
            identityResolver: this.runtime.securityServices.identityResolver,
          }),
          authorizer: createTenantAccessManagementAuthorizer(undefined),
        },
      );

      if (!result.ok) {
        if (result.reason === 'invalid_command') {
          throw new AccountingWorkspaceValidationError(
            400,
            'invalid_command',
            'Niepoprawna komenda cofnięcia grantu dostępu.',
          );
        }
        if (result.reason === 'operation_conflict') {
          throw new AccountingWorkspaceConflictError(
            'operation_conflict',
            'Konflikt idempotencji operacji administracyjnej cofnięcia grantu.',
          );
        }
        if (
          result.reason === 'access_management_unavailable' ||
          result.reason === 'authorization_audit_unavailable' ||
          result.reason === 'transaction_outcome_unknown'
        ) {
          throw new ServiceUnavailableException({
            statusCode: 503,
            error: 'service_unavailable',
            reasonCode: result.reason,
            message: 'Podsystem zarządzania dostępem PostgreSQL jest niedostępny (fail-closed).',
          });
        }
        throw new AccountingWorkspaceAccessError(
          403,
          result.reason,
          'Odmowa cofnięcia grantu dostępu do firmy w bieżącej organizacji.',
        );
      }

      if (matchedGrant && matchedGrant.revokedAt === null) {
        this.store.upsertGrant({
          ...matchedGrant,
          revokedAt: new Date(result.receipt.occurredAt),
        });
      }
      await this.syncCompanyGrantsIntoMemory(targetUserId, tId, leId);

      return AccessMutationResponseSchema.parse({
        ok: true,
        receipt: result.receipt,
      });
    });
  }

  getAuditLog(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<CompanyAuditListResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getAuditLog(actor, tenantId, legalEntityId),
    );
  }

  listDocuments(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: string,
  ): Promise<DocumentsListResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.listDocuments(actor, tenantId, legalEntityId, period),
    );
  }

  createDocument(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: CreateDocumentRequest,
  ): Promise<CompanyDocumentItemContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const created = txWorkspace.createDocument(actor, tenantId, legalEntityId, req);
        const existing = await scope.getAccountingDocumentById(created.documentId);
        if (!existing) {
          const comp = txWorkspace.store.getCompany(
            parseTenantId(tenantId),
            parseLegalEntityId(legalEntityId),
          );
          if (comp) {
            await persistDocumentItemToScope(scope, comp, created);
          }
        }
        return created;
      },
      { actionKind: 'createDocument', payload: req },
    );
  }

  getDocument(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    documentId: string,
  ): Promise<CompanyDocumentItemContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getDocument(actor, tenantId, legalEntityId, documentId),
    );
  }

  approveAndPostDocument(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    documentId: string,
    overrides?: ApproveAndPostDocumentRequest,
  ): Promise<CompanyDocumentItemContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const posted = txWorkspace.approveAndPostDocument(
          actor,
          tenantId,
          legalEntityId,
          documentId,
          overrides,
        );
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistApproveAndPostDocumentMutation(scope, comp, posted);
        }
        return posted;
      },
      {
        actionKind: 'approveAndPostDocument',
        payload: { documentId, overrides: overrides ?? null },
      },
    );
  }

  getKpirView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<KpirViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getKpirView(actor, tenantId, legalEntityId, period),
    );
  }

  createKpirManualEntry(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: CreateKpirEntryRequest,
  ): Promise<KpirEntryContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const entry = txWorkspace.createKpirManualEntry(actor, tenantId, legalEntityId, req);
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistKpirEntryToScope(scope, comp, entry, null);
        }
        return entry;
      },
      { actionKind: 'createKpirManualEntry', payload: req },
    );
  }

  calculateCompanyZus(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<ReturnType<AccountingWorkspaceService['calculateCompanyZus']>> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) =>
        txWorkspace.calculateCompanyZus(actor, tenantId, legalEntityId, period),
    );
  }

  getRyczaltView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<RyczaltViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getRyczaltView(actor, tenantId, legalEntityId, period),
    );
  }

  createRyczaltManualEntry(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: CreateRyczaltEntryRequest,
  ): Promise<RyczaltEntryContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const entry = txWorkspace.createRyczaltManualEntry(
          actor,
          tenantId,
          legalEntityId,
          req,
        );
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistRyczaltEntryToScope(scope, comp, entry, null);
        }
        return entry;
      },
      { actionKind: 'createRyczaltManualEntry', payload: req },
    );
  }

  getVatView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<VatViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getVatView(actor, tenantId, legalEntityId, period),
    );
  }

  getLedgerView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    period?: WorkspacePeriodParam,
  ): Promise<LedgerViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getLedgerView(actor, tenantId, legalEntityId, period),
    );
  }

  createJournalEntry(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: CreateJournalEntryRequest,
  ): Promise<JournalEntryContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const entry = txWorkspace.createJournalEntry(actor, tenantId, legalEntityId, req);
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistJournalEntryToScope(scope, comp, entry, null);
        }
        return entry;
      },
      { actionKind: 'createJournalEntry', payload: req },
    );
  }

  getFinanceView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<FinanceViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.getFinanceView(actor, tenantId, legalEntityId),
    );
  }

  importBankStatement(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: ImportBankStatementRequest,
  ): Promise<ImportBankStatementResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const compBefore = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        const beforeTxCount = compBefore ? compBefore.bankTransactions.length : 0;
        const prevSettled = new Map<string, number>(
          (compBefore?.settlements ?? []).map((s) => [s.settlementId, s.settledGrosze]),
        );
        const result = txWorkspace.importBankStatement(actor, tenantId, legalEntityId, req);
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistBankImportMutation(
            scope,
            comp,
            req.format,
            req.rawContent ?? req.content ?? '',
            beforeTxCount,
            prevSettled,
          );
        }
        return result;
      },
      { actionKind: 'importBankStatement', payload: req },
    );
  }

  reconcileBank(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: ReconcileBankRequest,
  ): Promise<FinanceViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const compBefore = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        const prevSettled = new Map<string, number>(
          (compBefore?.settlements ?? []).map((s) => [s.settlementId, s.settledGrosze]),
        );
        const result = txWorkspace.reconcileBank(actor, tenantId, legalEntityId, req);
        const comp = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        if (comp) {
          await persistBankReconciliationMatchesAndSettlements(scope, comp, prevSettled);
        }
        return result;
      },
      { actionKind: 'reconcileBank', payload: req },
    );
  }

  getCalendarView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    year?: number,
    month?: number | null,
  ): Promise<CalendarViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) =>
        txWorkspace.getCalendarView(actor, tenantId, legalEntityId, year, month),
    );
  }

  updateObligationStatus(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    obligationId: string,
    req: UpdateObligationStatusRequest,
    period?: WorkspacePeriodParam,
  ): Promise<CalendarObligationItemContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const updated = txWorkspace.updateObligationStatus(
          actor,
          tenantId,
          legalEntityId,
          obligationId,
          req,
          period,
        );
        await persistCalendarObligationStatusMutation(scope, updated);
        return updated;
      },
      {
        actionKind: 'updateObligationStatus',
        payload: { obligationId, req, period: period ?? null },
      },
    );
  }

  getNotificationsView(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<NotificationsViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      async (scope, txWorkspace) => {
        const baseView = txWorkspace.getNotificationsView(actor, tenantId, legalEntityId);
        const dbOutbox = await scope.listNotificationOutbox();
        const outboxById = new Map<string, NotificationsViewResponse['outbox'][number]>(
          baseView.outbox.map((item) => [item.outboxId, item]),
        );
        const mailboxById = new Map<string, SandboxMailboxMessageContract>(
          baseView.deliveredMailbox.map((msg) => [msg.messageId, msg]),
        );

        for (const row of dbOutbox) {
          const payload = row.payloadJson;
          if (typeof payload !== 'object' || payload === null) {
            continue;
          }
          const savedOutbox = (payload as { _papOutboxEntry?: unknown })._papOutboxEntry;
          if (
            typeof savedOutbox === 'object' &&
            savedOutbox !== null &&
            typeof (savedOutbox as { outboxId?: unknown }).outboxId === 'string'
          ) {
            const typed = savedOutbox as NotificationsViewResponse['outbox'][number];
            if (!outboxById.has(typed.outboxId)) {
              outboxById.set(typed.outboxId, {
                ...typed,
                status: row.status,
                retryCount: row.attemptCount,
              });
            }
          }
          const savedTestMsg = (payload as { _papTestSandboxMessage?: unknown })
            ._papTestSandboxMessage;
          if (
            typeof savedTestMsg === 'object' &&
            savedTestMsg !== null &&
            typeof (savedTestMsg as { messageId?: unknown }).messageId === 'string'
          ) {
            const typedMsg = savedTestMsg as SandboxMailboxMessageContract;
            if (!mailboxById.has(typedMsg.messageId)) {
              mailboxById.set(typedMsg.messageId, typedMsg);
            }
          }
        }

        return {
          ...baseView,
          outbox: [...outboxById.values()],
          deliveredMailbox: [...mailboxById.values()],
        };
      },
    );
  }

  updateNotificationPreferences(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationsViewResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const updatedView = await txWorkspace.updateNotificationPreferences(
          actor,
          tenantId,
          legalEntityId,
          req,
        );
        await scope.upsertNotificationPreference({
          id: deterministicUuidV4(`notif-pref:${tenantId}:${legalEntityId}:${actor.userId}`),
          userId: actor.userId,
          recipientEmail: updatedView.preferences.recipientEmail,
          frequency: updatedView.preferences.frequency,
          optOut: updatedView.preferences.optionalRemindersOptedOut,
          disabledStages: updatedView.preferences.disabledStages,
        });
        return updatedView;
      },
      { actionKind: 'updateNotificationPreferences', payload: req },
    );
  }

  dispatchDueNotifications(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    req?: DispatchDueNotificationsRequest,
  ): Promise<DispatchDueNotificationsResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const dispatched = await txWorkspace.dispatchDueNotifications(
          actor,
          tenantId,
          legalEntityId,
          req,
        );
        const view = txWorkspace.getNotificationsView(actor, tenantId, legalEntityId);
        await persistNotificationsStateMutation(scope, actor.userId, view);
        return dispatched;
      },
      { actionKind: 'dispatchDueNotifications', payload: req ?? null },
    );
  }

  sendSandboxReminderEmailFailClosed(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    params: {
      readonly toAddress: string;
      readonly stage?: ReminderStage | undefined;
      readonly period?: string | undefined;
    },
  ): Promise<SandboxMailboxMessageContract> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const sent = await txWorkspace.sendSandboxReminderEmailFailClosed(
          actor,
          tenantId,
          legalEntityId,
          params,
        );
        await persistSandboxTestEmailMutation(scope, actor.userId, sent);
        return sent;
      },
      { actionKind: 'sendSandboxReminderEmailFailClosed', payload: params },
    );
  }

  listMcpProposals(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
  ): Promise<McpProposalsListResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'read',
      (_scope, txWorkspace) => txWorkspace.listMcpProposals(actor, tenantId, legalEntityId),
    );
  }

  prepareMcpProposal(
    actor: WorkspaceActorContext,
    req: PrepareInvoiceAndPostingProposalInput,
    fixedProposalId?: string,
  ): Promise<PrepareInvoiceAndPostingProposalOutput> {
    return this.runCompanyOperation(
      actor,
      req.tenantId,
      req.legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const prepared = txWorkspace.prepareMcpProposal(actor, req, fixedProposalId);
        const stored = txWorkspace.store.getMcpProposal(prepared.proposalId);
        if (stored) {
          const existing = await scope.getMcpPreparedProposal(prepared.proposalId);
          if (!existing) {
            await persistMcpProposalWithIndexToScope(scope, stored);
          }
        }
        return prepared;
      },
      { actionKind: 'prepareMcpProposal', payload: req },
    );
  }

  issueMcpProposalChallenge(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    proposalId: string,
  ): Promise<IssueMcpChallengeResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const res = txWorkspace.issueMcpProposalChallenge(
          actor,
          tenantId,
          legalEntityId,
          proposalId,
        );
        const storedProposal = txWorkspace.store.getMcpProposal(proposalId);
        const storedChallenge = txWorkspace.store.getHumanChallenge(proposalId);
        if (storedProposal && storedChallenge) {
          await persistMcpChallengeMutation(scope, storedProposal, storedChallenge);
        }
        return res;
      },
      { actionKind: 'issueMcpProposalChallenge', payload: { proposalId } },
    );
  }

  confirmMcpProposal(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    proposalId: string,
    req: ConfirmMcpProposalRequest,
  ): Promise<ConfirmMcpProposalResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const compBefore = txWorkspace.store.getCompany(
          parseTenantId(tenantId),
          parseLegalEntityId(legalEntityId),
        );
        const prevDocIds = new Set((compBefore?.documents ?? []).map((d) => d.documentId));

        const confirmed = txWorkspace.confirmMcpProposal(
          actor,
          tenantId,
          legalEntityId,
          proposalId,
          req,
        );

        if (!confirmed.confirmation.idempotentReplay) {
          const comp = txWorkspace.store.getCompany(
            parseTenantId(tenantId),
            parseLegalEntityId(legalEntityId),
          );
          const stored = txWorkspace.store.getMcpProposal(proposalId);
          const postedDoc = comp?.documents.find((d) => !prevDocIds.has(d.documentId)) ?? null;
          if (comp && stored) {
            await persistConfirmMcpProposalMutation(scope, comp, stored, postedDoc);
          }
        }
        return confirmed;
      },
      { actionKind: 'confirmMcpProposal', payload: { proposalId, req } },
    );
  }

  rejectMcpProposal(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    proposalId: string,
    req?: RejectMcpProposalRequest,
  ): Promise<RejectMcpProposalResponse> {
    return this.runCompanyOperation(
      actor,
      tenantId,
      legalEntityId,
      'write',
      async (scope, txWorkspace) => {
        const rejected = txWorkspace.rejectMcpProposal(
          actor,
          tenantId,
          legalEntityId,
          proposalId,
          req,
        );
        const existing = await scope.getMcpPreparedProposal(proposalId);
        if (existing && existing.status === 'pending_human_approval') {
          await scope.rejectMcpPreparedProposal(proposalId);
        }
        return rejected;
      },
      { actionKind: 'rejectMcpProposal', payload: { proposalId, req: req ?? null } },
    );
  }

  createBoundMcpGateway(): PapMcpGateway {
    const gateway = this.innerWorkspace.createBoundMcpGateway(this.oidcVerifier);
    this.boundGateways.add(gateway);

    const origIssueChallenge = gateway.issueHumanConfirmationChallenge.bind(gateway);
    gateway.issueHumanConfirmationChallenge = async (input) => {
      if (typeof input.tenantId === 'string' && typeof input.legalEntityId === 'string') {
        await this.ensureCompanyHydratedIfValid(input.tenantId, input.legalEntityId, undefined, true);
      }
      return this.runAtomicMutation(async () => {
        const res = await origIssueChallenge(input);
        if (res.ok && input.humanBearerToken) {
          const storedProposal = this.store.getMcpProposal(input.proposalId);
          const storedChallenge = this.store.getHumanChallenge(input.proposalId);
          if (storedProposal && storedChallenge) {
            await executeAuthorizedCompanyAction(
              {
                rawBearerToken: input.humanBearerToken,
                requestId: input.correlationId ?? randomUUID(),
                operationId: randomUUID(),
                tenantId: storedProposal.tenantId,
                legalEntityId: storedProposal.legalEntityId,
                action: 'write',
              },
              {
                ...this.runtime.securityServices,
                verifier: this.oidcVerifier,
              },
              async (_ctx, scope) => {
                await scope.lockCompanyTaxSettingsForUpdate();
                await persistMcpChallengeMutation(scope, storedProposal, storedChallenge);
                await scope.recordOperationProbe();
              },
            );
          }
        }
        return res;
      });
    };

    const origPrepare = gateway.prepareInvoiceAndPostingProposal.bind(gateway);
    gateway.prepareInvoiceAndPostingProposal = async (callContext, rawInput) => {
      const parsedPrepareObj =
        typeof rawInput === 'object' && rawInput !== null
          ? (rawInput as { tenantId?: unknown; legalEntityId?: unknown })
          : {};
      if (
        typeof parsedPrepareObj.tenantId === 'string' &&
        typeof parsedPrepareObj.legalEntityId === 'string'
      ) {
        await this.ensureCompanyHydratedIfValid(
          parsedPrepareObj.tenantId,
          parsedPrepareObj.legalEntityId,
          undefined,
          true,
        );
      }
      return this.mutationMutex.runExclusive(async () => {
        const snapshot = captureWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways);
        let result: Awaited<ReturnType<typeof origPrepare>>;
        try {
          result = await origPrepare(callContext, rawInput);
        } catch (error) {
          restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
          throw error;
        }

        if (result.ok && !result.data.idempotentReplay) {
          if (!callContext.rawBearerToken) {
            restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
            return {
              ok: false,
              error: {
                ok: false,
                errorCode: 'unauthenticated',
                messagePl: 'Brak uwierzytelnionego tokena OIDC do utrwalenia propozycji MCP.',
                auditEventId: result.data.auditEventId,
                retryable: false,
              },
            };
          }

          const stored = this.store.getMcpProposal(result.data.proposalId);
          if (stored) {
            let dbError: unknown = null;
            let txRes: ExecuteAuthorizedCompanyActionResult<void> | null = null;
            try {
              txRes = await executeAuthorizedCompanyAction(
                {
                  rawBearerToken: callContext.rawBearerToken,
                  requestId: callContext.correlationId ?? randomUUID(),
                  operationId: randomUUID(),
                  tenantId: stored.tenantId,
                  legalEntityId: stored.legalEntityId,
                  action: 'write',
                },
                {
                  ...this.runtime.securityServices,
                  verifier: this.oidcVerifier,
                },
                async (_ctx, scope) => {
                  try {
                    await scope.lockCompanyTaxSettingsForUpdate();
                    const existing = await scope.getMcpPreparedProposal(stored.proposalId);
                    if (!existing) {
                      await persistMcpProposalWithIndexToScope(scope, stored);
                    }
                    await scope.recordOperationProbe();
                  } catch (err) {
                    dbError = err;
                    throw err;
                  }
                },
              );
            } catch (err) {
              dbError ??= err;
            }

            if (dbError !== null || !txRes || !txRes.allowed) {
              restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
              const errorCode: McpToolErrorCode =
                txRes && !txRes.allowed && txRes.status === 'forbidden'
                  ? 'forbidden'
                  : txRes && !txRes.allowed && txRes.status === 'unauthenticated'
                    ? 'unauthenticated'
                    : 'audit_unavailable';
              return {
                ok: false,
                error: {
                  ok: false,
                  errorCode,
                  messagePl:
                    errorCode === 'forbidden'
                      ? 'Odmowa zapisu propozycji MCP w PostgreSQL (brak uprawnień do firmy).'
                      : 'Podsystem persystencji i audytu PostgreSQL jest niedostępny — wycofano zmianę w pamięci (fail-closed).',
                  auditEventId: result.data.auditEventId,
                  retryable: errorCode === 'audit_unavailable',
                },
              };
            }
          }
        }
        return result;
      });
    };

    const origConfirm = gateway.confirmPreparedProposal.bind(gateway);
    gateway.confirmPreparedProposal = async (callContext, rawInput) => {
      const parsedConfirmObj =
        typeof rawInput === 'object' && rawInput !== null
          ? (rawInput as { tenantId?: unknown; legalEntityId?: unknown; proposalId?: unknown })
          : {};
      if (
        typeof parsedConfirmObj.tenantId === 'string' &&
        typeof parsedConfirmObj.legalEntityId === 'string'
      ) {
        await this.ensureCompanyHydratedIfValid(
          parsedConfirmObj.tenantId,
          parsedConfirmObj.legalEntityId,
          undefined,
          true,
        );
      }
      return this.mutationMutex.runExclusive(async () => {
        const snapshot = captureWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways);
        const rawTenantId =
          typeof parsedConfirmObj.tenantId === 'string' ? parsedConfirmObj.tenantId : null;
        const rawLeId =
          typeof parsedConfirmObj.legalEntityId === 'string'
            ? parsedConfirmObj.legalEntityId
            : null;
        const prevDocIds = new Set<string>();
        if (rawTenantId && rawLeId) {
          try {
            const compBefore = this.store.getCompany(
              parseTenantId(rawTenantId),
              parseLegalEntityId(rawLeId),
            );
            for (const d of compBefore?.documents ?? []) {
              prevDocIds.add(d.documentId);
            }
          } catch {
            // Zostanie odrzucone przez walidator kontraktu w gateway.
          }
        }

        let result: Awaited<ReturnType<typeof origConfirm>>;
        try {
          result = await origConfirm(callContext, rawInput);
        } catch (error) {
          restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
          throw error;
        }

        if (result.ok && !result.data.idempotentReplay) {
          if (!callContext.rawBearerToken) {
            restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
            return {
              ok: false,
              error: {
                ok: false,
                errorCode: 'unauthenticated',
                messagePl: 'Brak uwierzytelnionego tokena OIDC do zatwierdzenia propozycji MCP.',
                auditEventId: result.data.auditEventId,
                retryable: false,
              },
            };
          }

          const comp = this.store.getCompany(
            parseTenantId(result.data.tenantId),
            parseLegalEntityId(result.data.legalEntityId),
          );
          const stored = this.store.getMcpProposal(result.data.proposalId);
          const postedDoc = comp?.documents.find((d) => !prevDocIds.has(d.documentId)) ?? null;
          if (comp && stored) {
            let dbError: unknown = null;
            let txRes: ExecuteAuthorizedCompanyActionResult<void> | null = null;
            try {
              txRes = await executeAuthorizedCompanyAction(
                {
                  rawBearerToken: callContext.rawBearerToken,
                  requestId: callContext.correlationId ?? randomUUID(),
                  operationId: randomUUID(),
                  tenantId: result.data.tenantId,
                  legalEntityId: result.data.legalEntityId,
                  action: 'write',
                },
                {
                  ...this.runtime.securityServices,
                  verifier: this.oidcVerifier,
                },
                async (_ctx, scope) => {
                  try {
                    await scope.lockCompanyTaxSettingsForUpdate();
                    await persistConfirmMcpProposalMutation(scope, comp, stored, postedDoc);
                    await scope.recordOperationProbe();
                  } catch (err) {
                    dbError = err;
                    throw err;
                  }
                },
              );
            } catch (err) {
              dbError ??= err;
            }

            if (dbError !== null || !txRes || !txRes.allowed) {
              restoreWorkspaceRamSnapshot(this.innerWorkspace, this.boundGateways, snapshot);
              let errorCode: McpToolErrorCode = 'audit_unavailable';
              let messagePl =
                'Transakcja księgowania w PostgreSQL nie powiodła się — wycofano stan pamięci RAM (brak split-brain).';
              let retryable = true;

              if (dbError instanceof AccountingWorkspaceConflictError) {
                errorCode =
                  dbError.reasonCode === 'proposal_expired'
                    ? 'proposal_expired'
                    : 'proposal_already_processed';
                messagePl = dbError.message;
                retryable = false;
              } else if (txRes && !txRes.allowed) {
                if (txRes.status === 'forbidden') {
                  errorCode = 'forbidden';
                  messagePl =
                    'Odmowa zatwierdzenia propozycji MCP w PostgreSQL (brak uprawnień zapisu).';
                  retryable = false;
                } else if (txRes.status === 'unauthenticated') {
                  errorCode = 'unauthenticated';
                  messagePl = 'Weryfikacja tokena OIDC zakończyła się odmową.';
                  retryable = false;
                }
              }

              return {
                ok: false,
                error: {
                  ok: false,
                  errorCode,
                  messagePl,
                  auditEventId: result.data.auditEventId,
                  retryable,
                },
              };
            }
          }
        }
        return result;
      });
    };

    return gateway;
  }
}
