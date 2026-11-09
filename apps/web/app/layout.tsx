import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RuntimeModeProvider } from '../components/runtime-mode-provider';
import { isSyntheticPersonaLoginAllowed } from '../lib/runtime-mode';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Polish Accounting Platform — Księga Współczesna',
    template: '%s · Polish Accounting Platform',
  },
  description:
    'Polska platforma księgowa i edukacyjna (KPiR, Ryczałt, Pełne księgi UoR, VAT, KSeF FA(3), ZUS, Kalendarz podatkowy, MCP oraz Akademia Polskiej Księgowości). Dane syntetyczne.',
  referrer: 'same-origin',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const allowSyntheticLogin = isSyntheticPersonaLoginAllowed();

  return (
    <html lang="pl">
      <body className="min-h-screen bg-[#faf9f5] text-[#191c1a] antialiased">
        <RuntimeModeProvider allowSyntheticLogin={allowSyntheticLogin}>
          {children}
        </RuntimeModeProvider>
      </body>
    </html>
  );
}
