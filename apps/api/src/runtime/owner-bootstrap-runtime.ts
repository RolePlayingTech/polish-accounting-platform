import { randomUUID } from 'node:crypto';
import {
  AccountingWorkspaceService,
  InMemoryAccountingWorkspaceStore,
  InMemoryIdentityLifecycleStore,
  toBootstrapOwnerResponse,
  validateBootstrapOwnerRequest,
  type BootstrapInitialOwnerDeniedReason,
  type IdentityLifecycleStorePort,
} from '@pap/application';
import type { BootstrapOwnerResponse, CreateCompanyRequest } from '@pap/contracts';
import { PostgresIdentityLifecycleStore, type ProvisionCompanyDeniedReason } from '@pap/db';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { hydrateCompanyIntoWorkspaceIfMissing } from './postgres-company-hydrator.js';
import {
  ensureLedgerAccountsInScope,
  persistCompanyTaxSettingsToScope,
} from './postgres-demo-seed.js';
import { canonicalJsonStringify, deterministicUuidV4 } from './postgres-mappers.js';
import {
  captureWorkspaceRamSnapshot,
  restoreWorkspaceRamSnapshot,
} from './postgres-ram-snapshot.js';
import type { ConnectedPostgresRuntime } from './postgres-runtime-config.js';
import type { WorkspaceRuntimePort } from './postgres-workspace-persistence.js';

export type OwnerBootstrapFailureReason =
  | BootstrapInitialOwnerDeniedReason
  | ProvisionCompanyDeniedReason
  | 'invalid_bootstrap_request'
  | 'bootstrap_store_unavailable';

export class OwnerBootstrapError extends Error {
  readonly statusCode: number;
  readonly reasonCode: OwnerBootstrapFailureReason;

  constructor(statusCode: number, reasonCode: OwnerBootstrapFailureReason, message: string) {
    super(message);
    this.name = 'OwnerBootstrapError';
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
  }
}

export interface OwnerBootstrapPort {
  bootstrapInitialOwner(rawRequest: unknown): Promise<BootstrapOwnerResponse>;
  beforeInitialCompanyCommitHook?:
    | ((info: {
        readonly tenantId: string;
        readonly legalEntityId: string;
        readonly nip: string;
      }) => Promise<void> | void)
    | undefined;
}

function mapFailureReasonToHttpStatus(reason: OwnerBootstrapFailureReason): number {
  switch (reason) {
    case 'invalid_bootstrap_request':
    case 'invalid_bootstrap_input':
    case 'invalid_command':
      return 400;
    case 'identity_revoked':
    case 'user_disabled':
    case 'active_membership_required':
    case 'access_management_denied':
      return 403;
    case 'owner_already_bootstrapped':
    case 'operation_conflict':
    case 'user_already_exists':
    case 'identity_already_linked':
    case 'tenant_already_exists':
    case 'duplicate_company_nip':
      return 409;
    default:
      return 503;
  }
}

function mapFailureReasonMessagePl(reason: OwnerBootstrapFailureReason): string {
  switch (reason) {
    case 'owner_already_bootstrapped':
      return 'Właściciel początkowy platformy został już wcześniej zainicjalizowany (jednorazowy bootstrap jest zablokowany).';
    case 'operation_conflict':
      return 'Wykryto konflikt idempotentności operationId z innymi parametrami bootstrapu.';
    case 'duplicate_company_nip':
      return 'Podmiot prawny o wskazanym numerze NIP już istnieje w tej organizacji.';
    case 'identity_revoked':
    case 'user_disabled':
      return 'Wskazana tożsamość OIDC lub konto użytkownika jest zablokowane bądź odwołane.';
    case 'user_already_exists':
    case 'identity_already_linked':
    case 'tenant_already_exists':
      return 'Wskazany identyfikator użytkownika, powiązanie OIDC lub organizacja już istnieje.';
    default:
      return 'Nie udało się wykonać jednorazowego bootstrapu właściciela platformy.';
  }
}

