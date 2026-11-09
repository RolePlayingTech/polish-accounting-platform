import { randomUUID } from 'node:crypto';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { describe, expect, it } from 'vitest';
import {
  InMemoryAccountingWorkspaceStore,
  InMemoryIdentityLifecycleStore,
  buildAuthenticatedSessionView,
  generateOpaqueInvitationToken,
  hashInvitationTokenSha256,
  maskInvitationEmail,
  toBootstrapOwnerResponse,
  validateBootstrapOwnerRequest,
} from '../src/index.js';

describe('Wave 2 Slice 3 — identity-lifecycle (warstwa aplikacji)', () => {
  it('waliduje żądanie bootstrapu właściciela i odrzuca puste lub niepoprawne pola', () => {
    const invalid = validateBootstrapOwnerRequest({
      issuer: 'http://niebezpieczny-bez-https-poza-localhost.example',
      subject: '',
      displayName: 'A',
      email: 'zly-email',
      tenantName: 'X',
      reason: 'kr',
    });
    expect(invalid.ok).toBe(false);

    const valid = validateBootstrapOwnerRequest({
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'owner-oidc-sub-01',
      displayName: 'Katarzyna Właścicielska',
      email: 'katarzyna.wlasciciel@biuro-syntetyczne.example',
      tenantName: 'Kancelaria Podatkowa Syntetyczna Sp. z o.o.',
      reason: 'Jednorazowa inicjalizacja właściciela platformy PAP',
    });
    expect(valid.ok).toBe(true);
  });

  it('wykonuje jednorazowy bootstrap właściciela, obsługuje idempotentny replay i blokuje drugiego właściciela oraz konflikt operationId', async () => {
    const workspaceStore = new InMemoryAccountingWorkspaceStore();
    const lifecycle = new InMemoryIdentityLifecycleStore({ workspaceStore });
    const opId = randomUUID();
    const now = new Date('2026-11-09T12:00:00.000Z');

    const first = await lifecycle.bootstrapInitialOwner({
      operationId: opId,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'owner-sub-1',
      displayName: 'Marek Właściciel',
      email: 'Marek.Wlasciciel@Syntetyczny.Example',
      tenantName: 'Biuro Rachunkowe Alfa',
      reason: 'Inicjalizacja pierwszego właściciela w środowisku testowym',
      now,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('Oczekiwano sukcesu pierwszego bootstrapu.');
    }
    expect(first.idempotentReplay).toBe(false);
    expect(first.receipt.email).toBe('marek.wlasciciel@syntetyczny.example');
    expect(first.receipt.role).toBe('tenant_owner');

    const replay = await lifecycle.bootstrapInitialOwner({
      operationId: opId,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'owner-sub-1',
      displayName: 'Marek Właściciel',
      email: 'marek.wlasciciel@syntetyczny.example',
      tenantName: 'Biuro Rachunkowe Alfa',
      reason: 'Inicjalizacja pierwszego właściciela w środowisku testowym',
      now: new Date('2026-11-09T12:05:00.000Z'),
    });
    expect(replay).toEqual({
      ok: true,
      idempotentReplay: true,
      receipt: first.receipt,
    });

    const conflict = await lifecycle.bootstrapInitialOwner({
      operationId: opId,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'inny-subject-konflikt',
      displayName: 'Marek Właściciel',
      email: 'marek.wlasciciel@syntetyczny.example',
      tenantName: 'Biuro Rachunkowe Alfa',
      reason: 'Inicjalizacja pierwszego właściciela w środowisku testowym',
      now,
    });
    expect(conflict).toEqual({
      ok: false,
      reason: 'operation_conflict',
    });

    const secondOwnerAttempt = await lifecycle.bootstrapInitialOwner({
      operationId: randomUUID(),
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'drugi-wlasciciel-sub',
      displayName: 'Drugi Kandydat',
      email: 'drugi@syntetyczny.example',
      tenantName: 'Druga Organizacja',
      reason: 'Próba ponownego bootstrapu właściciela po inicjalizacji',
      now,
    });
    expect(secondOwnerAttempt).toEqual({
      ok: false,
      reason: 'owner_already_bootstrapped',
    });

    const response = toBootstrapOwnerResponse({
      idempotentReplay: false,
      receipt: first.receipt,
    });
    expect(response.ok).toBe(true);
    expect(response.tenantId).toBe(first.receipt.tenantId);
  });

  it('buduje widok sesji dla 1 użytkownika w N organizacjach i M podmiotach oraz obsługuje brak członkostwa (no_tenant_membership)', () => {
    const tenantA = '11111111-1111-4111-8111-111111111111';
    const tenantB = '22222222-2222-4222-8222-222222222222';
    const tenantRevoked = '33333333-3333-4333-8333-333333333333';
    const compA1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const compA2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const compB1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const compRevoked = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const userUuid = '99999999-9999-4999-8999-999999999999';

    const viewMulti = buildAuthenticatedSessionView({
      authMethod: 'oidc',
      userId: userUuid,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'ksiegowa-wielotenantowa',
      displayName: 'Ewa Wielotenantowa',
      email: 'ewa@syntetyczny.example',
      memberships: [
        {
          tenantId: tenantA,
          tenantName: 'Kancelaria Alfa',
          role: 'tenant_owner',
          status: 'active',
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: null,
        },
        {
          tenantId: tenantB,
          tenantName: 'Biuro Beta',
          role: 'tenant_member',
          status: 'active',
          validFrom: '2026-02-01T00:00:00.000Z',
          validUntil: null,
        },
        {
          tenantId: tenantRevoked,
          tenantName: 'Dawna Organizacja Gamma',
          role: 'tenant_member',
          status: 'revoked',
          validFrom: '2025-01-01T00:00:00.000Z',
          validUntil: '2026-01-01T00:00:00.000Z',
        },
      ],
      companies: [
        {
          tenantId: tenantA,
          legalEntityId: compA1,
          displayName: 'Alfa Sp. z o.o.',
          nip: '5213017228',
          legalForm: 'sp_z_o_o',
          taxRegime: 'cit_klasyczny',
          vatStatus: 'czynny',
          zusStage: 'not_applicable',
          role: 'tenant_owner',
          canRead: true,
          canWrite: true,
        },
        {
          tenantId: tenantA,
          legalEntityId: compA2,
          displayName: 'Alfa Usługi JDG',
          nip: '5250002008',
          legalForm: 'jdg',
          taxRegime: 'kpir_liniowy',
          vatStatus: 'czynny',
          zusStage: 'duzy_zus',
          role: 'tenant_owner',
          canRead: true,
          canWrite: true,
        },
        {
          tenantId: tenantB,
          legalEntityId: compB1,
          displayName: 'Beta Handel Ryczałt',
          nip: '5261040828',
          legalForm: 'jdg',
          taxRegime: 'ryczalt',
          vatStatus: 'zwolniony',
          zusStage: 'preferencyjny_zus',
          role: 'tenant_member',
          canRead: true,
          canWrite: false,
        },
        {
          tenantId: tenantRevoked,
          legalEntityId: compRevoked,
          displayName: 'Gamma Niedostępna',
          nip: '5250003002',
          legalForm: 'jdg',
          taxRegime: 'ryczalt',
          vatStatus: 'zwolniony',
          zusStage: 'preferencyjny_zus',
          role: 'tenant_member',
          canRead: true,
          canWrite: false,
        },
      ],
      requestedTenantId: tenantA,
      requestedLegalEntityId: compA2,
      requestedPeriod: '2026-10',
      sessionExpiresAt: '2026-11-09T20:00:00.000Z',
      accessTokenExpiresAt: '2026-11-09T12:15:00.000Z',
    });

    expect(viewMulti.state).toBe('authenticated');
    expect(viewMulti.tenantId).toBe(tenantA);
    expect(viewMulti.legalEntityId).toBe(compA2);
    expect(viewMulti.period).toBe('2026-10');
    expect(viewMulti.companies.map((c) => c.legalEntityId)).toEqual([compA1, compA2, compB1]);

    // Próba wyboru nieautoryzowanego tenantId/legalEntityId bezpiecznie wraca do pierwszego dozwolonego kontekstu
    const fallbackView = buildAuthenticatedSessionView({
      authMethod: 'oidc',
      userId: userUuid,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'ksiegowa-wielotenantowa',
      displayName: 'Ewa Wielotenantowa',
      email: 'ewa@syntetyczny.example',
      memberships: viewMulti.memberships,
      companies: viewMulti.companies,
      requestedTenantId: tenantRevoked,
      requestedLegalEntityId: compRevoked,
      requestedPeriod: 'niepoprawny-okres',
      sessionExpiresAt: '2026-11-09T20:00:00.000Z',
      accessTokenExpiresAt: '2026-11-09T12:15:00.000Z',
    });
    expect(fallbackView.state).toBe('authenticated');
    expect(fallbackView.tenantId).toBe(tenantA);
    expect(fallbackView.legalEntityId).toBe(compA1);

    // Użytkownik bez aktywnego członkostwa trafia do stanu no_tenant_membership
    const unassignedView = buildAuthenticatedSessionView({
      authMethod: 'oidc',
      userId: userUuid,
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'nowy-uzytkownik-oidc',
      displayName: 'Nowy Użytkownik',
      email: 'nowy@syntetyczny.example',
      memberships: [],
      companies: viewMulti.companies,
      sessionExpiresAt: '2026-11-09T20:00:00.000Z',
      accessTokenExpiresAt: '2026-11-09T12:15:00.000Z',
    });
    expect(unassignedView.state).toBe('no_tenant_membership');
    expect(unassignedView.tenantId).toBeNull();
    expect(unassignedView.legalEntityId).toBeNull();
    expect(unassignedView.companies).toEqual([]);
  });

  it('Wave 2 Slice 4 — egzekwuje haszowanie SHA-256 tokenów zaproszeń, maskowanie e-maili, granice delegacji ról i firm oraz ochronę TOCTOU przy akceptacji', async () => {
    const rawToken = generateOpaqueInvitationToken();
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    const tokenHash = hashInvitationTokenSha256(rawToken);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(maskInvitationEmail('Anna.Ksiegowa@Biuro.Example')).toBe('an***@biuro.example');
    expect(maskInvitationEmail('a@biuro.example')).toBe('a***@biuro.example');

    const workspaceStore = new InMemoryAccountingWorkspaceStore();
    const lifecycle = new InMemoryIdentityLifecycleStore({ workspaceStore });
    const now = new Date('2026-11-09T12:00:00.000Z');

    const boot = await lifecycle.bootstrapInitialOwner({
      operationId: randomUUID(),
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'owner-s4-unit',
      displayName: 'Właściciel S4',
      email: 'wlasciciel@syntetyczny.example',
      tenantName: 'Biuro S4',
      reason: 'Bootstrap pod testy zaproszeń',
      now,
    });
    expect(boot.ok).toBe(true);
    if (!boot.ok) {
      throw new Error('Oczekiwano sukcesu bootstrapu.');
    }

    const tId = tenantId(boot.receipt.tenantId);
    const comp1 = legalEntityId(randomUUID());
    const comp2 = legalEntityId(randomUUID());
    for (const [leId, nip] of [
      [comp1, '5250002008'],
      [comp2, '5213017228'],
    ] as const) {
      workspaceStore.saveCompany({
        tenantId: tId,
        legalEntityId: leId,
        displayName: `Firma ${nip}`,
        nip,
        legalForm: 'jdg',
        taxRegime: 'kpir_skala',
        vatStatusSimple: 'czynny',
        taxProfile: {
          profileCode: 'jdg_kpir_skala',
          legalForm: 'jdg',
          taxRegime: 'kpir_skala',
          vatStatus: 'czynny',
          vatSettlementPeriod: 'monthly',
          zusScheme: 'duzy_zus',
          activityStartDate: '2026-01-01',
        },
        settingsHistory: [],
        documents: [],
        kpirEntries: [],
        ryczaltEntries: [],
        vatEntries: [],
        journalEntries: [],
        settlements: [],
        bankTransactions: [],
        reconciliationMatches: [],
        paidObligationsByKey: new Map(),
        explanationsById: new Map(),
      });
    }

    // Delegacja roli tenant_owner jest zawsze zabroniona
    const ownerRoleForbidden = await lifecycle.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: boot.receipt.userId,
      tenantId: tId,
      tokenSha256: hashInvitationTokenSha256(generateOpaqueInvitationToken()),
      inviteeEmail: 'kandydat@syntetyczny.example',
      intendedRole: 'tenant_owner',
      reason: 'Próba delegacji roli właściciela',
      expiresAt: new Date('2026-11-12T12:00:00.000Z'),
      now,
    });
    expect(ownerRoleForbidden).toEqual({
      ok: false,
      reason: 'target_role_not_delegable',
    });

    // Właściciel zaprasza administratora z grantem read wyłącznie do comp1
    const adminToken = generateOpaqueInvitationToken();
    const createAdminInv = await lifecycle.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: boot.receipt.userId,
      tenantId: tId,
      tokenSha256: hashInvitationTokenSha256(adminToken),
      inviteeEmail: 'admin@syntetyczny.example',
      intendedRole: 'tenant_admin',
      initialCompanyGrants: [{ legalEntityId: comp1, actions: ['read'] }],
      reason: 'Zaproszenie administratora z ograniczonym zakresem',
      expiresAt: new Date('2026-11-12T12:00:00.000Z'),
      now,
    });
    expect(createAdminInv.ok).toBe(true);

    const acceptAdmin = await lifecycle.acceptTenantInvitation({
      operationId: randomUUID(),
      tokenSha256: hashInvitationTokenSha256(adminToken),
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'admin-s4-unit',
      displayName: 'Piotr Admin',
      email: 'admin@syntetyczny.example',
      now,
    });
    expect(acceptAdmin.ok).toBe(true);
    if (!acceptAdmin.ok) {
      throw new Error('Oczekiwano akceptacji zaproszenia administratora.');
    }

    // Administrator nie może delegować comp2 (brak grantu)
    const adminEscComp2 = await lifecycle.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: acceptAdmin.userId,
      tenantId: tId,
      tokenSha256: hashInvitationTokenSha256(generateOpaqueInvitationToken()),
      inviteeEmail: 'member@syntetyczny.example',
      intendedRole: 'tenant_member',
      initialCompanyGrants: [{ legalEntityId: comp2, actions: ['read'] }],
      reason: 'Próba delegacji nieautoryzowanej firmy',
      expiresAt: new Date('2026-11-12T12:00:00.000Z'),
      now,
    });
    expect(adminEscComp2).toEqual({
      ok: false,
      reason: 'grant_scope_not_delegable',
    });

    // Administrator wystawia poprawne zaproszenie na comp1 read, po czym traci swój grant przed akceptacją (TOCTOU)
    const memberToken = generateOpaqueInvitationToken();
    const createMemberInv = await lifecycle.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: acceptAdmin.userId,
      tenantId: tId,
      tokenSha256: hashInvitationTokenSha256(memberToken),
      inviteeEmail: 'member@syntetyczny.example',
      intendedRole: 'tenant_member',
      initialCompanyGrants: [{ legalEntityId: comp1, actions: ['read'] }],
      reason: 'Zaproszenie członka przed cofnięciem grantu admina',
      expiresAt: new Date('2026-11-12T12:00:00.000Z'),
      now,
    });
    expect(createMemberInv.ok).toBe(true);

    for (const g of workspaceStore.listGrantsForUser(userId(acceptAdmin.userId))) {
      workspaceStore.upsertGrant({ ...g, revokedAt: new Date('2026-11-09T12:10:00.000Z') });
    }

    const acceptAfterToctou = await lifecycle.acceptTenantInvitation({
      operationId: randomUUID(),
      tokenSha256: hashInvitationTokenSha256(memberToken),
      issuer: 'https://idp.syntetyczny.example/realms/pap',
      subject: 'member-s4-unit',
      displayName: 'Celina Member',
      email: 'member@syntetyczny.example',
      now: new Date('2026-11-09T12:15:00.000Z'),
    });
    expect(acceptAfterToctou).toEqual({
      ok: false,
      reason: 'inviter_authority_revoked',
    });
    expect(
      workspaceStore.getUserBySubject('member-s4-unit', 'https://idp.syntetyczny.example/realms/pap'),
    ).toBeNull();
  });
});
