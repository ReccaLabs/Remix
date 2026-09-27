import { describe, expect, it } from 'vitest';
import { formatLKR, lkr } from './money';
import {
  ADDON_IDS,
  ADDONS,
  averagePerStudent,
  baseForCycle,
  CALCULATOR_RANGE,
  compare,
  formatStorage,
  monthlyPrice,
  perCardPrice,
  PLAN_LIMITS,
  planFor,
  PLANS,
  PUBLIC_PLAN_IDS,
  YEARLY_FREE_MONTHS,
  yearlyBase,
} from './pricing';

describe('planFor', () => {
  it('picks tutor up to 150 students', () => {
    expect(planFor(1).id).toBe('tutor');
    expect(planFor(150).id).toBe('tutor');
  });
  it('picks institute from 151 to 1,500', () => {
    expect(planFor(151).id).toBe('institute');
    expect(planFor(1500).id).toBe('institute');
  });
  it('picks enterprise above 1,500', () => {
    expect(planFor(1501).id).toBe('enterprise');
  });
  it('picks lite only for youtube-only classes up to 100', () => {
    expect(planFor(100, true).id).toBe('lite');
    expect(planFor(101, true).id).toBe('tutor');
  });
});

describe('monthlyPrice', () => {
  it('matches the numbers on the home page design (300 students)', () => {
    const q = monthlyPrice(300);
    expect(q.plan.id).toBe('institute');
    expect(q.total).toBe(lkr(23_400));
  });
  it('is base + perStudent × students', () => {
    expect(monthlyPrice(100).total).toBe(PLANS.tutor.base + PLANS.tutor.perStudent * 100);
  });
  it('treats bad input as zero students', () => {
    expect(monthlyPrice(-5).students).toBe(0);
    expect(monthlyPrice(Number.NaN).students).toBe(0);
    expect(monthlyPrice(10.9).students).toBe(10);
  });
});

describe('perCardPrice', () => {
  it('uses 1.5 classes × LKR 150 by default', () => {
    expect(perCardPrice(300)).toBe(lkr(67_500));
  });
  it('never goes below the minimum', () => {
    expect(perCardPrice(1)).toBe(lkr(10_000));
  });
});

describe('compare', () => {
  it('shows LKR 44,100 savings for 300 students', () => {
    expect(compare(300).savings).toBe(lkr(44_100));
  });
});

describe('formatLKR', () => {
  it('formats whole rupees for marketing', () => {
    expect(formatLKR(lkr(23_400))).toBe('LKR 23,400');
  });
  it('formats exact amounts for the app', () => {
    expect(formatLKR(lkr(2_500), { exact: true })).toBe('LKR 2,500.00');
  });
});

describe('yearly billing', () => {
  it('gives 2 months free', () => {
    expect(YEARLY_FREE_MONTHS).toBe(2);
  });
  it('charges 10 × the monthly base per year', () => {
    expect(yearlyBase(PLANS.tutor)).toBe(lkr(30_000));
    expect(yearlyBase(PLANS.institute)).toBe(lkr(99_000));
    expect(yearlyBase(PLANS.enterprise)).toBe(lkr(250_000));
  });
  it('shows the monthly equivalent on yearly billing', () => {
    expect(baseForCycle(PLANS.tutor, 'yearly')).toBe(lkr(2_500));
    expect(baseForCycle(PLANS.institute, 'yearly')).toBe(lkr(8_250));
    expect(formatLKR(baseForCycle(PLANS.enterprise, 'yearly'))).toBe('LKR 20,833');
    expect(Number.isInteger(baseForCycle(PLANS.enterprise, 'yearly'))).toBe(true);
  });
  it('leaves monthly billing at the plan base', () => {
    for (const id of PUBLIC_PLAN_IDS)
      expect(baseForCycle(PLANS[id], 'monthly')).toBe(PLANS[id].base);
  });
});

describe('averagePerStudent', () => {
  it('divides the monthly total by students', () => {
    expect(averagePerStudent(monthlyPrice(300))).toBe(lkr(78));
  });
  it('is zero with no students', () => {
    expect(averagePerStudent(monthlyPrice(0))).toBe(0);
  });
});

describe('plan limits', () => {
  it('matches the plan cards', () => {
    expect(PLAN_LIMITS.tutor.teachers).toBe(1);
    expect(PLAN_LIMITS.institute.teachers).toBe(Number.POSITIVE_INFINITY);
    expect(PLAN_LIMITS.institute.cashierLogins).toBe(3);
    expect(PLAN_LIMITS.tutor.storageGB).toBeLessThan(PLAN_LIMITS.institute.storageGB);
    expect(PLAN_LIMITS.institute.storageGB).toBeLessThan(PLAN_LIMITS.enterprise.storageGB);
  });
  it('formats storage in GB or TB', () => {
    expect(formatStorage(PLAN_LIMITS.tutor.storageGB)).toBe('200 GB');
    expect(formatStorage(PLAN_LIMITS.institute.storageGB)).toBe('1 TB');
    expect(formatStorage(PLAN_LIMITS.enterprise.storageGB)).toBe('3 TB');
    expect(formatStorage(1500)).toBe('1500 GB');
  });
});

describe('add-ons', () => {
  it('has an entry for every id, in integer cents', () => {
    for (const id of ADDON_IDS) {
      expect(ADDONS[id].id).toBe(id);
      expect(Number.isInteger(ADDONS[id].price)).toBe(true);
    }
  });
  it('matches the pricing page design', () => {
    expect(ADDONS.gate.price).toBe(lkr(5_000));
    expect(ADDONS.drm.price).toBe(lkr(75));
    expect(ADDONS.sms.price).toBe(95);
    expect(formatLKR(ADDONS.sms.price, { exact: true })).toBe('LKR 0.95');
    expect(ADDONS.whiteLabel.price).toBe(lkr(25_000));
    expect(ADDONS.extraVideo.price).toBe(lkr(3));
  });
});

describe('calculator range', () => {
  it('starts at the home page defaults', () => {
    expect(CALCULATOR_RANGE.students.initial).toBe(300);
    expect(CALCULATOR_RANGE.classesPerStudent.initial).toBe(1.5);
  });
  it('compares with more classes per student', () => {
    const { cardTotal } = compare(300, CALCULATOR_RANGE.classesPerStudent.max);
    expect(cardTotal).toBe(lkr(180_000));
  });
});
