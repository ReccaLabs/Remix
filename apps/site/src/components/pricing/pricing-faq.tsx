import { PLANS } from '@remix/types';
import { Container, DisplayHeading } from '@remix/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES, whatsappUrl } from '@/lib/site';

export const PRICING_FAQ = ['trial', 'change', 'students', 'migration'] as const;

/** Values interpolated into FAQ answers (numbers live in @remix/types, not in the copy). */
export const faqValues = { max: new Intl.NumberFormat('en-US').format(PLANS.tutor.maxStudents) };

/** Native <details name> accordion, as on the home page. FAQPage JSON-LD is emitted by the page. */
export async function PricingFaq() {
  const t = await getTranslations('pricing.faq');
  const tc = await getTranslations('common.cta');
  const wa = whatsappUrl(tc('whatsappPrefill'));

  return (
    <section id="faq" aria-labelledby="faq-title" className="border-line-warm border-t">
      <Container className="flex flex-wrap gap-12 py-16 sm:py-24">
        <div className="flex flex-[1_1_320px] flex-col gap-4">
          <DisplayHeading id="faq-title" className="lg:text-[44px]">
            {t('title')}
          </DisplayHeading>
          <p className="text-muted m-0">
            {t.rich('contact', {
              link: (chunks) =>
                wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="font-medium">
                    {chunks}
                  </a>
                ) : (
                  <Link href={ROUTES.demo} className="font-medium">
                    {chunks}
                  </Link>
                ),
            })}
          </p>
        </div>
        <div className="border-line-warm flex min-w-0 flex-[2_1_560px] flex-col border-t">
          {PRICING_FAQ.map((key, i) => (
            <details
              key={key}
              name="pricing-faq"
              open={i === 0}
              className="border-line-warm group border-b"
            >
              <summary className="text-ink flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {t(`items.${key}.q`)}
                <Plus
                  size={20}
                  aria-hidden
                  className="flex-none transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="text-ink-2 m-0 text-pretty pb-5 pr-12">
                {t(`items.${key}.a`, faqValues)}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
