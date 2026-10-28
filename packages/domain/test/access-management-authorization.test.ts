import { describe, expect, it } from 'vitest';
import {
  decideAccessManagementAuthorization,
  legalEntityId,
  tenantId,
  userId,
  type CompanyAccessGrant,
  type DecideAccessManagementAuthorizationInput,
  type TenantMembership,
} from '../src/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(1));
const TENANT_B = tenantId(id(2));
const ENTITY_A1 = legalEntityId(id(11));
const ENTITY_A2 = legalEntityId(id(12));
const OWNER = userId(id(21));
const ADMIN = userId(id(22));
const OTHER_ADMIN = userId(id(23));
const MEMBER = userId(id(24));

const validFrom = new Date('2026-01-01T00:00:00.000Z');
const now = new Date('2026-10-28T12:00:00.000Z');
const future = new Date('2026-12-01T00:00:00.000Z');
const laterFuture = new Date('2027-01-01T00:00:00.000Z');

function membership(overrides: Partial<TenantMembership> = {}): TenantMembership {
  return {
    userId: ADMIN,
    tenantId: TENANT_A,
    role: 'tenant_admin',
    status: 'active',
    validFrom,
    validUntil: null,
    ...overrides,
  };
}

function grant(overrides: Partial<CompanyAccessGrant> = {}): CompanyAccessGrant {
  return {
    grantId: id(90),
    userId: ADMIN,
    tenantId: TENANT_A,
    legalEntityId: ENTITY_A1,
    action: 'read',
    validFrom,
    validUntil: null,
    revokedAt: null,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<DecideAccessManagementAuthorizationInput> = {},
): DecideAccessManagementAuthorizationInput {
  return {
    actorUserId: ADMIN,
    targetUserId: MEMBER,
    tenantId: TENANT_A,
    commandKind: 'grant',
    actorMembership: membership(),
    actorGrants: [grant()],
    targetMembership: membership({ userId: MEMBER, role: 'tenant_member' }),
    grantScope: {
      legalEntityId: ENTITY_A1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    },
    now,
    ...overrides,
  };
}

describe('decideAccessManagementAuthorization (polityka administracji dostępem)', () => {
  it('zezwala tenant_admin na delegację posiadanego grantu dla tenant_member w tym samym tenancie', () => {
    expect(decideAccessManagementAuthorization(baseInput())).toEqual({
      allowed: true,
      reason: 'authorized_tenant_administration',
    });
  });

  it('zezwala tenant_owner na nadanie grantu i zarządzanie tenant_admin bez posiadania własnego grantu księgowego', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          actorUserId: OWNER,
          targetUserId: ADMIN,
          actorMembership: membership({ userId: OWNER, role: 'tenant_owner' }),
          actorGrants: [],
          targetMembership: membership({ userId: ADMIN, role: 'tenant_admin' }),
        }),
      ),
    ).toEqual({
      allowed: true,
      reason: 'authorized_tenant_administration',
    });
  });

  it('blokuje samodzielne podnoszenie lub zmianę własnych uprawnień ( także przez tenant_owner i tenant_admin )', () => {
    for (const selfActor of [
      { user: ADMIN, role: 'tenant_admin' as const },
      { user: OWNER, role: 'tenant_owner' as const },
    ]) {
      expect(
        decideAccessManagementAuthorization(
          baseInput({
            actorUserId: selfActor.user,
            targetUserId: selfActor.user,
            actorMembership: membership({ userId: selfActor.user, role: selfActor.role }),
            targetMembership: membership({ userId: selfActor.user, role: selfActor.role }),
          }),
        ),
      ).toEqual({
        allowed: false,
        reason: 'self_access_management_forbidden',
      });
    }
  });

  it('odmawia, gdy aktor ma rolę tenant_member nawet z aktywnymi grantami read/write', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          actorMembership: membership({ role: 'tenant_member' }),
          actorGrants: [grant({ action: 'read' }), grant({ action: 'write' })],
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'admin_role_required',
    });
  });

  it.each([
    ['brak członkostwa aktora', null],
    ['członkostwo w innym tenancie B', membership({ tenantId: TENANT_B })],
    ['cofnięte członkostwo aktora', membership({ status: 'revoked' })],
    ['wygasłe członkostwo aktora', membership({ validUntil: now })],
    ['przyszłe członkostwo aktora', membership({ validFrom: future })],
  ] as const)('odmawia przy nieaktywnym członkostwie aktora: %s', (_label, actorMembership) => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          actorMembership,
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'active_admin_membership_required',
    });
  });

  it('odmawia tenant_admin przy próbie modyfikacji tenant_owner lub innego tenant_admin', () => {
    for (const targetRole of ['tenant_owner', 'tenant_admin'] as const) {
      expect(
        decideAccessManagementAuthorization(
          baseInput({
            targetUserId: OTHER_ADMIN,
            targetMembership: membership({ userId: OTHER_ADMIN, role: targetRole }),
            commandKind: 'revoke_membership',
          }),
        ),
      ).toEqual({
        allowed: false,
        reason: 'target_role_not_delegable',
      });
    }
  });

  it('odmawia tenant_owner przy próbie modyfikacji innego tenant_owner', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          actorUserId: OWNER,
          targetUserId: OTHER_ADMIN,
          actorMembership: membership({ userId: OWNER, role: 'tenant_owner' }),
          targetMembership: membership({ userId: OTHER_ADMIN, role: 'tenant_owner' }),
          commandKind: 'revoke_membership',
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'target_role_not_delegable',
    });
  });

  it.each([
    [
      'nadanie write przy posiadaniu tylko read',
      [grant({ action: 'read' })],
      { legalEntityId: ENTITY_A1, action: 'write' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie grantu do innej firmy A2 bez własnego grantu A2',
      [grant({ legalEntityId: ENTITY_A1 })],
      { legalEntityId: ENTITY_A2, action: 'read' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie grantu, gdy grant delegującego admina został cofnięty',
      [grant({ revokedAt: now })],
      { legalEntityId: ENTITY_A1, action: 'read' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie grantu, gdy grant delegującego admina wygasł',
      [grant({ validUntil: now })],
      { legalEntityId: ENTITY_A1, action: 'read' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie bezterminowego grantu, gdy grant delegującego admina ma datę końcową',
      [grant({ validUntil: future })],
      { legalEntityId: ENTITY_A1, action: 'read' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie grantu dłuższego niż grant delegującego admina',
      [grant({ validUntil: future })],
      {
        legalEntityId: ENTITY_A1,
        action: 'read' as const,
        validFrom: null,
        validUntil: laterFuture,
      },
    ],
    [
      'nadanie bezterminowego grantu, gdy grant delegującego admina ma zaplanowane cofnięcie w przyszłości (revokedAt > now)',
      [grant({ revokedAt: future })],
      { legalEntityId: ENTITY_A1, action: 'read' as const, validFrom: null, validUntil: null },
    ],
    [
      'nadanie grantu wykraczającego poza zaplanowane cofnięcie grantu delegującego admina (validUntil > revokedAt)',
      [grant({ revokedAt: future })],
      {
        legalEntityId: ENTITY_A1,
        action: 'read' as const,
        validFrom: null,
        validUntil: laterFuture,
      },
    ],
  ])('odmawia tenant_admin delegacji spoza zakresu: %s', (_label, actorGrants, grantScope) => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          actorGrants,
          grantScope,
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'grant_scope_not_delegable',
    });
  });

  it('odrzuca niepoprawne przedziały czasowe grantu lub reaktywacji jako authorization_context_invalid', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          grantScope: {
            legalEntityId: ENTITY_A1,
            action: 'read',
            validFrom,
            validUntil: future,
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'authorization_context_invalid',
    });

    expect(
      decideAccessManagementAuthorization(
        baseInput({
          grantScope: {
            legalEntityId: ENTITY_A1,
            action: 'read',
            validFrom: future,
            validUntil: future,
          },
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'authorization_context_invalid',
    });

    expect(
      decideAccessManagementAuthorization(
        baseInput({
          commandKind: 'reactivate_membership',
          requestedValidUntil: now,
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'authorization_context_invalid',
    });
  });

  it('odmawia cofnięcia grantu przez tenant_admin, jeśli nie ma on uprawnień do tej firmy i akcji', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          commandKind: 'revoke_grant',
          actorGrants: [grant({ legalEntityId: ENTITY_A1, action: 'read' })],
          revokedGrantScope: { legalEntityId: ENTITY_A2, action: 'read' },
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'grant_scope_not_delegable',
    });

    expect(
      decideAccessManagementAuthorization(
        baseInput({
          commandKind: 'revoke_grant',
          actorGrants: [grant({ legalEntityId: ENTITY_A1, action: 'read' })],
          revokedGrantScope: { legalEntityId: ENTITY_A1, action: 'read' },
        }),
      ),
    ).toEqual({
      allowed: true,
      reason: 'authorized_tenant_administration',
    });
  });

  it('odmawia reaktywacji członkostwa wykraczającej poza okres członkostwa delegującego aktora', () => {
    expect(
      decideAccessManagementAuthorization(
        baseInput({
          commandKind: 'reactivate_membership',
          actorMembership: membership({ validUntil: future }),
          requestedValidUntil: null,
        }),
      ),
    ).toEqual({
      allowed: false,
      reason: 'grant_scope_not_delegable',
    });

    expect(
      decideAccessManagementAuthorization(
        baseInput({
          commandKind: 'reactivate_membership',
          actorMembership: membership({ validUntil: future }),
          requestedValidUntil: future,
        }),
      ),
    ).toEqual({
      allowed: true,
      reason: 'authorized_tenant_administration',
    });
  });
});
