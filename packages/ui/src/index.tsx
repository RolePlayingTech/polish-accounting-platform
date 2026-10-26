import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react';

type CardProps = PropsWithChildren<HTMLAttributes<HTMLElement>> & {
  title?: string;
  eyebrow?: string;
  icon?: ReactNode;
};

export function Card({ children, className = '', eyebrow, icon, title, ...props }: CardProps) {
  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_4px_16px_rgba(28,35,30,0.035)] ${className}`}
      {...props}
    >
      {(title || eyebrow || icon) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-base font-semibold tracking-tight text-stone-950">{title}</h2>
            )}
          </div>
          {icon}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: 'success' | 'neutral' }) {
  const toneClass =
    tone === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600';
  const dotClass = tone === 'success' ? 'bg-emerald-500' : 'bg-stone-400';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${toneClass}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
