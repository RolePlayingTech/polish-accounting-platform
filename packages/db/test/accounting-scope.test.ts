import { executeAuthorizedCompanyAction } from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createPostgresAccountingScope,
  type PostgresAccountingScope,
} from '../src/accounting-scope.js';
import { connectDatabase } from '../src/client.js';
import { ScopeClosedError } from '../src/company-operation-probe.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { PostgresTransactionalUnitOfWork } from '../src/transactional-unit-of-work.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(10));
const ENTITY_A = legalEntityId(id(20));
const USER_A = userId(id(30));
const NOW_ISO = '2026-11-04T12:00:00.000Z';

const CONTEXT_BINDING_ROW = {
  xid: '4101',
  pid: 91,
  database: 'pap_test',
  role: 'pap_test_app',
  expires: '9999999999999',
};

const createSigner = () =>
  new PostgresContextSigner({ keyId: 'accounting-scope-test', keyHex: 'ab'.repeat(32) });

function createAccountingMockConnection(options?: { probeAlreadyExists?: boolean }) {
  const { db, client } = connectDatabase({
    PAP_DATABASE_ENV: 'test',
    DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
  });

  const executedQueries: Array<{ query: string; parameters: unknown[] }> = [];
  let probeInsertCount = 0;

  vi.spyOn(client, 'begin').mockImplementation((async (
    callback: (sql: typeof client) => Promise<unknown>,
  ) => callback(client)) as unknown as typeof client.begin);

  vi.spyOn(client, 'unsafe').mockImplementation(((query: string, parameters: unknown[] = []) => {
    executedQueries.push({ query, parameters });
    const pendingRows = (async () => {
      const normalized = query.toLowerCase();
      if (query.includes('pg_current_xact_id()')) {
        return [CONTEXT_BINDING_ROW];
      }
      if (normalized.includes('from "app_user"')) {
        return [[USER_A, 'active', null]];
      }
      if (normalized.includes('from "user_oidc_identity"')) {
        return [[id(77), USER_A, 'https://idp.example.test', 'sub-accountant', 'active', null]];
      }
      if (normalized.includes('from "tenant_membership"')) {
        return [[TENANT_A, USER_A, 'tenant_member', 'active', '2026-01-01T00:00:00.000Z', null]];
      }
      if (normalized.includes('from "legal_entity"')) {
        return [[ENTITY_A]];
      }
      if (normalized.includes('from "company_access_grant"')) {
        return [
          [
            id(90),
            TENANT_A,
            USER_A,
            ENTITY_A,
            parameters[3] ?? 'write',
            '2026-01-01T00:00:00.000Z',
            null,
            null,
          ],
        ];
      }
      if (query.includes('clock_timestamp()')) {
        return [{ now: NOW_ISO }];
      }
      if (normalized.includes('insert into "company_operation_probe"')) {
        probeInsertCount += 1;
        return options?.probeAlreadyExists ? [] : [[parameters[0]]];
      }
      if (normalized.includes('from "company_operation_probe"')) {
        return [[parameters[0], TENANT_A, ENTITY_A, USER_A, NOW_ISO]];
      }
      if (normalized.includes('insert into "accounting_document"')) {
        return [
          [
            parameters[0],
            TENANT_A,
            ENTITY_A,
            parameters[3],
            parameters[4],
            parameters[5],
            parameters[6],
            parameters[7],
            parameters[8],
            parameters[9],
            parameters[10],
            'PLN',
            parameters[12],
            parameters[13],
            parameters[14],
            parameters[15],
            parameters[16],
            parameters[17],
            parameters[18],
            parameters[19],
            parameters[20],
            parameters[21],
            parameters[22],
            parameters[23],
            parameters[24],
            USER_A,
            NOW_ISO,
          ],
        ];
      }
      if (normalized.includes('update "accounting_document"')) {
        return [
          [
            id(401),
            TENANT_A,
            ENTITY_A,
            'sales_invoice',
            'FV/2026/11/001',
            '2026-11-04',
            '2026-11-04',
            '2026-11-18',
            'Kontrahent Syntetyczny Sp. z o.o.',
            '5260250995',
            'ul. Prosta 1, 00-850 Warszawa',
            'PLN',
            100_000,
            23_000,
            123_000,
            'a'.repeat(64),
            'verified_posted',
            'uslugi_it',
            'Usługa programistyczna',
            'none',
            null,
            'NONE',
            null,
            USER_A,
            NOW_ISO,
            USER_A,
            NOW_ISO,
          ],
        ];
      }
      if (normalized.includes('from "accounting_document"')) {
        return [
          [
            id(401),
            TENANT_A,
            ENTITY_A,
            'sales_invoice',
            'FV/2026/11/001',
            '2026-11-04',
            '2026-11-04',
            '2026-11-18',
            'Kontrahent Syntetyczny Sp. z o.o.',
            '5260250995',
            'ul. Prosta 1, 00-850 Warszawa',
            'PLN',
            100_000,
            23_000,
            123_000,
            'a'.repeat(64),
            'draft',
            'uslugi_it',
            'Usługa programistyczna',
            'none',
            null,
            'NONE',
            null,
            null,
            null,
            USER_A,
            NOW_ISO,
          ],
        ];
      }
      if (normalized.includes('insert into "kpir_entry"')) {
        return [
          [
            parameters[0],
            TENANT_A,
            ENTITY_A,
            parameters[3],
            parameters[4],
            parameters[5],
            parameters[6],
            parameters[7],
            parameters[8],
            parameters[9],
            parameters[10],
            parameters[11],
            parameters[12],
            parameters[13],
            parameters[14],
            parameters[15],
            parameters[16],
            parameters[17],
            parameters[18],
            parameters[19],
            parameters[20],
            parameters[21],
            parameters[22],
            parameters[23],
            parameters[24],
            parameters[25],
            parameters[26],
            parameters[27],
            USER_A,
            NOW_ISO,
          ],
        ];
      }
      if (normalized.includes('insert into "security_decision_event"')) {
        return [];
      }
      return [];
    })();

    return Object.assign(pendingRows, { values: () => pendingRows });
  }) as unknown as typeof client.unsafe);

  return {
    db,
    executedQueries,
    get probeInsertCount() {
      return probeInsertCount;
    },
    async cleanup() {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    },
  };
}

