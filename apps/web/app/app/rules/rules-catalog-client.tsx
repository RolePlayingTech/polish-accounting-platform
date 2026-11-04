'use client';

import { useMemo, useState } from 'react';
import { Card, LegalBasisPanel, StatusBadge, type LegalBasisInfo } from '@pap/ui';

export interface LegalRuleCardItem {
  readonly id: string;
  readonly ruleCode: string;
  readonly domain: string;
  readonly title: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly basis: LegalBasisInfo;
}

export function RulesCatalogClient({ rules }: { readonly rules: readonly LegalRuleCardItem[] }) {
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');

  const domains = useMemo(() => Array.from(new Set(rules.map((r) => r.domain))).sort(), [rules]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter((r) => {
      if (domainFilter !== 'all' && r.domain !== domainFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        r.title.toLowerCase().includes(q) ||
        r.ruleCode.toLowerCase().includes(q) ||
        r.basis.provision.toLowerCase().includes(q) ||
        r.basis.journalReference.toLowerCase().includes(q) ||
        (r.basis.plainExplanation ?? '').toLowerCase().includes(q)
      );
    });
  }, [domainFilter, query, rules]);

  return (
    <div className="space-y-6">
      <Card
        as="div"
        eyebrow="Wyszukiwarka rejestru prawa 2025/2026"
        title={`Zweryfikowane reguły prawne (${String(filtered.length)} z ${String(rules.length)})`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="rules-search" className="block text-xs font-medium text-[#464c48]">
              Szukaj przepisu, kodu reguły, Dz.U. lub hasła (np. 240 000, KSeF, 75%, Wigilia, CIT
              9%)
            </label>
            <input
              id="rules-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Wpisz frazę lub artykuł ustawy…"
              className="mt-1 min-h-10 w-full rounded-md border border-[#858177] bg-white px-3 py-2 text-sm text-[#191c1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            />
          </div>

          <div>
            <label htmlFor="rules-domain" className="block text-xs font-medium text-[#464c48]">
              Obszar prawa
            </label>
            <select
              id="rules-domain"
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-md border border-[#858177] bg-white px-3 py-2 text-sm text-[#191c1a]"
            >
              <option value="all">Wszystkie obszary ({String(rules.length)})</option>
              {domains.map((dom) => (
                <option key={dom} value={dom}>
                  {dom.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {filtered.map((rule) => (
          <Card
            key={rule.id}
            as="article"
            eyebrow={`${rule.domain.toUpperCase()} · ${rule.ruleCode}`}
            title={rule.title}
            actions={
              <StatusBadge
                size="sm"
                tone="legal"
                label={`Obowiązuje: ${rule.validFrom} → ${rule.validTo ?? 'bezterminowo'}`}
              />
            }
          >
            <LegalBasisPanel basis={rule.basis} />
          </Card>
        ))}
      </div>
    </div>
  );
}
