/**
 * ReMix plan pricing — the ONE source of truth.
 * The marketing site (calculator, plan cards) and, later, platform billing import from here.
 * All amounts are integer cents. Never duplicate these numbers anywhere else.
 */
import { lkr, type Cents } from './money';

export const PLAN_IDS = ['lite', 'tutor', 'institute', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  /** Monthly base fee */
  base: Cents;
  /** Per active student per month */
  perStudent: Cents;
  /** Upper bound of active students this plan is sized for */
  maxStudents: number;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  lite: { id: 'lite', base: lkr(1500), perStudent: lkr(30), maxStudents: 100 },
  tutor: { id: 'tutor', base: lkr(3000), perStudent: lkr(50), maxStudents: 150 },
  institute: { id: 'institute', base: lkr(9900), perStudent: lkr(45), maxStudents: 1500 },
  enterprise: {
    id: 'enterprise',
    base: lkr(25000),
    perStudent: lkr(35),
    maxStudents: Number.POSITIVE_INFINITY,
  },
};

/** Assumptions used by the "per-class-card" comparison on the marketing site. */
export const CARD_PRICING_DEFAULTS = {
  classesPerStudent: 1.5,
  perCard: lkr(150),
  minimum: lkr(10000),
} as const;

export function planFor(students: number, youtubeOnly = false): Plan {
  if (youtubeOnly && students <= PLANS.lite.maxStudents) return PLANS.lite;
  if (students <= PLANS.tutor.maxStudents) return PLANS.tutor;
  if (students <= PLANS.institute.maxStudents) return PLANS.institute;
  return PLANS.enterprise;
}

export interface MonthlyQuote {
  plan: Plan;
  students: number;
  total: Cents;
}

export function monthlyPrice(students: number, youtubeOnly = false): MonthlyQuote {
  const n = sanitizeCount(students);
  const plan = planFor(n, youtubeOnly);
  return { plan, students: n, total: plan.base + plan.perStudent * n };
}

/** What the same institute would pay under a typical per-class-card model. */
export function perCardPrice(
  students: number,
  classesPerStudent: number = CARD_PRICING_DEFAULTS.classesPerStudent,
  perCard: Cents = CARD_PRICING_DEFAULTS.perCard,
  minimum: Cents = CARD_PRICING_DEFAULTS.minimum,
): Cents {
  const n = sanitizeCount(students);
  return Math.max(minimum, Math.round(n * classesPerStudent * perCard));
}

export interface Comparison {
  quote: MonthlyQuote;
  cardTotal: Cents;
  /** Positive = ReMix is cheaper. Can be negative for very small classes. */
  savings: Cents;
}

export function compare(students: number, classesPerStudent?: number): Comparison {
  const quote = monthlyPrice(students);
  const cardTotal = perCardPrice(students, classesPerStudent);
  return { quote, cardTotal, savings: cardTotal - quote.total };
}

function sanitizeCount(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/* ------------------------------------------------------------------------------------------
 * Pricing page data (remix.lk/pricing). Plan cards, yearly billing, limits and add-ons.
 * ---------------------------------------------------------------------------------------- */

/** Plans shown as cards on the pricing page, in display order. Lite is not advertised. */
export const PUBLIC_PLAN_IDS = ['tutor', 'institute', 'enterprise'] as const;
export type PublicPlanId = (typeof PUBLIC_PLAN_IDS)[number];

/** Numeric limits that appear in plan feature lists. `Infinity` = unlimited. */
export interface PlanLimits {
  teachers: number;
  cashierLogins: number;
  storageGB: number;
}

export const PLAN_LIMITS: Readonly<Record<PublicPlanId, PlanLimits>> = {
  tutor: { teachers: 1, cashierLogins: 0, storageGB: 200 },
  institute: { teachers: Number.POSITIVE_INFINITY, cashierLogins: 3, storageGB: 1000 },
  enterprise: { teachers: Number.POSITIVE_INFINITY, cashierLogins: 3, storageGB: 3000 },
};

/** "200 GB", "1 TB", "3 TB" (decimal units, as storage is sold). */
export function formatStorage(gb: number): string {
  return gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`;
}

/** Yearly billing: pay for 10 months, get 12 ("2 months free"). Applies to the base fee only. */
export const YEARLY_BILLING = { paidMonths: 10, monthsCovered: 12 } as const;
export const YEARLY_FREE_MONTHS = YEARLY_BILLING.monthsCovered - YEARLY_BILLING.paidMonths;

export type BillingCycle = 'monthly' | 'yearly';

/** Base fee charged once a year on yearly billing (10 × monthly base). */
export function yearlyBase(plan: Plan): Cents {
  return plan.base * YEARLY_BILLING.paidMonths;
}

/** Base fee per month as shown on the plan cards for the chosen billing cycle. */
export function baseForCycle(plan: Plan, cycle: BillingCycle): Cents {
  return cycle === 'yearly'
    ? Math.round(yearlyBase(plan) / YEARLY_BILLING.monthsCovered)
    : plan.base;
}

/** Average ReMix cost per active student per month (0 when there are no students). */
export function averagePerStudent(quote: MonthlyQuote): Cents {
  return quote.students > 0 ? Math.round(quote.total / quote.students) : 0;
}

/** Ranges for the pricing-page calculator sliders. */
export const CALCULATOR_RANGE = {
  students: { min: 10, max: 3000, step: 10, initial: 300 },
  classesPerStudent: {
    min: 1,
    max: 4,
    step: 0.5,
    initial: CARD_PRICING_DEFAULTS.classesPerStudent,
  },
} as const;

export const ADDON_IDS = ['gate', 'drm', 'sms', 'whiteLabel', 'extraVideo'] as const;
export type AddonId = (typeof ADDON_IDS)[number];

/** How an add-on price is charged. The site turns this into words ("per branch / month"). */
export type AddonUnit = 'branchMonth' | 'premiumStudent' | 'message' | 'oneTime' | 'gb';

export interface Addon {
  id: AddonId;
  price: Cents;
  unit: AddonUnit;
}

export const ADDONS: Readonly<Record<AddonId, Addon>> = {
  gate: { id: 'gate', price: lkr(5000), unit: 'branchMonth' },
  drm: { id: 'drm', price: lkr(75), unit: 'premiumStudent' },
  sms: { id: 'sms', price: lkr(0.95), unit: 'message' },
  whiteLabel: { id: 'whiteLabel', price: lkr(25000), unit: 'oneTime' },
  extraVideo: { id: 'extraVideo', price: lkr(3), unit: 'gb' },
};

/** Video streaming included per active student per month before `ADDONS.extraVideo` applies. */
export const VIDEO_ALLOWANCE_GB_PER_STUDENT = 20;
