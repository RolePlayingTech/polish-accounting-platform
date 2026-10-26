import Link from 'next/link';
import { Card } from '@pap/ui';

export default function SettingsPlaceholderPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-16">
      <Card
        className="w-full p-8 sm:p-10"
        eyebrow="Ustawienia organizacji"
        title="Ten obszar nie jest jeszcze aktywny"
      >
        <p className="max-w-xl text-sm leading-6 text-stone-600">
          Logowanie, członkostwa i zarządzanie firmami nie zostały jeszcze wdrożone. Ten statyczny
          widok nie udostępnia operacji administracyjnych.
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
