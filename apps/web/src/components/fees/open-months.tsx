import { Checkbox, StatusBadge } from '@remix/ui';
import type { InvoiceLine } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { useFormatter, useTranslations } from 'next-intl';

export function OpenMonths({ lines, selected, onSelect, disabled = false, title }: { lines: InvoiceLine[]; selected?: string[]; onSelect?: (ids: string[]) => void; disabled?: boolean; title?: string }) {
  const t = useTranslations('fees'); const format = useFormatter(); const heading = title ?? t('openMonths');
  return <section aria-label={heading} className="overflow-hidden rounded-lg border border-line bg-surface">
    <h2 className="m-0 border-b border-line px-4 py-3 text-base font-semibold">{heading}</h2>
    {lines.length === 0 ? <p className="m-0 px-4 py-6 text-muted">{t('noOpen')}</p> : <ul className="m-0 list-none divide-y divide-line p-0">{lines.map(l => {
      const title = <span className="font-medium">{l.className}<span className="block text-sm font-normal text-muted">{format.dateTime(new Date(l.month), { month: 'long', year: 'numeric' })}</span></span>;
      return <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {onSelect ? <Checkbox value={l.id} disabled={disabled} checked={selected?.includes(l.id) ?? false} label={title} onChange={e => onSelect(e.target.checked ? [...(selected ?? []), l.id] : (selected ?? []).filter(id => id !== l.id))} /> : title}
        <div className="flex items-center gap-3"><StatusBadge tone={l.overdue ? 'danger' : 'neutral'}>{t(l.overdue ? 'overdue' : 'unpaid')}</StatusBadge><span className="font-semibold tabular-nums">{formatLKR(l.openCents, { exact: true })}</span></div>
      </li>;
    })}</ul>}
  </section>;
}
