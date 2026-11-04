import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ACADEMY_ALL_LESSONS,
  ACADEMY_DISCLAIMER,
  ACADEMY_FIELD_HELP_ENTRIES,
  ACADEMY_MODULES,
} from '@pap/domain/academy';
import { FieldHelpButton } from '@pap/ui';
import { AcademyScreenshotPreview } from '../components/academy-screenshot-preview.js';
import { SystemStatusDiagnosticSection } from '../components/system-status-section.js';
import { AcademyDisclaimerBanner } from '../components/ui-controls.js';
import { getCanonicalLessonHref, resolveUiFieldHelp } from '../lib/field-help.js';

function routeExistsInWebApp(appRoute: string): boolean {
  const cleanPath = appRoute.split('?')[0]?.split('#')[0] ?? '/';
  const segments = cleanPath.split('/').filter(Boolean);
  const appRoot = resolve(import.meta.dirname, '..', 'app');

  if (segments.length === 0) {
    return existsSync(resolve(appRoot, 'page.tsx'));
  }

  // Dopasowanie dokładnej ścieżki lub segmentu dynamicznego (np. [proposalId], [documentId])
  let currentDir = appRoot;
  for (const segment of segments) {
    const exactCandidate = resolve(currentDir, segment);
    if (existsSync(exactCandidate)) {
      currentDir = exactCandidate;
      continue;
    }

    const dynamicCandidates = ['[documentId]', '[proposalId]', '[moduleSlug]', '[lessonSlug]'];
    const matchedDynamic = dynamicCandidates
      .map((dyn) => resolve(currentDir, dyn))
      .find((candidatePath) => existsSync(candidatePath));

    if (matchedDynamic) {
      currentDir = matchedDynamic;
      continue;
    }

    return false;
  }

  return existsSync(resolve(currentDir, 'page.tsx'));
}

describe('SystemStatusDiagnosticSection E2E & smoke-test contract', () => {
  it('renders exact status labels and section heading with 16px border radius when API is available', () => {
    const html = renderToStaticMarkup(
      <SystemStatusDiagnosticSection
        status={{
          state: 'available',
          status: {
            service: 'Polish Accounting Platform',
            status: 'ok',
            version: '0.1.0',
            modules: {
              accounting: 'not_available',
              tenantAuthorization: 'not_available',
              remoteMcp: 'not_available',
            },
          },
        }}
      />,
    );

    expect(html).toContain('Zakres pierwszego etapu');
    expect(html).toContain('border-radius:16px');
    expect(html.match(/>API odpowiada</g)?.length).toBe(1);
    expect(html).toContain('>Uruchomiony<');
    expect(html).toContain('>Dostępny<');
  });

  it('renders API niedostępne exactly once when API does not respond', () => {
    const html = renderToStaticMarkup(
      <SystemStatusDiagnosticSection status={{ state: 'unavailable' }} />,
    );

    expect(html).toContain('Zakres pierwszego etapu');
    expect(html.match(/>API niedostępne</g)?.length).toBe(1);
    expect(html).toContain('>Uruchomiony<');
    expect(html).toContain('>Niedostępny<');
  });
});

describe('Interactive Polish Accounting Academy & contextual FieldHelpButton', () => {
  it('exposes all 12 Academy modules (37 lessons) and maps every screenshotSlot.appRoute to a real apps/web route', () => {
    expect(ACADEMY_MODULES.length).toBe(12);
    expect(ACADEMY_ALL_LESSONS.length).toBe(37);

    for (const lesson of ACADEMY_ALL_LESSONS) {
      const canonicalHref = getCanonicalLessonHref(lesson.slug);
      expect(canonicalHref).toMatch(/^\/academy\/[^/]+\/[^/]+$/);

      const slot = lesson.screenshotSlot;
      expect(
        routeExistsInWebApp(slot.appRoute),
        `Brak strony w apps/web/app dla screenshotSlot.appRoute="${slot.appRoute}" (lekcja: ${lesson.slug})`,
      ).toBe(true);
    }
  });

  it('resolves contextual FieldHelpInfo with Academy lesson links for critical accounting fields', () => {
    for (const key of [
      'nip',
      'ksef_reference',
      'gtu_code',
      'vehicle_75_kup',
      'kup_deductibility',
      'vat_50_vehicle',
      'mpp_split_payment',
      'whitelist_iban',
    ]) {
      const resolved = resolveUiFieldHelp(key);
      expect(resolved, `Brak wpisu pomocy kontekstowej dla klucza ${key}`).toBeDefined();
      expect(resolved?.lessonHref).toMatch(/^\/academy\//);

      const buttonMarkup = renderToStaticMarkup(<FieldHelpButton help={resolved!} />);
      expect(buttonMarkup).toContain('?');
    }

    // Wszystkie klucze z ACADEMY_FIELD_HELP_ENTRIES muszą być rozwiązywalne
    for (const entry of ACADEMY_FIELD_HELP_ENTRIES) {
      expect(resolveUiFieldHelp(entry.fieldHelpId)).toBeDefined();
    }
  });

  it('renders AcademyDisclaimerBanner and AcademyScreenshotPreview with Polish educational disclaimer', () => {
    const disclaimerHtml = renderToStaticMarkup(<AcademyDisclaimerBanner />);
    expect(disclaimerHtml).toContain(ACADEMY_DISCLAIMER);

    const firstLesson = ACADEMY_ALL_LESSONS[0];
    expect(firstLesson).toBeDefined();
    const firstSlot = firstLesson!.screenshotSlot;
    const previewHtml = renderToStaticMarkup(
      <AcademyScreenshotPreview
        {...firstSlot}
        demoCompanyName={firstLesson!.practicalExercise.demoCompanyName}
      />,
    );
    expect(previewHtml).toContain(firstSlot.appRoute);
    expect(previewHtml).toContain('Otwórz ten ekran w aplikacji');
  });
});
