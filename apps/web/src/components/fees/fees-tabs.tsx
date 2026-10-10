export const FEES_TAB_IDS = ['payments', 'invoices', 'slips', 'cash'] as const;
export type FeesTabId = (typeof FEES_TAB_IDS)[number];

export interface FeesTab {
  id: FeesTabId;
  href: string;
  label: string;
  active: boolean;
  /** Waiting items shown as a number beside the label (the Bank slips tab). Hidden at 0. */
  count?: number;
  /** Spoken after the number, e.g. "waiting". */
  countLabel?: string;
}

/**
 * The Fees tab bar (11a-11e): one link per view, the current one marked `aria-current`. Links are
 * plain anchors because each view loads its own data on the server. The bar scrolls sideways on a
 * phone instead of wrapping; every target is at least 44 px high.
 */
export function FeesTabs({ label, tabs }: { label: string; tabs: readonly FeesTab[] }) {
  return (
    <nav aria-label={label} className="border-line flex overflow-x-auto border-b">
      {tabs.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          aria-label={tab.count ? `${tab.label} ${tab.count} ${tab.countLabel ?? ''}`.trim() : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 font-semibold no-underline focus-visible:-outline-offset-2 focus-visible:outline-2 ${tab.active ? 'border-brand text-brand' : 'text-muted hover:text-ink border-transparent'}`}
        >
          {tab.label}
          {tab.count ? (
            <span
              aria-hidden
              className="bg-brand-soft text-brand inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums"
            >
              {tab.count > 99 ? '99+' : tab.count}
            </span>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
