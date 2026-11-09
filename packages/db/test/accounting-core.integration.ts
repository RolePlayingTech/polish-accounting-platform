import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql as statement } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeAuthorizedCompanyAction } from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import {
  createPostgresAccountingScope,
  type PostgresAccountingScope,
} from '../src/accounting-scope.js';
import { connectDatabase } from '../src/client.js';
import { applyMigrations } from '../src/migrations.js';
import {
  configureRuntimePrivileges,
  provisionDatabaseContextKey,
} from '../src/runtime-provisioning.js';
import {
  createPostgresSecurityServices,
  type PostgresSecurityServices,
} from '../src/runtime-security.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { applyLocalRlsSessionContext } from '../src/transaction-primitives.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const actorA = userId(id(101));
const actorB = userId(id(102));
const tenantA = tenantId(id(201));
const entityA1 = legalEntityId(id(301));
const entityA2 = legalEntityId(id(302));
const tenantB = tenantId(id(202));
const entityB1 = legalEntityId(id(303));
const runtimeRole = 'pap_test_app';

const sha256Hex = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

describe('0007 Accounting Core — RLS, ACL, audyt atomowy, append-only i PostgresAccountingScope', () => {
  let owner: TestDatabase;
  let runtime: ReturnType<typeof connectDatabase>;
  let signer: PostgresContextSigner;
  let services: PostgresSecurityServices<PostgresAccountingScope>;
  let createdRole = false;

  const runAsActor = <TResult>(
    params: {
      subject: 'actor-a' | 'actor-b';
      tenant: ReturnType<typeof tenantId>;
      entity: ReturnType<typeof legalEntityId>;
      action: 'read' | 'write';
      operationId?: string;
    },
    operation: (scope: PostgresAccountingScope) => Promise<TResult>,
  ) =>
    executeAuthorizedCompanyAction(
      {
        requestId: randomUUID(),
        ...(params.action === 'write' ? { operationId: params.operationId ?? randomUUID() } : {}),
        rawBearerToken: `token-${params.subject}`,
        tenantId: params.tenant,
        legalEntityId: params.entity,
        action: params.action,
      },
      {
        ...services,
        verifier: {
          verifyAccessToken: async () => ({
            ok: true as const,
            identity: {
              issuer: 'https://idp.example.test',
              subject: params.subject,
            },
          }),
        },
      },
      (_ctx, scope) => operation(scope),
    );

  beforeAll(async () => {
    owner = await createTestDatabase();
    const { client: sql } = owner;
    const preprovisionedRuntimeUrl = process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL?.trim();
    let runtimeUrl: string;

    if (preprovisionedRuntimeUrl) {
      runtimeUrl = preprovisionedRuntimeUrl;
    } else {
      if ((await sql`SELECT 1 FROM pg_roles WHERE rolname = ${runtimeRole}`).length) {
        throw new Error('Test wymaga wolnej nazwy pap_test_app na odizolowanej instancji.');
      }
      const password = randomBytes(24).toString('hex');
      await sql.unsafe(`CREATE ROLE pap_test_app LOGIN PASSWORD '${password}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      createdRole = true;
      const url = new URL(process.env.DATABASE_URL!);
      url.username = runtimeRole;
      url.password = password;
      runtimeUrl = url.toString();
    }

    await applyMigrations(owner.db, owner.dataSchema);
    const keyHex = randomBytes(32).toString('hex');
    await provisionDatabaseContextKey(owner.db, {
      keyId: 'accounting-core-integration',
      keyHex,
      runtimeRole,
    });
    await configureRuntimePrivileges(owner.db, runtimeRole);

    await sql`INSERT INTO tenant(id, name) VALUES
      (${tenantA}, 'Kancelaria Syntetyczna A'),
      (${tenantB}, 'Kancelaria Syntetyczna B')`;
    await sql`INSERT INTO legal_entity(id, tenant_id, display_name) VALUES
      (${entityA1}, ${tenantA}, 'JDG Programista A1'),
      (${entityA2}, ${tenantA}, 'Spółka Siostrzana A2 Sp. z o.o.'),
      (${entityB1}, ${tenantB}, 'Obca Firma B1')`;
    await sql`INSERT INTO app_user(id, status) VALUES
      (${actorA}, 'active'),
      (${actorB}, 'active')`;
    await sql`INSERT INTO user_oidc_identity(id, user_id, issuer, subject, status) VALUES
      (${id(401)}, ${actorA}, 'https://idp.example.test', 'actor-a', 'active'),
      (${id(402)}, ${actorB}, 'https://idp.example.test', 'actor-b', 'active')`;
    await sql`INSERT INTO tenant_membership(tenant_id, user_id, role, status, valid_from) VALUES
      (${tenantA}, ${actorA}, 'tenant_member', 'active', '2026-01-01'),
      (${tenantB}, ${actorB}, 'tenant_member', 'active', '2026-01-01')`;
    await sql`INSERT INTO company_access_grant(grant_id, tenant_id, user_id, legal_entity_id, action, valid_from) VALUES
      (${id(501)}, ${tenantA}, ${actorA}, ${entityA1}, 'read', '2026-01-01'),
      (${id(502)}, ${tenantA}, ${actorA}, ${entityA1}, 'write', '2026-01-01'),
      (${id(503)}, ${tenantB}, ${actorB}, ${entityB1}, 'read', '2026-01-01'),
      (${id(504)}, ${tenantB}, ${actorB}, ${entityB1}, 'write', '2026-01-01')`;

    runtime = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 4 },
    );
    signer = new PostgresContextSigner({ keyId: 'accounting-core-integration', keyHex });
    services = await createPostgresSecurityServices(
      runtime.db,
      signer,
      createPostgresAccountingScope,
    );
  });

  afterAll(async () => {
    await runtime?.client.end({ timeout: 1 });
    if (createdRole) {
      await owner.client.unsafe(`REVOKE CONNECT ON DATABASE pap_test FROM ${runtimeRole}`);
      await owner.client`DROP SCHEMA ${owner.client(owner.dataSchema)} CASCADE`;
      await owner.client.unsafe(`DROP ROLE ${runtimeRole}`);
      await owner.client.end({ timeout: 1 });
      return;
    }
    await owner?.cleanup();
  });

  it('obsługuje pełny cykl księgowy (ustawienia, faktury SHA-256, KPiR, Ryczałt, VAT, UoR, rozrachunki, bank, terminy, MCP, powiadomienia) z atomowym audytem', async () => {
    const docHash = sha256Hex('FV/2026/11/001|5260250995|123000');
    const opId = randomUUID();

    const posted = await runAsActor(
      {
        subject: 'actor-a',
        tenant: tenantA,
        entity: entityA1,
        action: 'write',
        operationId: opId,
      },
      async (scope) => {
        const settings = await scope.upsertCompanyTaxSettings({
          nip: '5260250995',
          legalForm: 'jdg',
          taxRegime: 'kpir_liniowy',
          vatStatus: 'czynny',
          zusStage: 'duzy_zus',
          ksefMode: 'mandatory_2026_apr',
          defaultIban: 'PL61109010140000071219812874',
          addressSummary: 'ul. Prosta 10, 00-850 Warszawa',
        });

        const firstDoc = await scope.createAccountingDocument({
          documentType: 'sales_invoice',
          documentNumber: 'FV/2026/11/001',
          issueDate: '2026-11-04',
          saleDate: '2026-11-04',
          dueDate: '2026-11-18',
          counterpartyName: 'Odbiorca Testowy Sp. z o.o.',
          counterpartyNip: '5213007228',
          netGrosze: 1_000_000,
          vatGrosze: 230_000,
          grossGrosze: 1_230_000,
          sha256Hash: docHash,
          categoryCode: 'uslugi_it',
          aiProposalJson: { confidence: 0.96, suggestedCategory: 'uslugi_it' },
        });
        expect(firstDoc.deduplicated).toBe(false);
        expect(firstDoc.document.status).toBe('ai_proposed');

        // Deduplikacja po SHA-256 w obrębie tej samej firmy
        const duplicateDoc = await scope.createAccountingDocument({
          documentType: 'sales_invoice',
          documentNumber: 'FV/2026/11/001-DUP',
          issueDate: '2026-11-04',
          saleDate: '2026-11-04',
          counterpartyName: 'Odbiorca Testowy Sp. z o.o.',
          netGrosze: 1_000_000,
          vatGrosze: 230_000,
          grossGrosze: 1_230_000,
          sha256Hash: docHash,
          categoryCode: 'uslugi_it',
        });
        expect(duplicateDoc.deduplicated).toBe(true);
        expect(duplicateDoc.document.id).toBe(firstDoc.document.id);

        // Zatwierdzenie przez człowieka przed księgowaniem
        const verifiedDoc = await scope.verifyAndPostAccountingDocument({
          documentId: firstDoc.document.id,
          ksefMarker: 'NONE',
          ksefReference: '5260250995-20261104-ABCDEF-01',
        });
        expect(verifiedDoc.status).toBe('verified_posted');
        expect(verifiedDoc.verifiedBy).toBe(actorA);

        const kpir = await scope.appendKpirEntry({
          lp: 1,
          period: '2026-11',
          eventDate: '2026-11-04',
          documentId: verifiedDoc.id,
          documentNumber: verifiedDoc.documentNumber,
          ksefReference: verifiedDoc.ksefReference,
          counterpartyName: verifiedDoc.counterpartyName,
          counterpartyNip: verifiedDoc.counterpartyNip,
          counterpartyAddress: 'ul. Złota 44, Warszawa',
          description: 'Świadczenie usług programistycznych B2B',
          col7SalesRevenueGrosze: 1_000_000,
          ruleCode: 'KPIR_REV_COL7_ART_14_1',
          legalExplanationJson: { basis: 'art. 14 ust. 1 u.p.d.o.f.' },
        });

        const ryczalt = await scope.appendRyczaltEntry({
          lp: 1,
          period: '2026-11',
          eventDate: '2026-11-04',
          documentId: verifiedDoc.id,
          documentNumber: verifiedDoc.documentNumber,
          counterpartyName: verifiedDoc.counterpartyName,
          rateBps: 1200,
          revenueGrosze: 1_000_000,
          legalExplanationJson: { basis: 'art. 12 ust. 1 pkt 2b lit. b u.z.p.d.' },
        });

        const vat = await scope.appendVatRegisterEntry({
          direction: 'sales',
          period: '2026-11',
          taxPointDate: '2026-11-04',
          documentId: verifiedDoc.id,
          documentNumber: verifiedDoc.documentNumber,
          counterpartyName: verifiedDoc.counterpartyName,
          counterpartyNip: verifiedDoc.counterpartyNip,
          vatRateCode: '23',
          netGrosze: 1_000_000,
          vatTotalGrosze: 230_000,
          vatDeductibleGrosze: 0,
          vatNonDeductibleGrosze: 230_000,
          gtuCodes: ['GTU_12'],
          ksefMarker: 'NONE',
          ksefReference: verifiedDoc.ksefReference,
          legalExplanationJson: { basis: 'art. 19a ust. 1 u.p.t.u.' },
        });

        const accReceivable = await scope.upsertLedgerAccount({
          accountCode: '201',
          namePl: 'Rozrachunki z odbiorcami',
          teamNumber: 2,
          accountNature: 'asset',
        });
        const accRevenue = await scope.upsertLedgerAccount({
          accountCode: '700',
          namePl: 'Sprzedaż usług',
          teamNumber: 7,
          accountNature: 'revenue',
        });
        const accVatDue = await scope.upsertLedgerAccount({
          accountCode: '221-1',
          namePl: 'VAT należny',
          teamNumber: 2,
          accountNature: 'liability',
        });

        const journal = await scope.postJournalEntry({
          entryNumber: 'DZ/2026/11/001',
          period: '2026-11',
          bookingDate: '2026-11-04',
          documentDate: '2026-11-04',
          documentId: verifiedDoc.id,
          documentNumber: verifiedDoc.documentNumber,
          description: 'Dekret sprzedaży usług IT',
          lines: [
            {
              ledgerAccountId: accReceivable.id,
              accountCode: accReceivable.accountCode,
              side: 'Wn',
              amountGrosze: 1_230_000,
              description: 'Należność brutto od kontrahenta',
            },
            {
              ledgerAccountId: accRevenue.id,
              accountCode: accRevenue.accountCode,
              side: 'Ma',
              amountGrosze: 1_000_000,
              description: 'Przychód netto ze sprzedaży usług',
            },
            {
              ledgerAccountId: accVatDue.id,
              accountCode: accVatDue.accountCode,
              side: 'Ma',
              amountGrosze: 230_000,
              description: 'VAT należny 23%',
            },
          ],
        });

        const settlement = await scope.createSettlementItem({
          documentId: verifiedDoc.id,
          direction: 'receivable',
          counterpartyName: verifiedDoc.counterpartyName,
          counterpartyNip: verifiedDoc.counterpartyNip,
          documentNumber: verifiedDoc.documentNumber,
          issueDate: '2026-11-04',
          dueDate: '2026-11-18',
          originalGrossGrosze: 1_230_000,
        });

        const bankImport = await scope.importBankStatement({
          sourceFormat: 'csv',
          fileName: 'wyciag-2026-11.csv',
          sha256Hash: sha256Hex('wyciag-2026-11.csv'),
          iban: settings.defaultIban,
          transactions: [
            {
              bookingDate: '2026-11-10',
              direction: 'credit',
              amountGrosze: 1_230_000,
              counterpartyName: verifiedDoc.counterpartyName,
              title: 'Zapłata za FV/2026/11/001',
            },
          ],
        });

        const settledItem = await scope.applySettlementPayment({
          settlementId: settlement.id,
          paidAmountGrosze: 1_230_000,
        });

        const matchedTx = await scope.recordBankTransactionMatch({
          transactionId: bankImport.transactions[0]!.id,
          matchStatus: 'matched_exact',
          matchedSettlementId: settlement.id,
          matchedDocumentId: verifiedDoc.id,
          settledAmountGrosze: 1_230_000,
        });

        const obligation = await scope.upsertTaxObligation({
          period: '2026-11',
          obligationCode: 'VAT_JPK_V7M_2026_11',
          category: 'vat',
          titlePl: 'JPK_V7M i zapłata podatku VAT za listopad 2026',
          statutoryDueDate: '2026-12-25',
          adjustedDueDate: '2026-12-28',
          shiftReason: 'Przesunięcie ze świąt i weekendu (art. 12 § 5 Ordynacji podatkowej)',
          estimatedAmountGrosze: 230_000,
          legalBasisJson: { basis: 'art. 99 ust. 1 i art. 103 ust. 1 u.p.t.u.' },
        });

        const challengeHash = sha256Hex('human-challenge-token-1');
        const preparedMcp = await scope.saveMcpPreparedProposal({
          idempotencyKey: randomUUID(),
          payloadHash: sha256Hex('mcp-payload-1'),
          invoiceJson: { documentNumber: 'FV/MCP/001', grossGrosze: 61_500 },
          proposedPostingJson: { kpirColumn: 13, deductibleVatGrosze: 11_500 },
          confirmationChallengeHash: challengeHash,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        const confirmedMcp = await scope.confirmMcpPreparedProposal({
          proposalId: preparedMcp.proposal.proposalId,
          confirmationChallengeHash: challengeHash,
          ledgerEntryId: kpir.id,
        });

        const pref = await scope.upsertNotificationPreference({
          recipientEmail: 'ksiegowosc@firma-testowa.invalid',
          frequency: 'standard',
          advanceDays: [7, 2, -1],
        });
        const outbox = await scope.enqueueNotificationOutbox({
          obligationId: obligation.id,
          obligationCode: obligation.obligationCode,
          stage: 'advance_7d',
          dedupKey: `${obligation.obligationCode}:advance_7d:${actorA}`,
          recipientEmail: pref.recipientEmail,
          subject: '[PAP] Przypomnienie o terminie JPK_V7M',
          payloadJson: { dueDate: obligation.adjustedDueDate },
        });
        const mailboxMsg = await scope.appendSandboxMailboxMessage({
          outboxId: outbox.item.id,
          recipientEmail: pref.recipientEmail,
          subject: outbox.item.subject,
          rawRfc5322Mime:
            'From: noreply@pap.invalid\r\nTo: ksiegowosc@firma-testowa.invalid\r\nSubject: Test\r\n\r\nPrzypomnienie.',
          obligationCode: obligation.obligationCode,
        });
        await scope.updateNotificationOutboxStatus({
          outboxId: outbox.item.id,
          status: 'sent',
          attemptCount: 1,
        });

        return {
          settings,
          verifiedDoc,
          kpir,
          ryczalt,
          vat,
          journal,
          settledItem,
          matchedTx,
          confirmedMcp,
          mailboxMsg,
        };
      },
    );

    expect(posted.allowed).toBe(true);
    if (!posted.allowed) throw new Error('Oczekiwano autoryzowanego zapisu');
    expect(posted.data.kpir.col9TotalRevenueGrosze).toBe(1_000_000);
    expect(posted.data.journal.lines).toHaveLength(3);
    expect(posted.data.settledItem.status).toBe('settled');
    expect(posted.data.matchedTx.matchStatus).toBe('matched_exact');
    expect(posted.data.confirmedMcp.status).toBe('confirmed');

    // Weryfikacja atomowego śladu company_operation_probe + security_decision_event
    const probes = await owner.client`
      SELECT operation_id FROM company_operation_probe WHERE operation_id = ${opId}
    `;
    expect(probes).toHaveLength(1);
    const decisions = await owner.client`
      SELECT outcome, decision, action FROM security_decision_event WHERE operation_id = ${opId}
    `;
    expect(decisions).toEqual([{ outcome: 'committed', decision: 'allow', action: 'write' }]);
  });

  it('NEG: wymusza pełną izolację RLS między tenantami oraz między spółkami tego samego tenanta bez jawnego grantu', async () => {
    // Aktor B (tenantB / entityB1) widzi 0 dokumentów, wpisów KPiR, VAT i wiadomości A1
    const crossTenantRead = await runAsActor(
      { subject: 'actor-b', tenant: tenantB, entity: entityB1, action: 'read' },
      async (scope) => ({
        settings: await scope.getCompanyTaxSettings(),
        docs: await scope.listAccountingDocuments(),
        kpir: await scope.listKpirEntries(),
        vat: await scope.listVatRegisterEntries(),
        journal: await scope.listJournalEntries(),
        mailbox: await scope.listSandboxMailboxMessages(),
      }),
    );
    expect(crossTenantRead).toMatchObject({
      allowed: true,
      data: {
        settings: null,
        docs: [],
        kpir: [],
        vat: [],
        journal: [],
        mailbox: [],
      },
    });

    // Aktor A nie ma grantu do spółki siostrzanej entityA2 w tym samym tenantA -> odmowa + audyt denied
    const siblingCompanyAttempt = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA2, action: 'read' },
      (scope) => scope.listAccountingDocuments(),
    );
    expect(siblingCompanyAttempt).toMatchObject({
      allowed: false,
      reason: 'explicit_company_grant_required',
    });
  });

  it('NEG: blokuje DELETE na wszystkich tabelach 0007, UPDATE na rejestrach append-only, mutację kwot zaksięgowanej faktury oraz surowy zapis runtime bez audytu TX', async () => {
    // Brak uprawnień DELETE / TRUNCATE dla roli runtime (42501)
    for (const query of [
      'DELETE FROM accounting_document',
      'DELETE FROM kpir_entry',
      'DELETE FROM vat_register_entry',
      'DELETE FROM journal_entry',
      'DELETE FROM mcp_prepared_proposal',
      'TRUNCATE kpir_entry',
    ]) {
      await expectDatabaseError(runtime.client.unsafe(query), '42501');
    }

    // Brak uprawnień UPDATE na tabelach append-only (42501)
    for (const query of [
      "UPDATE kpir_entry SET description = 'podmiana'",
      'UPDATE ryczalt_entry SET revenue_grosze = 1',
      'UPDATE vat_register_entry SET net_grosze = 1',
      "UPDATE journal_entry SET description = 'podmiana'",
      'UPDATE journal_line SET debit_grosze = 1',
      "UPDATE sandbox_mailbox_message SET subject = 'podmiana'",
    ]) {
      await expectDatabaseError(runtime.client.unsafe(query), '42501');
    }

    // Nawet właściciel schematu (migrator) jest chroniony wyzwalaczem append-only i zakazem modyfikacji kwot zaksięgowanej faktury (23514)
    await expectDatabaseError(
      owner.client`UPDATE kpir_entry SET col7_sales_revenue_grosze = 999 WHERE tenant_id = ${tenantA}`,
      '23514',
    );
    await expectDatabaseError(
      owner.client`DELETE FROM accounting_document WHERE tenant_id = ${tenantA}`,
      '23514',
    );
    await expectDatabaseError(
      owner.client`UPDATE accounting_document SET net_grosze = 500000, gross_grosze = 730000 WHERE tenant_id = ${tenantA}`,
      '23514',
    );

    // Próba bezpośredniego zapisu przez runtime z ważnym kontekstem RLS, ale BEZ atomowego security_decision_event w tej samej TX -> odrzucona na COMMIT (23514)
    await expectDatabaseError(
      runtime.db.transaction(async (tx) => {
        const fakeOpId = randomUUID();
        const decisionAt = new Date().toISOString();
        await signer.apply(tx, {
          purpose: 'company',
          actorUserId: actorA,
          tenantId: tenantA,
          legalEntityId: entityA1,
          action: 'write',
          operationId: fakeOpId,
          decisionAt,
        });
        await applyLocalRlsSessionContext(tx, {
          actorUserId: actorA,
          tenantId: tenantA,
          legalEntityId: entityA1,
        });
        await tx.execute(
          statement`
            UPDATE company_tax_settings
            SET address_summary = 'Próba obejścia audytu'
            WHERE tenant_id = ${tenantA} AND legal_entity_id = ${entityA1}
          `,
        );
      }),
      '23514',
    );
  });

  it('P1-1: serializuje współbieżne zapisy w READ COMMITTED (maxConnections: 4) — blokuje nadpłatę rozrachunku i podwójne zatwierdzenie propozycji MCP', async () => {
    const createTwoPartyBarrier = () => {
      let arrived = 0;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      return async () => {
        arrived += 1;
        if (arrived >= 2) {
          release();
        }
        await ready;
      };
    };

    // (a) Dwie równoległe wpłaty po 60_000 gr na rozrachunek 100_000 gr -> dokładnie 1 przechodzi, druga odrzucona
    const setupSettlement = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      (scope) =>
        scope.createSettlementItem({
          direction: 'receivable',
          counterpartyName: 'Kontrahent Współbieżny Sp. z o.o.',
          counterpartyNip: '5213007228',
          documentNumber: 'FV/2026/11/RACE-SETTLEMENT',
          issueDate: '2026-11-04',
          dueDate: '2026-11-20',
          originalGrossGrosze: 100_000,
        }),
    );
    expect(setupSettlement.allowed).toBe(true);
    if (!setupSettlement.allowed) throw new Error('Nie utworzono rozrachunku testowego');
    const settlementId = setupSettlement.data.id;

    const settlementBarrier = createTwoPartyBarrier();
    const [paymentA, paymentB] = await Promise.all([
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
        async (scope) => {
          await settlementBarrier();
          const updated = await scope.applySettlementPayment({
            settlementId,
            paidAmountGrosze: 60_000,
          });
          await new Promise((resolve) => setTimeout(resolve, 30));
          return updated;
        },
      ),
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
        async (scope) => {
          await settlementBarrier();
          const updated = await scope.applySettlementPayment({
            settlementId,
            paidAmountGrosze: 60_000,
          });
          await new Promise((resolve) => setTimeout(resolve, 30));
          return updated;
        },
      ),
    ]);

    const allowedPayments = [paymentA, paymentB].filter((res) => res.allowed);
    const rejectedPayments = [paymentA, paymentB].filter((res) => !res.allowed);
    expect(allowedPayments).toHaveLength(1);
    expect(rejectedPayments).toHaveLength(1);
    if (allowedPayments[0]?.allowed) {
      expect(allowedPayments[0].data.remainingGrossGrosze).toBe(40_000);
      expect(allowedPayments[0].data.status).toBe('partial');
    }

    const [persistedSettlement] = await owner.client<
      { remaining_gross_grosze: string; status: string }[]
    >`
      SELECT remaining_gross_grosze::text AS remaining_gross_grosze, status
      FROM settlement_item
      WHERE id = ${settlementId}
    `;
    expect(persistedSettlement).toEqual({
      remaining_gross_grosze: '40000',
      status: 'partial',
    });

    // (b) Dwa równoległe wywołania confirmMcpPreparedProposal dla tej samej propozycji -> dokładnie 1 przechodzi
    const challengeHash = sha256Hex('mcp-race-challenge-token');
    const setupMcp = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      async (scope) => {
        const entry1 = await scope.appendKpirEntry({
          lp: 20,
          period: '2026-11',
          eventDate: '2026-11-04',
          documentNumber: 'FV/MCP/RACE/1',
          counterpartyName: 'Dostawca Chmury A',
          counterpartyAddress: 'ul. Testowa 1, Warszawa',
          description: 'Usługa chmurowa #1',
          col13OtherExpensesGrosze: 50_000,
          ruleCode: 'KPIR_COST_COL13_ART_22_1',
          legalExplanationJson: { basis: 'art. 22 ust. 1 u.p.d.o.f.' },
        });
        const entry2 = await scope.appendKpirEntry({
          lp: 21,
          period: '2026-11',
          eventDate: '2026-11-04',
          documentNumber: 'FV/MCP/RACE/2',
          counterpartyName: 'Dostawca Chmury B',
          counterpartyAddress: 'ul. Testowa 2, Warszawa',
          description: 'Usługa chmurowa #2',
          col13OtherExpensesGrosze: 50_000,
          ruleCode: 'KPIR_COST_COL13_ART_22_1',
          legalExplanationJson: { basis: 'art. 22 ust. 1 u.p.d.o.f.' },
        });
        const prepared = await scope.saveMcpPreparedProposal({
          idempotencyKey: randomUUID(),
          payloadHash: sha256Hex('mcp-race-payload'),
          invoiceJson: { documentNumber: 'FV/MCP/RACE', grossGrosze: 61_500 },
          proposedPostingJson: { kpirColumn: 13 },
          confirmationChallengeHash: challengeHash,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        return {
          proposalId: prepared.proposal.proposalId,
          entry1Id: entry1.id,
          entry2Id: entry2.id,
        };
      },
    );
    expect(setupMcp.allowed).toBe(true);
    if (!setupMcp.allowed) throw new Error('Nie przygotowano propozycji MCP do testu wyścigu');

    const mcpBarrier = createTwoPartyBarrier();
    const [confirmA, confirmB] = await Promise.all([
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
        async (scope) => {
          await mcpBarrier();
          const confirmed = await scope.confirmMcpPreparedProposal({
            proposalId: setupMcp.data.proposalId,
            confirmationChallengeHash: challengeHash,
            ledgerEntryId: setupMcp.data.entry1Id,
          });
          await new Promise((resolve) => setTimeout(resolve, 30));
          return confirmed;
        },
      ),
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
        async (scope) => {
          await mcpBarrier();
          const confirmed = await scope.confirmMcpPreparedProposal({
            proposalId: setupMcp.data.proposalId,
            confirmationChallengeHash: challengeHash,
            ledgerEntryId: setupMcp.data.entry2Id,
          });
          await new Promise((resolve) => setTimeout(resolve, 30));
          return confirmed;
        },
      ),
    ]);

    const allowedConfirmations = [confirmA, confirmB].filter((res) => res.allowed);
    const rejectedConfirmations = [confirmA, confirmB].filter((res) => !res.allowed);
    expect(allowedConfirmations).toHaveLength(1);
    expect(rejectedConfirmations).toHaveLength(1);
    if (allowedConfirmations[0]?.allowed) {
      expect(allowedConfirmations[0].data.status).toBe('confirmed');
    }

    const [persistedProposal] = await owner.client<{ status: string; ledger_entry_id: string }[]>`
      SELECT status, ledger_entry_id
      FROM mcp_prepared_proposal
      WHERE proposal_id = ${setupMcp.data.proposalId}
    `;
    expect(persistedProposal?.status).toBe('confirmed');
    expect([setupMcp.data.entry1Id, setupMcp.data.entry2Id]).toContain(
      persistedProposal?.ledger_entry_id,
    );
  });

  it('NEG (P1-2): pod rolą pap_test_app blokuje ścieżkę verified_posted -> archived -> draft, podmianę kolumn podatkowych na verified_posted oraz cofnięcie terminalnych statusów mcp_prepared_proposal', async () => {
    const setupFixtures = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      async (scope) => {
        const toArchive = await scope.createAccountingDocument({
          documentType: 'sales_invoice',
          documentNumber: 'FV/2026/11/GUARD-ARCHIVE',
          issueDate: '2026-11-04',
          saleDate: '2026-11-04',
          counterpartyName: 'Odbiorca Archiwalny Sp. z o.o.',
          counterpartyNip: '5213007228',
          netGrosze: 200_000,
          vatGrosze: 46_000,
          grossGrosze: 246_000,
          sha256Hash: sha256Hex('FV/2026/11/GUARD-ARCHIVE'),
          categoryCode: 'uslugi_it',
        });
        await scope.verifyAndPostAccountingDocument({ documentId: toArchive.document.id });
        const archivedDoc = await scope.archiveAccountingDocument(toArchive.document.id);

        const postedOnly = await scope.createAccountingDocument({
          documentType: 'purchase_invoice',
          documentNumber: 'FV/2026/11/GUARD-POSTED',
          issueDate: '2026-11-04',
          saleDate: '2026-11-04',
          counterpartyName: 'Dostawca Chroniony Sp. z o.o.',
          counterpartyNip: '5260250995',
          netGrosze: 300_000,
          vatGrosze: 69_000,
          grossGrosze: 369_000,
          sha256Hash: sha256Hex('FV/2026/11/GUARD-POSTED'),
          categoryCode: 'uslugi_obce',
        });
        const postedDoc = await scope.verifyAndPostAccountingDocument({
          documentId: postedOnly.document.id,
        });

        const kpirForMcp = await scope.appendKpirEntry({
          lp: 30,
          period: '2026-11',
          eventDate: '2026-11-04',
          documentId: postedDoc.id,
          documentNumber: postedDoc.documentNumber,
          counterpartyName: postedDoc.counterpartyName,
          counterpartyAddress: 'ul. Chroniona 5, Warszawa',
          description: 'Zakup usług obcych',
          col13OtherExpensesGrosze: 300_000,
          ruleCode: 'KPIR_COST_COL13_ART_22_1',
          legalExplanationJson: { basis: 'art. 22 ust. 1 u.p.d.o.f.' },
        });

        const challengeConfirmed = sha256Hex('guard-mcp-confirmed');
        const preparedToConfirm = await scope.saveMcpPreparedProposal({
          idempotencyKey: randomUUID(),
          payloadHash: sha256Hex('guard-mcp-payload-confirmed'),
          invoiceJson: { documentNumber: 'FV/MCP/GUARD-1', grossGrosze: 369_000 },
          proposedPostingJson: { kpirColumn: 13 },
          confirmationChallengeHash: challengeConfirmed,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        const confirmedProposal = await scope.confirmMcpPreparedProposal({
          proposalId: preparedToConfirm.proposal.proposalId,
          confirmationChallengeHash: challengeConfirmed,
          ledgerEntryId: kpirForMcp.id,
        });

        const preparedToReject = await scope.saveMcpPreparedProposal({
          idempotencyKey: randomUUID(),
          payloadHash: sha256Hex('guard-mcp-payload-rejected'),
          invoiceJson: { documentNumber: 'FV/MCP/GUARD-2', grossGrosze: 123_000 },
          proposedPostingJson: { kpirColumn: 13 },
          confirmationChallengeHash: sha256Hex('guard-mcp-rejected'),
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        const rejectedProposal = await scope.rejectMcpPreparedProposal(
          preparedToReject.proposal.proposalId,
        );

        return { archivedDoc, postedDoc, confirmedProposal, rejectedProposal };
      },
    );
    expect(setupFixtures.allowed).toBe(true);
    if (!setupFixtures.allowed) throw new Error('Nie przygotowano danych do testu P1-2');
    expect(setupFixtures.data.archivedDoc.status).toBe('archived');
    expect(setupFixtures.data.postedDoc.status).toBe('verified_posted');
    expect(setupFixtures.data.confirmedProposal.status).toBe('confirmed');
    expect(setupFixtures.data.rejectedProposal.status).toBe('rejected');

    const runRawRuntimeUpdate = async (
      query: ReturnType<typeof statement>,
    ): Promise<{ code: string | undefined; message: string }> => {
      let caughtStatementError: unknown;
      await runtime.db
        .transaction(async (tx) => {
          const fakeOpId = randomUUID();
          const decisionAt = new Date().toISOString();
          await signer.apply(tx, {
            purpose: 'company',
            actorUserId: actorA,
            tenantId: tenantA,
            legalEntityId: entityA1,
            action: 'write',
            operationId: fakeOpId,
            decisionAt,
          });
          await applyLocalRlsSessionContext(tx, {
            actorUserId: actorA,
            tenantId: tenantA,
            legalEntityId: entityA1,
          });
          try {
            await tx.execute(query);
          } catch (stmtErr) {
            caughtStatementError = stmtErr;
            throw stmtErr;
          }
        })
        .catch(() => undefined);

      let unwrapped = caughtStatementError;
      while (unwrapped instanceof Error && 'cause' in unwrapped && unwrapped.cause) {
        unwrapped = unwrapped.cause;
      }
      if (!(unwrapped instanceof Error)) {
        throw new Error('Oczekiwano natychmiastowego błędu wyzwalacza BEFORE UPDATE');
      }
      return {
        code: (unwrapped as { code?: string }).code,
        message: unwrapped.message,
      };
    };

    // (a) Próba cofnięcia zarchiwizowanego dokumentu do draft (verified_posted -> archived -> draft) pod pap_test_app
    const archivedToDraftErr = await runRawRuntimeUpdate(statement`
      UPDATE accounting_document
      SET status = 'draft', verified_by = NULL, verified_at = NULL
      WHERE id = ${setupFixtures.data.archivedDoc.id}
    `);
    expect(archivedToDraftErr.code).toBe('23514');
    expect(archivedToDraftErr.message).toContain(
      'Zarchiwizowany dokument księgowy jest niezmienny',
    );

    // (b) Próba podmiany counterparty_nip, issue_date oraz jednoczesnego archived + counterparty_nip na verified_posted
    const nipTamperErr = await runRawRuntimeUpdate(statement`
      UPDATE accounting_document
      SET counterparty_nip = '1111111111'
      WHERE id = ${setupFixtures.data.postedDoc.id}
    `);
    expect(nipTamperErr.code).toBe('23514');
    expect(nipTamperErr.message).toContain(
      'Zaksięgowany dokument może przejść wyłącznie do archiwum bez zmiany jakichkolwiek innych pól',
    );

    const issueDateTamperErr = await runRawRuntimeUpdate(statement`
      UPDATE accounting_document
      SET issue_date = '2026-11-01'
      WHERE id = ${setupFixtures.data.postedDoc.id}
    `);
    expect(issueDateTamperErr.code).toBe('23514');
    expect(issueDateTamperErr.message).toContain(
      'Zaksięgowany dokument może przejść wyłącznie do archiwum bez zmiany jakichkolwiek innych pól',
    );

    const archiveWithTamperErr = await runRawRuntimeUpdate(statement`
      UPDATE accounting_document
      SET status = 'archived', counterparty_nip = '1111111111'
      WHERE id = ${setupFixtures.data.postedDoc.id}
    `);
    expect(archiveWithTamperErr.code).toBe('23514');

    // (c) Próba cofnięcia confirmed -> pending_human_approval oraz rejected -> pending_human_approval na mcp_prepared_proposal
    const revertConfirmedMcpErr = await runRawRuntimeUpdate(statement`
      UPDATE mcp_prepared_proposal
      SET status = 'pending_human_approval',
          confirmed_by = NULL,
          confirmed_at = NULL,
          ledger_entry_id = NULL
      WHERE proposal_id = ${setupFixtures.data.confirmedProposal.proposalId}
    `);
    expect(revertConfirmedMcpErr.code).toBe('23514');
    expect(revertConfirmedMcpErr.message).toContain(
      'Propozycja MCP w stanie terminalnym jest niezmienna',
    );

    const revertRejectedMcpErr = await runRawRuntimeUpdate(statement`
      UPDATE mcp_prepared_proposal
      SET status = 'pending_human_approval'
      WHERE proposal_id = ${setupFixtures.data.rejectedProposal.proposalId}
    `);
    expect(revertRejectedMcpErr.code).toBe('23514');
    expect(revertRejectedMcpErr.message).toContain(
      'Propozycja MCP w stanie terminalnym jest niezmienna',
    );
  });

  it('utrwala skorygowane przez człowieka kolumny relacyjne accounting_document przy przejściu draft/ai_proposed -> verified_posted i trwale je pieczętuje', async () => {
    const created = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      async (scope) =>
        scope.createAccountingDocument({
          documentType: 'purchase_invoice',
          documentNumber: 'FV/AI/2026/11/DRAFT-01',
          issueDate: '2026-11-02',
          saleDate: '2026-11-02',
          dueDate: '2026-11-16',
          counterpartyName: 'Dostawca OCR Szkic Sp. z o.o.',
          counterpartyNip: '5213007228',
          counterpartyAddress: 'ul. Szkicowa 1, Warszawa',
          netGrosze: 250_000,
          vatGrosze: 57_500,
          grossGrosze: 307_500,
          sha256Hash: sha256Hex('human-override-doc-p1-1'),
          status: 'ai_proposed',
          categoryCode: 'uslugi_obce',
          aiProposalJson: { confidenceBps: 8100 },
        }),
    );
    expect(created.allowed).toBe(true);
    if (!created.allowed) throw new Error('Nie utworzono dokumentu ai_proposed');

    // Próba zatwierdzenia z niespójnymi kwotami (net + vat !== gross) kończy się błędem walidacji i rollbackiem
    let caughtMismatchError: unknown = null;
    const mismatched = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      async (scope) => {
        try {
          return await scope.verifyAndPostAccountingDocument({
            documentId: created.data.document.id,
            netGrosze: 280_000,
            vatGrosze: 64_400,
            grossGrosze: 999_999,
          });
        } catch (err) {
          caughtMismatchError = err;
          throw err;
        }
      },
    );
    expect(mismatched.allowed).toBe(false);
    expect(caughtMismatchError).toBeInstanceOf(Error);
    expect((caughtMismatchError as Error).message).toContain(
      'netGrosze + vatGrosze musi równać się grossGrosze',
    );

    // Zatwierdzenie z ludzką korektą kwot, numeru, dat oraz kontrahenta zapisuje nowe kolumny relacyjne SQL
    const verified = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA1, action: 'write' },
      async (scope) =>
        scope.verifyAndPostAccountingDocument({
          documentId: created.data.document.id,
          documentNumber: 'FV/KOREKTA-LUDZKA/2026/11/01',
          issueDate: '2026-11-03',
          saleDate: '2026-11-04',
          dueDate: '2026-11-18',
          counterpartyName: 'Zweryfikowany Dostawca IT Sp. z o.o.',
          counterpartyNip: '5250001003',
          counterpartyAddress: 'ul. Zweryfikowana 10, Kraków',
          netGrosze: 280_000,
          vatGrosze: 64_400,
          grossGrosze: 344_400,
          categoryCode: 'pozostale_wydatki_kpir',
        }),
    );
    expect(verified.allowed).toBe(true);

    const [sqlRow] = await owner.client<
      {
        status: string;
        document_number: string;
        issue_date: string;
        sale_date: string;
        due_date: string | null;
        counterparty_name: string;
        counterparty_nip: string | null;
        counterparty_address: string | null;
        net_grosze: string;
        vat_grosze: string;
        gross_grosze: string;
        category_code: string;
      }[]
    >`
      SELECT
        status,
        document_number,
        issue_date::text AS issue_date,
        sale_date::text AS sale_date,
        due_date::text AS due_date,
        counterparty_name,
        counterparty_nip,
        counterparty_address,
        net_grosze::text AS net_grosze,
        vat_grosze::text AS vat_grosze,
        gross_grosze::text AS gross_grosze,
        category_code
      FROM accounting_document
      WHERE id = ${created.data.document.id}
    `;

    expect(sqlRow).toEqual({
      status: 'verified_posted',
      document_number: 'FV/KOREKTA-LUDZKA/2026/11/01',
      issue_date: '2026-11-03',
      sale_date: '2026-11-04',
      due_date: '2026-11-18',
      counterparty_name: 'Zweryfikowany Dostawca IT Sp. z o.o.',
      counterparty_nip: '5250001003',
      counterparty_address: 'ul. Zweryfikowana 10, Kraków',
      net_grosze: '280000',
      vat_grosze: '64400',
      gross_grosze: '344400',
      category_code: 'pozostale_wydatki_kpir',
    });
  });

  it('0009 wymusza na poziomie schematu PostgreSQL unikalność (tenant_id, nip) przy tworzeniu i aktualizacji NIP, dopuszczając ten sam NIP w innym tenancie', async () => {
    const entityA3 = legalEntityId(id(304));
    const nipA1 = '5261040828';
    const nipA3 = '5213017228';

    await owner.client`
      INSERT INTO legal_entity(id, tenant_id, display_name)
      VALUES (${entityA3}, ${tenantA}, 'Druga Firma w Tenancie A')
    `;
    await owner.client`
      INSERT INTO entity_profile_version(id, tenant_id, legal_entity_id, profile_code, valid_from, profile_json)
      VALUES
        (${id(701)}, ${tenantA}, ${entityA1}, 'jdg_kpir_liniowy', '2026-01-01T00:00:00.000Z', ${JSON.stringify({ nip: nipA1, displayName: 'JDG Programista A1' })}::jsonb),
        (${id(702)}, ${tenantA}, ${entityA3}, 'spzoo_pelne_ksiegi', '2026-01-01T00:00:00.000Z', ${JSON.stringify({ nip: nipA3, displayName: 'Druga Firma w Tenancie A' })}::jsonb)
    `;
    await owner.client`
      INSERT INTO company_access_grant(grant_id, tenant_id, user_id, legal_entity_id, action, valid_from)
      VALUES
        (${id(505)}, ${tenantA}, ${actorA}, ${entityA3}, 'read', '2026-01-01'),
        (${id(506)}, ${tenantA}, ${actorA}, ${entityA3}, 'write', '2026-01-01')
    `;

    // 1. Zapis początkowych ustawień dla entityA3 z unikalnym nipA3 przechodzi
    const savedA3 = await runAsActor(
      { subject: 'actor-a', tenant: tenantA, entity: entityA3, action: 'write' },
      async (scope) =>
        scope.upsertCompanyTaxSettings({
          nip: nipA3,
          legalForm: 'sp_z_o_o',
          taxRegime: 'cit_klasyczny',
          vatStatus: 'czynny',
          zusStage: 'brak_sp_zoo',
          ksefMode: 'mandatory_2026_feb',
          addressSummary: 'ul. Unikalna 3, 00-003 Warszawa',
        }),
    );
    expect(savedA3.allowed).toBe(true);

    // 2. Próba aktualizacji NIP podmiotu entityA3 na NIP zajęty już przez entityA1 (5261040828) w tym samym tenancie
    // zostaje odrzucona przez PostgreSQL ograniczeniem UNIQUE company_tax_settings_tenant_nip_unique (23505)
    await expectDatabaseError(
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA3, action: 'write' },
        async (scope) =>
          scope.upsertCompanyTaxSettings({
            nip: nipA1,
            legalForm: 'sp_z_o_o',
            taxRegime: 'cit_klasyczny',
            vatStatus: 'czynny',
            zusStage: 'brak_sp_zoo',
            ksefMode: 'mandatory_2026_feb',
            addressSummary: 'ul. Konfliktowa 3, 00-003 Warszawa',
          }),
      ),
      '23505',
    );

    // 3. Próba aktualizacji NIP w aktywnej wersji entity_profile_version podmiotu entityA3 na nipA1
    // zostaje odrzucona przez częściowy indeks unikalny entity_profile_version_active_tenant_nip_uidx (23505)
    await expectDatabaseError(
      runAsActor(
        { subject: 'actor-a', tenant: tenantA, entity: entityA3, action: 'write' },
        async (scope) =>
          scope.upsertEntityProfileVersion({
            profileCode: 'spzoo_pelne_ksiegi',
            profileJson: { nip: nipA1, displayName: 'Próba podmiany NIP w profilu' },
          }),
      ),
      '23505',
    );

    // 4. Natomiast podmiot w INNYM tenancie (tenantB / entityB1) może legalnie użyć tego samego 10-cyfrowego NIP (nipA1)
    const savedB1SameNip = await runAsActor(
      { subject: 'actor-b', tenant: tenantB, entity: entityB1, action: 'write' },
      async (scope) =>
        scope.upsertCompanyTaxSettings({
          nip: nipA1,
          legalForm: 'jdg',
          taxRegime: 'kpir_skala',
          vatStatus: 'czynny',
          zusStage: 'duzy_zus',
          ksefMode: 'mandatory_2026_apr',
          addressSummary: 'ul. Inny Tenant 1, 30-001 Kraków',
        }),
    );
    expect(savedB1SameNip.allowed).toBe(true);
    if (savedB1SameNip.allowed) {
      expect(savedB1SameNip.data.nip).toBe(nipA1);
    }
  });
});
