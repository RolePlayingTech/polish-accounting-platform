import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryAccountingWorkspaceStore,
  InMemoryIdentityLifecycleStore,
  buildAuthenticatedSessionView,
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
});
