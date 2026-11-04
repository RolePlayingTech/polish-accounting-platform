import { notFound, redirect } from 'next/navigation';
import { ACADEMY_MODULES, getAcademyLessonBySlug } from '@pap/domain/academy';

export default async function LegacyLessonSlugRedirectPage({
  params,
}: {
  params: Promise<{ lessonSlug: string }>;
}) {
  const { lessonSlug } = await params;
  const lesson = getAcademyLessonBySlug(lessonSlug);
  if (!lesson) {
    notFound();
  }
  const ownerModule = ACADEMY_MODULES.find((m) => m.moduleNumber === lesson.moduleNumber);
  if (!ownerModule) {
    notFound();
  }
  redirect(`/academy/${ownerModule.slug}/${lesson.slug}`);
}
