import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AuthenticatedSessionViewSchema,
  BootstrapOwnerRequestSchema,
  BootstrapOwnerResponseSchema,
  TaxPeriodMonthSchema,
  type AccessibleCompanyItem,
  type AuthenticatedSessionView,
  type BootstrapOwnerRequest,
  type BootstrapOwnerResponse,
  type TenantMembershipSummaryContract,
} from '@pap/contracts';
import { SafeEmailAddressSchema } from '@pap/contracts/notifications';
import {
  decideAccessManagementAuthorization,
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { DEMO_DEFAULT_PERIOD } from './demo-seed.js';
import type { AccountingWorkspaceStorePort } from './accounting-workspace.js';

export interface UserProfileRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ActorSessionDirectoryResult {
  readonly ok: true;
  readonly userId: string;
  readonly profile: UserProfileRecord | null;
  readonly memberships: readonly TenantMembershipSummaryContract[];
}

export type GetActorSessionDirectoryResult =
  | ActorSessionDirectoryResult
  | {
      readonly ok: false;
      readonly reason: 'user_inactive_or_missing' | 'invalid_identity_input';
    };

export interface UpsertUserProfileInput {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly now?: Date | undefined;
}

export interface ProvisionOrResolveOidcUserInput {
  readonly operationId?: string | undefined;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName?: string | undefined;
  readonly email?: string | undefined;
  readonly now?: Date | undefined;
}

export type ProvisionOrResolveOidcUserDeniedReason =
  | 'identity_revoked'
  | 'user_disabled'
  | 'invalid_identity_input';

export type ProvisionOrResolveOidcUserResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly created: boolean;
      readonly profile: UserProfileRecord;
    }
  | {
      readonly ok: false;
      readonly reason: ProvisionOrResolveOidcUserDeniedReason;
    };

export interface InvitationCompanyGrantSpec {
  readonly legalEntityId: string;
  readonly actions: readonly ('read' | 'write')[];
}

export type StoredTenantInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'rejected';

export interface TenantInvitationRecord {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly inviteeMaskedEmail: string;
  readonly inviteeDisplayName: string | null;
  readonly intendedRole: 'tenant_owner' | 'tenant_admin' | 'tenant_member';
  readonly initialCompanyGrants: readonly InvitationCompanyGrantSpec[];
  readonly status: StoredTenantInvitationStatus;
  readonly invitedByUserId: string;
  readonly invitedByDisplayName: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly acceptedByUserId: string | null;
  readonly revokedAt: string | null;
  readonly rejectedAt: string | null;
}

export interface CreateTenantInvitationStoreInput {
  readonly operationId: string;
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly tokenSha256: string;
  readonly inviteeEmail: string;
  readonly inviteeDisplayName?: string | undefined;
  readonly intendedRole: 'tenant_owner' | 'tenant_admin' | 'tenant_member';
  readonly initialCompanyGrants: readonly InvitationCompanyGrantSpec[];
  readonly expiresAt: Date;
  readonly reason: string;
  readonly now?: Date | undefined;
}

export type CreateTenantInvitationDeniedReason =
  | 'active_admin_membership_required'
  | 'admin_role_required'
  | 'target_role_not_delegable'
  | 'grant_scope_not_delegable'
  | 'duplicate_pending_invitation'
  | 'operation_conflict'
  | 'user_disabled'
  | 'invalid_invitation_input';

export type CreateTenantInvitationStoreResult =
  | {
      readonly ok: true;
      readonly invitation: TenantInvitationRecord;
      readonly auditEventId: string;
    }
  | {
      readonly ok: false;
      readonly reason: CreateTenantInvitationDeniedReason;
    };

export interface ListTenantInvitationsStoreInput {
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly now?: Date | undefined;
}

