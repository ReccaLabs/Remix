import { Container, Eyebrow } from '@remix/ui';
import { FileWarning } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Fragment, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

export type LegalPage = 'privacy' | 'terms' | 'dataProtection';

/** A paragraph is a string; a bullet list is an array of strings. */
type LegalSection = { id: string; title: string; content: (string | string[])[] };

/** ISO date of the current drafts — keep in sync with legal.common.lastUpdated. */
const UPDATED_ISO = '2026-09-25';

const PAGES: Record<LegalPage, string> = {
  privacy: ROUTES.privacy,
  terms: ROUTES.terms,
  dataProtection: ROUTES.dataProtection,
};

const EMAIL_RE = /\b([a-z0-9.+-]+@remix\.lk)\b/g;

/** Turns our own @remix.lk addresses into mailto links. Plain text otherwise — no HTML parsing. */
function withEmailLinks(text: string): ReactNode {
  return text.split(EMAIL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={`mailto:${part}`} className="break-all font-medium">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function isSection(value: unknown): value is LegalSection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.title === 'string' && Array.isArray(v.content);
}

/** Shared long-form layout for /privacy, /terms and /data-protection. Content: messages/<locale>/legal.json. */
export async function LegalDocument({ page }: { page: LegalPage }) {
  const t = await getTranslations('legal');
  const raw: unknown = t.raw(`${page}.sections`);
  const sections = Array.isArray(raw) ? raw.filter(isSection) : [];

  return (
    <Container className="py-12 sm:py-16 lg:py-20">
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <header className="flex max-w-[760px] flex-col gap-4 lg:col-start-2">
          <Eyebrow>{t('common.eyebrow')}</Eyebrow>
          <h1 className="font-display m-0 text-balance text-[36px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
            {t(`${page}.title`)}
          </h1>
          <div
            role="note"
            className="border-accent-line bg-accent-tint flex gap-3 rounded-md border px-4 py-3"
          >
            <FileWarning size={20} aria-hidden className="text-accent-ink mt-0.5 flex-none" />
            <div className="flex flex-col gap-0.5 text-[15px] leading-6">
              <p className="text-ink m-0 font-semibold">{t('common.draftTitle')}</p>
              <p className="text-ink-2 m-0">{t('common.draftBody')}</p>
              <p className="text-ink-2 m-0 text-sm">
                {t.rich('common.lastUpdated', {
                  time: (chunks) => <time dateTime={UPDATED_ISO}>{chunks}</time>,
                })}
              </p>
            </div>
          </div>
          <p className="text-ink-2 m-0 text-pretty text-lg leading-7">{t(`${page}.intro`)}</p>
        </header>

        <nav aria-labelledby="legal-toc-title" className="lg:sticky lg:top-24 lg:self-start">
          <h2 id="legal-toc-title" className="text-muted m-0 mb-2 text-sm font-semibold">
            {t('common.onThisPage')}
          </h2>
          <ol className="border-line-warm m-0 flex list-none flex-col border-l p-0 text-[15px]">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-ink-2 hover:text-ink flex min-h-11 items-center py-1.5 pl-4 leading-5 lg:min-h-9"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex min-w-0 max-w-[760px] flex-col gap-10">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="flex scroll-mt-24 flex-col gap-3"
            >
              <h2
                id={`${s.id}-title`}
                className="m-0 text-[22px] font-semibold leading-7 tracking-[-0.01em]"
              >
                {s.title}
              </h2>
              {s.content.map((block, i) =>
                Array.isArray(block) ? (
                  <ul
                    key={i}
                    className="text-ink-2 marker:text-muted m-0 flex list-disc flex-col gap-2 pl-6 leading-7"
                  >
                    {block.map((item, j) => (
                      <li key={j} className="pl-1">
                        {withEmailLinks(item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} className="text-ink-2 m-0 text-pretty leading-7">
                    {withEmailLinks(block)}
                  </p>
                ),
              )}
            </section>
          ))}

          <footer className="border-line-warm flex flex-col gap-6 border-t pt-8">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-lg font-semibold">{t('common.questionsTitle')}</h2>
              <p className="text-ink-2 m-0">{withEmailLinks(t('common.questions'))}</p>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-lg font-semibold">{t('common.relatedTitle')}</h2>
              <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0">
                {(Object.keys(PAGES) as LegalPage[])
                  .filter((p) => p !== page)
                  .map((p) => (
                    <li key={p}>
                      <Link
                        href={PAGES[p]}
                        className="inline-flex min-h-11 items-center font-medium"
                      >
                        {t(`common.related.${p}`)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          </footer>
        </article>
      </div>
    </Container>
  );
}
