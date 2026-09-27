import { cn, Container } from '@remix/ui';
import { ADDON_IDS, ADDONS, formatLKR, VIDEO_ALLOWANCE_GB_PER_STUDENT } from '@remix/types';
import { getTranslations } from 'next-intl/server';

/** Whole rupees where possible ("LKR 5,000"), exact cents otherwise ("LKR 0.95"). */
const price = (cents: number) => formatLKR(cents, { exact: cents % 100 !== 0 });

// Three columns from md up, stacked rows on phones. ARIA table roles keep the table semantics
// while the layout reflows (a native <table> cannot restack like this reliably).
const row =
  'grid gap-1 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)] md:items-baseline md:gap-4 md:py-[18px]';

export async function AddonsTable() {
  const t = await getTranslations('pricing.addons');

  return (
    <section aria-labelledby="addons-title">
      <Container className="flex flex-col gap-6 pb-16 sm:pb-24">
        <h2
          id="addons-title"
          className="font-display m-0 text-[30px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[36px]"
        >
          {t('title')}
        </h2>
        <div
          role="table"
          aria-labelledby="addons-title"
          className="bg-surface border-line-warm rounded-card overflow-hidden border"
        >
          <div role="rowgroup" className="max-md:sr-only">
            <div
              role="row"
              className={cn(
                row,
                'border-line-warm text-muted border-b text-[13px] font-medium md:py-3.5',
              )}
            >
              <span role="columnheader">{t('columns.name')}</span>
              <span role="columnheader">{t('columns.what')}</span>
              <span role="columnheader" className="md:text-right">
                {t('columns.price')}
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {ADDON_IDS.map((id) => {
              const addon = ADDONS[id];
              return (
                <div
                  key={id}
                  role="row"
                  className={cn(row, 'border-line-warm-soft border-b last:border-b-0')}
                >
                  <span role="rowheader" className="font-semibold">
                    {t(`items.${id}.name`)}
                  </span>
                  <span role="cell" className="text-muted">
                    {t(`items.${id}.body`, { gb: VIDEO_ALLOWANCE_GB_PER_STUDENT })}
                  </span>
                  <span role="cell" className="tabular font-medium md:text-right">
                    {t(`units.${addon.unit}`, { price: price(addon.price) })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
