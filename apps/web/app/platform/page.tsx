import Link from 'next/link';
import { Card } from '@pap/ui';

export default function PlatformPlaceholderPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-16">
      <Card
        className="w-full p-8 sm:p-10"
        eyebrow="Administracja platformy"
        title="Konsola nie jest dostępna"
      >
        <p className="max-w-xl text-sm leading-6 text-stone-600">
          To statyczny placeholder. Nie ma tu endpointów operacyjnych, dostępu do danych klientów
          ani funkcji podszywania się pod użytkownika.
        </p>
        <Link
          className="mt-6 inline-flex text-sm font-semibold text-[#236948] hover:underline"
          href="/app"
        >
          Wróć do przeglądu
        </Link>
      </Card>
    </main>
  );
}
