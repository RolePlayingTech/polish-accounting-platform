'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TenantInvitationItemContract } from '@pap/contracts';
import type { TaxProfileCode } from '@pap/domain';
import {
  Card,
  CriticalConfirmDialog,
  FieldHelpButton,
  FormField,
  LedgerTable,
  MoneyAmount,
  StatusBadge,
  WhyTrigger,
  formatNip,
  type FieldHelpInfo,
  type LedgerColumn,
  type LegalBasisInfo,
} from '@pap/ui';
import { AlertBanner, Button, NipInput, TaxRegimeSelector } from '../../../components/ui-controls';
import {
  COMPANY_JDG_KPIR_ID,
  TENANT_1_ID,
  type AuditLogEntryRecord,
  type CompanyProfileRecord,
  type CompanyUserGrantRecord,
  type TenantDirectoryMemberSummary,
} from '../../../lib/workspace-types';

export interface CompaniesWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  accessibleCompanies: readonly CompanyProfileRecord[];
  grants: readonly CompanyUserGrantRecord[];
  members?: readonly TenantDirectoryMemberSummary[];
  invitations?: readonly TenantInvitationItemContract[];
  isOidcSession?: boolean;
  currentUserId?: string;
  auditLog: readonly AuditLogEntryRecord[];
  period: string;
  zusTotalGrosze: number | null;
  zusBasis: LegalBasisInfo | null;
  helpMap: {
    readonly nip: FieldHelpInfo;
    readonly taxRegime: FieldHelpInfo;
    readonly vatLimit: FieldHelpInfo;
    readonly zusScheme: FieldHelpInfo;
  };
}

