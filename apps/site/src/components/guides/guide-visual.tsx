import { cn } from '@remix/ui';
import { Compass, Receipt, ScanLine, ShieldCheck, Video, type LucideIcon } from 'lucide-react';
import type { GuideCategory } from '@/content/guides/guides';

export const CATEGORY_ICONS: Record<GuideCategory, LucideIcon> = {
  gettingStarted: Compass,
  onlineClasses: Video,
  fees: Receipt,
  protectingLessons: ShieldCheck,
  attendance: ScanLine,
};

const stripes = {
  paper:
    'bg-[repeating-linear-gradient(135deg,var(--color-paper-2)_0_10px,var(--color-paper-3)_10px_20px)] [--tile-border:var(--color-line-warm)]',
  brand:
    'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-brand-soft),var(--color-brand)_5%)_0_10px,var(--color-brand-soft)_10px_20px)] [--tile-border:var(--color-brand-line)]',
} as const;

/**
 * Decorative cover for a guide card. The design has photo placeholders here; until real photos
 * exist (DESIGN.md §2.5: real Sri Lankan classrooms, no stock) we show the topic icon on the
 * design's striped panel. Swap for a next/image when photography is ready.
 */
export function GuideVisual({
  category,
  tone = 'paper',
  size = 'md',
  className,
}: {
  category: GuideCategory;
  tone?: keyof typeof stripes;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <div aria-hidden className={cn('flex items-end', stripes[tone], className)}>
      <span
        className={cn(
          'bg-surface text-ink-2 border-(--tile-border) flex items-center justify-center rounded-md border',
          size === 'lg' ? 'size-14' : 'size-10',
        )}
      >
        <Icon size={size === 'lg' ? 26 : 20} strokeWidth={1.75} />
      </span>
    </div>
  );
}
