import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Polish Accounting Platform — Księga Współczesna',
    template: '%s · Polish Accounting Platform',
  },
  description:
    'Polska platforma księgowa i edukacyjna (KPiR, Ryczałt, Pełne księgi UoR, VAT, KSeF FA(3), ZUS, Kalendarz podatkowy, MCP oraz Akademia Polskiej Księgowości). Dane syntetyczne.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pl">
      <body className="min-h-screen bg-[#faf9f5] text-[#191c1a] antialiased">{children}</body>
    </html>
  );
}
