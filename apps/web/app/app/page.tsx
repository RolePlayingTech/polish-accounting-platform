import Link from 'next/link';
import {
  ActionQueue,
  Card,
  MoneyAmount,
  ObligationTimeline,
  StatusBadge,
  type ActionQueueItem,
  type TaxObligationItem,
} from '@pap/ui';
import { WorkspaceAccessDeniedCard } from '../../components/access-denied-card';
import { SystemStatusDiagnosticSection } from '../../components/system-status-section';
import { AcademyDisclaimerBanner } from '../../components/ui-controls';
import { WorkspaceShell } from '../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo } from '../../lib/field-help';
import { readPublicSystemStatus } from '../../lib/read-system-status';
import { readServerSession } from '../../lib/session';
import {
  WorkspaceAccessError,
  getDashboardSnapshot,
  listAccessibleCompaniesForSession,
} from '../../lib/synthetic-workspace';

export default async function AppDashboardPage() {
  const [systemStatus, session] = await Promise.all([
    readPublicSystemStatus(),
    readServerSession(),
  ]);

  let snapshot: Awaited<ReturnType<typeof getDashboardSnapshot>> | null = null;
  let sessionError: string | null = null;
  let sessionErrorStatus = 403;
  let sessionErrorReason = 'access_denied';

  if (session) {
    try {
      snapshot = await getDashboardSnapshot(session);
    } catch (err) {
      if (err instanceof WorkspaceAccessError) {
        sessionError = err.message;
        sessionErrorStatus = err.statusCode;
        sessionErrorReason = err.reasonCode;
      } else {
        sessionError = 'Nie udało się odczytać kontekstu wybranej firmy.';
      }
    }
  }

  if (!session || !snapshot) {
    let fallbackAccessible: Awaited<ReturnType<typeof listAccessibleCompaniesForSession>> = [];
    if (session) {
      try {
        fallbackAccessible = await listAccessibleCompaniesForSession(session);
      } catch {
        fallbackAccessible = [];
      }
    }

    return (
      <WorkspaceShell
        activeHref="/app"
        pageEyebrow="Pulpit księgowy · Księga Współczesna"
        pageTitle="Warsztat księgowy i status platformy"
        pageSubtitle="Zaloguj się na syntetyczną personę testową, aby pracować na księgach JDG i Sp. z o.o., lub przejdź bezpośrednio do Akademii Polskiej Księgowości."
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          {session && sessionError ? (
            <WorkspaceAccessDeniedCard
              statusCode={sessionErrorStatus}
              reasonCode={sessionErrorReason}
              messagePl={sessionError}
              accessibleCompanies={fallbackAccessible}
            />
          ) : null}

          <Card
            as="div"
            tone="accent"
            eyebrow="Środowisko demonstracyjne na danych syntetycznych"
            title="Rozpocznij pracę w księdze lub otwórz kurs księgowości"
          >
            <p className="max-w-3xl text-sm leading-relaxed text-[#464c48]">
              Aplikacja obsługuje pełny obieg dokumentów z weryfikacją propozycji AI obok oryginału,
              KPiR (19 kolumn KSeF 2026 / 17 kolumn 2019), ewidencję ryczałtu z kontrolą limitu 240
              000 PLN, rejestry VAT i JPK_V7M(3), księgę główną Sp. z o.o., rozrachunki bankowe oraz
              zatwierdzanie propozycji MCP przez człowieka.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex min-h-10 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-sm font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
              >
                Zaloguj się do środowiska testowego
              </Link>
              <Link
                href="/academy"
                className="inline-flex min-h-10 items-center rounded-md border border-[#858177] bg-white px-4 py-2 text-sm font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
              >
                Otwórz Akademię Księgowości
              </Link>
            </div>
          </Card>

          <SystemStatusDiagnosticSection status={systemStatus} />

          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const queueItems: ActionQueueItem[] = [
    ...snapshot.pendingDocuments.map((doc): ActionQueueItem => ({
      id: `q-doc-${doc.documentId}`,
      title: `${doc.documentNumber} · ${doc.counterpartyName}`,
      description: doc.isDuplicateSha256
        ? `Wykryto potencjalny duplikat skrótu SHA-256! Sprawdź dokument przed księgowaniem.`
        : `${doc.description} — propozycja (${doc.extractionMethodLabelPl ?? 'wymaga weryfikacji człowieka'}) oczekuje na zatwierdzenie człowieka.`,
      category: doc.isDuplicateSha256 ? 'discrepancy' : 'document_verify',
      urgency: doc.isDuplicateSha256 || doc.aiConfidence === 'low' ? 'urgent' : 'attention',
      amountGrosze: doc.grossGrosze,
      sourceLabel: doc.sourceChannel,
      ctaLabel: 'Weryfikuj dokument',
      href: `/app/documents/${doc.documentId}`,
    })),
    ...snapshot.pendingMcpProposals.map((prop): ActionQueueItem => ({
      id: `q-mcp-${prop.proposalId}`,
      title: `Propozycja MCP: ${prop.invoiceNumber} (${prop.counterpartyName})`,
      description: `Szkic przygotowany przez ${prop.clientName}. AI/MCP nie zapisuje w księgach bez Twojego potwierdzenia.`,
      category: 'mcp_approval',
      urgency: prop.promptInjectionSuspected ? 'urgent' : 'attention',
      amountGrosze: prop.grossGrosze,
      sourceLabel: prop.toolName,
      ctaLabel: 'Rozpatrz w kolejce MCP',
      href: '/app/mcp',
    })),
  ];

  const timelineItems: TaxObligationItem[] = snapshot.obligations.map((ob) => {
    const isApplicable = ob.status === 'applicable';
    const wasShifted = ob.shiftedFromNonWorkingDays.length > 0;
    const shiftSummary = ob.shiftedFromNonWorkingDays
      .map((s) => `${s.date}: ${s.reason}`)
      .join(', ');

    return {
      id: `ob-${ob.code}-${ob.period}`,
      dueDate: ob.effectiveDueDate,
      title: ob.title,
      authority: ob.category === 'zus' ? 'ZUS' : 'US',
      status: !isApplicable
        ? 'not_applicable'
        : ob.isPaid
          ? 'submitted'
          : wasShifted
            ? 'due_soon'
            : 'upcoming',
      relativeLabel: !isApplicable
        ? 'Okres przejściowy / informacyjny'
        : ob.isPaid
          ? 'Oznaczono jako opłacone'
          : wasShifted
            ? `Przesunięto z ${ob.statutoryDueDate} (${shiftSummary})`
            : `Termin ustawowy za ${ob.period}`,
      amountGrosze: ob.code.includes('ZUS')
        ? snapshot.estimatedZusGrosze
        : ob.code.includes('VAT') || ob.code.includes('JPK_V7')
          ? Math.max(0, snapshot.outputVatGrosze - snapshot.deductibleInputVatGrosze)
          : ob.code.includes('PIT') || ob.code.includes('RYCZALT') || ob.code.includes('CIT')
            ? snapshot.estimatedIncomeTaxGrosze
            : null,
      uncalculatedReason: isApplicable
        ? 'Obowiązek ewidencyjny / deklaracyjny'
        : ob.explanation.summary,
      legalBasis: mapDomainExplanationToBasisInfo(ob.explanation, ob.title),
    };
  });

  return (
    <WorkspaceShell
      activeHref="/app"
      pageEyebrow={`Pulpit operacyjny · okres ${snapshot.period}`}
      pageTitle="Do zrobienia dziś"
      pageSubtitle="Najpierw decyzje wymagające zatwierdzenia człowieka i ustawowe terminy, poniżej wskaźniki finansowe wybranego podmiotu."
      sessionContext={session.context}
      activeCompany={snapshot.activeCompany}
      accessibleCompanies={snapshot.accessibleCompanies}
      pageActions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/documents"
            className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#164833]"
          >
            + Dodaj / importuj FA(3)
          </Link>
          <Link
            href="/academy"
            className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec]"
          >
            Akademia Księgowości
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div
          data-testid="dashboard-financial-overview"
          className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5"
        >
          <Card as="div" eyebrow={`Przychody · ${snapshot.period}`}>
            <div className="mt-1">
              <MoneyAmount
                amount={snapshot.monthlyRevenueGrosze}
                inGrosze
                size="lg"
                variant="income"
              />
            </div>
            <p className="mt-1.5 text-xs text-[#636b66]">Sprzedaż netto ujęta w ewidencji</p>
          </Card>

          <Card as="div" eyebrow={`Koszty KUP · ${snapshot.period}`}>
            <div className="mt-1">
              <MoneyAmount
                amount={snapshot.monthlyKupCostsGrosze}
                inGrosze
                size="lg"
                variant="expense"
              />
            </div>
            <p className="mt-1.5 text-xs text-[#636b66]">
              {snapshot.activeCompany.profileCode === 'jdg_ryczalt'
                ? 'Ryczałt nie pomniejsza podstawy o KUP'
                : 'Koszty podatkowe okresu'}
            </p>
          </Card>

          <Card as="div" eyebrow="Bilans VAT (należny − naliczony)">
            <div className="mt-1">
              <MoneyAmount
                amount={snapshot.outputVatGrosze - snapshot.deductibleInputVatGrosze}
                inGrosze
                size="lg"
                variant="tax"
              />
            </div>
            <p className="mt-1.5 font-mono text-xs tabular-nums text-[#636b66]">
              Sprz.: {(snapshot.outputVatGrosze / 100).toFixed(2)} · Zak.:{' '}
              {(snapshot.deductibleInputVatGrosze / 100).toFixed(2)} PLN
            </p>
          </Card>

          <Card as="div" eyebrow={snapshot.incomeTaxLabelPl}>
            <div className="mt-1">
              <MoneyAmount
                amount={snapshot.estimatedIncomeTaxGrosze}
                inGrosze
                size="lg"
                variant="tax"
              />
            </div>
            <p className="mt-1.5 text-xs text-[#636b66]">Wyliczenie deterministyczne z ksiąg</p>
          </Card>

          <Card as="div" eyebrow="Składki ZUS (DRA)">
            <div className="mt-1">
              <MoneyAmount amount={snapshot.estimatedZusGrosze} inGrosze size="lg" variant="tax" />
            </div>
            <p className="mt-1.5 text-xs text-[#636b66]">
              {snapshot.activeCompany.zusScheme === 'not_applicable'
                ? 'Sp. z o.o. — brak ZUS właścicielskiego JDG'
                : `Schemat: ${snapshot.activeCompany.zusScheme}`}
            </p>
          </Card>
        </div>

        <ActionQueue
          eyebrow="Weryfikacja człowieka (Zasada nr 5)"
          title="Dokumenty z propozycją AI i oczekujące szkice MCP"
          items={queueItems}
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ObligationTimeline
              eyebrow="Kalendarz US / ZUS / KSeF"
              title={`Terminy ustawowe za okres ${snapshot.period}`}
              items={timelineItems}
            />
          </div>

          <Card as="div" eyebrow="Szybkie przejścia do modułów" title="Księgi, rejestry i edukacja">
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link
                  href="/app/kpir"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>KPiR (19 kolumn 2026 / 17 kolumn)</span>
                  <StatusBadge size="sm" tone="legal" label="Dz.U. 2025 poz. 1299" />
                </Link>
              </li>
              <li>
                <Link
                  href="/app/ryczalt"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>Ewidencja ryczałtu i limit 240 tys. PLN</span>
                  <span className="font-mono text-xs text-[#1d5c42]">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/app/vat"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>Rejestry VAT i pola JPK_V7M(3)</span>
                  <span className="font-mono text-xs text-[#1d5c42]">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/app/ledger"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>Pełne księgi UoR, Bilans, RZiS i CIT</span>
                  <span className="font-mono text-xs text-[#1d5c42]">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/app/finance"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>Rozrachunki, wiekowanie i bank CSV/MT940</span>
                  <span className="font-mono text-xs text-[#1d5c42]">→</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/app/mcp"
                  className="flex items-center justify-between rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2.5 font-medium text-[#191c1a] hover:border-[#1d5c42]"
                >
                  <span>Podłącz Claude / Cursor / ChatGPT (MCP)</span>
                  <span className="font-mono text-xs text-[#1d5c42]">→</span>
                </Link>
              </li>
            </ul>
          </Card>
        </div>

        <SystemStatusDiagnosticSection status={systemStatus} />

        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