function prepareInitialCompanyTemplate(
  ownerSubject: string,
  ownerDisplayName: string,
  ownerEmail: string,
  req: CreateCompanyRequest,
) {
  const txStore = new InMemoryAccountingWorkspaceStore();
  const txWorkspace = new AccountingWorkspaceService({
    store: txStore,
    seedDemoData: false,
  });
  const scratchOwnerId = parseUserId(randomUUID());
  const scratchTenantId = parseTenantId(randomUUID());

  txStore.upsertUser({
    userId: scratchOwnerId,
    subject: ownerSubject,
    displayName: ownerDisplayName,
    email: ownerEmail,
    active: true,
  });
  txStore.upsertMembership({
    tenantId: scratchTenantId,
    userId: scratchOwnerId,
    role: 'tenant_owner',
    status: 'active',
    validFrom: new Date(),
    validUntil: null,
  });

  const created = txWorkspace.createCompany(
    {
      userId: scratchOwnerId,
      subject: ownerSubject,
      displayName: ownerDisplayName,
      email: ownerEmail,
      scopes: ['pap:ui:full'],
    },
    scratchTenantId,
    req,
  );
  const candidateCompany = txStore.getCompany(
    parseTenantId(created.company.tenantId),
    parseLegalEntityId(created.company.legalEntityId),
  );
  if (!candidateCompany) {
    throw new Error('Nie udało się przygotować szablonu początkowego podmiotu prawnego.');
  }

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

  return { created, candidateCompany, companyMetaPayload };
}

export class RuntimeOwnerBootstrapService implements OwnerBootstrapPort {
  readonly #lifecycleStore: IdentityLifecycleStorePort;
  readonly #workspace: WorkspaceRuntimePort;
  readonly #innerWorkspace: AccountingWorkspaceService | undefined;
  readonly #pgRuntime: ConnectedPostgresRuntime | undefined;

  public beforeInitialCompanyCommitHook:
    | ((info: {
        readonly tenantId: string;
        readonly legalEntityId: string;
        readonly nip: string;
      }) => Promise<void> | void)
    | undefined;

  constructor(options: {
    readonly lifecycleStore: IdentityLifecycleStorePort;
    readonly workspace: WorkspaceRuntimePort;
    readonly innerWorkspace?: AccountingWorkspaceService | undefined;
    readonly pgRuntime?: ConnectedPostgresRuntime | undefined;
  }) {
    this.#lifecycleStore = options.lifecycleStore;
    this.#workspace = options.workspace;
    this.#innerWorkspace = options.innerWorkspace;
    this.#pgRuntime = options.pgRuntime;
  }

