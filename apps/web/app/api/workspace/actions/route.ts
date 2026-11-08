import { NextResponse, type NextRequest } from 'next/server';
import type {
  KpirExpenseQualificationKind,
  RyczaltRateCode,
  TaxProfileCode,
  VatDeductionMode,
  VatRateCode,
} from '@pap/domain';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import { readServerSession, writeSessionToResponse } from '../../../../lib/session';
import {
  MAX_WORKSPACE_IMPORT_BYTES,
  WorkspaceAccessError,
  addJournalEntryMutation,
  addManualKpirEntryMutation,
  addRyczaltEntryMutation,
  approveAndPostDocumentMutation,
  createCompanyMutation,
  createOrImportDocumentMutation,
  importAndReconcileBankStatementMutation,
  manageCompanyGrantMutation,
  manageMcpProposalMutation,
  toggleObligationPaidMutation,
  updateCompanyTaxSettingsMutation,
  updateNotificationPrefsAndDispatchMutation,
} from '../../../../lib/synthetic-workspace';
import type {
  DocumentKind,
  NotificationFrequency,
  ReminderStage,
} from '../../../../lib/workspace-types';

function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  const session = await readServerSession();
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Sesja nieaktywna — zaloguj się jako jedna z person testowych na /login.',
      },
      { status: 401 },
    );
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_WORKSPACE_IMPORT_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: 'payload_too_large',
          error: 'Ładunek żądania przekracza dopuszczalny limit 256 KB.',
        },
        { status: 413 },
      );
    }
  }

  let rawBodyText: string;
  try {
    rawBodyText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, reasonCode: 'invalid_body', error: 'Nie udało się odczytać treści żądania.' },
      { status: 400 },
    );
  }

  if (Buffer.byteLength(rawBodyText, 'utf8') > MAX_WORKSPACE_IMPORT_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'payload_too_large',
        error: 'Ładunek żądania przekracza dopuszczalny limit 256 KB.',
      },
      { status: 413 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBodyText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Wymagany obiekt JSON.');
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, reasonCode: 'invalid_json', error: 'Nieprawidłowy ładunek JSON.' },
      { status: 400 },
    );
  }

  const action = str(payload['action']);

  try {
    switch (action) {
      case 'create_company': {
        const created = await createCompanyMutation(session, {
          companyName: str(payload['companyName']),
          nip: str(payload['nip']),
          address: str(payload['address']),
          legalForm: payload['legalForm'] === 'sp_z_o_o' ? 'sp_z_o_o' : 'jdg',
          profileCode: (str(payload['profileCode']) || 'jdg_kpir_skala') as TaxProfileCode,
          vatStatus: payload['vatStatus'] === 'zwolniony_art_113' ? 'zwolniony_art_113' : 'czynny',
        });

        const switchImmediately = payload['switchImmediately'] !== false;
        const res = NextResponse.json({ ok: true, company: created });
        if (switchImmediately) {
          writeSessionToResponse(res, {
            oidcToken: session.oidcToken,
            context: {
              ...session.context,
              tenantId: created.tenantId,
              legalEntityId: created.legalEntityId,
            },
          });
        }
        return res;
      }

      case 'update_tax_settings': {
        const updated = await updateCompanyTaxSettingsMutation(session, {
          profileCode: (str(payload['profileCode']) || 'jdg_kpir_skala') as TaxProfileCode,
          vatStatus: payload['vatStatus'] === 'zwolniony_art_113' ? 'zwolniony_art_113' : 'czynny',
          zusScheme: (str(payload['zusScheme']) || 'duzy_zus') as
            | 'ulga_na_start'
            | 'preferencyjny_zus'
            | 'duzy_zus'
            | 'not_applicable',
          smallTaxpayer: Boolean(payload['smallTaxpayer']),
        });
        return NextResponse.json({ ok: true, company: updated });
      }

      case 'grant_access': {
        const rawActions = Array.isArray(payload['actions']) ? payload['actions'] : ['read'];
        const actions: ('read' | 'write')[] = rawActions.includes('write')
          ? ['read', 'write']
          : ['read'];
        const targetUserId = str(payload['targetUserId']).trim();
        await manageCompanyGrantMutation(session, {
          op: 'grant',
          userEmail: str(payload['userEmail']),
          userDisplayName: str(payload['userDisplayName']),
          actions,
          ...(targetUserId ? { targetUserId } : {}),
        });
        return NextResponse.json({ ok: true });
      }

      case 'revoke_access': {
        await manageCompanyGrantMutation(session, {
          op: 'revoke',
          grantId: str(payload['grantId']),
        });
        return NextResponse.json({ ok: true });
      }

      case 'create_manual_document': {
        const ksefRef = str(payload['ksefReferenceNumber']).trim();
        const created = await createOrImportDocumentMutation(session, {
          mode: 'manual',
          documentKind: (str(payload['documentKind']) || 'purchase') as DocumentKind,
          direction: payload['direction'] === 'sales' ? 'sales' : 'purchase',
          documentNumber: str(payload['documentNumber']),
          issueDate: str(payload['issueDate'], `${session.context.period}-16`),
          dueDate: str(payload['dueDate'], `${session.context.period}-28`),
          counterpartyName: str(payload['counterpartyName']),
          counterpartyNip: str(payload['counterpartyNip']),
          description: str(payload['description']),
          netPln: str(payload['netPln'], '0.00'),
          vatRate: (str(payload['vatRate']) || '23') as VatRateCode,
          ksefMarker: (str(payload['ksefMarker']) || 'BFK') as 'NrKSeF' | 'OFF' | 'BFK' | 'DI',
          ...(ksefRef ? { ksefReferenceNumber: ksefRef } : {}),
          annex15Item: Boolean(payload['annex15Item']),
        });
        return NextResponse.json({ ok: true, document: created });
      }

      case 'import_document': {
        const fmt = str(payload['format']);
        const format: 'fa3_xml' | 'csv' | 'json' =
          fmt === 'csv' ? 'csv' : fmt === 'json' ? 'json' : 'fa3_xml';
        const created = await createOrImportDocumentMutation(session, {
          mode: 'import_xml_or_csv',
          format,
          rawPayload: str(payload['rawPayload']),
        });
        return NextResponse.json({ ok: true, document: created });
      }

      case 'approve_and_post_document': {
        const updated = await approveAndPostDocumentMutation(session, {
          documentId: str(payload['documentId']),
          documentNumber: str(payload['documentNumber']),
          counterpartyName: str(payload['counterpartyName']),
          counterpartyNip: str(payload['counterpartyNip']),
          issueDate: str(payload['issueDate']),
          netPln: str(payload['netPln'], '0.00'),
          vatPln: str(payload['vatPln'], '0.00'),
          expenseQualification: (str(payload['expenseQualification']) ||
            'other_expenses_100_col13') as KpirExpenseQualificationKind,
          vatDeductionMode: (str(payload['vatDeductionMode']) || 'full_100') as VatDeductionMode,
        });
        return NextResponse.json({ ok: true, document: updated });
      }

      case 'add_kpir_entry': {
        const ksefRef = str(payload['ksefReferenceNumber']).trim();
        const entry = await addManualKpirEntryMutation(session, {
          mode: 'entry',
          eventDate: str(payload['eventDate'], `${session.context.period}-20`),
          documentNumber: str(payload['documentNumber']),
          ...(ksefRef ? { ksefReferenceNumber: ksefRef } : {}),
          counterpartyName: str(payload['counterpartyName']),
          counterpartyNip: str(payload['counterpartyNip']),
          counterpartyAddress: str(payload['counterpartyAddress']),
          eventDescription: str(payload['eventDescription']),
          salesPln: str(payload['salesPln'], '0.00'),
          otherExpensesPln: str(payload['otherExpensesPln'], '0.00'),
        });
        return NextResponse.json({ ok: true, entryId: entry.id });
      }

      case 'storno_kpir_entry': {
        const storno = await addManualKpirEntryMutation(session, {
          mode: 'storno',
          targetEntryId: str(payload['targetEntryId']),
          correctionDate: str(payload['correctionDate'], `${session.context.period}-25`),
          correctionDocumentNumber: str(payload['correctionDocumentNumber']),
          correctionReason: str(payload['correctionReason'], 'Korekta zapisu księgowego'),
        });
        return NextResponse.json({ ok: true, entryId: storno.id });
      }

      case 'add_ryczalt_entry': {
        const nip = str(payload['counterpartyNip']).trim();
        const remarks = str(payload['remarks']).trim();
        const entry = await addRyczaltEntryMutation(session, {
          revenueDate: str(payload['revenueDate'], `${session.context.period}-20`),
          documentNumber: str(payload['documentNumber']),
          counterpartyName: str(payload['counterpartyName']),
          ...(nip ? { counterpartyNip: nip } : {}),
          rate: (str(payload['rate']) || '12') as RyczaltRateCode,
          revenuePln: str(payload['revenuePln'], '0.00'),
          ...(remarks ? { remarks } : {}),
        });
        return NextResponse.json({ ok: true, entryId: entry.id });
      }

      case 'add_journal_entry': {
        const rawLines = Array.isArray(payload['lines']) ? payload['lines'] : [];
        const lines = rawLines.map((item) => {
          const rec = (item ?? {}) as Record<string, unknown>;
          return {
            accountCode: str(rec['accountCode']),
            side: (rec['side'] === 'Ma' ? 'Ma' : 'Wn') as 'Wn' | 'Ma',
            amountPln: str(rec['amountPln'], '0.00'),
            description: str(rec['description']),
          };
        });
        const entry = await addJournalEntryMutation(session, {
          bookingDate: str(payload['bookingDate'], `${session.context.period}-24`),
          documentNumber: str(payload['documentNumber']),
          description: str(payload['description']),
          lines,
        });
        return NextResponse.json({ ok: true, entryNumber: entry.entryNumber });
      }

      case 'import_bank_statement': {
        const result = await importAndReconcileBankStatementMutation(session, {
          format: payload['format'] === 'mt940' ? 'mt940' : 'csv',
          content: str(payload['content']),
          applySettlements: Boolean(payload['applySettlements']),
        });
        return NextResponse.json({ ok: true, ...result });
      }

      case 'toggle_obligation_paid': {
        const nextPaid = await toggleObligationPaidMutation(
          session,
          str(payload['obligationCode']),
        );
        return NextResponse.json({ ok: true, isPaid: nextPaid });
      }

      case 'update_notification_prefs': {
        const rawDisabled = Array.isArray(payload['disabledStages'])
          ? payload['disabledStages'].filter((s): s is ReminderStage => typeof s === 'string')
          : [];
        await updateNotificationPrefsAndDispatchMutation(session, {
          op: 'update_prefs',
          frequency: (str(payload['frequency']) || 'standard') as NotificationFrequency,
          optionalRemindersOptedOut: Boolean(payload['optionalRemindersOptedOut']),
          disabledStages: rawDisabled,
        });
        return NextResponse.json({ ok: true });
      }

      case 'dispatch_due_notifications': {
        await updateNotificationPrefsAndDispatchMutation(session, {
          op: 'dispatch_due',
        });
        return NextResponse.json({ ok: true });
      }

      case 'mcp_issue_code': {
        const res = await manageMcpProposalMutation(session, {
          op: 'issue_code',
          proposalId: str(payload['proposalId']),
        });
        return NextResponse.json({ ok: true, ...res });
      }

      case 'mcp_confirm_proposal': {
        const code = str(payload['confirmationCode']).trim();
        await manageMcpProposalMutation(session, {
          op: 'confirm',
          proposalId: str(payload['proposalId']),
          ...(code ? { confirmationCode: code } : {}),
        });
        return NextResponse.json({ ok: true });
      }

      case 'mcp_reject_proposal': {
        const reason = str(payload['reason']).trim();
        await manageMcpProposalMutation(session, {
          op: 'reject',
          proposalId: str(payload['proposalId']),
          ...(reason ? { reason } : {}),
        });
        return NextResponse.json({ ok: true });
      }

      case 'mcp_create_demo_proposal': {
        const res = await manageMcpProposalMutation(session, { op: 'create_demo_proposal' });
        return NextResponse.json({ ok: true, ...res });
      }

      default:
        return NextResponse.json(
          { ok: false, reasonCode: 'unknown_action', error: `Nieznana operacja BFF: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { ok: false, reasonCode: err.reasonCode, error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'validation_or_domain_error',
        error: err instanceof Error ? err.message : 'Nie udało się wykonać operacji księgowej.',
      },
      { status: 400 },
    );
  }
}