export function CompaniesWorkbench({
  accessibleCompanies,
  activeCompany,
  auditLog,
  currentUserId,
  grants,
  helpMap,
  invitations = [],
  isOidcSession = false,
  members = [],
  period,
  zusBasis,
  zusTotalGrosze,
}: CompaniesWorkbenchProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger' | 'warning';
    title: string;
    detail: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Formularz nowej firmy
  const [newName, setNewName] = useState('');
  const [newNip, setNewNip] = useState('5213004125');
  const [newAddress, setNewAddress] = useState('ul. Nowogrodzka 15/3, 00-511 Warszawa');
  const [newProfile, setNewProfile] = useState<TaxProfileCode>('jdg_kpir_skala');
  const [newLegalForm, setNewLegalForm] = useState<'jdg' | 'sp_z_o_o'>('jdg');
  const [newVatStatus, setNewVatStatus] = useState<'czynny' | 'zwolniony_art_113'>('czynny');

  // Edycja ustawień podatkowych aktywnej firmy
  const [editProfile, setEditProfile] = useState<TaxProfileCode>(activeCompany.profileCode);
  const [editVatStatus, setEditVatStatus] = useState<'czynny' | 'zwolniony_art_113'>(
    activeCompany.vatStatus === 'zwolniony_art_113' ? 'zwolniony_art_113' : 'czynny',
  );
  const [editZusScheme, setEditZusScheme] = useState(activeCompany.zusScheme);
  const [editSmallTaxpayer, setEditSmallTaxpayer] = useState(activeCompany.smallTaxpayer);

  // Grant użytkownika
  const [grantEmail, setGrantEmail] = useState('audytor.zewnetrzny@syntetyczny.example');
  const [grantName, setGrantName] = useState('Tomasz Audytor');
  const [grantWrite, setGrantWrite] = useState(false);
  const [grantToRevoke, setGrantToRevoke] = useState<CompanyUserGrantRecord | null>(null);

  // Zaproszenia OIDC do organizacji
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<'tenant_member' | 'tenant_admin'>('tenant_member');
  const [inviteIncludeActiveCompany, setInviteIncludeActiveCompany] = useState(true);
  const [inviteAllowWrite, setInviteAllowWrite] = useState(false);
  const [inviteReason, setInviteReason] = useState(
    'Zaproszenie współpracownika księgowego do organizacji',
  );
  const [issuedSecret, setIssuedSecret] = useState<{
    readonly invitationToken: string;
    readonly acceptPath: string;
    readonly inviteeMaskedEmail: string;
  } | null>(null);
  const [memberToRevoke, setMemberToRevoke] = useState<TenantDirectoryMemberSummary | null>(null);

  async function postAction(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        legalEntityId?: string;
        company?: CompanyProfileRecord;
        invitationToken?: string;
        acceptPath?: string;
        invitation?: { inviteeMaskedEmail?: string };
      };
      if (!response.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa lub błąd walidacji (HTTP ${String(response.status)})`,
          detail: data.error ?? 'Operacja nie powiodła się.',
        });
      } else {
        if (
          body['action'] === 'create_company' &&
          body['switchImmediately'] !== false &&
          data.company
        ) {
          window.dispatchEvent(
            new CustomEvent('pap:company-switched', {
              detail: {
                company: data.company,
                legalEntityId: data.company.legalEntityId,
              },
            }),
          );
        }
        if (
          body['action'] === 'create_invitation' &&
          typeof data.invitationToken === 'string' &&
          typeof data.acceptPath === 'string'
        ) {
          setIssuedSecret({
            invitationToken: data.invitationToken,
            acceptPath: data.acceptPath,
            inviteeMaskedEmail: data.invitation?.inviteeMaskedEmail ?? inviteEmail,
          });
          setInviteEmail('');
          setInviteDisplayName('');
        }
        setFeedback({
          tone: 'success',
          title: 'Zapisano zmianę i zarejestrowano ślad audytowy',
          detail: successMsg,
        });
        router.refresh();
      }
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z BFF',
        detail: 'Nie udało się wysłać żądania.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function switchCompany(tenantId: string, legalEntityId: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, legalEntityId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; companyName?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Zablokowano dostęp międzyorganizacyjny (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Brak uprawnień do wskazanego podmiotu.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: 'Przełączono aktywny podmiot',
          detail: `Aktywna firma: ${data.companyName ?? ''}`,
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const auditColumns: readonly LedgerColumn<AuditLogEntryRecord>[] = [
    {
      id: 'timestamp',
      header: 'Znacznik czasu',
      mobileRole: 'meta',
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[#464c48]">
          {row.timestamp.slice(0, 19).replace('T', ' ')}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Aktor i kanał',
      mobileRole: 'meta',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-[#191c1a]">{row.actorName}</p>
          <span className="font-mono text-[11px] text-[#636b66]">
            Kanał: {row.channel} · {row.correlationId}
          </span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Kod zdarzenia',
      mobileRole: 'status',
      render: (row) => (
        <StatusBadge
          size="sm"
          tone={row.actionCode.includes('DENIED') ? 'danger' : 'legal'}
          label={row.actionCode}
        />
      ),
    },
    {
      id: 'summary',
      header: 'Opis operacji w dzienniku audytu',
      mobileRole: 'title',
      render: (row) => <span className="text-xs text-[#191c1a]">{row.summaryPl}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <Card
        as="div"
        eyebrow="Dostępne podmioty prawne (GET /api/v1/me/companies)"
        title="Firmy w Twoim zakresie autoryzacji"
        actions={
          !isOidcSession ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void switchCompany(TENANT_1_ID, COMPANY_JDG_KPIR_ID);
              }}
            >
              Test izolacji: spróbuj odczytać Tenant 1
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          {accessibleCompanies.map((comp) => {
            const isActive = comp.legalEntityId === activeCompany.legalEntityId;
            return (
              <div
                key={comp.legalEntityId}
                className={`flex flex-col justify-between rounded-xl border p-4 ${
                  isActive ? 'border-[#1d5c42] bg-[#e7f1ec]/60' : 'border-[#e5e2d9] bg-[#faf9f5]'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge
                      size="sm"
                      tone={isActive ? 'success' : 'neutral'}
                      label={isActive ? 'Aktywna firma' : 'Dostępna'}
                    />
                    <span className="font-mono text-xs tabular-nums text-[#464c48]">
                      NIP {formatNip(comp.nip)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[#191c1a]">{comp.companyName}</p>
                  <p className="text-xs text-[#464c48]">{comp.profileLabelPl}</p>
                  <p className="text-xs text-[#636b66]">{comp.address}</p>
                  <p className="font-mono text-[11px] text-[#636b66]">
                    Uprawnienia: {comp.grantedActions.join(' + ')}
                  </p>
                </div>

                {!isActive ? (
                  <div className="mt-3 pt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        void switchCompany(comp.tenantId, comp.legalEntityId);
                      }}
                    >
                      Przełącz na ten podmiot
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div data-testid="tax-regime-comparison-card">
          <Card
            as="div"
            eyebrow={`Ustawienia podatkowe · ${activeCompany.shortName}`}
            title="Profil podatkowy, status VAT i ZUS"
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void postAction(
                  {
                    action: 'update_tax_settings',
                    profileCode: editProfile,
                    vatStatus: editVatStatus,
                    zusScheme: editZusScheme,
                    smallTaxpayer: editSmallTaxpayer,
                  },
                  `Zaktualizowano profil podatkowy dla ${activeCompany.companyName}.`,
                );
              }}
            >
              <FormField
                id="edit-tax-profile"
                label="Forma opodatkowania dochodu / przychodu"
                fieldHelp={helpMap.taxRegime}
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={editProfile}
                    onChange={(e) => setEditProfile(e.target.value as TaxProfileCode)}
                  >
                    <option value="jdg_kpir_skala">JDG — KPiR (skala 12% / 32%)</option>
                    <option value="jdg_kpir_liniowy">JDG — KPiR (liniowy 19%)</option>
                    <option value="jdg_ryczalt">JDG — Ryczałt ewidencjonowany</option>
                    <option value="spzoo_pelne_ksiegi">Sp. z o.o. — Pełne księgi UoR + CIT</option>
                  </select>
                )}
              </FormField>

              <FormField
                id="edit-vat-status"
                label="Status podatnika VAT"
                fieldHelp={helpMap.vatLimit}
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={editVatStatus}
                    onChange={(e) =>
                      setEditVatStatus(e.target.value as 'czynny' | 'zwolniony_art_113')
                    }
                  >
                    <option value="czynny">Czynny podatnik VAT (JPK_V7M)</option>
                    <option value="zwolniony_art_113">
                      Zwolniony podmiotowo wg art. 113 ust. 1 i 9 (limit 240 000 PLN w 2026 r.)
                    </option>
                  </select>
                )}
              </FormField>

              <FormField
                id="edit-zus-scheme"
                label="Schemat składek ZUS przedsiębiorcy"
                fieldHelp={helpMap.zusScheme}
              >
                {(ctrl) => (
                  <select
                    {...ctrl}
                    value={editZusScheme}
                    onChange={(e) =>
                      setEditZusScheme(
                        e.target.value as
                          'ulga_na_start' | 'preferencyjny_zus' | 'duzy_zus' | 'not_applicable',
                      )
                    }
                  >
                    <option value="ulga_na_start">
                      Ulga na start (6 pełnych miesięcy — tylko zdrowotna)
                    </option>
                    <option value="preferencyjny_zus">
                      Preferencyjny ZUS (24 miesiące — 30% płacy min.)
                    </option>
                    <option value="duzy_zus">
                      Pełny ZUS (60% prognozowanego przeciętnego wynagrodzenia)
                    </option>
                    <option value="not_applicable">Nie dotyczy (Sp. z o.o. wieloosobowa)</option>
                  </select>
                )}
              </FormField>

              <label
                htmlFor="edit-company-small-taxpayer"
                className="flex items-center gap-2.5 text-sm text-[#191c1a]"
              >
                <input
                  id="edit-company-small-taxpayer"
                  type="checkbox"
                  checked={editSmallTaxpayer}
                  onChange={(e) => setEditSmallTaxpayer(e.target.checked)}
                  className="h-6 w-6 shrink-0 accent-[#1d5c42]"
                />
                <span>
                  Status małego podatnika (limit 2 000 000 EUR brutto — m.in. CIT 9% / metoda
                  kasowa)
                </span>
              </label>

              {zusTotalGrosze !== null && zusBasis ? (
                <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#464c48]">
                      Szacunkowa składka ZUS za {period}:
                    </span>
                    <MoneyAmount amount={zusTotalGrosze} inGrosze size="sm" variant="tax" />
                  </div>
                  <div className="mt-2">
                    <WhyTrigger basis={zusBasis} />
                  </div>
                </div>
              ) : null}

              <Button type="submit" disabled={busy}>
                Zapisz ustawienia podatkowe firmy
              </Button>
            </form>
          </Card>
        </div>

        <div data-testid="demo-company-tax-profile-wizard">
          <Card
            as="div"
            eyebrow="Rejestracja podmiotu w organizacji (POST .../companies)"
            title="Dodaj nową firmę syntetyczną"
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void postAction(
                  {
                    action: 'create_company',
                    companyName: newName,
                    nip: newNip,
                    address: newAddress,
                    legalForm: newLegalForm,
                    profileCode: newProfile,
                    vatStatus: newVatStatus,
                    switchImmediately: true,
                  },
                  `Utworzono podmiot "${newName}" i przełączono na niego aktywny kontekst.`,
                );
              }}
            >
              <FormField
                id="new-company-name"
                label="Pełna nazwa firmy (syntetyczna)"
                required
                hint="Nie wprowadzaj danych prawdziwych osób ani rzeczywistych kontrahentów."
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="np. Pracownia Architektury Syntetycznej Test"
                  />
                )}
              </FormField>

              <NipInput
                id="new-company-nip"
                value={newNip}
                onChange={setNewNip}
                fieldHelp={helpMap.nip}
              />

              <FormField id="new-company-address" label="Adres siedziby (syntetyczny)">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                  />
                )}
              </FormField>

              <TaxRegimeSelector
                value={newProfile}
                fieldHelp={helpMap.taxRegime}
                onChange={(code, form) => {
                  setNewProfile(code);
                  setNewLegalForm(form);
                }}
              />

              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="new-company-vat-active"
                  className="flex items-center gap-2 text-xs font-medium text-[#191c1a]"
                >
                  <input
                    id="new-company-vat-active"
                    type="checkbox"
                    checked={newVatStatus === 'czynny'}
                    onChange={(e) =>
                      setNewVatStatus(e.target.checked ? 'czynny' : 'zwolniony_art_113')
                    }
                    className="h-6 w-6 shrink-0 accent-[#1d5c42]"
                  />
                  <span>Zarejestrowany jako czynny podatnik VAT (VAT-R)</span>
                </label>
                <FieldHelpButton help={helpMap.vatLimit} />
              </div>

              <Button type="submit" disabled={busy}>
                Utwórz podmiot i przełącz kontekst
              </Button>
            </form>
          </Card>
        </div>
      </div>

      <div data-testid="mcp-access-and-pending-approvals">
        <Card
          as="div"
          eyebrow="Delegowanie uprawnień księgowych (ADR-003)"
          title={`Granty dostępu do podmiotu: ${activeCompany.companyName}`}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2.5">
              {grants.map((g) => (
                <div
                  key={g.grantId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3.5 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#191c1a]">
                      {g.userDisplayName}{' '}
                      <span className="font-normal text-[#636b66]">({g.roleLabelPl})</span>
                    </p>
                    <p className="font-mono text-xs text-[#464c48]">
                      {g.userEmail} · akcje: {g.actions.join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      size="sm"
                      tone={g.status === 'active' ? 'success' : 'neutral'}
                      label={g.status === 'active' ? 'Aktywny grant' : 'Cofnięty'}
                    />
                    {g.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => setGrantToRevoke(g)}
                      >
                        Cofnij dostęp
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <form
              className="space-y-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void postAction(
                  {
                    action: 'grant_access',
                    userEmail: grantEmail,
                    userDisplayName: grantName,
                    actions: grantWrite ? ['read', 'write'] : ['read'],
                  },
                  `Nadano nowy grant podmiotowy dla ${grantDisplayNameSafe(grantName)}.`,
                );
              }}
            >
              <p className="text-sm font-semibold text-[#191c1a]">
                Nadaj dostęp księgowemu lub audytorowi
              </p>
              <FormField id="grant-user-name" label="Imię i nazwisko (syntetyczne)">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={grantName}
                    onChange={(e) => setGrantName(e.target.value)}
                  />
                )}
              </FormField>
              <FormField id="grant-user-email" label="Adres e-mail konta">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="email"
                    value={grantEmail}
                    onChange={(e) => setGrantEmail(e.target.value)}
                  />
                )}
              </FormField>
              <label
                htmlFor="grant-access-allow-write"
                className="flex items-center gap-2 text-xs text-[#191c1a]"
              >
                <input
                  id="grant-access-allow-write"
                  type="checkbox"
                  checked={grantWrite}
                  onChange={(e) => setGrantWrite(e.target.checked)}
                  className="h-6 w-6 shrink-0 accent-[#1d5c42]"
                />
                <span>Zezwól na zapis i księgowanie dokumentów (read + write)</span>
              </label>
              <Button size="sm" type="submit" disabled={busy}>
                Nadaj grant podmiotowy
              </Button>
            </form>
          </div>
        </Card>
      </div>

      <div data-testid="tenant-invitations-card">
        <Card
          as="div"
          eyebrow="Cykl życia użytkowników i jednorazowe zaproszenia (SHA-256 · ADR-011)"
          title="Zaproszenia do organizacji i członkostwo"
        >
          <div className="space-y-6">
            {issuedSecret ? (
              <AlertBanner
                tone="warning"
                title="Jednorazowy link i token zaproszenia (skopiuj teraz — nie zostanie wyświetlony ponownie)"
              >
                <div className="mt-2 space-y-1.5" data-testid="created-invitation-secret">
                  <p className="text-xs text-[#464c48]">
                    Odbiorca: <strong>{issuedSecret.inviteeMaskedEmail}</strong>. Surowy token nie
                    jest przechowywany w bazie PostgreSQL (wyłącznie skrót SHA-256).
                  </p>
                  <p className="font-mono text-xs break-all text-[#191c1a]">
                    Ścieżka akceptacji:{' '}
                    <code data-testid="created-invitation-accept-path">
                      {issuedSecret.acceptPath}
                    </code>
                  </p>
                  <p className="font-mono text-xs break-all text-[#191c1a]">
                    Token:{' '}
                    <code data-testid="created-invitation-token">
                      {issuedSecret.invitationToken}
                    </code>
                  </p>
                </div>
              </AlertBanner>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <form
                className="space-y-3 rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-4"
                data-testid="create-invitation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const initialCompanyGrants = inviteIncludeActiveCompany
                    ? [
                        {
                          legalEntityId: activeCompany.legalEntityId,
                          actions: inviteAllowWrite ? ['read', 'write'] : ['read'],
                        },
                      ]
                    : [];
                  void postAction(
                    {
                      action: 'create_invitation',
                      inviteeEmail: inviteEmail,
                      inviteeDisplayName: inviteDisplayName,
                      intendedRole: inviteRole,
                      initialCompanyGrants,
                      reason: inviteReason,
                    },
                    `Wystawiono jednorazowe zaproszenie dla ${inviteEmail.trim() || 'współpracownika'}.`,
                  );
                }}
              >
                <p className="text-sm font-semibold text-[#191c1a]">
                  Wystaw jednorazowe zaproszenie do organizacji
                </p>

                <FormField id="invite-email" label="Adres e-mail zapraszanej osoby" required>
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="np. ksiegowa@biuro-syntetyczne.example"
                    />
                  )}
                </FormField>

                <FormField id="invite-display-name" label="Imię i nazwisko (opcjonalnie)">
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="text"
                      value={inviteDisplayName}
                      onChange={(e) => setInviteDisplayName(e.target.value)}
                      placeholder="np. Ewa Księgowa"
                    />
                  )}
                </FormField>

                <FormField id="invite-role" label="Rola docelowa w organizacji">
                  {(ctrl) => (
                    <select
                      {...ctrl}
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(
                          e.target.value === 'tenant_admin' ? 'tenant_admin' : 'tenant_member',
                        )
                      }
                    >
                      <option value="tenant_member">
                        Członek organizacji / Księgowy (tenant_member)
                      </option>
                      <option value="tenant_admin">
                        Administrator organizacji (tenant_admin — bez automatycznego dostępu do
                        ksiąg)
                      </option>
                    </select>
                  )}
                </FormField>

                <label
                  htmlFor="invite-include-active-company"
                  className="flex items-center gap-2 text-xs text-[#191c1a]"
                >
                  <input
                    id="invite-include-active-company"
                    type="checkbox"
                    checked={inviteIncludeActiveCompany}
                    onChange={(e) => setInviteIncludeActiveCompany(e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-[#1d5c42]"
                  />
                  <span>
                    Przypisz od razu dostęp do bieżącego podmiotu ({activeCompany.shortName})
                  </span>
                </label>

                {inviteIncludeActiveCompany ? (
                  <label
                    htmlFor="invite-allow-write"
                    className="flex items-center gap-2 pl-6 text-xs text-[#191c1a]"
                  >
                    <input
                      id="invite-allow-write"
                      type="checkbox"
                      checked={inviteAllowWrite}
                      onChange={(e) => setInviteAllowWrite(e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[#1d5c42]"
                    />
                    <span>Zezwól również na zapis i księgowanie dokumentów (read + write)</span>
                  </label>
                ) : null}

                <FormField id="invite-reason" label="Uzasadnienie w dzienniku audytu" required>
                  {(ctrl) => (
                    <input
                      {...ctrl}
                      type="text"
                      value={inviteReason}
                      onChange={(e) => setInviteReason(e.target.value)}
                    />
                  )}
                </FormField>

                <Button size="sm" type="submit" disabled={busy}>
                  Wygeneruj jednorazowe zaproszenie
                </Button>
              </form>

              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[#191c1a]">
                    Wystawione zaproszenia w organizacji
                  </p>
                  {invitations.length === 0 ? (
                    <p className="text-xs text-[#636b66]">
                      Brak zaproszeń lub konto nie posiada uprawnień administratora organizacji do
                      przeglądu listy zaproszeń.
                    </p>
                  ) : (
                    invitations.map((inv) => (
                      <div
                        key={inv.invitationId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] px-3.5 py-2.5"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[#191c1a]">
                            {inv.inviteeDisplayName ?? inv.inviteeMaskedEmail}{' '}
                            <span className="font-normal text-[#636b66]">
                              ({inv.intendedRole})
                            </span>
                          </p>
                          <p className="font-mono text-[11px] text-[#636b66]">
                            {inv.inviteeMaskedEmail} · ważność do {inv.expiresAt.slice(0, 10)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            size="sm"
                            tone={
                              inv.status === 'accepted'
                                ? 'success'
                                : inv.status === 'pending'
                                  ? 'info'
                                  : 'neutral'
                            }
                            label={invitationStatusLabelPl(inv.status)}
                          />
                          {inv.status === 'pending' ? (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => {
                                void postAction(
                                  {
                                    action: 'revoke_invitation',
                                    invitationId: inv.invitationId,
                                    reason: 'Odwołanie oczekującego zaproszenia w panelu organizacji',
                                  },
                                  `Cofnięto oczekujące zaproszenie (${inv.inviteeMaskedEmail}).`,
                                );
                              }}
                            >
                              Cofnij zaproszenie
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {members.length > 0 ? (
                  <div className="space-y-2 border-t border-[#e5e2d9] pt-3">
                    <p className="text-sm font-semibold text-[#191c1a]">
                      Członkowie organizacji (natychmiastowe cofanie członkostwa i sesji BFF)
                    </p>
                    {members.map((m) => (
                      <div
                        key={m.userId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e5e2d9] bg-white px-3.5 py-2"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[#191c1a]">
                            {m.displayName}{' '}
                            <span className="font-normal text-[#636b66]">({m.tenantRole})</span>
                          </p>
                          <p className="font-mono text-[11px] text-[#636b66]">{m.maskedEmail}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            size="sm"
                            tone={m.status === 'active' ? 'success' : 'neutral'}
                            label={m.status === 'active' ? 'Aktywny członek' : 'Cofnięty'}
                          />
                          {m.status === 'active' &&
                          m.tenantRole !== 'tenant_owner' &&
                          m.userId !== currentUserId ? (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => setMemberToRevoke(m)}
                            >
                              Cofnij członkostwo
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div data-testid="audit-log-viewer">
        <LedgerTable
          caption="Niezmienny dziennik audytu operacji w organizacji (UI, API oraz MCP)"
          title="Dziennik audytu (GET .../audit)"
          subtitle="Każda zmiana ustawień, nadanie/cofnięcie grantu, zaksięgowanie oraz odmowa dostępu 403 są rejestrowane z identyfikatorem korelacji."
          columns={auditColumns}
          rows={auditLog}
          getRowKey={(row) => row.auditId}
        />
      </div>

      <CriticalConfirmDialog
        open={grantToRevoke !== null}
        operationType="period_close"
        tone="danger"
        title="Potwierdź cofnięcie dostępu do ksiąg podmiotu"
        description={`Czy na pewno chcesz natychmiast odebrać uprawnienia użytkownikowi ${grantToRevoke?.userDisplayName ?? ''} (${grantToRevoke?.userEmail ?? ''})?`}
        companyName={activeCompany.companyName}
        nip={activeCompany.nip}
        period={period}
        auditConsequences={[
          'Użytkownik oraz jego sesje MCP natychmiast stracą możliwość odczytu i zapisu w tym podmiocie.',
          'Zdarzenie COMPANY_GRANT_REVOKED zostanie trwale dopisane do dziennika audytu.',
        ]}
        confirmLabel="Tak, cofnij grant dostępu"
        isSubmitting={busy}
        onCancel={() => setGrantToRevoke(null)}
        onConfirm={() => {
          if (!grantToRevoke) return;
          const id = grantToRevoke.grantId;
          setGrantToRevoke(null);
          void postAction(
            { action: 'revoke_access', grantId: id },
            'Cofnięto grant dostępu i zapisano zdarzenie w dzienniku audytu.',
          );
        }}
      />
      <CriticalConfirmDialog
        open={memberToRevoke !== null}
        operationType="period_close"
        tone="danger"
        title="Potwierdź natychmiastowe cofnięcie członkostwa w organizacji"
        description={`Czy na pewno chcesz natychmiast odebrać członkostwo w organizacji użytkownikowi ${memberToRevoke?.displayName ?? ''} (${memberToRevoke?.maskedEmail ?? ''})?`}
        companyName={activeCompany.companyName}
        nip={activeCompany.nip}
        period={period}
        auditConsequences={[
          'Wszystkie aktywne granty podmiotowe oraz sesje BFF tego użytkownika w organizacji zostaną natychmiast unieważnione.',
          'Operacja zostanie trwale zarejestrowana w access_management_event oraz pap_identity_lifecycle_event.',
        ]}
        confirmLabel="Tak, cofnij członkostwo w organizacji"
        isSubmitting={busy}
        onCancel={() => setMemberToRevoke(null)}
        onConfirm={() => {
          if (!memberToRevoke) return;
          const targetId = memberToRevoke.userId;
          setMemberToRevoke(null);
          void postAction(
            {
              action: 'revoke_membership',
              targetUserId: targetId,
              reason: 'Natychmiastowe cofnięcie członkostwa z poziomu panelu organizacji',
            },
            'Cofnięto członkostwo użytkownika w organizacji i unieważniono jego sesje BFF.',
          );
        }}
      />
    </div>
  );
}

function invitationStatusLabelPl(status: TenantInvitationItemContract['status']): string {
  switch (status) {
    case 'pending':
      return 'Oczekujące';
    case 'accepted':
      return 'Przyjęte';
    case 'revoked':
      return 'Cofnięte';
    case 'rejected':
      return 'Odrzucone';
    case 'expired':
      return 'Wygasłe';
  }
}

function grantDisplayNameSafe(name: string): string {
  return name.trim() || 'Współpracownik';
}
