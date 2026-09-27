import { PricingCalculator } from './pricing-calculator';

export function PricingBand() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="bg-brand-soft max-w-marketing rounded-band mx-auto flex flex-wrap items-center gap-12 p-6 sm:p-10 lg:p-14">
        <PricingCalculator />
      </div>
    </section>
  );
}
