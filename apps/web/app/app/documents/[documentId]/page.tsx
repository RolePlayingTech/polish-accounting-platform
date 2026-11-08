import Link from 'next/link';
import { WorkspaceAccessErrorShell } from '../../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../../components/login-required-card';
import { AcademyDisclaimerBanner, AlertBanner } from '../../../../components/ui-controls';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { mustResolveUiFieldHelp } from '../../../../lib/field-help';
import { readServerSession } from '../../../../lib/session';
import {
  WorkspaceAccessError,
  getDashboardSnapshot,
  getDocumentDetailSnapshot,
} from '../../../../lib/synthetic-workspace';
import { DocumentVerificationClient } from './document-verification-client';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/documents"
        pageEyebrow="Warsztat weryfikacji Split-View"
        pageTitle="Weryfikacja propozycji AI obok oryginału dokumentu"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo={`/app/documents/${documentId}`}
            screenTitle="Warsztat weryfikacji dokumentu (Split-View)"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  let dash: Awaited<ReturnType<typeof getDashboardSnapshot>>;
  try {
    dash = await getDashboardSnapshot(session);
  } catch (err) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={err}
        activeHref="/app/documents"
        pageEyebrow="Warsztat weryfikacji Split-View"
        pageTitle="Weryfikacja propozycji AI obok oryginału dokumentu"
      />
    );
  }

  let detail: Awaited<ReturnType<typeof getDocumentDetailSnapshot>> | null = null;
  let errorMessage = 'Nie znaleziono dokumentu w aktywnej firmie.';

  try {
    detail = await getDocumentDetailSnapshot(session, documentId);
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      errorMessage = err.message;
    }
  }

  if (!detail) {
    return (
      <WorkspaceShell
        activeHref="/app/documents"
        pageEyebrow="Obieg dokumentów"
        pageTitle="Dokument niedostępny w bieżącym podmiocie"
        sessionContext={session.context}
        activeCompany={dash.activeCompany}
        accessibleCompanies={dash.accessibleCompanies}
      >
        <div className="space-y-4">
          <AlertBanner tone="warning" title="Brak dokumentu w aktywnej firmie">
            {errorMessage} Jeżeli przełączyłeś aktywną firmę w nagłówku, wróć do rejestru dokumentów
            bieżącego podmiotu.
          </AlertBanner>
          <Link
            href="/app/documents"
            className="inline-flex min-h-9 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-4 py-2 text-xs font-medium text-white"
          >
            Przejdź do listy dokumentów aktywnej firmy
          </Link>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      activeHref="/app/documents"
      pageEyebrow="Dwukolumnowy warsztat weryfikacji (Zasada nr 5)"
      pageTitle={`Weryfikacja dowodu: ${detail.document.documentNumber}`}
      pageSubtitle="Po lewej niezmienny oryginał i skrót integralności SHA-256, po prawej pola wyodrębnione przez AI/FA(3) z kontrolą człowieka i podstawą prawną."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <DocumentVerificationClient
          company={detail.activeCompany}
          document={detail.document}
          helpMap={{
            nip: mustResolveUiFieldHelp('nip'),
            ksefReference: mustResolveUiFieldHelp('ksef_reference'),
            gtuCode: mustResolveUiFieldHelp('gtu_code'),
            vehicle75Kup: mustResolveUiFieldHelp('vehicle_75_kup'),
            kupDeductibility: mustResolveUiFieldHelp('kup_deductibility'),
            vat50Vehicle: mustResolveUiFieldHelp('vat_50_vehicle'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
