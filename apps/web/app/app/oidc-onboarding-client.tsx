'use client';

import { useState } from 'react';
import type { TaxProfileCode } from '@pap/domain';
import { Card, FormField, StatusBadge, formatNip, type FieldHelpInfo } from '@pap/ui';
import { AlertBanner, Button, NipInput, TaxRegimeSelector } from '../../components/ui-controls';
import type { CompanyProfileRecord } from '../../lib/workspace-types';

export interface OidcOnboardingMembershipSummary {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: 'tenant_owner' | 'tenant_admin' | 'tenant_member';
}

export interface OidcOnboardingClientProps {
  readonly mode:
    | 'invitation_only'
    | 'owner_first_company'
    | 'member_no_company_grants'
    | 'inline_invite_banner';
  readonly initialInviteToken?: string | undefined;
  readonly memberships: readonly OidcOnboardingMembershipSummary[];
  readonly accessibleCompanies: readonly CompanyProfileRecord[];
  readonly helpMap: {
    readonly nip: FieldHelpInfo;
    readonly taxRegime: FieldHelpInfo;
  };
}

export function OidcOnboardingClient({
  accessibleCompanies,
  helpMap,
  initialInviteToken = '',
  memberships,
  mode,
}: OidcOnboardingClientProps) {
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [rejectReason, setRejectReason] = useState(
    'Odrzucenie zaproszenia przez użytkownika w aplikacji',
  );
  const [companyName, setCompanyName] = useState('');
  const [nip, setNip] = useState('5261040828');
  const [address, setAddress] = useState('ul. Książęca 4, 00-498 Warszawa');
  const [profileCode, setProfileCode] = useState<TaxProfileCode>('jdg_kpir_skala');
  const [legalForm, setLegalForm] = useState<'jdg' | 'sp_z_o_o'>('jdg');
  const [vatStatus, setVatStatus] = useState<'czynny' | 'zwolniony_art_113'>('czynny');

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    readonly tone: 'success' | 'danger' | 'warning' | 'info';
    readonly title: string;
    readonly detail: string;
  } | null>(null);

  const primaryAdminMembership = memberships.find(
    (m) => m.role === 'tenant_owner' || m.role === 'tenant_admin',
  );

  async function handleSwitchCompany(tenantId: string, legalEntityId: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tenantId, legalEntityId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa przełączenia kontekstu (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Nie udało się ustawić aktywnego podmiotu w sesji.',
        });
        return;
      }
      window.location.assign('/app');
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z serwerem aplikacji',
        detail: 'Nie udało się zapisać wybranego podmiotu w sesji BFF.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptInvitation(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inviteToken.trim();
    if (trimmed.length < 24) {
      setFeedback({
        tone: 'warning',
        title: 'Wprowadź pełny token zaproszenia',
        detail: 'Jednorazowy token zaproszenia musi mieć co najmniej 24 znaki.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/session/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ invitationToken: trimmed }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        invitation?: { tenantName?: string };
      };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa przyjęcia zaproszenia (HTTP ${String(res.status)})`,
          detail:
            data.error ??
            'Zaproszenie wygasło, zostało już wykorzystane lub odwołane przez wystawcę.',
        });
        return;
      }
      setFeedback({
        tone: 'success',
        title: 'Zaproszenie przyjęte',
        detail: `Dołączono do organizacji ${data.invitation?.tenantName ?? ''}. Trwa otwieranie pulpitu...`,
      });
      window.location.assign('/app');
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z usługą zaproszeń',
        detail: 'Nie udało się potwierdzić przyjęcia zaproszenia.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectInvitation() {
    const trimmed = inviteToken.trim();
    if (trimmed.length < 24) {
      setFeedback({
        tone: 'warning',
        title: 'Brak tokena zaproszenia do odrzucenia',
        detail: 'Wklej otrzymany jednorazowy token zaproszenia przed kliknięciem odrzucenia.',
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/session/invitations/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          invitationToken: trimmed,
          reason: rejectReason.trim() || 'Odrzucenie zaproszenia przez użytkownika',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Nie udało się odrzucić zaproszenia (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Token zaproszenia jest nieaktywny lub niepoprawny.',
        });
        return;
      }
      setInviteToken('');
      setFeedback({
        tone: 'info',
        title: 'Zaproszenie zostało odrzucone',
        detail:
          'Jednorazowy token zaproszenia został trwale unieważniony i odnotowany w dzienniku audytu.',
      });
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia',
        detail: 'Nie udało się wysłać odrzucenia zaproszenia.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFirstCompany(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'create_company',
          companyName,
          nip,
          address,
          legalForm,
          profileCode,
          vatStatus,
          switchImmediately: true,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Nie udało się utworzyć podmiotu (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Sprawdź poprawność numeru NIP oraz nazwy firmy.',
        });
        return;
      }
      window.location.assign('/app');
    } catch {
      setFeedback({
        tone: 'danger',
        title: 'Błąd połączenia z BFF',
        detail: 'Nie udało się zarejestrować pierwszego podmiotu prawnego.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'inline_invite_banner') {
    return (
      <Card
        as="section"
        tone="accent"
        eyebrow="Zaproszenie wieloorganizacyjne (1 użytkownik → wiele organizacji)"
        title="Otrzymano jednorazowe zaproszenie do kolejnej organizacji"
      >
        <div className="space-y-4" data-testid="oidc-inline-invitation-card">
          {feedback ? (
            <AlertBanner tone={feedback.tone} title={feedback.title}>
              {feedback.detail}
            </AlertBanner>
          ) : null}
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleAcceptInvitation}>
            <div className="min-w-[260px] flex-1">
              <FormField id="inline-invite-token" label="Jednorazowy token zaproszenia" required>
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    className="w-full rounded-md border border-[#858177] bg-white px-3 py-2 font-mono text-xs text-[#191c1a]"
                  />
                )}
              </FormField>
            </div>
            <Button type="submit" disabled={busy}>
              Przyjmij zaproszenie
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleRejectInvitation()}
            >
              Odrzuć zaproszenie
            </Button>
          </form>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="oidc-onboarding-container">
      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      {accessibleCompanies.length > 0 ? (
        <Card
          as="section"
          eyebrow="Dostępne podmioty prawne"
          title="Wybierz podmiot do pracy w księgach"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {accessibleCompanies.map((comp) => (
              <div
                key={comp.legalEntityId}
                className="flex flex-col justify-between rounded-xl border border-[#e5e2d9] bg-[#faf9f5] p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#191c1a]">{comp.companyName}</p>
                  <p className="font-mono text-xs text-[#464c48]">NIP {formatNip(comp.nip)}</p>
                  <p className="text-xs text-[#636b66]">{comp.profileLabelPl}</p>
                </div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleSwitchCompany(comp.tenantId, comp.legalEntityId)}
                  >
                    Otwórz księgi tego podmiotu
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {mode === 'owner_first_company' && primaryAdminMembership ? (
        <Card
          as="section"
          eyebrow={`Organizacja: ${primaryAdminMembership.tenantName}`}
          title="Utwórz pierwszy podmiot prawny w organizacji"
        >
          <div className="space-y-4" data-testid="owner-first-company-card">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                size="sm"
                tone="accent"
                label={
                  primaryAdminMembership.role === 'tenant_owner'
                    ? 'Właściciel organizacji'
                    : 'Administrator organizacji'
                }
              />
              <span className="text-xs text-[#464c48]">
                Twoja organizacja nie posiada jeszcze skonfigurowanego podmiotu prawnego (JDG lub
                Sp. z o.o.).
              </span>
            </div>

            <form className="space-y-4" onSubmit={handleCreateFirstCompany}>
              <FormField
                id="first-company-name"
                label="Pełna nazwa podmiotu (dane syntetyczne)"
                required
                hint="W środowisku nieprodukcyjnym wprowadzaj wyłącznie dane syntetyczne."
              >
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="np. Kancelaria Rachunkowa Syntetyczna Sp. z o.o."
                  />
                )}
              </FormField>

              <NipInput
                id="first-company-nip"
                value={nip}
                onChange={setNip}
                fieldHelp={helpMap.nip}
              />

              <FormField id="first-company-address" label="Adres siedziby">
                {(ctrl) => (
                  <input
                    {...ctrl}
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                )}
              </FormField>

              <TaxRegimeSelector
                value={profileCode}
                fieldHelp={helpMap.taxRegime}
                onChange={(code, form) => {
                  setProfileCode(code);
                  setLegalForm(form);
                }}
              />

              <label
                htmlFor="first-company-vat-active"
                className="flex items-center gap-2 text-xs font-medium text-[#191c1a]"
              >
                <input
                  id="first-company-vat-active"
                  type="checkbox"
                  checked={vatStatus === 'czynny'}
                  onChange={(e) =>
                    setVatStatus(e.target.checked ? 'czynny' : 'zwolniony_art_113')
                  }
                  className="h-5 w-5 shrink-0 accent-[#1d5c42]"
                />
                <span>Zarejestrowany jako czynny podatnik VAT (VAT-R)</span>
              </label>

              <Button type="submit" disabled={busy}>
                Utwórz pierwszy podmiot i otwórz pulpit
              </Button>
            </form>
          </div>
        </Card>
      ) : null}

      {mode === 'member_no_company_grants' ? (
        <AlertBanner
          tone="warning"
          title="Brak aktywnych uprawnień do podmiotów prawnych w organizacji"
        >
          Twoje członkostwo w organizacji{' '}
          <strong>{memberships.map((m) => m.tenantName).join(', ')}</strong> jest aktywne, lecz
          właściciel nie przypisał jeszcze jawnego grantu odczytu lub zapisu do żadnej firmy (albo
          dotychczasowy dostęp został cofnięty). Skontaktuj się z właścicielem organizacji lub
          przyjmij inne zaproszenie poniżej.
        </AlertBanner>
      ) : null}

      <Card
        as="section"
        eyebrow="Jednorazowe zaproszenie (SHA-256 · single-use)"
        title={
          mode === 'invitation_only'
            ? 'Dołącz do organizacji na podstawie zaproszenia'
            : 'Masz zaproszenie do innej organizacji?'
        }
      >
        <form
          className="space-y-4"
          data-testid="invitation-acceptance-form"
          onSubmit={handleAcceptInvitation}
        >
          <p className="text-sm leading-relaxed text-[#464c48]">
            {mode === 'invitation_only'
              ? 'Twoje konto OIDC zostało uwierzytelnione, lecz nie należy jeszcze do żadnej organizacji. Wklej jednorazowy token zaproszenia otrzymany od właściciela lub administratora organizacji.'
              : 'Jedno konto użytkownika może należeć do wielu niezależnych organizacji (biur rachunkowych i klientów). Wklej token zaproszenia, aby dołączyć do kolejnej organizacji.'}
          </p>

          <FormField
            id="onboarding-invite-token"
            label="Jednorazowy token zaproszenia"
            required
          >
            {(ctrl) => (
              <input
                {...ctrl}
                type="text"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Wklej jednorazowy token zaproszenia..."
                className="w-full rounded-md border border-[#858177] bg-white px-3 py-2 font-mono text-xs text-[#191c1a]"
              />
            )}
          </FormField>

          {inviteToken.trim().length > 0 ? (
            <FormField
              id="onboarding-reject-reason"
              label="Powód ewentualnego odrzucenia zaproszenia (opcjonalnie)"
            >
              {(ctrl) => (
                <input
                  {...ctrl}
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              )}
            </FormField>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              Przyjmij zaproszenie do organizacji
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void handleRejectInvitation()}
            >
              Odrzuć zaproszenie
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
