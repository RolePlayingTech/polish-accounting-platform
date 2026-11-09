import { randomUUID } from 'node:crypto';
import type {
  ActorSessionDirectoryResult,
  BootstrapInitialOwnerDeniedReason,
  BootstrapInitialOwnerReceipt,
  BootstrapInitialOwnerStoreInput,
  BootstrapInitialOwnerStoreResult,
  CompanyRlsSessionContext,
  GetActorSessionDirectoryResult,
  IdentityLifecycleStorePort,
  UpsertUserProfileInput,
  UserProfileRecord,
} from '@pap/application';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { sql } from 'drizzle-orm';
import {
  createPostgresAccountingScope,
  isDuplicateCompanyNipRollbackError,
  type PostgresAccountingScope,
  type ProvisionCompanyDeniedReason,
} from './accounting-scope.js';
import type { connectDatabase } from './client.js';
import { ScopeClosedError } from './company-operation-probe.js';
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
}
