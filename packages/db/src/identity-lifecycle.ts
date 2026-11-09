import { randomUUID } from 'node:crypto';
import {
  computeDelegatedGrantValidUntil,
  copyAccessManagementCommand,
  type AccessManagementCommand,
  type AccessManagementResult,
  type AcceptTenantInvitationDeniedReason,
  type AcceptTenantInvitationStoreInput,
  type AcceptTenantInvitationStoreResult,
  type ActorSessionDirectoryResult,
  type BootstrapInitialOwnerDeniedReason,
  type BootstrapInitialOwnerReceipt,
  type BootstrapInitialOwnerStoreInput,
  type BootstrapInitialOwnerStoreResult,
  type CompanyRlsSessionContext,
  type CreateTenantInvitationDeniedReason,
  type CreateTenantInvitationStoreInput,
  type CreateTenantInvitationStoreResult,
  type GetActorSessionDirectoryResult,
  type IdentityLifecycleStorePort,
  type InvitationCompanyGrantSpec,
  type ListTenantInvitationsStoreInput,
  type ListTenantInvitationsStoreResult,
  type ProvisionOrResolveOidcUserDeniedReason,
  type ProvisionOrResolveOidcUserInput,
  type ProvisionOrResolveOidcUserResult,
  type RejectTenantInvitationDeniedReason,
  type RejectTenantInvitationStoreInput,
  type RejectTenantInvitationStoreResult,
  type RevokeTenantInvitationDeniedReason,
  type RevokeTenantInvitationStoreInput,
  type RevokeTenantInvitationStoreResult,
  type TenantInvitationRecord,
  type UpsertUserProfileInput,
  type UserProfileRecord,
} from '@pap/application';
import {
  decideAccessManagementAuthorization,
  grantId as parseGrantId,
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
  type CompanyAccessGrant,
} from '@pap/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  createPostgresAccountingScope,
  isDuplicateCompanyNipRollbackError,
  type PostgresAccountingScope,
  type ProvisionCompanyDeniedReason,
} from './accounting-scope.js';
import type { connectDatabase } from './client.js';
import { ScopeClosedError } from './company-operation-probe.js';
import { companyAccessGrant } from './schema.js';
import { appendSecurityDecision } from './security-audit.js';
import type { PostgresContextSigner } from './signed-context.js';
import {
  applyLocalRlsSessionContext,
  readTransactionClockNow,
  runManagedTransaction,
  type PostgresTransaction,
} from './transaction-primitives.js';

type IdentityLifecycleDatabase = Pick<ReturnType<typeof connectDatabase>['db'], 'transaction'>;

interface SqlBootstrapOpResponse {
  readonly ok: boolean;
  readonly idempotentReplay?: boolean;
  readonly receipt?: BootstrapInitialOwnerReceipt;
  readonly reason?: BootstrapInitialOwnerDeniedReason;
}

interface SqlProfileOpResponse {
  readonly ok: boolean;
  readonly profile?: UserProfileRecord;
  readonly reason?: string;
}

interface SqlDirectoryOpResponse {
  readonly ok: boolean;
  readonly userId?: string;
  readonly profile?: UserProfileRecord | null;
  readonly memberships?: ActorSessionDirectoryResult['memberships'];
  readonly reason?: 'user_inactive_or_missing' | 'invalid_identity_input';
}

interface SqlProvisionUserOpResponse {
  readonly ok: boolean;
  readonly userId?: string;
  readonly created?: boolean;
  readonly profile?: UserProfileRecord;
  readonly reason?: ProvisionOrResolveOidcUserDeniedReason;
}

interface SqlCreateInvitationOpResponse {
  readonly ok: boolean;
  readonly invitation?: TenantInvitationRecord;
  readonly auditEventId?: string;
  readonly reason?: CreateTenantInvitationDeniedReason;
}

interface SqlListInvitationsOpResponse {
  readonly ok: boolean;
  readonly tenantId?: string;
  readonly invitations?: readonly TenantInvitationRecord[];
  readonly reason?:
    | 'active_admin_membership_required'
    | 'admin_role_required'
    | 'user_disabled'
    | 'invalid_invitation_input';
}

