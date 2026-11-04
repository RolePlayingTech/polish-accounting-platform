'use client';

import Link from 'next/link';
import { Card, StatusBadge } from '@pap/ui';
import { Button } from '../components/ui-controls';

export default function GlobalAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Card
        as="section"
        tone="subtle"
        eyebrow="Polish Accounting Platform · „Księga Współczesna”"
        title="Nie udało się wyświetlić wybranego widoku"
        actions={<StatusBadge size="sm" tone="danger" label="Błąd operacji widoku" />}
      >
        <div role="alert" className="space-y-4">
          <p className="text-sm leading-relaxed text-[#464c48]">
            {error.message ||
              'Wystąpił błąd podczas pobierania danych lub weryfikacji dostępu do podmiotu.'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => reset()}>Spróbuj ponownie</Button>
            <Link
              href="/app/companies"
              className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Wybierz podmiot (/app/companies)
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-9 items-center rounded-md border border-[#858177] bg-white px-3.5 py-1.5 text-xs font-medium text-[#191c1a] hover:bg-[#f4f2ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
            >
              Przejdź do logowania (/login)
            </Link>
          </div>
        </div>
      </Card>
    </main>
  );
}
