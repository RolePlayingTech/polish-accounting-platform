'use client';

import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@pap/ui';

export interface AcademyScreenshotPreviewProps {
  slotId: string;
  imagePath: string;
  appRoute: string;
  captureSelector: string;
  caption: string;
  demoCompanyName: string;
}

export function AcademyScreenshotPreview({
  appRoute,
  caption,
  captureSelector,
  demoCompanyName,
  imagePath,
  slotId,
}: AcademyScreenshotPreviewProps) {
  const [imageMissing, setImageMissing] = useState(false);

  if (!imageMissing) {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagePath}
          alt={caption}
          onError={() => setImageMissing(true)}
          className="block w-full rounded-lg border border-[#e5e2d9]"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="font-mono text-xs text-[#636b66]">
            Slot: {slotId} · {captureSelector}
          </span>
          <Link
            href={appRoute}
            className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-1 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
          >
            Otwórz ten ekran w aplikacji ({appRoute})
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#e5e2d9] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge
          size="sm"
          tone="accent"
          label={`Interaktywny widok aplikacji · ${demoCompanyName}`}
        />
        <span className="font-mono text-xs text-[#636b66]">{captureSelector}</span>
      </div>
      <p className="text-sm leading-relaxed text-[#191c1a]">{caption}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e5e2d9] bg-[#faf9f5] px-3 py-2 text-xs text-[#464c48]">
        <span>
          Ścieżka docelowa zrzutu Playwright: <code className="font-mono">{imagePath}</code>
        </span>
        <Link
          href={appRoute}
          className="inline-flex min-h-8 items-center rounded-md border border-[#1d5c42] bg-[#1d5c42] px-3 py-1 text-xs font-medium text-white hover:bg-[#164833] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
        >
          Przejdź do widoku na żywo ({appRoute})
        </Link>
      </div>
    </div>
  );
}