interface SqlRevokeInvitationOpResponse {
  readonly ok: boolean;
  readonly idempotentReplay?: boolean;
  readonly invitation?: TenantInvitationRecord;
  readonly auditEventId?: string;
  readonly reason?: RevokeTenantInvitationDeniedReason;
}

interface SqlAcceptInvitationOpResponse {
  readonly ok: boolean;
  readonly idempotentReplay?: boolean;
  readonly userId?: string;
  readonly invitation?: TenantInvitationRecord;
  readonly membership?: ActorSessionDirectoryResult['memberships'][number];
  readonly grantedCompanyIds?: readonly string[];
  readonly auditEventId?: string;
  readonly needsMembershipReactivation?: boolean;
  readonly existingMembershipStatus?: 'active' | 'revoked' | null;
  readonly inviterUserId?: string;
  readonly inviterRole?: 'tenant_owner' | 'tenant_admin';
  readonly inviterMembershipValidFrom?: string;
  readonly inviterMembershipValidUntil?: string | null;
  readonly initialCompanyGrants?: readonly InvitationCompanyGrantSpec[];
  readonly reason?: AcceptTenantInvitationDeniedReason;
}

interface SqlRejectInvitationOpResponse {
  readonly ok: boolean;
  readonly idempotentReplay?: boolean;
  readonly userId?: string;
  readonly invitation?: TenantInvitationRecord;
  readonly auditEventId?: string;
  readonly reason?: RejectTenantInvitationDeniedReason;
}

function freezeInvitationRecord(inv: TenantInvitationRecord): TenantInvitationRecord {
  return Object.freeze({
    ...inv,
    initialCompanyGrants: Object.freeze(
      inv.initialCompanyGrants.map((g) =>
        Object.freeze({
          legalEntityId: g.legalEntityId,
          actions: Object.freeze([...g.actions]),
        }),
      ),
    ),
  });
}

export interface BootstrapInitialCompanyInTxOptions {
  readonly legalEntityId: string;
  readonly displayName: string;
  readonly profileCode: string;
  readonly nip: string;
  readonly profileJson?: Readonly<Record<string, unknown>> | undefined;
  readonly companySummaryKey: string;
  readonly onProvisionedInTransaction?:
    | ((scope: PostgresAccountingScope, ownerReceipt: BootstrapInitialOwnerReceipt) => Promise<void>)
    | undefined;
}

export type BootstrapInitialOwnerWithCompanyResult =
  | BootstrapInitialOwnerStoreResult
  | {
      readonly ok: false;
      readonly reason: BootstrapInitialOwnerDeniedReason | ProvisionCompanyDeniedReason;
    };

export class PostgresIdentityLifecycleStore implements IdentityLifecycleStorePort {
  readonly #db: IdentityLifecycleDatabase;
  readonly #signer: PostgresContextSigner;

  constructor(db: IdentityLifecycleDatabase, signer: PostgresContextSigner) {
    this.#db = db;
    this.#signer = signer;
    Object.freeze(this);
  }

