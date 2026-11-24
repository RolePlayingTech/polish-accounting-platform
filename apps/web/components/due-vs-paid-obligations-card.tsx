'use client';

import { Card, LedgerTable, MoneyAmount, StatusBadge, type LedgerColumn } from '@pap/ui';
import type {
  DueVsPaidObligationRow,
  TaxObligationsDueVsPaidSnapshot,
} from '../lib/wave2-statutory-and-close';
import { AlertBanner } from './ui-controls';

const LIFECYCLE_BADGE: Record<
  DueVsPaidObligationRow['status'],
  { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  paid: { label: 'Opłacone (potwierdzony przelew)', tone: 'success' },
  partially_paid: { label: 'Częściowo opłacone', tone: 'warning' },
  due_unpaid: { label: 'Wymagalne — nieopłacone!', tone: 'danger' },
  accrued_not_yet_due: { label: 'Naliczone (przed terminem płatności)', tone: 'info' },
  overpaid: { label: 'Nadpłata', tone: 'neutral' },
};

export interface DueVsPaidObligationsCardProps {
  readonly snapshot: TaxObligationsDueVsPaidSnapshot;
}

export function DueVsPaidObligationsCard({ snapshot }: DueVsPaidObligationsCardProps) {
  const columns: readonly LedgerColumn<DueVsPaidObligationRow>[] = [
    {
      id: 'obligation',
      header: 'Zobowiązanie publicznoprawne i podstawa odliczenia',
      mobileRole: 'title',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-[#191c1a]">{row.labelPl}</p>
          <p className="text-[11px] text-[#464c48]">{row.legalNotePl}</p>
        </div>
      ),
    },
    {
      id: 'due_date',
      header: 'Termin ustawowy',
      mobileRole: 'meta',
      render: (row) => (
        <span className="font-mono text-xs tabular-nums text-[#191c1a]">
          {row.statutoryDueDate}
        </span>
      ),
    },
    {
      id: 'accrued',
      header: 'Naliczone (z ksiąg)',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (row) => <MoneyAmount amount={row.accruedDueGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={snapshot.totalAccruedGrosze} inGrosze size="sm" />,
    },
    {
      id: 'paid',
      header: 'Opłacone (przelewy)',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (row) => (
        <MoneyAmount amount={row.confirmedPaidGrosze} inGrosze size="sm" variant="income" />
      ),
      footer: (
        <MoneyAmount
          amount={snapshot.totalConfirmedPaidGrosze}
          inGrosze
          size="sm"
          variant="income"
        />
      ),
    },
    {
      id: 'remaining',
      header: 'Pozostało do zapłaty',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => (
        <MoneyAmount
          amount={row.remainingUnpaidGrosze}
          inGrosze
          size="sm"
          variant={row.remainingUnpaidGrosze > 0 ? 'tax' : 'neutral'}
        />
      ),
      footer: (
        <MoneyAmount
          amount={snapshot.totalRemainingUnpaidGrosze}
          inGrosze
          size="sm"
          variant="tax"
        />
      ),
    },
    {
      id: 'status',
      header: 'Stan rozrachunku US / ZUS',
      mobileRole: 'status',
      render: (row) => {
        const meta = LIFECYCLE_BADGE[row.status] ?? LIFECYCLE_BADGE.accrued_not_yet_due;
        return <StatusBadge size="sm" tone={meta.tone} label={meta.label} />;
      },
    },
  ];

  return (
    <div data-testid="due-vs-paid-obligations-card">
      <Card
        as="section"
        eyebrow={`Rozdział kwot naliczonych od zapłaconych · okres ${snapshot.period}`}
        title="Zobowiązania podatkowe i ZUS: Naliczone vs Faktycznie opłacone"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Razem naliczone za {snapshot.period}:</p>
              <MoneyAmount amount={snapshot.totalAccruedGrosze} inGrosze size="md" variant="tax" />
            </div>
            <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
              <p className="text-xs text-[#636b66]">Potwierdzone wpłaty (wyciągi bankowe):</p>
              <MoneyAmount
                amount={snapshot.totalConfirmedPaidGrosze}
                inGrosze
                size="md"
                variant="income"
              />
            </div>
            <div className="rounded-lg border border-[#1d5c42] bg-[#e7f1ec]/70 p-3">
              <p className="text-xs font-medium text-[#1d5c42]">
                Pozostało do przelewu (US + ZUS):
              </p>
              <MoneyAmount
                amount={snapshot.totalRemainingUnpaidGrosze}
                inGrosze
                size="md"
                variant="tax"
              />
            </div>
          </div>

          {snapshot.warningsPl.length > 0 ? (
            <AlertBanner
              tone="info"
              title="Zasada kasowego odliczania składek ZUS i weryfikacji stawki CIT"
            >
              <ul className="list-disc space-y-1 pl-4">
                {snapshot.warningsPl.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </AlertBanner>
          ) : null}

          <LedgerTable
            caption={`Zestawienie zobowiązań naliczonych i opłaconych za okres ${snapshot.period}`}
            columns={columns}
            rows={snapshot.rows}
            getRowKey={(r) => r.kind}
          />
        </div>
      </Card>
    </div>
  );
}
