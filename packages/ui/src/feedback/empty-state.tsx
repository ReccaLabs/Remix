import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  /** Short statement of what is empty ("No classes yet"). */
  title: ReactNode;
  /** One sentence on why / what to do next. */
  description?: ReactNode;
  /** A Lucide icon element (`<BookOpen />`); sized and hidden from screen readers here. */
  icon?: ReactNode;
  /** One action: a <Button> or a link styled with buttonClass(). */
  action?: ReactNode;
  /** Heading level for the title so it fits the page outline. */
  headingLevel?: 2 | 3 | 4;
  /** `compact` for inside tables and cards. */
  size?: 'default' | 'compact';
  className?: string;
}

/** "Nothing here yet" panel: explain + one action (DESIGN.md §5). Server-compatible. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  size = 'default',
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        size === 'default' ? 'gap-3 px-6 py-12' : 'gap-2 px-4 py-8',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="bg-brand-soft text-brand flex size-12 items-center justify-center rounded-xl [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <Heading className="text-ink m-0 text-base font-semibold">{title}</Heading>
        {description ? <p className="text-muted m-0 text-pretty text-sm">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