  async #executeOp<TResult>(
    tx: PostgresTransaction,
    kind: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<TResult> {
    const fullPayload = { kind, ...payload };
    const cmdJson = JSON.stringify(fullPayload);
    await this.#signer.apply(tx, {
      purpose: 'identity_lifecycle',
      command: fullPayload,
    });
    const [row] = await tx.execute<{ result: TResult }>(
      sql`SELECT pap_wave2_identity_op(${cmdJson}::jsonb) AS result`,
    );
    if (!row || row.result === undefined || row.result === null) {
      throw new Error('Brak odpowiedzi z funkcji pap_wave2_identity_op.');
    }
    return row.result;
  }

  async bootstrapInitialOwner(
    input: BootstrapInitialOwnerStoreInput,
  ): Promise<BootstrapInitialOwnerStoreResult> {
    return runManagedTransaction(
      this.#db,
      async (tx) => {
        const res = await this.#executeOp<SqlBootstrapOpResponse>(tx, 'bootstrap_initial_owner', {
          operationId: input.operationId,
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          issuer: input.issuer,
          subject: input.subject,
          displayName: input.displayName,
          email: input.email.toLowerCase(),
          ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
          tenantName: input.tenantName,
          reason: input.reason,
          ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
        });
        if (!res.ok || !res.receipt) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_bootstrap_input',
          });
        }
        return Object.freeze({
          ok: true as const,
          idempotentReplay: res.idempotentReplay === true,
          receipt: Object.freeze({ ...res.receipt }),
        });
      },
      (result) => result.ok,
    );
  }

  async bootstrapInitialOwnerWithCompany(
    input: BootstrapInitialOwnerStoreInput,
    initialCompany?: BootstrapInitialCompanyInTxOptions,
  ): Promise<BootstrapInitialOwnerWithCompanyResult> {
    if (!initialCompany) {
      return this.bootstrapInitialOwner(input);
    }

    const canonicalNip = initialCompany.nip.replace(/[\s-]/g, '').trim();
    const canonicalLegalEntityId = parseLegalEntityId(initialCompany.legalEntityId);

    try {
      return await runManagedTransaction(
        this.#db,
        async (tx): Promise<BootstrapInitialOwnerWithCompanyResult> => {
          const decisionTime = input.now ?? (await readTransactionClockNow(tx));
          const decisionAtIso = decisionTime.toISOString();

          const ownerRes = await this.#executeOp<SqlBootstrapOpResponse>(
            tx,
            'bootstrap_initial_owner',
            {
              operationId: input.operationId,
              ...(input.userId !== undefined ? { userId: input.userId } : {}),
              issuer: input.issuer,
              subject: input.subject,
              displayName: input.displayName,
              email: input.email.toLowerCase(),
              ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
              tenantName: input.tenantName,
              reason: input.reason,
              initialCompanyKey: initialCompany.companySummaryKey,
              initialLegalEntityId: canonicalLegalEntityId,
              nowIso: decisionAtIso,
            },
          );

          if (!ownerRes.ok || !ownerRes.receipt) {
            return Object.freeze({
              ok: false as const,
              reason: ownerRes.reason ?? 'invalid_bootstrap_input',
            });
          }

          if (ownerRes.idempotentReplay === true) {
            return Object.freeze({
              ok: true as const,
              idempotentReplay: true,
              receipt: Object.freeze({ ...ownerRes.receipt }),
            });
          }

          const canonicalTenantId = parseTenantId(ownerRes.receipt.tenantId);
          const canonicalActorId = parseUserId(ownerRes.receipt.userId);
          const companyOpId = randomUUID();

          if (/^\d{10}$/.test(canonicalNip)) {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${`pap:provision:${canonicalTenantId}`}), hashtext(${canonicalNip}))`,
            );
          }

          await this.#signer.apply(tx, {
            purpose: 'provision_company',
            actorUserId: canonicalActorId,
            targetUserId: canonicalActorId,
            tenantId: canonicalTenantId,
            legalEntityId: canonicalLegalEntityId,
            operationId: companyOpId,
            decisionAt: decisionAtIso,
            command: {
              kind: 'provision_company',
              operationId: companyOpId,
              tenantId: canonicalTenantId,
              userId: canonicalActorId,
              legalEntityId: canonicalLegalEntityId,
              displayName: initialCompany.displayName,
              profileCode: initialCompany.profileCode,
              profileJson: initialCompany.profileJson ?? {},
              nip: canonicalNip,
            },
          });

          const [provRow] = await tx.execute<{
            result:
              | {
                  readonly ok: true;
                  readonly receipt: {
                    readonly operationId: string;
                    readonly occurredAt: string;
                    readonly changed: boolean;
                    readonly grantId: string | null;
                    readonly legalEntityId: string;
                  };
                }
              | {
                  readonly ok: false;
                  readonly reason: ProvisionCompanyDeniedReason;
                };
          }>(sql`SELECT pap_provision_company() AS result`);

          const provPayload = provRow?.result;
          if (!provPayload) {
            throw new Error('Brak wyniku z funkcji pap_provision_company().');
          }
          if (!provPayload.ok) {
            return Object.freeze({
              ok: false as const,
              reason: provPayload.reason,
            });
          }

          await appendSecurityDecision(
            tx,
            {
              requestId: input.operationId,
              operationId: companyOpId,
              accessManagementOperationId: companyOpId,
              actorId: canonicalActorId,
              targetUserId: canonicalActorId,
              tenantId: canonicalTenantId,
              legalEntityId: canonicalLegalEntityId,
              action: 'provision_company',
              kind: 'access',
              decision: 'allow',
              outcome: 'committed',
              reason: 'authorized_tenant_administration',
              decidedAt: decisionAtIso,
            },
            this.#signer,
          );

          if (initialCompany.onProvisionedInTransaction) {
            const provisionedEntityId = parseLegalEntityId(provPayload.receipt.legalEntityId);
            const companyInitOperationId = randomUUID();
            const companySessionContext: CompanyRlsSessionContext = Object.freeze({
              operationId: companyInitOperationId,
              decisionAt: decisionAtIso,
              actorUserId: canonicalActorId,
              tenantId: canonicalTenantId,
              legalEntityId: provisionedEntityId,
              action: 'write',
            });
            await this.#signer.apply(tx, {
              purpose: 'company',
              actorUserId: canonicalActorId,
              tenantId: canonicalTenantId,
              legalEntityId: provisionedEntityId,
              action: 'write',
              operationId: companyInitOperationId,
              decisionAt: decisionAtIso,
            });
            await applyLocalRlsSessionContext(tx, companySessionContext);
            let initScopeActive = true;
            const assertInitScopeActive = (): void => {
              if (!initScopeActive) {
                throw new ScopeClosedError();
              }
            };
            const initScope = createPostgresAccountingScope(
              Object.freeze({
                tx,
                context: companySessionContext,
                assertActive: assertInitScopeActive,
              }),
            );
            try {
              await initScope.recordOperationProbe(companyInitOperationId);
              await initialCompany.onProvisionedInTransaction(initScope, ownerRes.receipt);
            } finally {
              initScopeActive = false;
            }
            await appendSecurityDecision(
              tx,
              {
                requestId: randomUUID(),
                operationId: companyInitOperationId,
                actorId: canonicalActorId,
                tenantId: canonicalTenantId,
                legalEntityId: provisionedEntityId,
                action: 'write',
                kind: 'company',
                decision: 'allow',
                outcome: 'committed',
                reason: 'explicit_company_grant',
                decidedAt: decisionAtIso,
              },
              this.#signer,
            );
          }

          return Object.freeze({
            ok: true as const,
            idempotentReplay: false,
            receipt: Object.freeze({
              ...ownerRes.receipt,
              legalEntityId: provPayload.receipt.legalEntityId,
            }),
          });
        },
        (result) => result.ok,
      );
    } catch (err) {
      if (isDuplicateCompanyNipRollbackError(err)) {
        return Object.freeze({
          ok: false as const,
          reason: 'duplicate_company_nip' as const,
        });
      }
      throw err;
    }
  }

  async upsertUserProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord | null> {
    return this.#db.transaction(async (tx) => {
      const res = await this.#executeOp<SqlProfileOpResponse>(tx, 'upsert_user_profile', {
        userId: input.userId,
        displayName: input.displayName,
        email: input.email.toLowerCase(),
        ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
      });
      if (!res.ok || !res.profile) {
        return null;
      }
      return Object.freeze({ ...res.profile });
    });
  }

  async getActorSessionDirectory(
    userId: string,
    now?: Date,
  ): Promise<GetActorSessionDirectoryResult> {
    return this.#db.transaction(async (tx) => {
      const res = await this.#executeOp<SqlDirectoryOpResponse>(
        tx,
        'get_actor_session_directory',
        {
          userId,
          ...(now !== undefined ? { nowIso: now.toISOString() } : {}),
        },
      );
      if (!res.ok || !res.userId) {
        return Object.freeze({
          ok: false as const,
          reason: res.reason ?? 'user_inactive_or_missing',
        });
      }
      return Object.freeze({
        ok: true as const,
        userId: res.userId,
        profile: res.profile ? Object.freeze({ ...res.profile }) : null,
        memberships: Object.freeze((res.memberships ?? []).map((m) => Object.freeze({ ...m }))),
      });
    });
  }

  async provisionOrResolveOidcUser(
    input: ProvisionOrResolveOidcUserInput,
  ): Promise<ProvisionOrResolveOidcUserResult> {
    return runManagedTransaction(
      this.#db,
      async (tx) => {
        const res = await this.#executeOp<SqlProvisionUserOpResponse>(
          tx,
          'provision_or_resolve_oidc_user',
          {
            ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
            issuer: input.issuer,
            subject: input.subject,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
            ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
          },
        );
        if (!res.ok || !res.userId || !res.profile) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_identity_input',
          });
        }
        return Object.freeze({
          ok: true as const,
          userId: res.userId,
          created: res.created === true,
          profile: Object.freeze({ ...res.profile }),
        });
      },
      (result) => result.ok,
    );
  }

  async createTenantInvitation(
    input: CreateTenantInvitationStoreInput,
  ): Promise<CreateTenantInvitationStoreResult> {
    return runManagedTransaction(
      this.#db,
      async (tx) => {
        const res = await this.#executeOp<SqlCreateInvitationOpResponse>(tx, 'create_invitation', {
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          tokenSha256: input.tokenSha256,
          inviteeEmail: input.inviteeEmail.toLowerCase(),
          ...(input.inviteeDisplayName !== undefined
            ? { inviteeDisplayName: input.inviteeDisplayName }
            : {}),
          intendedRole: input.intendedRole,
          initialCompanyGrants: input.initialCompanyGrants.map((g) => ({
            legalEntityId: g.legalEntityId,
            actions: [...g.actions],
          })),
          expiresAtIso: input.expiresAt.toISOString(),
          reason: input.reason,
          ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
        });
        if (!res.ok || !res.invitation || !res.auditEventId) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_invitation_input',
          });
        }
        return Object.freeze({
          ok: true as const,
          invitation: freezeInvitationRecord(res.invitation),
          auditEventId: res.auditEventId,
        });
      },
      (result) => result.ok,
    );
  }

  async listTenantInvitations(
    input: ListTenantInvitationsStoreInput,
  ): Promise<ListTenantInvitationsStoreResult> {
    return this.#db.transaction(async (tx) => {
      const res = await this.#executeOp<SqlListInvitationsOpResponse>(
        tx,
        'list_tenant_invitations',
        {
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
        },
      );
      if (!res.ok || !res.tenantId || !res.invitations) {
        return Object.freeze({
          ok: false as const,
          reason: res.reason ?? 'invalid_invitation_input',
        });
      }
      return Object.freeze({
        ok: true as const,
        tenantId: res.tenantId,
        invitations: Object.freeze(res.invitations.map((inv) => freezeInvitationRecord(inv))),
      });
    });
  }

  async revokeTenantInvitation(
    input: RevokeTenantInvitationStoreInput,
  ): Promise<RevokeTenantInvitationStoreResult> {
    return runManagedTransaction(
      this.#db,
      async (tx) => {
        const res = await this.#executeOp<SqlRevokeInvitationOpResponse>(tx, 'revoke_invitation', {
          operationId: input.operationId,
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          invitationId: input.invitationId,
          reason: input.reason,
          ...(input.now !== undefined ? { nowIso: input.now.toISOString() } : {}),
        });
        if (!res.ok || !res.invitation || !res.auditEventId) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_invitation_input',
          });
        }
        return Object.freeze({
          ok: true as const,
          idempotentReplay: res.idempotentReplay === true,
          invitation: freezeInvitationRecord(res.invitation),
          auditEventId: res.auditEventId,
        });
      },
      (result) => result.ok,
    );
  }

  async #executeAccessCommandInTx(params: {
    readonly tx: PostgresTransaction;
    readonly actorUserId: ReturnType<typeof parseUserId>;
    readonly targetUserId: ReturnType<typeof parseUserId>;
    readonly tenantId: ReturnType<typeof parseTenantId>;
    readonly command: AccessManagementCommand;
    readonly decisionAtIso: string;
    readonly requestId: string;
  }): Promise<boolean> {
    const cmd = copyAccessManagementCommand(params.command);
    await this.#signer.apply(params.tx, {
      purpose: 'access',
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      targetUserId: params.targetUserId,
      command: cmd,
      decisionAt: params.decisionAtIso,
      ...(cmd.kind === 'grant' ? { legalEntityId: cmd.legalEntityId } : {}),
    });
    const [row] = await params.tx.execute<{ result: AccessManagementResult }>(
      sql`SELECT pap_execute_access() AS result`,
    );
    if (!row?.result?.ok) {
      return false;
    }
    await appendSecurityDecision(
      params.tx,
      {
        requestId: params.requestId,
        operationId: cmd.operationId,
        accessManagementOperationId: cmd.operationId,
        actorId: params.actorUserId,
        targetUserId: params.targetUserId,
        tenantId: params.tenantId,
        legalEntityId: cmd.kind === 'grant' ? cmd.legalEntityId : null,
        action: cmd.kind,
        kind: 'access',
        decision: 'allow',
        outcome: 'committed',
        reason: 'authorized_tenant_administration',
        decidedAt: params.decisionAtIso,
      },
      this.#signer,
    );
    return true;
  }

  async acceptTenantInvitation(
    input: AcceptTenantInvitationStoreInput,
  ): Promise<AcceptTenantInvitationStoreResult> {
    return runManagedTransaction(
      this.#db,
      async (tx): Promise<AcceptTenantInvitationStoreResult> => {
        const txClockNow = await readTransactionClockNow(tx);
        const decisionNow =
          input.now && input.now.getTime() <= txClockNow.getTime() ? input.now : txClockNow;
        const evalNow = input.now ?? txClockNow;
        const decisionNowIso = decisionNow.toISOString();
        const evalNowIso = evalNow.toISOString();

        const res = await this.#executeOp<SqlAcceptInvitationOpResponse>(tx, 'accept_invitation', {
          operationId: input.operationId,
          tokenSha256: input.tokenSha256,
          ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
          issuer: input.issuer,
          subject: input.subject,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
          nowIso: decisionNowIso,
          evalNowIso,
        });

        if (
          !res.ok ||
          !res.userId ||
          !res.invitation ||
          !res.membership ||
          !res.auditEventId ||
          !res.grantedCompanyIds
        ) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_invitation_input',
          });
        }

        if (res.idempotentReplay === true) {
          return Object.freeze({
            ok: true as const,
            idempotentReplay: true,
            userId: res.userId,
            invitation: freezeInvitationRecord(res.invitation),
            membership: Object.freeze({ ...res.membership }),
            grantedCompanyIds: Object.freeze([...res.grantedCompanyIds]),
            auditEventId: res.auditEventId,
          });
        }

        const canonicalTenantId = parseTenantId(res.invitation.tenantId);
        const canonicalInviterId = parseUserId(res.inviterUserId ?? res.invitation.invitedByUserId);
        const canonicalInviteeId = parseUserId(res.userId);
        const inviterRole = res.inviterRole ?? 'tenant_admin';
        const inviterValidFrom = res.inviterMembershipValidFrom
          ? new Date(res.inviterMembershipValidFrom)
          : decisionNow;
        const inviterValidUntil = res.inviterMembershipValidUntil
          ? new Date(res.inviterMembershipValidUntil)
          : null;

        if (res.needsMembershipReactivation === true) {
          if (res.existingMembershipStatus === 'active') {
            const revokeOk = await this.#executeAccessCommandInTx({
              tx,
              actorUserId: canonicalInviterId,
              targetUserId: canonicalInviteeId,
              tenantId: canonicalTenantId,
              command: {
                kind: 'revoke_membership',
                operationId: randomUUID(),
                tenantId: canonicalTenantId,
                userId: canonicalInviteeId,
              },
              decisionAtIso: decisionNowIso,
              requestId: input.operationId,
            });
            if (!revokeOk) {
              return Object.freeze({
                ok: false as const,
                reason: 'inviter_authority_revoked' as const,
              });
            }
          }

          const reactivateOk = await this.#executeAccessCommandInTx({
            tx,
            actorUserId: canonicalInviterId,
            targetUserId: canonicalInviteeId,
            tenantId: canonicalTenantId,
            command: {
              kind: 'reactivate_membership',
              operationId: randomUUID(),
              tenantId: canonicalTenantId,
              userId: canonicalInviteeId,
              validUntil: inviterValidUntil,
            },
            decisionAtIso: decisionNowIso,
            requestId: input.operationId,
          });
          if (!reactivateOk) {
            return Object.freeze({
              ok: false as const,
              reason: 'inviter_authority_revoked' as const,
            });
          }
        }

        const grantSpecs = res.initialCompanyGrants ?? res.invitation.initialCompanyGrants;
        if (grantSpecs.length > 0) {
          let inviterGrants: CompanyAccessGrant[] = [];
          if (inviterRole === 'tenant_admin') {
            const firstEntityId = parseLegalEntityId(grantSpecs[0]!.legalEntityId);
            const probeCmd: AccessManagementCommand = {
              kind: 'grant',
              operationId: randomUUID(),
              grantId: parseGrantId(randomUUID()),
              tenantId: canonicalTenantId,
              userId: canonicalInviteeId,
              legalEntityId: firstEntityId,
              action: 'read',
              validFrom: decisionNow,
              validUntil: inviterValidUntil,
            };
            await this.#signer.apply(tx, {
              purpose: 'facts',
              actorUserId: canonicalInviterId,
              tenantId: canonicalTenantId,
              targetUserId: canonicalInviteeId,
              command: probeCmd,
              legalEntityId: firstEntityId,
            });
            const lockedGrantRows = await tx
              .select()
              .from(companyAccessGrant)
              .where(
                and(
                  eq(companyAccessGrant.tenantId, canonicalTenantId),
                  eq(companyAccessGrant.userId, canonicalInviterId),
                ),
              )
              .orderBy(asc(companyAccessGrant.grantId))
              .for('share');

            inviterGrants = lockedGrantRows.map((g) => ({
              ...g,
              grantId: parseGrantId(g.grantId),
              tenantId: parseTenantId(g.tenantId),
              userId: parseUserId(g.userId),
              legalEntityId: parseLegalEntityId(g.legalEntityId),
            }));
          }

          const inviterMembership = {
            tenantId: canonicalTenantId,
            userId: canonicalInviterId,
            role: inviterRole,
            status: 'active' as const,
            validFrom: inviterValidFrom,
            validUntil: inviterValidUntil,
          };
          const inviteeMembership = {
            tenantId: canonicalTenantId,
            userId: canonicalInviteeId,
            role: res.invitation.intendedRole as 'tenant_admin' | 'tenant_member',
            status: 'active' as const,
            validFrom: decisionNow,
            validUntil: inviterValidUntil,
          };

          for (const spec of grantSpecs) {
            const canonicalEntityId = parseLegalEntityId(spec.legalEntityId);
            for (const action of spec.actions) {
              const boundedUntil = computeDelegatedGrantValidUntil({
                actorRole: inviterRole,
                actorMembershipUntil: inviterValidUntil,
                actorGrants: inviterGrants,
                tenantId: canonicalTenantId,
                legalEntityId: canonicalEntityId,
                action,
                now: evalNow,
              });
              const decision = decideAccessManagementAuthorization({
                actorUserId: canonicalInviterId,
                targetUserId: canonicalInviteeId,
                tenantId: canonicalTenantId,
                commandKind: 'grant',
                actorMembership: inviterMembership,
                actorGrants: inviterGrants,
                targetMembership: inviteeMembership,
                grantScope: {
                  legalEntityId: canonicalEntityId,
                  action,
                  validFrom: evalNow,
                  validUntil: boundedUntil,
                },
                now: evalNow,
              });
              if (!decision.allowed) {
                return Object.freeze({
                  ok: false as const,
                  reason: 'inviter_authority_revoked' as const,
                });
              }

              const grantOk = await this.#executeAccessCommandInTx({
                tx,
                actorUserId: canonicalInviterId,
                targetUserId: canonicalInviteeId,
                tenantId: canonicalTenantId,
                command: {
                  kind: 'grant',
                  operationId: randomUUID(),
                  grantId: parseGrantId(randomUUID()),
                  tenantId: canonicalTenantId,
                  userId: canonicalInviteeId,
                  legalEntityId: canonicalEntityId,
                  action,
                  validFrom: decisionNow,
                  validUntil: boundedUntil,
                },
                decisionAtIso: decisionNowIso,
                requestId: input.operationId,
              });
              if (!grantOk) {
                return Object.freeze({
                  ok: false as const,
                  reason: 'inviter_authority_revoked' as const,
                });
              }
            }
          }
        }

        return Object.freeze({
          ok: true as const,
          idempotentReplay: false,
          userId: res.userId,
          invitation: freezeInvitationRecord(res.invitation),
          membership: Object.freeze({ ...res.membership }),
          grantedCompanyIds: Object.freeze([...res.grantedCompanyIds]),
          auditEventId: res.auditEventId,
        });
      },
      (result) => result.ok,
    );
  }

  async rejectTenantInvitation(
    input: RejectTenantInvitationStoreInput,
  ): Promise<RejectTenantInvitationStoreResult> {
    return runManagedTransaction(
      this.#db,
      async (tx) => {
        const txClockNow = await readTransactionClockNow(tx);
        const decisionNow =
          input.now && input.now.getTime() <= txClockNow.getTime() ? input.now : txClockNow;
        const evalNow = input.now ?? txClockNow;

        const res = await this.#executeOp<SqlRejectInvitationOpResponse>(tx, 'reject_invitation', {
          operationId: input.operationId,
          tokenSha256: input.tokenSha256,
          ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
          issuer: input.issuer,
          subject: input.subject,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          nowIso: decisionNow.toISOString(),
          evalNowIso: evalNow.toISOString(),
        });
        if (!res.ok || !res.userId || !res.invitation || !res.auditEventId) {
          return Object.freeze({
            ok: false as const,
            reason: res.reason ?? 'invalid_invitation_input',
          });
        }
        return Object.freeze({
          ok: true as const,
          idempotentReplay: res.idempotentReplay === true,
          userId: res.userId,
          invitation: freezeInvitationRecord(res.invitation),
          auditEventId: res.auditEventId,
        });
      },
      (result) => result.ok,
    );
  }
}

export interface TenantMemberDirectoryItem {
  readonly userId: string;
  readonly displayName: string;
  readonly maskedEmail: string;
  readonly userActive: boolean;
}

export async function listTenantMemberDirectoryFromPostgres(
  db: Pick<Database, 'transaction'>,
  signer: PostgresContextSigner,
  input: {
    readonly actorUserId: string;
    readonly tenantId: string;
  },
): Promise<readonly TenantMemberDirectoryItem[]> {
  let canonicalActorId: ReturnType<typeof parseUserId>;
  let canonicalTenantId: ReturnType<typeof parseTenantId>;
  try {
    canonicalActorId = parseUserId(input.actorUserId);
    canonicalTenantId = parseTenantId(input.tenantId);
  } catch {
    return Object.freeze([]);
  }

  return db.transaction(async (tx) => {
    const cmdPayload = {
      kind: 'list_tenant_member_directory',
      actorUserId: canonicalActorId,
      tenantId: canonicalTenantId,
    };
    await signer.apply(tx, {
      purpose: 'identity_lifecycle',
      actorUserId: canonicalActorId,
      tenantId: canonicalTenantId,
      command: cmdPayload,
    });
    const cmdJson = JSON.stringify(cmdPayload);
    const [row] = await tx.execute<{
      result: {
        readonly ok: boolean;
        readonly members?: readonly TenantMemberDirectoryItem[] | undefined;
      };
    }>(sql`SELECT pap_wave2_identity_op(${cmdJson}::jsonb) AS result`);
    if (!row?.result?.ok || !Array.isArray(row.result.members)) {
      return Object.freeze([]);
    }
    return Object.freeze(row.result.members.map((m) => Object.freeze({ ...m })));
  });
}
