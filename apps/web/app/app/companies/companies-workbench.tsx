'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
} from '../../../lib/workspace-types';

export interface CompaniesWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  accessibleCompanies: readonly CompanyProfileRecord[];
  grants: readonly CompanyUserGrantRecord[];
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
  grants,
  helpMap,
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
    </div>
  );
}

function grantDisplayNameSafe(name: string): string {
  return name.trim() || 'Współpracownik';
}
