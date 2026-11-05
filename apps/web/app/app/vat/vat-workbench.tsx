'use client';

import type { VatRegisterEntry } from '@pap/domain';
import { LedgerTable, MoneyAmount, StatusBadge, formatNip, type LedgerColumn } from '@pap/ui';

export interface VatDocumentMarkers {
  readonly gtuCodes: readonly string[];
  readonly procedureCodes: readonly string[];
}

export interface VatRegistersWorkbenchProps {
  readonly period: string;
  readonly salesEntries: readonly VatRegisterEntry[];
  readonly purchaseEntries: readonly VatRegisterEntry[];
  readonly salesNetTotalGrosze: number;
  readonly outputVatExactGrosze: number;
  readonly inputVatExactGrosze: number;
  readonly markersByDocNumber: Readonly<Record<string, VatDocumentMarkers>>;
}

export function VatRegistersWorkbench({
  inputVatExactGrosze,
  markersByDocNumber,
  outputVatExactGrosze,
  period,
  purchaseEntries,
  salesEntries,
  salesNetTotalGrosze,
}: VatRegistersWorkbenchProps) {
  const salesColumns: readonly LedgerColumn<VatRegisterEntry>[] = [
    {
      id: 'doc',
      header: 'Dowód i data obowiązku',
      mobileRole: 'title',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-[#191c1a]">{row.documentNumber}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            Obowiązek: {row.taxPointDate} · Wyst.: {row.issueDate}
          </p>
        </div>
      ),
    },
    {
      id: 'cp',
      header: 'Nabywca i NIP',
      mobileRole: 'meta',
      render: (row) => (
        <div>
          <p className="text-xs font-medium text-[#191c1a]">{row.counterpartyName}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            {row.counterpartyNip ? formatNip(row.counterpartyNip) : '—'}
          </p>
        </div>
      ),
    },
    {
      id: 'markers',
      header: 'KSeF / GTU / Procedury',
      mobileRole: 'status',
      render: (row) => {
        const meta = markersByDocNumber[row.documentNumber];
        const gtus = meta?.gtuCodes ?? [];
        const procs = meta?.procedureCodes ?? [];
        return (
          <div className="flex flex-wrap gap-1">
            <StatusBadge
              size="sm"
              tone={row.ksefMarker === 'NrKSeF' ? 'legal' : 'neutral'}
              label={row.ksefMarker}
            />
            {gtus.map((g) => (
              <StatusBadge key={g} size="sm" tone="info" label={g} />
            ))}
            {procs.map((p) => (
              <StatusBadge key={p} size="sm" tone="warning" label={p} />
            ))}
          </div>
        );
      },
    },
    {
      id: 'net',
      header: 'Podstawa netto',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (row) => <MoneyAmount amount={row.netGrosze} inGrosze size="sm" />,
      footer: <MoneyAmount amount={salesNetTotalGrosze} inGrosze size="sm" />,
    },
    {
      id: 'vat',
      header: 'VAT należny',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => (
        <MoneyAmount amount={row.deductibleVatGrosze} inGrosze size="sm" variant="tax" />
      ),
      footer: <MoneyAmount amount={outputVatExactGrosze} inGrosze size="sm" variant="tax" />,
    },
  ];

  const purchaseColumns: readonly LedgerColumn<VatRegisterEntry>[] = [
    {
      id: 'doc',
      header: 'Faktura zakupu i data',
      mobileRole: 'title',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-[#191c1a]">{row.documentNumber}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">{row.issueDate}</p>
        </div>
      ),
    },
    {
      id: 'cp',
      header: 'Dostawca i KSeF',
      mobileRole: 'meta',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-[#191c1a]">{row.counterpartyName}</p>
          <p className="font-mono text-[11px] tabular-nums text-[#636b66]">
            {row.counterpartyNip ? formatNip(row.counterpartyNip) : '—'} · KSeF: {row.ksefMarker}
          </p>
        </div>
      ),
    },
    {
      id: 'mode',
      header: 'Tryb odliczenia',
      mobileRole: 'status',
      render: (row) => (
        <StatusBadge
          size="sm"
          tone={row.deductionMode === 'vehicle_mixed_50' ? 'warning' : 'success'}
          label={
            row.deductionMode === 'vehicle_mixed_50'
              ? 'Pojazd 50% (art. 86a)'
              : row.deductionMode === 'full_100'
                ? 'Odliczenie 100%'
                : 'Brak 0%'
          }
        />
      ),
    },
    {
      id: 'deductible',
      header: 'VAT odliczony (do JPK)',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'primaryAmount',
      render: (row) => (
        <MoneyAmount amount={row.deductibleVatGrosze} inGrosze size="sm" variant="tax" />
      ),
      footer: <MoneyAmount amount={inputVatExactGrosze} inGrosze size="sm" variant="tax" />,
    },
    {
      id: 'non_deductible',
      header: 'VAT nieodliczony (50% / NKUP)',
      unit: 'PLN',
      align: 'right',
      numeric: true,
      mobileRole: 'meta',
      render: (row) => <MoneyAmount amount={row.nonDeductibleVatGrosze} inGrosze size="sm" />,
    },
  ];

  return (
    <div data-testid="vat-registers-summary" className="space-y-6">
      <LedgerTable
        caption={`Rejestr sprzedaży VAT za okres ${period}`}
        title="Ewidencja sprzedaży VAT (podatek należny)"
        subtitle="Obejmuje faktury ustrukturyzowane FA(3) z NrKSeF, kody GTU_01–GTU_13 oraz oznaczenie MPP."
        columns={salesColumns}
        rows={salesEntries}
        getRowKey={(r) => r.id}
      />

      <LedgerTable
        caption={`Rejestr zakupów VAT za okres ${period}`}
        title="Ewidencja zakupów VAT (podatek naliczony i rozbicie 50% / 50%)"
        subtitle="Dla wydatków eksploatacyjnych samochodów mieszanych (art. 86a VAT) 50% VAT trafia do odliczenia w JPK_V7M, a nieodliczone 50% zasila podstawę 75% KUP."
        columns={purchaseColumns}
        rows={purchaseEntries}
        getRowKey={(r) => r.id}
      />
    </div>
  );
}
