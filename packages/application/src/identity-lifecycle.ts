import { randomUUID } from 'node:crypto';
import {
  AuthenticatedSessionViewSchema,
  BootstrapOwnerRequestSchema,
  BootstrapOwnerResponseSchema,
  DEMO_DEFAULT_PERIOD,
  TaxPeriodMonthSchema,
  type AccessibleCompanyItem,
  type AuthenticatedSessionView,
  type BootstrapOwnerRequest,
  type BootstrapOwnerResponse,
  type TenantMemberRole,
  type TenantMembershipSummaryContract,
} from '@pap/contracts';
import { tenantId as parseTenantId, userId as parseUserId } from '@pap/domain';
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
    } else if (this.#bootstrapEvents.size > 0) {
      return { ok: false, reason: 'owner_already_bootstrapped' };
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

  async upsertUserProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord | null> {
    const parsedUser = this.#workspaceStore?.getUserById(parseUserId(input.userId));
    if (this.#workspaceStore && (!parsedUser || !parsedUser.active)) {
      return null;
    }
    const nowIso = (input.now ?? new Date()).toISOString();
    const prev = this.#profiles.get(input.userId);
    const next: UserProfileRecord = Object.freeze({
      userId: input.userId,
      displayName: input.displayName.trim(),
      email: input.email.trim().toLowerCase(),
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
        role: m.role as TenantMemberRole,
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

export function buildAuthenticatedSessionView(
  input: BuildAuthenticatedSessionViewInput,
): AuthenticatedSessionView {
  const activeMemberships = input.memberships.filter((m) => m.status === 'active');
  const activeTenantIds = new Set(activeMemberships.map((m) => m.tenantId));
  const permittedCompanies = input.companies.filter((c) => activeTenantIds.has(c.tenantId));

  const parsedPeriod = TaxPeriodMonthSchema.safeParse(input.requestedPeriod);
  const period = parsedPeriod.success ? parsedPeriod.data : DEMO_DEFAULT_PERIOD;

  if (activeMemberships.length === 0) {
    return AuthenticatedSessionViewSchema.parse({
      state: 'no_tenant_membership',
      authMethod: input.authMethod,
      userId: input.userId,
      issuer: input.issuer,
      subject: input.subject,
      displayName: input.displayName,
      email: input.email,
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
    displayName: input.displayName,
    email: input.email,
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
