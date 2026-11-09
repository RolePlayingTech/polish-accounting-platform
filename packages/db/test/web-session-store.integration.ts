import { createHash, randomBytes } from 'node:crypto';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { applyMigrations } from '../src/migrations.js';
import {
  configureRuntimePrivileges,
  provisionDatabaseContextKey,
} from '../src/runtime-provisioning.js';
import { assertRuntimeDatabaseSecurity } from '../src/runtime-security.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { PostgresUserIdentityStore } from '../src/user-identity.js';
import { PostgresWebSessionStore } from '../src/web-session-store.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const USER_1 = userId(id(501));
const USER_2 = userId(id(502));
const TENANT_1 = tenantId(id(601));
const ENTITY_1 = legalEntityId(id(701));
const ISSUER = 'https://idp.syntetyczny.example/realms/pap';
const runtimeRole = 'pap_test_bff_runtime';

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

describe('Wave 2 Slice 2 — PostgresWebSessionStore (FORCE RLS, NOBYPASSRLS, współbieżność i natychmiastowe unieważnianie)', () => {
  let owner: TestDatabase;
  let runtimeConnA: ReturnType<typeof connectDatabase>;
  let runtimeConnB: ReturnType<typeof connectDatabase>;
  let storeA: PostgresWebSessionStore;
  let storeB: PostgresWebSessionStore;
  let identityStore: PostgresUserIdentityStore;
  let createdRole = false;

  beforeAll(async () => {
    owner = await createTestDatabase();
    const { client: sql } = owner;
    const preprovisionedRuntimeUrl = process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL?.trim();
    let runtimeUrl: string;

    if (preprovisionedRuntimeUrl) {
      runtimeUrl = preprovisionedRuntimeUrl;
    } else {
      const password = randomBytes(24).toString('hex');
      await sql.unsafe(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${password}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      createdRole = true;
      const url = new URL(process.env.DATABASE_URL!);
      url.username = runtimeRole;
      url.password = password;
      runtimeUrl = url.toString();
    }

    const effectiveRole = preprovisionedRuntimeUrl
      ? new URL(preprovisionedRuntimeUrl).username
      : runtimeRole;

    await applyMigrations(owner.db, owner.dataSchema);
    const keyHex = randomBytes(32).toString('hex');
    await provisionDatabaseContextKey(owner.db, {
      keyId: 'wave2-bff-test',
      keyHex,
      runtimeRole: effectiveRole,
    });
    await configureRuntimePrivileges(owner.db, effectiveRole);

    await sql`INSERT INTO tenant (id, name) VALUES (${TENANT_1}, 'Organizacja Testowa BFF')`;
    await sql`INSERT INTO legal_entity (id, tenant_id, display_name) VALUES (${ENTITY_1}, ${TENANT_1}, 'Spółka Testowa BFF')`;

    identityStore = new PostgresUserIdentityStore(owner.db);
    await identityStore.provisionUserWithOidcIdentity({
      userId: USER_1,
      identityId: id(801),
      issuer: ISSUER,
      subject: 'anna-oidc-sub',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: USER_2,
      identityId: id(802),
      issuer: ISSUER,
      subject: 'bartosz-oidc-sub',
    });

    runtimeConnA = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 4 },
    );
    runtimeConnB = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 4 },
    );

    await assertRuntimeDatabaseSecurity(runtimeConnA.db);
    const signer = new PostgresContextSigner({ keyId: 'wave2-bff-test', keyHex });
    storeA = new PostgresWebSessionStore(runtimeConnA.db, signer);
    storeB = new PostgresWebSessionStore(runtimeConnB.db, signer);
  });

  afterAll(async () => {
    await runtimeConnA?.client.end({ timeout: 1 });
    await runtimeConnB?.client.end({ timeout: 1 });
    if (createdRole) {
      await owner.client.unsafe(`DROP OWNED BY ${runtimeRole}`);
      await owner.client.unsafe(`DROP ROLE ${runtimeRole}`);
    }
    await owner?.cleanup();
  });

  it('odrzuca bezpośredni dostęp SQL roli runtime (42501) do pap_oidc_auth_state i pap_bff_session oraz sfałszowany podpis pap.context', async () => {
    const sql = runtimeConnA.client;
    for (const stmt of [
      'SELECT * FROM pap_oidc_auth_state',
      'SELECT * FROM pap_bff_session',
      "INSERT INTO pap_oidc_auth_state (state_hash, encrypted_payload, expires_at) VALUES ('" +
        'a'.repeat(64) +
        "', 'cipher', now() + interval '5 minutes')",
      'DELETE FROM pap_bff_session',
      'TRUNCATE pap_bff_session',
      'TRUNCATE pap_oidc_auth_state',
    ]) {
      await expectDatabaseError(sql.unsafe(stmt), '42501');
    }

    // Próba wywołania pap_bff_session_op bez ważnego podpisu HMAC w pap.context kończy się odmową 42501
    await expectDatabaseError(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('pap.context', '{"v":1,"purpose":"bff_session","bffCommand":{"kind":"get_session","sessionIdHash":"${'b'.repeat(64)}"}}', true),
                        set_config('pap.context_signature', ${'0'.repeat(64)}, true)`;
        await tx`SELECT pap_bff_session_op(${JSON.stringify({
          kind: 'get_session',
          sessionIdHash: 'b'.repeat(64),
        })}::jsonb)`;
      }),
      '42501',
    );
  });

  it('gwarantuje atomowe jednorazowe zużycie stanu PKCE (10 równoległych żądań -> dokładnie 1 sukces i 9 already_consumed) oraz odrzuca wygasły stan', async () => {
    const stateHash = sha256Hex('pkce-concurrent-state-1');
    await storeA.createOidcAuthState({
      stateHash,
      encryptedPayload: 'v1.encrypted.pkce.payload',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const parallelResults = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        (idx % 2 === 0 ? storeA : storeB).consumeOidcAuthState({ stateHash }),
      ),
    );

    const successes = parallelResults.filter((r) => r.ok);
    const replays = parallelResults.filter(
      (r) => !r.ok && r.reason === 'already_consumed',
    );
    expect(successes).toHaveLength(1);
    expect(replays).toHaveLength(9);

    const expiredHash = sha256Hex('pkce-expired-state-1');
    const baseNow = new Date('2026-11-09T12:00:00.000Z');
    await storeA.createOidcAuthState({
      stateHash: expiredHash,
      encryptedPayload: 'v1.expired.payload',
      expiresAt: new Date(baseNow.getTime() + 10_000),
      now: baseNow,
    });

    const expiredRes = await storeB.consumeOidcAuthState({
      stateHash: expiredHash,
      now: new Date(baseNow.getTime() + 11_000),
    });
    expect(expiredRes).toEqual({ ok: false, reason: 'expired' });
  });

  it('współdzieli sesję między dwiema instancjami, obsługuje współbieżną rotację tokenów i natychmiast unieważnia sesję po cofnięciu tożsamości lub wyłączeniu konta', async () => {
    const sessionIdHash = sha256Hex('opaque-session-anna-1');
    const now = new Date('2026-11-09T12:00:00.000Z');

    const created = await storeA.createSession({
      sessionIdHash,
      userId: USER_1,
      issuer: ISSUER,
      subject: 'anna-oidc-sub',
      displayName: 'Anna Księgowa',
      email: 'anna@biuro-syntetyczne.example',
      tenantId: TENANT_1,
      legalEntityId: ENTITY_1,
      period: '2026-11',
      encryptedTokens: 'v1.gen0.tokens',
      accessTokenExpiresAt: new Date(now.getTime() + 300_000),
      expiresAt: new Date(now.getTime() + 28_800_000),
      now,
    });
    expect(created.ok).toBe(true);

    // Druga instancja natychmiast widzi utworzoną sesję
    const fetchedFromB = await storeB.getSession({ sessionIdHash, now });
    expect(fetchedFromB).toMatchObject({
      ok: true,
      session: {
        userId: USER_1,
        tenantId: TENANT_1,
        legalEntityId: ENTITY_1,
        refreshGeneration: 0,
        encryptedTokens: 'v1.gen0.tokens',
      },
    });

    // Współbieżna rotacja z dwóch instancji z expectedGeneration=0:
    // jedna wygrywa (rotated=true), druga otrzymuje stan zwycięzcy w oknie karencji (alreadyAdvanced=true)
    const [rotA, rotB] = await Promise.all([
      storeA.rotateSessionTokens({
        sessionIdHash,
        expectedGeneration: 0,
        encryptedTokens: 'v1.gen1.fromA',
        accessTokenExpiresAt: new Date(now.getTime() + 600_000),
        now: new Date(now.getTime() + 1_000),
      }),
      storeB.rotateSessionTokens({
        sessionIdHash,
        expectedGeneration: 0,
        encryptedTokens: 'v1.gen1.fromB',
        accessTokenExpiresAt: new Date(now.getTime() + 600_000),
        now: new Date(now.getTime() + 1_000),
      }),
    ]);

    expect(rotA.ok && rotB.ok).toBe(true);
    if (rotA.ok && rotB.ok) {
      const rotatedFlags = [rotA.rotated, rotB.rotated].sort();
      const advancedFlags = [rotA.alreadyAdvanced, rotB.alreadyAdvanced].sort();
      expect(rotatedFlags).toEqual([false, true]);
      expect(advancedFlags).toEqual([false, true]);
      expect(rotA.session.refreshGeneration).toBe(1);
      expect(rotB.session.refreshGeneration).toBe(1);
      expect(rotA.session.encryptedTokens).toBe(rotB.session.encryptedTokens);
    }

    // Próba rotacji przestarzałej generacji po upływie okna karencji kończy się odmową
    const staleAfterGrace = await storeB.rotateSessionTokens({
      sessionIdHash,
      expectedGeneration: 0,
      encryptedTokens: 'v1.stale.attempt',
      accessTokenExpiresAt: new Date(now.getTime() + 900_000),
      now: new Date(now.getTime() + 60_000),
    });
    expect(staleAfterGrace).toEqual({ ok: false, reason: 'generation_conflict' });

    // Cofnięcie tożsamości OIDC natychmiast blokuje odczyt i rotację aktywnej sesji w bazie
    await identityStore.revokeOidcIdentity({ userId: USER_1, identityId: id(801) });
    expect(
      await storeA.getSession({
        sessionIdHash,
        now: new Date(now.getTime() + 2_000),
      }),
    ).toEqual({ ok: false, reason: 'user_inactive_or_identity_revoked' });

    // Analogicznie wyłączenie konta app_user natychmiast blokuje sesję drugiego użytkownika
    const sessionUser2Hash = sha256Hex('opaque-session-bartosz-1');
    expect(
      (
        await storeB.createSession({
          sessionIdHash: sessionUser2Hash,
          userId: USER_2,
          issuer: ISSUER,
          subject: 'bartosz-oidc-sub',
          displayName: 'Bartosz Testowy',
          email: 'bartosz@syntetyczny.example',
          tenantId: TENANT_1,
          legalEntityId: ENTITY_1,
          period: '2026-11',
          encryptedTokens: 'v1.user2.tokens',
          accessTokenExpiresAt: new Date(now.getTime() + 300_000),
          expiresAt: new Date(now.getTime() + 28_800_000),
          now,
        })
      ).ok,
    ).toBe(true);

    await identityStore.disableUserAccount({ userId: USER_2 });
    expect(
      await storeA.getSession({
        sessionIdHash: sessionUser2Hash,
        now: new Date(now.getTime() + 2_000),
      }),
    ).toEqual({ ok: false, reason: 'user_inactive_or_identity_revoked' });
  });
});