  async bootstrapInitialOwner(rawRequest: unknown): Promise<BootstrapOwnerResponse> {
    const validated = validateBootstrapOwnerRequest(rawRequest);
    if (!validated.ok) {
      throw new OwnerBootstrapError(400, 'invalid_bootstrap_request', validated.message);
    }

    const data = validated.data;
    const operationId = data.operationId ?? randomUUID();

    if (this.#lifecycleStore instanceof PostgresIdentityLifecycleStore && this.#pgRuntime) {
      let companyTemplate: ReturnType<typeof prepareInitialCompanyTemplate> | undefined;
      if (data.initialCompany) {
        companyTemplate = prepareInitialCompanyTemplate(
          data.subject,
          data.displayName,
          data.email.toLowerCase(),
          data.initialCompany,
        );
      }

      const res = await this.#lifecycleStore.bootstrapInitialOwnerWithCompany(
        {
          operationId,
          ...(data.userId !== undefined ? { userId: data.userId } : {}),
          issuer: data.issuer,
          subject: data.subject,
          displayName: data.displayName,
          email: data.email.toLowerCase(),
          ...(data.tenantId !== undefined ? { tenantId: data.tenantId } : {}),
          tenantName: data.tenantName,
          reason: data.reason,
        },
        companyTemplate && data.initialCompany
          ? {
              legalEntityId: companyTemplate.created.company.legalEntityId,
              displayName: companyTemplate.created.company.displayName,
              profileCode: companyTemplate.created.taxProfile.profileCode,
              nip: companyTemplate.created.company.nip,
              profileJson: companyTemplate.companyMetaPayload as unknown as Record<string, unknown>,
              companySummaryKey: canonicalJsonStringify(data.initialCompany),
              onProvisionedInTransaction: async (initScope, ownerReceipt) => {
                const adjustedCompany = {
                  ...companyTemplate.candidateCompany,
                  tenantId: parseTenantId(ownerReceipt.tenantId),
                };
                await persistCompanyTaxSettingsToScope(initScope, adjustedCompany);
                await ensureLedgerAccountsInScope(initScope, adjustedCompany);
                await initScope.upsertNotificationPreference({
                  id: deterministicUuidV4(
                    `notif-pref:${ownerReceipt.tenantId}:${adjustedCompany.legalEntityId}:${ownerReceipt.userId}`,
                  ),
                  userId: ownerReceipt.userId,
                  recipientEmail: ownerReceipt.email,
                  frequency: 'standard',
                  optOut: false,
                });
                if (this.beforeInitialCompanyCommitHook) {
                  await this.beforeInitialCompanyCommitHook({
                    tenantId: ownerReceipt.tenantId,
                    legalEntityId: adjustedCompany.legalEntityId,
                    nip: adjustedCompany.nip,
                  });
                }
              },
            }
          : undefined,
      );

      if (!res.ok) {
        const status = mapFailureReasonToHttpStatus(res.reason);
        throw new OwnerBootstrapError(status, res.reason, mapFailureReasonMessagePl(res.reason));
      }

      this.#workspace.store.upsertUser({
        userId: parseUserId(res.receipt.userId),
        issuer: res.receipt.issuer,
        subject: res.receipt.subject,
        displayName: res.receipt.displayName,
        email: res.receipt.email,
        active: true,
      });
      this.#workspace.store.upsertMembership({
        tenantId: parseTenantId(res.receipt.tenantId),
        userId: parseUserId(res.receipt.userId),
        role: 'tenant_owner',
        status: 'active',
        validFrom: new Date(res.receipt.occurredAt),
        validUntil: null,
      });

      if (res.receipt.legalEntityId && this.#innerWorkspace) {
        await hydrateCompanyIntoWorkspaceIfMissing(
          this.#pgRuntime,
          this.#innerWorkspace,
          res.receipt.tenantId,
          res.receipt.legalEntityId,
          res.receipt.userId,
        );
      }

      return toBootstrapOwnerResponse({
        idempotentReplay: res.idempotentReplay,
        receipt: res.receipt,
      });
    }

    // Ścieżka in-memory (testy jednostkowe / LOCAL_DEV bez PostgreSQL):
    // walidujemy szablon początkowego podmiotu przed mutacją stanu i wykonujemy atomowy rollback migawki przy jakimkolwiek błędzie.
    if (data.initialCompany) {
      prepareInitialCompanyTemplate(
        data.subject,
        data.displayName,
        data.email.toLowerCase(),
        data.initialCompany,
      );
    }

    const emptyGateways = new Set<never>();
    const lifecycleSnap =
      this.#lifecycleStore instanceof InMemoryIdentityLifecycleStore
        ? this.#lifecycleStore.captureSnapshot()
        : undefined;
    const workspaceSnap = this.#innerWorkspace
      ? captureWorkspaceRamSnapshot(this.#innerWorkspace, emptyGateways)
      : undefined;

    const storeRes = await this.#lifecycleStore.bootstrapInitialOwner({
      operationId,
      ...(data.userId !== undefined ? { userId: data.userId } : {}),
      issuer: data.issuer,
      subject: data.subject,
      displayName: data.displayName,
      email: data.email.toLowerCase(),
      ...(data.tenantId !== undefined ? { tenantId: data.tenantId } : {}),
      tenantName: data.tenantName,
      reason: data.reason,
      ...(data.initialCompany !== undefined
        ? { initialCompanyKey: canonicalJsonStringify(data.initialCompany) }
        : {}),
    });

    if (!storeRes.ok) {
      const status = mapFailureReasonToHttpStatus(storeRes.reason);
      throw new OwnerBootstrapError(
        status,
        storeRes.reason,
        mapFailureReasonMessagePl(storeRes.reason),
      );
    }

    let provisionedLegalEntityId: string | null = storeRes.receipt.legalEntityId;
    if (!storeRes.idempotentReplay && data.initialCompany) {
      try {
        const created = await this.#workspace.createCompany(
          {
            userId: parseUserId(storeRes.receipt.userId),
            issuer: storeRes.receipt.issuer,
            subject: storeRes.receipt.subject,
            displayName: storeRes.receipt.displayName,
            email: storeRes.receipt.email,
            scopes: ['pap:ui:full'],
          },
          storeRes.receipt.tenantId,
          data.initialCompany,
        );
        provisionedLegalEntityId = created.company.legalEntityId;
        if (this.#lifecycleStore instanceof InMemoryIdentityLifecycleStore) {
          this.#lifecycleStore.recordBootstrapInitialCompany(operationId, provisionedLegalEntityId);
        }
        if (this.beforeInitialCompanyCommitHook) {
          await this.beforeInitialCompanyCommitHook({
            tenantId: storeRes.receipt.tenantId,
            legalEntityId: provisionedLegalEntityId,
            nip: created.company.nip,
          });
        }
      } catch (err) {
        if (lifecycleSnap && this.#lifecycleStore instanceof InMemoryIdentityLifecycleStore) {
          this.#lifecycleStore.restoreSnapshot(lifecycleSnap);
        }
        if (workspaceSnap && this.#innerWorkspace) {
          restoreWorkspaceRamSnapshot(this.#innerWorkspace, emptyGateways, workspaceSnap);
        }
        throw err;
      }
    }

    return toBootstrapOwnerResponse({
      idempotentReplay: storeRes.idempotentReplay,
      receipt: storeRes.receipt,
      legalEntityIdOverride: provisionedLegalEntityId,
    });
  }
}