describe('PostgresAccountingScope — izolacja TScope, sonda company_operation_probe i walidacja groszowa', () => {
  it('zamraża uchwyt repozytorium, nie ujawnia tx/signera i odrzuca użycie po zamknięciu callbacku (ScopeClosedError)', async () => {
    const conn = createAccountingMockConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createSigner(),
        createPostgresAccountingScope,
      );
      let leakedScope: PostgresAccountingScope | undefined;

      const result = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A,
          action: 'read',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        async (_ctx, scope) => {
          leakedScope = scope;
          expect(Object.isFrozen(scope)).toBe(true);
          for (const forbidden of ['tx', 'db', 'signer', 'execute', 'transaction', 'context']) {
            expect(scope).not.toHaveProperty(forbidden);
          }
          const docs = await scope.listAccountingDocuments();
          expect(Object.isFrozen(docs)).toBe(true);
          expect(docs).toHaveLength(1);
          expect(Object.isFrozen(docs[0])).toBe(true);
          return docs;
        },
      );

      expect(result.allowed).toBe(true);
      expect(conn.probeInsertCount).toBe(0);
      await expect(leakedScope!.listAccountingDocuments()).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(leakedScope!.getCompanyTaxSettings()).rejects.toBeInstanceOf(ScopeClosedError);
    } finally {
      await conn.cleanup();
    }
  });

  it('NEG: blokuje wywołanie metod zapisu w sesji z prawem wyłącznie do odczytu (action = read)', async () => {
    const conn = createAccountingMockConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createSigner(),
        createPostgresAccountingScope,
      );

      let capturedError: unknown;
      const denied = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A,
          action: 'read',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        async (_ctx, scope) => {
          try {
            return await scope.createAccountingDocument({
              documentType: 'sales_invoice',
              documentNumber: 'FV/2026/11/001',
              issueDate: '2026-11-04',
              saleDate: '2026-11-04',
              counterpartyName: 'Kontrahent Syntetyczny',
              netGrosze: 100_000,
              vatGrosze: 23_000,
              grossGrosze: 123_000,
              sha256Hash: 'a'.repeat(64),
              categoryCode: 'uslugi_it',
            });
          } catch (error) {
            capturedError = error;
            throw error;
          }
        },
      );
      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as Error).message).toContain('wymaga jawnego prawa zapisu');
      expect(denied.allowed).toBe(false);
      expect(conn.probeInsertCount).toBe(0);
    } finally {
      await conn.cleanup();
    }
  });

  it('zapisuje dokładnie jedną sondę company_operation_probe na wielokrokowy zapis w jednej transakcji oraz obsługuje idempotentny replay', async () => {
    const conn = createAccountingMockConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createSigner(),
        createPostgresAccountingScope,
      );
      const opId = id(601);

      const writeResult = await executeAuthorizedCompanyAction(
        {
          operationId: opId,
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        async (_ctx, scope) => {
          const doc = await scope.createAccountingDocument({
            id: id(401),
            documentType: 'sales_invoice',
            documentNumber: 'FV/2026/11/001',
            issueDate: '2026-11-04',
            saleDate: '2026-11-04',
            counterpartyName: 'Kontrahent Syntetyczny Sp. z o.o.',
            netGrosze: 100_000n,
            vatGrosze: 23_000n,
            grossGrosze: 123_000n,
            sha256Hash: 'a'.repeat(64),
            categoryCode: 'uslugi_it',
          });
          const entry = await scope.appendKpirEntry({
            lp: 1,
            period: '2026-11',
            eventDate: '2026-11-04',
            documentId: doc.document.id,
            documentNumber: doc.document.documentNumber,
            counterpartyName: doc.document.counterpartyName,
            counterpartyAddress: 'ul. Prosta 1, Warszawa',
            description: 'Sprzedaż usług IT',
            col7SalesRevenueGrosze: 100_000,
            ruleCode: 'KPIR_REV_COL7_ART_14_1',
            legalExplanationJson: { legalBasis: 'art. 14 ust. 1 u.p.d.o.f.' },
          });
          return { doc, entry };
        },
      );

      expect(writeResult.allowed).toBe(true);
      expect(conn.probeInsertCount).toBe(1);
    } finally {
      await conn.cleanup();
    }

    const replayConn = createAccountingMockConnection({ probeAlreadyExists: true });
    try {
      const replayUow = new PostgresTransactionalUnitOfWork(
        replayConn.db,
        createSigner(),
        createPostgresAccountingScope,
      );
      const replayResult = await executeAuthorizedCompanyAction(
        {
          operationId: id(601),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: replayUow,
        },
        (_ctx, scope) =>
          scope.createAccountingDocument({
            documentType: 'sales_invoice',
            documentNumber: 'FV/2026/11/001',
            issueDate: '2026-11-04',
            saleDate: '2026-11-04',
            counterpartyName: 'Kontrahent Syntetyczny Sp. z o.o.',
            netGrosze: 100_000,
            vatGrosze: 23_000,
            grossGrosze: 123_000,
            sha256Hash: 'a'.repeat(64),
            categoryCode: 'uslugi_it',
          }),
      );

      expect(replayResult).toMatchObject({
        allowed: true,
        data: { deduplicated: true },
      });
      expect(
        replayConn.executedQueries.some((q) =>
          q.query.toLowerCase().includes('insert into "accounting_document"'),
        ),
      ).toBe(false);
    } finally {
      await replayConn.cleanup();
    }
  });

  it('NEG: odrzuca kwoty zmiennoprzecinkowe (float), niespójne brutto oraz niezbilansowany dekret Wn !== Ma', async () => {
    const conn = createAccountingMockConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createSigner(),
        createPostgresAccountingScope,
      );

      const expectRejectedInWrite = async <T>(
        fn: (scope: PostgresAccountingScope) => Promise<T>,
        expectedMessageFragment: string,
      ) => {
        let captured: unknown;
        const outcome = await executeAuthorizedCompanyAction(
          {
            operationId: id(701),
            rawBearerToken: 'valid-jwt',
            tenantId: TENANT_A,
            legalEntityId: ENTITY_A,
            action: 'write',
          },
          {
            verifier: {
              verifyAccessToken: async () => ({
                ok: true as const,
                identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
              }),
            },
            identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
            unitOfWork: uow,
          },
          async (_ctx, scope) => {
            try {
              return await fn(scope);
            } catch (error) {
              captured = error;
              throw error;
            }
          },
        );
        expect(captured).toBeInstanceOf(Error);
        expect((captured as Error).message).toContain(expectedMessageFragment);
        expect(outcome.allowed).toBe(false);
      };

      await expectRejectedInWrite(
        (scope) =>
          scope.createAccountingDocument({
            documentType: 'sales_invoice',
            documentNumber: 'FV/FLOAT/1',
            issueDate: '2026-11-04',
            saleDate: '2026-11-04',
            counterpartyName: 'Kontrahent',
            netGrosze: 100.5,
            vatGrosze: 23,
            grossGrosze: 123.5,
            sha256Hash: 'b'.repeat(64),
            categoryCode: 'uslugi_it',
          }),
        'liczbą całkowitą w groszach',
      );

      await expectRejectedInWrite(
        (scope) =>
          scope.createAccountingDocument({
            documentType: 'sales_invoice',
            documentNumber: 'FV/SUM/1',
            issueDate: '2026-11-04',
            saleDate: '2026-11-04',
            counterpartyName: 'Kontrahent',
            netGrosze: 100_000,
            vatGrosze: 23_000,
            grossGrosze: 124_000,
            sha256Hash: 'c'.repeat(64),
            categoryCode: 'uslugi_it',
          }),
        'Niespójność kwot dokumentu',
      );

      await expectRejectedInWrite(
        (scope) =>
          scope.postJournalEntry({
            entryNumber: 'DZ/2026/11/001',
            period: '2026-11',
            bookingDate: '2026-11-04',
            documentDate: '2026-11-04',
            documentNumber: 'FV/2026/11/001',
            description: 'Niezbilansowany dekret',
            lines: [
              {
                ledgerAccountId: id(801),
                accountCode: '201',
                side: 'Wn',
                amountGrosze: 123_000,
                description: 'Rozrachunki z odbiorcami',
              },
              {
                ledgerAccountId: id(802),
                accountCode: '700',
                side: 'Ma',
                amountGrosze: 100_000,
                description: 'Brakująca linia VAT',
              },
            ],
          }),
        'Niezbilansowany dekret księgowy',
      );
      await expectRejectedInWrite(
        (scope) =>
          scope.postJournalEntry({
            entryNumber: 'DZ/2026/11/002',
            period: '2026-11',
            bookingDate: '2026-11-04',
            documentDate: '2026-11-04',
            documentNumber: 'FV/2026/11/002',
            description: 'Błędna strona linii dekretu',
            lines: [
              {
                ledgerAccountId: id(801),
                accountCode: '201',
                side: 'Wn',
                amountGrosze: 100_000,
                description: 'Rozrachunki z odbiorcami',
              },
              {
                ledgerAccountId: id(802),
                accountCode: '700',
                side: 'NIEPOPRAWNA' as unknown as 'Ma',
                amountGrosze: 100_000,
                description: 'Niepoprawna strona',
              },
            ],
          }),
        'Nieprawidłowa strona dekretu w linii 2',
      );
    } finally {
      await conn.cleanup();
    }
  });

  it('zakłada blokadę wierszową FOR UPDATE i predykat statusu przy operacjach odczyt-walidacja-aktualizacja', async () => {
    const conn = createAccountingMockConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createSigner(),
        createPostgresAccountingScope,
      );

      const outcome = await executeAuthorizedCompanyAction(
        {
          operationId: id(709),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-accountant' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        (_ctx, scope) => scope.verifyAndPostAccountingDocument({ documentId: id(401) }),
      );

      expect(outcome.allowed).toBe(true);
      const selectDocQuery = conn.executedQueries.find(
        (q) =>
          q.query.toLowerCase().includes('from "accounting_document"') &&
          q.query.toLowerCase().startsWith('select'),
      );
      expect(selectDocQuery?.query.toLowerCase()).toContain('for update');
      const updateDocQuery = conn.executedQueries.find((q) =>
        q.query.toLowerCase().startsWith('update "accounting_document"'),
      );
      expect(updateDocQuery?.query.toLowerCase()).toContain('"accounting_document"."status" in');
    } finally {
      await conn.cleanup();
    }
  });
});