export type ListTenantInvitationsStoreResult =
  | {
      readonly ok: true;
      readonly tenantId: string;
      readonly invitations: readonly TenantInvitationRecord[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'active_admin_membership_required'
        | 'admin_role_required'
        | 'user_disabled'
        | 'invalid_invitation_input';
    };

export interface RevokeTenantInvitationStoreInput {
  readonly operationId: string;
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly reason: string;
  readonly now?: Date | undefined;
}

export type RevokeTenantInvitationDeniedReason =
  | 'active_admin_membership_required'
  | 'admin_role_required'
  | 'target_role_not_delegable'
  | 'grant_scope_not_delegable'
  | 'invitation_not_found'
  | 'invitation_not_pending'
  | 'operation_conflict'
  | 'user_disabled'
  | 'invalid_invitation_input';

export type RevokeTenantInvitationStoreResult =
  | {
      readonly ok: true;
      readonly idempotentReplay: boolean;
      readonly invitation: TenantInvitationRecord;
      readonly auditEventId: string;
    }
  | {
      readonly ok: false;
      readonly reason: RevokeTenantInvitationDeniedReason;
    };

export interface AcceptTenantInvitationStoreInput {
  readonly operationId: string;
  readonly tokenSha256: string;
  readonly actorUserId?: string | undefined;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName?: string | undefined;
  readonly email?: string | undefined;
  readonly now?: Date | undefined;
}

export type AcceptTenantInvitationDeniedReason =
  | 'invitation_not_found'
  | 'invitation_already_used'
  | 'invitation_expired'
  | 'invitation_revoked'
  | 'invitation_rejected'
  | 'self_invitation_acceptance_forbidden'
  | 'already_tenant_member'
  | 'membership_role_change_not_supported'
  | 'inviter_authority_revoked'
  | 'grant_scope_not_delegable'
  | 'operation_conflict'
  | 'identity_revoked'
  | 'user_disabled'
  | 'invalid_invitation_input';

export type AcceptTenantInvitationStoreResult =
  | {
      readonly ok: true;
      readonly idempotentReplay: boolean;
      readonly userId: string;
      readonly invitation: TenantInvitationRecord;
      readonly membership: TenantMembershipSummaryContract;
      readonly grantedCompanyIds: readonly string[];
      readonly auditEventId: string;
    }
  | {
      readonly ok: false;
      readonly reason: AcceptTenantInvitationDeniedReason;
    };

export interface RejectTenantInvitationStoreInput {
  readonly operationId: string;
  readonly tokenSha256: string;
  readonly actorUserId?: string | undefined;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName?: string | undefined;
  readonly email?: string | undefined;
  readonly reason?: string | undefined;
  readonly now?: Date | undefined;
}

export type RejectTenantInvitationDeniedReason =
  | 'invitation_not_found'
  | 'invitation_already_used'
  | 'invitation_expired'
  | 'invitation_revoked'
  | 'invitation_rejected'
  | 'operation_conflict'
  | 'identity_revoked'
  | 'user_disabled'
  | 'invalid_invitation_input';

export interface RejectTenantInvitationStoreResultSuccess {
  readonly ok: true;
  readonly idempotentReplay: boolean;
  readonly userId: string;
  readonly invitation: TenantInvitationRecord;
  readonly auditEventId: string;
}

export type RejectTenantInvitationStoreResult =
  | RejectTenantInvitationStoreResultSuccess
  | {
      readonly ok: false;
      readonly reason: RejectTenantInvitationDeniedReason;
    };

export interface BootstrapInitialOwnerStoreInput {
  readonly operationId: string;
  readonly userId?: string | undefined;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantId?: string | undefined;
  readonly tenantName: string;
  readonly reason: string;
  readonly initialCompanyKey?: string | undefined;
  readonly initialLegalEntityId?: string | undefined;
  readonly now?: Date | undefined;
}

export interface BootstrapInitialOwnerReceipt {
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: 'tenant_owner';
  readonly legalEntityId: string | null;
  readonly operationId: string;
  readonly auditEventId: string;
  readonly occurredAt: string;
}

export type BootstrapInitialOwnerDeniedReason =
  | 'owner_already_bootstrapped'
  | 'operation_conflict'
  | 'identity_revoked'
  | 'user_disabled'
  | 'user_already_exists'
  | 'identity_already_linked'
  | 'tenant_already_exists'
  | 'invalid_bootstrap_input';

export type BootstrapInitialOwnerStoreResult =
  | {
      readonly ok: true;
      readonly idempotentReplay: boolean;
      readonly receipt: BootstrapInitialOwnerReceipt;
    }
  | {
      readonly ok: false;
      readonly reason: BootstrapInitialOwnerDeniedReason;
    };

export interface IdentityLifecycleStorePort {
  bootstrapInitialOwner(
    input: BootstrapInitialOwnerStoreInput,
  ): Promise<BootstrapInitialOwnerStoreResult>;
  upsertUserProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord | null>;
  getActorSessionDirectory(
    userId: string,
    now?: Date,
  ): Promise<GetActorSessionDirectoryResult>;
  provisionOrResolveOidcUser(
    input: ProvisionOrResolveOidcUserInput,
  ): Promise<ProvisionOrResolveOidcUserResult>;
  createTenantInvitation(
    input: CreateTenantInvitationStoreInput,
  ): Promise<CreateTenantInvitationStoreResult>;
  listTenantInvitations(
    input: ListTenantInvitationsStoreInput,
  ): Promise<ListTenantInvitationsStoreResult>;
  revokeTenantInvitation(
    input: RevokeTenantInvitationStoreInput,
  ): Promise<RevokeTenantInvitationStoreResult>;
  acceptTenantInvitation(
    input: AcceptTenantInvitationStoreInput,
  ): Promise<AcceptTenantInvitationStoreResult>;
  rejectTenantInvitation(
    input: RejectTenantInvitationStoreInput,
  ): Promise<RejectTenantInvitationStoreResult>;
}

export function generateOpaqueInvitationToken(): {
  readonly rawToken: string;
  readonly tokenSha256: string;
} {
  const randomPart = randomBytes(32).toString('base64url');
  const rawToken = `pap_inv_${randomPart}`;
  return {
    rawToken,
    tokenSha256: hashInvitationTokenSha256(rawToken),
  };
}

export function hashInvitationTokenSha256(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function maskInvitationEmail(rawEmail: string): string {
  const normalized = rawEmail.trim().toLowerCase();
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return '***@***';
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const prefix = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${prefix}***@${domain}`.slice(0, 160);
}

export function computeDelegatedGrantValidUntil(params: {
  readonly actorRole: 'tenant_owner' | 'tenant_admin';
  readonly actorMembershipUntil: Date | null;
  readonly actorGrants: ReturnType<AccountingWorkspaceStorePort['listGrantsForUser']>;
  readonly tenantId: ReturnType<typeof parseTenantId>;
  readonly legalEntityId: ReturnType<typeof parseLegalEntityId>;
  readonly action: 'read' | 'write';
  readonly now: Date;
}): Date | null {
  const nowMs = params.now.getTime();
  let grantBoundMs: number | null = null;

  if (params.actorRole === 'tenant_admin') {
    const activeGrants = params.actorGrants.filter(
      (g) =>
        g.tenantId === params.tenantId &&
        g.legalEntityId === params.legalEntityId &&
        g.action === params.action &&
        g.validFrom.getTime() <= nowMs &&
        (g.validUntil === null || g.validUntil.getTime() > nowMs) &&
        (g.revokedAt === null || g.revokedAt.getTime() > nowMs),
    );
    if (activeGrants.length > 0) {
      let bestEndMs: number | null = -1;
      for (const g of activeGrants) {
        const gBounds: number[] = [];
        if (g.validUntil) {
          gBounds.push(g.validUntil.getTime());
        }
        if (g.revokedAt) {
          gBounds.push(g.revokedAt.getTime());
        }
        if (gBounds.length === 0) {
          bestEndMs = null;
          break;
        }
        const effectiveGrantEnd = Math.min(...gBounds);
        if (bestEndMs !== null && effectiveGrantEnd > bestEndMs) {
          bestEndMs = effectiveGrantEnd;
        }
      }
      grantBoundMs = bestEndMs === null || bestEndMs < 0 ? null : bestEndMs;
    }
  }

  const candidates: number[] = [];
  if (params.actorMembershipUntil) {
    candidates.push(params.actorMembershipUntil.getTime());
  }
  if (grantBoundMs !== null) {
    candidates.push(grantBoundMs);
  }
  return candidates.length === 0 ? null : new Date(Math.min(...candidates));
}

function canonicalBootstrapRequestKey(input: BootstrapInitialOwnerStoreInput): string {
  return JSON.stringify({
    operationId: input.operationId,
    userId: input.userId ?? null,
    issuer: input.issuer,
    subject: input.subject,
    displayName: input.displayName,
    email: input.email.toLowerCase(),
    tenantId: input.tenantId ?? null,
    tenantName: input.tenantName,
    reason: input.reason,
    initialCompanyKey: input.initialCompanyKey ?? null,
  });
}

interface StoredInMemoryInvitation {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly tokenSha256: string;
  readonly inviteeEmail: string;
  readonly inviteeDisplayName: string | null;
  readonly intendedRole: 'tenant_admin' | 'tenant_member';
  readonly initialCompanyGrants: readonly InvitationCompanyGrantSpec[];
  status: 'pending' | 'accepted' | 'revoked' | 'rejected';
  readonly invitedByUserId: string;
  readonly invitedByDisplayName: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  revokedAt: string | null;
  rejectedAt: string | null;
}

export class InMemoryIdentityLifecycleStore implements IdentityLifecycleStorePort {
  readonly #workspaceStore: AccountingWorkspaceStorePort | undefined;
  readonly #profiles = new Map<string, UserProfileRecord>();
  readonly #tenantNames = new Map<string, string>();
  readonly #identities = new Map<
    string,
    { readonly userId: string; readonly active: boolean }
  >();
  readonly #bootstrapEvents = new Map<
    string,
    {
      readonly requestKey: string;
      readonly receipt: BootstrapInitialOwnerReceipt;
    }
  >();
  readonly #invitationsById = new Map<string, StoredInMemoryInvitation>();
  readonly #invitationIdByTokenHash = new Map<string, string>();
  readonly #lifecycleOperationReceipts = new Map<
    string,
    {
      readonly kind: string;
      readonly requestKey: string;
      readonly payload: unknown;
    }
  >();

  constructor(options?: {
    readonly workspaceStore?: AccountingWorkspaceStorePort | undefined;
    readonly initialTenantNames?: Readonly<Record<string, string>> | undefined;
  }) {
    this.#workspaceStore = options?.workspaceStore;
    if (options?.initialTenantNames) {
      for (const [id, name] of Object.entries(options.initialTenantNames)) {
        this.#tenantNames.set(id, name);
      }
    }
  }

  registerTenantName(tenantId: string, tenantName: string): void {
    this.#tenantNames.set(tenantId, tenantName);
  }

  recordBootstrapInitialCompany(operationId: string, legalEntityId: string): void {
    const existing = this.#bootstrapEvents.get(operationId);
    if (!existing) {
      return;
    }
    this.#bootstrapEvents.set(operationId, {
      requestKey: existing.requestKey,
      receipt: Object.freeze({
        ...existing.receipt,
        legalEntityId,
      }),
    });
  }

  captureSnapshot(): {
    readonly profiles: Map<string, UserProfileRecord>;
    readonly tenantNames: Map<string, string>;
    readonly identities: Map<string, { readonly userId: string; readonly active: boolean }>;
    readonly bootstrapEvents: Map<
      string,
      { readonly requestKey: string; readonly receipt: BootstrapInitialOwnerReceipt }
    >;
    readonly invitationsById: Map<string, StoredInMemoryInvitation>;
    readonly invitationIdByTokenHash: Map<string, string>;
    readonly lifecycleOperationReceipts: Map<
      string,
      { readonly kind: string; readonly requestKey: string; readonly payload: unknown }
    >;
  } {
    const clonedInvitations = new Map<string, StoredInMemoryInvitation>();
    for (const [k, v] of this.#invitationsById) {
      clonedInvitations.set(k, {
        ...v,
        initialCompanyGrants: v.initialCompanyGrants.map((g) => ({
          legalEntityId: g.legalEntityId,
          actions: [...g.actions],
        })),
      });
    }
    return {
      profiles: new Map(this.#profiles),
      tenantNames: new Map(this.#tenantNames),
      identities: new Map(this.#identities),
      bootstrapEvents: new Map(this.#bootstrapEvents),
      invitationsById: clonedInvitations,
      invitationIdByTokenHash: new Map(this.#invitationIdByTokenHash),
      lifecycleOperationReceipts: new Map(this.#lifecycleOperationReceipts),
    };
  }

  restoreSnapshot(snapshot: {
    readonly profiles: ReadonlyMap<string, UserProfileRecord>;
    readonly tenantNames: ReadonlyMap<string, string>;
    readonly identities: ReadonlyMap<string, { readonly userId: string; readonly active: boolean }>;
    readonly bootstrapEvents: ReadonlyMap<
      string,
      { readonly requestKey: string; readonly receipt: BootstrapInitialOwnerReceipt }
    >;
    readonly invitationsById?: ReadonlyMap<string, StoredInMemoryInvitation> | undefined;
    readonly invitationIdByTokenHash?: ReadonlyMap<string, string> | undefined;
    readonly lifecycleOperationReceipts?:
      | ReadonlyMap<
          string,
          { readonly kind: string; readonly requestKey: string; readonly payload: unknown }
        >
      | undefined;
  }): void {
    this.#profiles.clear();
    for (const [k, v] of snapshot.profiles) {
      this.#profiles.set(k, v);
    }
    this.#tenantNames.clear();
    for (const [k, v] of snapshot.tenantNames) {
      this.#tenantNames.set(k, v);
    }
    this.#identities.clear();
    for (const [k, v] of snapshot.identities) {
      this.#identities.set(k, v);
    }
    this.#bootstrapEvents.clear();
    for (const [k, v] of snapshot.bootstrapEvents) {
      this.#bootstrapEvents.set(k, v);
    }
    this.#invitationsById.clear();
    if (snapshot.invitationsById) {
      for (const [k, v] of snapshot.invitationsById) {
        this.#invitationsById.set(k, {
          ...v,
          initialCompanyGrants: v.initialCompanyGrants.map((g) => ({
            legalEntityId: g.legalEntityId,
            actions: [...g.actions],
          })),
        });
      }
    }
    this.#invitationIdByTokenHash.clear();
    if (snapshot.invitationIdByTokenHash) {
      for (const [k, v] of snapshot.invitationIdByTokenHash) {
        this.#invitationIdByTokenHash.set(k, v);
      }
    }
    this.#lifecycleOperationReceipts.clear();
    if (snapshot.lifecycleOperationReceipts) {
      for (const [k, v] of snapshot.lifecycleOperationReceipts) {
        this.#lifecycleOperationReceipts.set(k, v);
      }
    }
  }

  #toContractInvitation(rec: StoredInMemoryInvitation, now: Date): TenantInvitationRecord {
    const effectiveStatus: StoredTenantInvitationStatus =
      rec.status === 'pending' && new Date(rec.expiresAt).getTime() <= now.getTime()
        ? 'expired'
        : rec.status;
    return Object.freeze({
      invitationId: rec.invitationId,
      tenantId: rec.tenantId,
      tenantName:
        this.#tenantNames.get(rec.tenantId) ?? `Organizacja ${rec.tenantId.slice(0, 8)}`,
      inviteeMaskedEmail: maskInvitationEmail(rec.inviteeEmail),
      inviteeDisplayName: rec.inviteeDisplayName,
      intendedRole: rec.intendedRole,
      initialCompanyGrants: rec.initialCompanyGrants.map((g) =>
        Object.freeze({
          legalEntityId: g.legalEntityId,
          actions: Object.freeze([...g.actions]),
        }),
      ),
      status: effectiveStatus,
      invitedByUserId: rec.invitedByUserId,
      invitedByDisplayName: rec.invitedByDisplayName,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      acceptedAt: rec.acceptedAt,
      acceptedByUserId: rec.acceptedByUserId,
      revokedAt: rec.revokedAt,
      rejectedAt: rec.rejectedAt,
    });
  }

  async bootstrapInitialOwner(
    input: BootstrapInitialOwnerStoreInput,
  ): Promise<BootstrapInitialOwnerStoreResult> {
    const issuer = input.issuer.trim();
    const subject = input.subject.trim();
    const displayName = input.displayName.trim();
    const email = input.email.trim().toLowerCase();
    const tenantName = input.tenantName.trim();
    const reason = input.reason.trim();

    if (
      !issuer ||
      issuer !== input.issuer ||
      !subject ||
      subject !== input.subject ||
      displayName.length < 2 ||
      !email ||
      tenantName.length < 2 ||
      reason.length < 3
    ) {
      return { ok: false, reason: 'invalid_bootstrap_input' };
    }

    const requestKey = canonicalBootstrapRequestKey({
      ...input,
      issuer,
      subject,
      displayName,
      email,
      tenantName,
      reason,
    });

    const existingEvent = this.#bootstrapEvents.get(input.operationId);
    if (existingEvent) {
      if (existingEvent.requestKey !== requestKey) {
        return { ok: false, reason: 'operation_conflict' };
      }
      return {
        ok: true,
        idempotentReplay: true,
        receipt: existingEvent.receipt,
      };
    }

    if (this.#bootstrapEvents.size > 0) {
      return { ok: false, reason: 'owner_already_bootstrapped' };
    }

    if (this.#workspaceStore) {
      for (const user of this.#workspaceStore.listUsers()) {
        if (!user.active) {
          continue;
        }
        for (const membership of this.#workspaceStore.listMembershipsForUser(user.userId)) {
          if (membership.role === 'tenant_owner' && membership.status === 'active') {
            return { ok: false, reason: 'owner_already_bootstrapped' };
          }
        }
      }
    }

    const identityKey = `${issuer}\u0000${subject}`;
    const existingIdentity = this.#identities.get(identityKey);
    let resolvedUserId: string;

    if (existingIdentity) {
      if (!existingIdentity.active) {
        return { ok: false, reason: 'identity_revoked' };
      }
      if (input.userId && input.userId !== existingIdentity.userId) {
        return { ok: false, reason: 'identity_already_linked' };
      }
      resolvedUserId = existingIdentity.userId;
    } else {
      resolvedUserId = input.userId ?? randomUUID();
      if (this.#workspaceStore?.getUserById(parseUserId(resolvedUserId))) {
        return { ok: false, reason: 'user_already_exists' };
      }
    }

    const resolvedTenantId = input.tenantId ?? randomUUID();
    if (this.#tenantNames.has(resolvedTenantId)) {
      return { ok: false, reason: 'tenant_already_exists' };
    }

    const now = input.now ?? new Date();
    const nowIso = now.toISOString();

    this.#identities.set(identityKey, { userId: resolvedUserId, active: true });
    this.#tenantNames.set(resolvedTenantId, tenantName);

    const profile: UserProfileRecord = Object.freeze({
      userId: resolvedUserId,
      displayName,
      email,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    this.#profiles.set(resolvedUserId, profile);

    if (this.#workspaceStore) {
      this.#workspaceStore.upsertUser({
        userId: parseUserId(resolvedUserId),
        issuer,
        subject,
        displayName,
        email,
        active: true,
      });
      this.#workspaceStore.upsertMembership({
        tenantId: parseTenantId(resolvedTenantId),
        userId: parseUserId(resolvedUserId),
        role: 'tenant_owner',
        status: 'active',
        validFrom: now,
        validUntil: null,
      });
    }

    const receipt: BootstrapInitialOwnerReceipt = Object.freeze({
      userId: resolvedUserId,
      issuer,
      subject,
      displayName,
      email,
      tenantId: resolvedTenantId,
      tenantName,
      role: 'tenant_owner',
      legalEntityId: input.initialLegalEntityId ?? null,
      operationId: input.operationId,
      auditEventId: randomUUID(),
      occurredAt: nowIso,
    });

    this.#bootstrapEvents.set(input.operationId, { requestKey, receipt });
    return {
      ok: true,
      idempotentReplay: false,
      receipt,
    };
  }

  async provisionOrResolveOidcUser(
    input: ProvisionOrResolveOidcUserInput,
  ): Promise<ProvisionOrResolveOidcUserResult> {
    const issuer = input.issuer.trim();
    const subject = input.subject.trim();
    if (!issuer || issuer !== input.issuer || !subject || subject !== input.subject) {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    const now = input.now ?? new Date();
    const identityKey = `${issuer}\u0000${subject}`;
    const existingIdentity = this.#identities.get(identityKey);

    if (existingIdentity) {
      if (!existingIdentity.active) {
        return { ok: false, reason: 'identity_revoked' };
      }
      const existingStoreUser = this.#workspaceStore?.getUserById(
        parseUserId(existingIdentity.userId),
      );
      if (existingStoreUser && !existingStoreUser.active) {
        return { ok: false, reason: 'user_disabled' };
      }
      const updated = await this.upsertUserProfile({
        userId: existingIdentity.userId,
        displayName: normalizeSessionDisplayName(input.displayName, subject),
        email: normalizeSessionSafeEmail(input.email),
        now,
      });
      if (!updated) {
        return { ok: false, reason: 'user_disabled' };
      }
      return {
        ok: true,
        userId: existingIdentity.userId,
        created: false,
        profile: updated,
      };
    }

    const storeMatch = this.#workspaceStore?.getUserBySubject(subject, issuer);
    if (storeMatch && storeMatch.issuer === issuer) {
      if (!storeMatch.active) {
        return { ok: false, reason: 'user_disabled' };
      }
      this.#identities.set(identityKey, { userId: storeMatch.userId, active: true });
      const updated = await this.upsertUserProfile({
        userId: storeMatch.userId,
        displayName: normalizeSessionDisplayName(
          input.displayName ?? storeMatch.displayName,
          subject,
        ),
        email: normalizeSessionSafeEmail(input.email ?? storeMatch.email),
        now,
      });
      if (!updated) {
        return { ok: false, reason: 'user_disabled' };
      }
      return {
        ok: true,
        userId: storeMatch.userId,
        created: false,
        profile: updated,
      };
    }

    const newUserId = randomUUID();
    const safeDisplayName = normalizeSessionDisplayName(input.displayName, subject);
    const safeEmail = normalizeSessionSafeEmail(input.email);
    const nowIso = now.toISOString();

    this.#identities.set(identityKey, { userId: newUserId, active: true });
    const profile: UserProfileRecord = Object.freeze({
      userId: newUserId,
      displayName: safeDisplayName,
      email: safeEmail,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    this.#profiles.set(newUserId, profile);

    if (this.#workspaceStore) {
      this.#workspaceStore.upsertUser({
        userId: parseUserId(newUserId),
        issuer,
        subject,
        displayName: safeDisplayName,
        email: safeEmail,
        active: true,
      });
    }

    return {
      ok: true,
      userId: newUserId,
      created: true,
      profile,
    };
  }

  async createTenantInvitation(
    input: CreateTenantInvitationStoreInput,
  ): Promise<CreateTenantInvitationStoreResult> {
    if (!this.#workspaceStore) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }
    if (!/^[0-9a-f]{64}$/.test(input.tokenSha256)) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const now = input.now ?? new Date();
    if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    if (
      this.#lifecycleOperationReceipts.has(input.operationId) ||
      this.#invitationIdByTokenHash.has(input.tokenSha256)
    ) {
      return { ok: false, reason: 'operation_conflict' };
    }

    let actorId: ReturnType<typeof parseUserId>;
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      actorId = parseUserId(input.actorUserId);
      tenantId = parseTenantId(input.tenantId);
    } catch {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const actorUser = this.#workspaceStore.getUserById(actorId);
    if (!actorUser || !actorUser.active) {
      return { ok: false, reason: 'user_disabled' };
    }

    const actorMembership = this.#workspaceStore.getMembership(tenantId, actorId);
    if (
      !actorMembership ||
      actorMembership.status !== 'active' ||
      actorMembership.validFrom.getTime() > now.getTime() ||
      (actorMembership.validUntil !== null && actorMembership.validUntil.getTime() <= now.getTime())
    ) {
      return { ok: false, reason: 'active_admin_membership_required' };
    }

    if (actorMembership.role !== 'tenant_owner' && actorMembership.role !== 'tenant_admin') {
      return { ok: false, reason: 'admin_role_required' };
    }

    if (input.intendedRole === 'tenant_owner') {
      return { ok: false, reason: 'target_role_not_delegable' };
    }
    if (actorMembership.role === 'tenant_admin' && input.intendedRole !== 'tenant_member') {
      return { ok: false, reason: 'target_role_not_delegable' };
    }

    const syntheticTargetUserId = parseUserId(randomUUID());
    const syntheticTargetMembership = {
      tenantId,
      userId: syntheticTargetUserId,
      role: input.intendedRole,
      status: 'active' as const,
      validFrom: now,
      validUntil: actorMembership.validUntil,
    };
    const actorGrants = this.#workspaceStore.listGrantsForUser(actorId);

    const seenEntityIds = new Set<string>();
    for (const grantSpec of input.initialCompanyGrants) {
      let leId: ReturnType<typeof parseLegalEntityId>;
      try {
        leId = parseLegalEntityId(grantSpec.legalEntityId);
      } catch {
        return { ok: false, reason: 'invalid_invitation_input' };
      }
      if (
        seenEntityIds.has(leId) ||
        grantSpec.actions.length === 0 ||
        new Set(grantSpec.actions).size !== grantSpec.actions.length ||
        grantSpec.actions.some((a) => a !== 'read' && a !== 'write') ||
        (grantSpec.actions.includes('write') && !grantSpec.actions.includes('read'))
      ) {
        return { ok: false, reason: 'invalid_invitation_input' };
      }
      seenEntityIds.add(leId);

      const companyInTenant = this.#workspaceStore.getCompany(tenantId, leId);
      if (!companyInTenant) {
        return { ok: false, reason: 'grant_scope_not_delegable' };
      }
      for (const action of grantSpec.actions) {
        const delegatorBoundUntil = computeDelegatedGrantValidUntil({
          actorRole: actorMembership.role,
          actorMembershipUntil: actorMembership.validUntil,
          actorGrants,
          tenantId,
          legalEntityId: leId,
          action,
          now,
        });
        const decision = decideAccessManagementAuthorization({
          actorUserId: actorId,
          targetUserId: syntheticTargetUserId,
          tenantId,
          commandKind: 'grant',
          actorMembership,
          actorGrants,
          targetMembership: syntheticTargetMembership,
          grantScope: {
            legalEntityId: leId,
            action,
            validFrom: now,
            validUntil: delegatorBoundUntil,
          },
          now,
        });
        if (!decision.allowed) {
          return {
            ok: false,
            reason:
              decision.reason === 'target_role_not_delegable'
                ? 'target_role_not_delegable'
                : 'grant_scope_not_delegable',
          };
        }
      }
    }

    const normalizedEmail = input.inviteeEmail.trim().toLowerCase();
    for (const existing of this.#invitationsById.values()) {
      if (
        existing.tenantId === tenantId &&
        existing.inviteeEmail === normalizedEmail &&
        existing.status === 'pending' &&
        new Date(existing.expiresAt).getTime() > now.getTime()
      ) {
        return { ok: false, reason: 'duplicate_pending_invitation' };
      }
    }

    const invitationId = randomUUID();
    const auditEventId = randomUUID();
    const inviterProfile = this.#profiles.get(actorId);
    const invitedByDisplayName =
      inviterProfile?.displayName ?? actorUser.displayName ?? 'Administrator organizacji';

    const stored: StoredInMemoryInvitation = {
      invitationId,
      tenantId,
      tokenSha256: input.tokenSha256,
      inviteeEmail: normalizedEmail,
      inviteeDisplayName: input.inviteeDisplayName?.trim() || null,
      intendedRole: input.intendedRole,
      initialCompanyGrants: input.initialCompanyGrants.map((g) => ({
        legalEntityId: g.legalEntityId,
        actions: [...g.actions],
      })),
      status: 'pending',
      invitedByUserId: actorId,
      invitedByDisplayName,
      reason: input.reason.trim(),
      createdAt: now.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      rejectedAt: null,
    };

    this.#invitationsById.set(invitationId, stored);
    this.#invitationIdByTokenHash.set(input.tokenSha256, invitationId);
    const invitation = this.#toContractInvitation(stored, now);
    this.#lifecycleOperationReceipts.set(input.operationId, {
      kind: 'create_invitation',
      requestKey: input.tokenSha256,
      payload: { invitation, auditEventId },
    });

    return {
      ok: true,
      invitation,
      auditEventId,
    };
  }

  async listTenantInvitations(
    input: ListTenantInvitationsStoreInput,
  ): Promise<ListTenantInvitationsStoreResult> {
    if (!this.#workspaceStore) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }
    const now = input.now ?? new Date();
    let actorId: ReturnType<typeof parseUserId>;
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      actorId = parseUserId(input.actorUserId);
      tenantId = parseTenantId(input.tenantId);
    } catch {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const actorUser = this.#workspaceStore.getUserById(actorId);
    if (!actorUser || !actorUser.active) {
      return { ok: false, reason: 'user_disabled' };
    }

    const actorMembership = this.#workspaceStore.getMembership(tenantId, actorId);
    if (
      !actorMembership ||
      actorMembership.status !== 'active' ||
      actorMembership.validFrom.getTime() > now.getTime() ||
      (actorMembership.validUntil !== null && actorMembership.validUntil.getTime() <= now.getTime())
    ) {
      return { ok: false, reason: 'active_admin_membership_required' };
    }
    if (actorMembership.role !== 'tenant_owner' && actorMembership.role !== 'tenant_admin') {
      return { ok: false, reason: 'admin_role_required' };
    }

    const invitations = [...this.#invitationsById.values()]
      .filter((inv) => inv.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((inv) => this.#toContractInvitation(inv, now));

    return {
      ok: true,
      tenantId,
      invitations,
    };
  }

  async revokeTenantInvitation(
    input: RevokeTenantInvitationStoreInput,
  ): Promise<RevokeTenantInvitationStoreResult> {
    if (!this.#workspaceStore) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }
    const now = input.now ?? new Date();
    let actorId: ReturnType<typeof parseUserId>;
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      actorId = parseUserId(input.actorUserId);
      tenantId = parseTenantId(input.tenantId);
    } catch {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const actorUser = this.#workspaceStore.getUserById(actorId);
    if (!actorUser || !actorUser.active) {
      return { ok: false, reason: 'user_disabled' };
    }

    const actorMembership = this.#workspaceStore.getMembership(tenantId, actorId);
    if (
      !actorMembership ||
      actorMembership.status !== 'active' ||
      actorMembership.validFrom.getTime() > now.getTime() ||
      (actorMembership.validUntil !== null && actorMembership.validUntil.getTime() <= now.getTime())
    ) {
      return { ok: false, reason: 'active_admin_membership_required' };
    }
    if (actorMembership.role !== 'tenant_owner' && actorMembership.role !== 'tenant_admin') {
      return { ok: false, reason: 'admin_role_required' };
    }

    const reqKey = JSON.stringify({
      actorUserId: actorId,
      tenantId,
      invitationId: input.invitationId,
      reason: input.reason.trim(),
    });
    const prevOp = this.#lifecycleOperationReceipts.get(input.operationId);
    if (prevOp) {
      if (prevOp.kind !== 'revoke_invitation' || prevOp.requestKey !== reqKey) {
        return { ok: false, reason: 'operation_conflict' };
      }
      const prevPayload = prevOp.payload as {
        readonly invitation: TenantInvitationRecord;
        readonly auditEventId: string;
      };
      return {
        ok: true,
        idempotentReplay: true,
        invitation: prevPayload.invitation,
        auditEventId: prevPayload.auditEventId,
      };
    }

    const stored = this.#invitationsById.get(input.invitationId);
    if (!stored || stored.tenantId !== tenantId) {
      return { ok: false, reason: 'invitation_not_found' };
    }

    if (actorMembership.role === 'tenant_admin' && stored.intendedRole !== 'tenant_member') {
      return { ok: false, reason: 'target_role_not_delegable' };
    }

    if (actorMembership.role === 'tenant_admin' && stored.initialCompanyGrants.length > 0) {
      const actorGrants = this.#workspaceStore.listGrantsForUser(actorId);
      const syntheticTargetId = parseUserId(randomUUID());
      for (const grantSpec of stored.initialCompanyGrants) {
        const leId = parseLegalEntityId(grantSpec.legalEntityId);
        for (const action of grantSpec.actions) {
          const decision = decideAccessManagementAuthorization({
            actorUserId: actorId,
            targetUserId: syntheticTargetId,
            tenantId,
            commandKind: 'revoke_grant',
            actorMembership,
            actorGrants,
            targetMembership: {
              tenantId,
              userId: syntheticTargetId,
              role: 'tenant_member',
              status: 'active',
              validFrom: now,
              validUntil: null,
            },
            revokedGrantScope: { legalEntityId: leId, action },
            now,
          });
          if (!decision.allowed) {
            return { ok: false, reason: 'grant_scope_not_delegable' };
          }
        }
      }
    }

    if (stored.status !== 'pending' || new Date(stored.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reason: 'invitation_not_pending' };
    }

    stored.status = 'revoked';
    stored.revokedAt = now.toISOString();
    const auditEventId = randomUUID();
    const invitation = this.#toContractInvitation(stored, now);
    this.#lifecycleOperationReceipts.set(input.operationId, {
      kind: 'revoke_invitation',
      requestKey: reqKey,
      payload: { invitation, auditEventId },
    });

    return {
      ok: true,
      idempotentReplay: false,
      invitation,
      auditEventId,
    };
  }

  async acceptTenantInvitation(
    input: AcceptTenantInvitationStoreInput,
  ): Promise<AcceptTenantInvitationStoreResult> {
    if (!this.#workspaceStore || !/^[0-9a-f]{64}$/.test(input.tokenSha256)) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const issuer = input.issuer.trim();
    const subject = input.subject.trim();
    if (!issuer || !subject) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const now = input.now ?? new Date();
    const identityKey = `${issuer}\u0000${subject}`;
    const existingIdentity = this.#identities.get(identityKey);
    if (existingIdentity && !existingIdentity.active) {
      return { ok: false, reason: 'identity_revoked' };
    }

    const existingStoreUser = input.actorUserId
      ? this.#workspaceStore.getUserById(parseUserId(input.actorUserId))
      : this.#workspaceStore.getUserBySubject(subject, issuer);
    if (existingStoreUser && !existingStoreUser.active) {
      return { ok: false, reason: 'user_disabled' };
    }

    const reqKey = JSON.stringify({
      tokenSha256: input.tokenSha256,
      issuer,
      subject,
    });
    const prevOp = this.#lifecycleOperationReceipts.get(input.operationId);
    if (prevOp) {
      if (prevOp.kind !== 'accept_invitation' || prevOp.requestKey !== reqKey) {
        return { ok: false, reason: 'operation_conflict' };
      }
      const prevPayload = prevOp.payload as {
        readonly userId: string;
        readonly invitation: TenantInvitationRecord;
        readonly membership: TenantMembershipSummaryContract;
        readonly grantedCompanyIds: readonly string[];
        readonly auditEventId: string;
      };
      return {
        ok: true,
        idempotentReplay: true,
        ...prevPayload,
      };
    }

    const invitationId = this.#invitationIdByTokenHash.get(input.tokenSha256);
    const stored = invitationId ? this.#invitationsById.get(invitationId) : undefined;
    if (!stored) {
      return { ok: false, reason: 'invitation_not_found' };
    }
    if (stored.status === 'revoked') {
      return { ok: false, reason: 'invitation_revoked' };
    }
    if (stored.status === 'rejected') {
      return { ok: false, reason: 'invitation_rejected' };
    }
    if (stored.status === 'accepted') {
      return { ok: false, reason: 'invitation_already_used' };
    }
    if (new Date(stored.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reason: 'invitation_expired' };
    }

    const tenantId = parseTenantId(stored.tenantId);
    const inviterId = parseUserId(stored.invitedByUserId);
    const inviterUser = this.#workspaceStore.getUserById(inviterId);
    const inviterMembership = this.#workspaceStore.getMembership(tenantId, inviterId);
    if (
      !inviterUser ||
      !inviterUser.active ||
      !inviterMembership ||
      inviterMembership.status !== 'active' ||
      inviterMembership.validFrom.getTime() > now.getTime() ||
      (inviterMembership.validUntil !== null &&
        inviterMembership.validUntil.getTime() <= now.getTime()) ||
      (inviterMembership.role !== 'tenant_owner' && inviterMembership.role !== 'tenant_admin') ||
      (inviterMembership.role === 'tenant_admin' && stored.intendedRole !== 'tenant_member')
    ) {
      return { ok: false, reason: 'inviter_authority_revoked' };
    }

    const snapshot = this.captureSnapshot();
    const resolvedInvitee = await this.provisionOrResolveOidcUser({
      issuer,
      subject,
      displayName: input.displayName ?? stored.inviteeDisplayName ?? undefined,
      email: input.email ?? stored.inviteeEmail,
      now,
    });
    if (!resolvedInvitee.ok) {
      this.restoreSnapshot(snapshot);
      return { ok: false, reason: resolvedInvitee.reason };
    }

    const inviteeId = parseUserId(resolvedInvitee.userId);
    if (inviteeId === inviterId) {
      this.restoreSnapshot(snapshot);
      return { ok: false, reason: 'self_invitation_acceptance_forbidden' };
    }

    const existingMembership = this.#workspaceStore.getMembership(tenantId, inviteeId);
    if (
      existingMembership &&
      existingMembership.status === 'active' &&
      existingMembership.validFrom.getTime() <= now.getTime() &&
      (existingMembership.validUntil === null ||
        existingMembership.validUntil.getTime() > now.getTime())
    ) {
      this.restoreSnapshot(snapshot);
      return { ok: false, reason: 'already_tenant_member' };
    }
    if (existingMembership && existingMembership.role !== stored.intendedRole) {
      this.restoreSnapshot(snapshot);
      return { ok: false, reason: 'membership_role_change_not_supported' };
    }

    const targetMembership = {
      tenantId,
      userId: inviteeId,
      role: stored.intendedRole,
      status: 'active' as const,
      validFrom: now,
      validUntil: inviterMembership.validUntil,
    };

    const inviterGrants = this.#workspaceStore.listGrantsForUser(inviterId);
    const grantsToWrite: Array<{
      readonly legalEntityId: ReturnType<typeof parseLegalEntityId>;
      readonly action: 'read' | 'write';
      readonly validUntil: Date | null;
    }> = [];

    for (const grantSpec of stored.initialCompanyGrants) {
      const leId = parseLegalEntityId(grantSpec.legalEntityId);
      if (!this.#workspaceStore.getCompany(tenantId, leId)) {
        this.restoreSnapshot(snapshot);
        return { ok: false, reason: 'grant_scope_not_delegable' };
      }
      for (const action of grantSpec.actions) {
        const boundedUntil = computeDelegatedGrantValidUntil({
          actorRole: inviterMembership.role,
          actorMembershipUntil: inviterMembership.validUntil,
          actorGrants: inviterGrants,
          tenantId,
          legalEntityId: leId,
          action,
          now,
        });
        const decision = decideAccessManagementAuthorization({
          actorUserId: inviterId,
          targetUserId: inviteeId,
          tenantId,
          commandKind: 'grant',
          actorMembership: inviterMembership,
          actorGrants: inviterGrants,
          targetMembership,
          grantScope: {
            legalEntityId: leId,
            action,
            validFrom: now,
            validUntil: boundedUntil,
          },
          now,
        });
        if (!decision.allowed) {
          this.restoreSnapshot(snapshot);
          return { ok: false, reason: 'inviter_authority_revoked' };
        }
        grantsToWrite.push({
          legalEntityId: leId,
          action,
          validUntil: boundedUntil,
        });
      }
    }

    this.#workspaceStore.upsertMembership(targetMembership);
    const grantedEntitySet = new Set<string>();
    for (const g of grantsToWrite) {
      grantedEntitySet.add(g.legalEntityId);
      this.#workspaceStore.upsertGrant({
        grantId: randomUUID(),
        tenantId,
        userId: inviteeId,
        legalEntityId: g.legalEntityId,
        action: g.action,
        validFrom: now,
        validUntil: g.validUntil,
        revokedAt: null,
      });
    }

    const nowIso = now.toISOString();
    stored.status = 'accepted';
    stored.acceptedAt = nowIso;
    stored.acceptedByUserId = inviteeId;

    const auditEventId = randomUUID();
    const invitation = this.#toContractInvitation(stored, now);
    const membershipSummary: TenantMembershipSummaryContract = {
      tenantId,
      tenantName:
        this.#tenantNames.get(tenantId) ?? `Organizacja ${tenantId.slice(0, 8)}`,
      role: stored.intendedRole,
      status: 'active',
      validFrom: nowIso,
      validUntil: targetMembership.validUntil ? targetMembership.validUntil.toISOString() : null,
    };
    const grantedCompanyIds = [...grantedEntitySet];

    this.#lifecycleOperationReceipts.set(input.operationId, {
      kind: 'accept_invitation',
      requestKey: reqKey,
      payload: {
        userId: inviteeId,
        invitation,
        membership: membershipSummary,
        grantedCompanyIds,
        auditEventId,
      },
    });

    return {
      ok: true,
      idempotentReplay: false,
      userId: inviteeId,
      invitation,
      membership: membershipSummary,
      grantedCompanyIds,
      auditEventId,
    };
  }

  async rejectTenantInvitation(
    input: RejectTenantInvitationStoreInput,
  ): Promise<RejectTenantInvitationStoreResult> {
    if (!this.#workspaceStore || !/^[0-9a-f]{64}$/.test(input.tokenSha256)) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }
    const issuer = input.issuer.trim();
    const subject = input.subject.trim();
    if (!issuer || !subject) {
      return { ok: false, reason: 'invalid_invitation_input' };
    }

    const now = input.now ?? new Date();
    const identityKey = `${issuer}\u0000${subject}`;
    const existingIdentity = this.#identities.get(identityKey);
    if (existingIdentity && !existingIdentity.active) {
      return { ok: false, reason: 'identity_revoked' };
    }
    const existingStoreUser = input.actorUserId
      ? this.#workspaceStore.getUserById(parseUserId(input.actorUserId))
      : this.#workspaceStore.getUserBySubject(subject, issuer);
    if (existingStoreUser && !existingStoreUser.active) {
      return { ok: false, reason: 'user_disabled' };
    }

    const reqKey = JSON.stringify({
      tokenSha256: input.tokenSha256,
      issuer,
      subject,
      reason: input.reason?.trim() ?? null,
    });
    const prevOp = this.#lifecycleOperationReceipts.get(input.operationId);
    if (prevOp) {
      if (prevOp.kind !== 'reject_invitation' || prevOp.requestKey !== reqKey) {
        return { ok: false, reason: 'operation_conflict' };
      }
      const prevPayload = prevOp.payload as {
        readonly userId: string;
        readonly invitation: TenantInvitationRecord;
        readonly auditEventId: string;
      };
      return {
        ok: true,
        idempotentReplay: true,
        ...prevPayload,
      };
    }

    const invitationId = this.#invitationIdByTokenHash.get(input.tokenSha256);
    const stored = invitationId ? this.#invitationsById.get(invitationId) : undefined;
    if (!stored) {
      return { ok: false, reason: 'invitation_not_found' };
    }
    if (stored.status === 'revoked') {
      return { ok: false, reason: 'invitation_revoked' };
    }
    if (stored.status === 'rejected') {
      return { ok: false, reason: 'invitation_rejected' };
    }
    if (stored.status === 'accepted') {
      return { ok: false, reason: 'invitation_already_used' };
    }
    if (new Date(stored.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reason: 'invitation_expired' };
    }

    const snapshot = this.captureSnapshot();
    const resolvedActor = await this.provisionOrResolveOidcUser({
      issuer,
      subject,
      displayName: input.displayName ?? stored.inviteeDisplayName ?? undefined,
      email: input.email ?? stored.inviteeEmail,
      now,
    });
    if (!resolvedActor.ok) {
      this.restoreSnapshot(snapshot);
      return { ok: false, reason: resolvedActor.reason };
    }

    stored.status = 'rejected';
    stored.rejectedAt = now.toISOString();
    const auditEventId = randomUUID();
    const invitation = this.#toContractInvitation(stored, now);
    this.#lifecycleOperationReceipts.set(input.operationId, {
      kind: 'reject_invitation',
      requestKey: reqKey,
      payload: {
        userId: resolvedActor.userId,
        invitation,
        auditEventId,
      },
    });

    return {
      ok: true,
      idempotentReplay: false,
      userId: resolvedActor.userId,
      invitation,
      auditEventId,
    };
  }

  async upsertUserProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord | null> {
    const parsedUser = this.#workspaceStore?.getUserById(parseUserId(input.userId));
    if (this.#workspaceStore && (!parsedUser || !parsedUser.active)) {
      return null;
    }
    const nowIso = (input.now ?? new Date()).toISOString();
    const prev = this.#profiles.get(input.userId);
    const candidateEmail = input.email.trim().toLowerCase();
    const effectiveEmail =
      prev &&
      !prev.email.endsWith('.invalid') &&
      (candidateEmail.endsWith('.invalid') || !SafeEmailAddressSchema.safeParse(candidateEmail).success)
        ? prev.email
        : candidateEmail;
    const candidateDisplayName = input.displayName.trim().slice(0, 160);
    const effectiveDisplayName =
      candidateDisplayName.length > 0
        ? candidateDisplayName
        : (prev?.displayName ?? 'Użytkownik');
    const next: UserProfileRecord = Object.freeze({
      userId: input.userId,
      displayName: effectiveDisplayName,
      email: effectiveEmail,
      createdAt: prev?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
    this.#profiles.set(input.userId, next);
    if (this.#workspaceStore && parsedUser) {
      this.#workspaceStore.upsertUser({
        ...parsedUser,
        displayName: next.displayName,
        email: next.email,
      });
    }
    return next;
  }

  async getActorSessionDirectory(
    rawUserId: string,
    now: Date = new Date(),
  ): Promise<GetActorSessionDirectoryResult> {
    let canonicalUserId: ReturnType<typeof parseUserId>;
    try {
      canonicalUserId = parseUserId(rawUserId);
    } catch {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    const storeUser = this.#workspaceStore?.getUserById(canonicalUserId);
    if (this.#workspaceStore && (!storeUser || !storeUser.active)) {
      return { ok: false, reason: 'user_inactive_or_missing' };
    }

    const profile =
      this.#profiles.get(canonicalUserId) ??
      (storeUser
        ? {
            userId: canonicalUserId,
            displayName: storeUser.displayName,
            email: storeUser.email,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          }
        : null);

    const rawMemberships = this.#workspaceStore?.listMembershipsForUser(canonicalUserId) ?? [];
    const memberships: TenantMembershipSummaryContract[] = rawMemberships.map((m) => {
      const isEffectiveActive =
        m.status === 'active' &&
        m.validFrom.getTime() <= now.getTime() &&
        (m.validUntil === null || m.validUntil.getTime() > now.getTime());
      const resolvedTenantName =
        this.#tenantNames.get(m.tenantId) ?? `Organizacja ${m.tenantId.slice(0, 8)}`;
      return {
        tenantId: m.tenantId,
        tenantName: resolvedTenantName,
        role: m.role as TenantMembershipSummaryContract['role'],
        status: isEffectiveActive ? 'active' : 'revoked',
        validFrom: m.validFrom.toISOString(),
        validUntil: m.validUntil ? m.validUntil.toISOString() : null,
      };
    });

    return {
      ok: true,
      userId: canonicalUserId,
      profile,
      memberships,
    };
  }
}

export interface BuildAuthenticatedSessionViewInput {
  readonly authMethod: 'oidc' | 'sandbox_persona';
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly memberships: readonly TenantMembershipSummaryContract[];
  readonly companies: readonly AccessibleCompanyItem[];
  readonly requestedTenantId?: string | null | undefined;
  readonly requestedLegalEntityId?: string | null | undefined;
  readonly requestedPeriod?: string | null | undefined;
  readonly sessionExpiresAt: string;
  readonly accessTokenExpiresAt: string;
  readonly personaId?: string | undefined;
}

export function normalizeSessionDisplayName(raw: string | undefined, fallbackSubject: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 160);
  }
  const fallback = fallbackSubject.trim().slice(0, 160);
  return fallback.length > 0 ? fallback : 'Użytkownik';
}

export function normalizeSessionSafeEmail(raw: string | undefined): string {
  const candidate = (raw ?? '').trim().toLowerCase();
  const parsed = SafeEmailAddressSchema.safeParse(candidate);
  return parsed.success ? parsed.data : 'uzytkownik@pap.example';
}

export function buildAuthenticatedSessionView(
  input: BuildAuthenticatedSessionViewInput,
): AuthenticatedSessionView {
  const activeMemberships = input.memberships.filter((m) => m.status === 'active');
  const activeTenantIds = new Set(activeMemberships.map((m) => m.tenantId));
  const permittedCompanies = input.companies.filter((c) => activeTenantIds.has(c.tenantId));

  const parsedPeriod = TaxPeriodMonthSchema.safeParse(input.requestedPeriod);
  const period = parsedPeriod.success ? parsedPeriod.data : DEMO_DEFAULT_PERIOD;
  const safeDisplayName = normalizeSessionDisplayName(input.displayName, input.subject);
  const safeEmail = normalizeSessionSafeEmail(input.email);

  if (activeMemberships.length === 0) {
    return AuthenticatedSessionViewSchema.parse({
      state: 'no_tenant_membership',
      authMethod: input.authMethod,
      userId: input.userId,
      issuer: input.issuer,
      subject: input.subject,
      displayName: safeDisplayName,
      email: safeEmail,
      tenantId: null,
      legalEntityId: null,
      period,
      memberships: [...input.memberships],
      companies: [],
      sessionExpiresAt: input.sessionExpiresAt,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      ...(input.personaId ? { personaId: input.personaId } : {}),
    });
  }

  const selectedTenantId =
    input.requestedTenantId && activeTenantIds.has(input.requestedTenantId)
      ? input.requestedTenantId
      : (permittedCompanies[0]?.tenantId ?? activeMemberships[0]!.tenantId);

  const companiesInSelectedTenant = permittedCompanies.filter(
    (c) => c.tenantId === selectedTenantId,
  );
  const selectedLegalEntityId =
    input.requestedLegalEntityId &&
    companiesInSelectedTenant.some((c) => c.legalEntityId === input.requestedLegalEntityId)
      ? input.requestedLegalEntityId
      : (companiesInSelectedTenant[0]?.legalEntityId ?? null);

  return AuthenticatedSessionViewSchema.parse({
    state: 'authenticated',
    authMethod: input.authMethod,
    userId: input.userId,
    issuer: input.issuer,
    subject: input.subject,
    displayName: safeDisplayName,
    email: safeEmail,
    tenantId: selectedTenantId,
    legalEntityId: selectedLegalEntityId,
    period,
    memberships: [...input.memberships],
    companies: permittedCompanies,
    sessionExpiresAt: input.sessionExpiresAt,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    ...(input.personaId ? { personaId: input.personaId } : {}),
  });
}

export function validateBootstrapOwnerRequest(raw: unknown):
  | { readonly ok: true; readonly data: BootstrapOwnerRequest }
  | { readonly ok: false; readonly message: string } {
  const parsed = BootstrapOwnerRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        'Niepoprawne żądanie jednorazowego bootstrapu właściciela platformy.',
    };
  }
  return { ok: true, data: parsed.data };
}

export function toBootstrapOwnerResponse(params: {
  readonly idempotentReplay: boolean;
  readonly receipt: BootstrapInitialOwnerReceipt;
  readonly legalEntityIdOverride?: string | null | undefined;
}): BootstrapOwnerResponse {
  return BootstrapOwnerResponseSchema.parse({
    ok: true,
    idempotentReplay: params.idempotentReplay,
    userId: params.receipt.userId,
    issuer: params.receipt.issuer,
    subject: params.receipt.subject,
    displayName: params.receipt.displayName,
    email: params.receipt.email,
    tenantId: params.receipt.tenantId,
    tenantName: params.receipt.tenantName,
    role: 'tenant_owner',
    legalEntityId:
      params.legalEntityIdOverride !== undefined
        ? params.legalEntityIdOverride
        : params.receipt.legalEntityId,
    operationId: params.receipt.operationId,
    auditEventId: params.receipt.auditEventId,
    occurredAt: params.receipt.occurredAt,
  });
}
