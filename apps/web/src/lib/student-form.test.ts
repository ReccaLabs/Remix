import type { StudentProfile } from '@remix/types/api';
import { describe, expect, it } from 'vitest';
import {
  blankGuardian,
  createPayload,
  emptyValues,
  updatePayload,
  validateStudent,
  valuesFromProfile,
} from './student-form';

const filled = () => ({
  ...emptyValues('2026-10-01'),
  displayName: 'Nimali Perera',
  phone: '077 123 4567',
});

describe('createPayload', () => {
  it('sends only what was filled in', () => {
    const payload = createPayload(filled());
    expect(payload).toMatchObject({
      displayName: 'Nimali Perera',
      under18: false,
      guardians: [],
      classIds: [],
      sendWelcomeSms: true,
    });
    expect(payload).not.toHaveProperty('school');
    expect(payload).not.toHaveProperty('alYear');
    expect(payload).not.toHaveProperty('consent');
  });

  it('converts A/L year, drops blank guardian rows and keeps consent only for minors', () => {
    const base = {
      ...filled(),
      school: ' Mahamaya ',
      alYear: '2027',
      medium: 'sinhala',
      guardians: [blankGuardian(), { ...blankGuardian(), name: 'Mala', phone: '071 000 0000' }],
      consentGivenBy: 'Mala',
    };
    const adult = createPayload(base);
    expect(adult).toMatchObject({ school: 'Mahamaya', alYear: 2027, medium: 'sinhala' });
    expect(adult.guardians).toHaveLength(1);
    expect(adult).not.toHaveProperty('consent');
    expect(createPayload({ ...base, under18: true }).consent).toEqual({
      givenBy: 'Mala',
      method: 'paper_form',
    });
  });

  it('accepts a single checked class (checkbox gives a string) or several', () => {
    expect(createPayload({ ...filled(), classIds: 'c1' as unknown as string[] }).classIds).toEqual([
      'c1',
    ]);
    expect(createPayload({ ...filled(), classIds: ['a', 'b'] }).classIds).toEqual(['a', 'b']);
    expect(createPayload({ ...filled(), classIds: false as unknown as string[] }).classIds).toEqual(
      [],
    );
  });
});

describe('validateStudent', () => {
  it('accepts a minimal valid student', () => {
    expect(validateStudent('create', createPayload(filled()))).toEqual([]);
  });

  it('points at the name, phone, consent and guardian fields', () => {
    const issues = validateStudent(
      'create',
      createPayload({
        ...filled(),
        displayName: ' ',
        phone: '123',
        under18: true,
        guardians: [{ ...blankGuardian(), name: 'X', phone: 'nope' }],
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: 'displayName', message: 'name' },
        { field: 'phone', message: 'phone' },
        { field: 'guardians.0.phone', message: 'guardianPhone' },
      ]),
    );
  });

  it('requires consent for under-18s on create', () => {
    const issues = validateStudent(
      'create',
      createPayload({ ...filled(), under18: true, consentGivenBy: '' }),
    );
    expect(issues.some((i) => i.field === 'consentGivenBy')).toBe(true);
  });
});

const profile: StudentProfile = {
  id: '0193f1c2-7b1d-7c3e-9a4f-000000000001',
  studentNo: 'BR-0001',
  displayName: 'Nimali Perera',
  phone: '+94771234567',
  school: null,
  alYear: 2027,
  status: 'active',
  classNames: [],
  activeDevices: 0,
  joinedAt: '2026-01-01T00:00:00.000Z',
  medium: null,
  under18: true,
  consent: { givenBy: 'Mala', method: 'verbal', recordedAt: '2026-01-01T00:00:00.000Z' },
  guardians: [],
  enrollments: [],
  devices: [],
  overview: {
    owesCents: null,
    paidThisYearCents: null,
    attendancePercent: null,
    lessonsWatched: null,
  },
  archivedAt: null,
};

describe('updatePayload', () => {
  it('round-trips a profile and does not re-record unchanged consent', () => {
    const payload = updatePayload(valuesFromProfile(profile), profile);
    expect(payload).toMatchObject({ school: null, alYear: 2027, medium: null, under18: true });
    expect(payload).not.toHaveProperty('consent');
    expect(validateStudent('edit', payload)).toEqual([]);
  });

  it('records consent again when who gave it changes', () => {
    const values = { ...valuesFromProfile(profile), consentGivenBy: 'Nimal' };
    expect(updatePayload(values, profile).consent).toEqual({ givenBy: 'Nimal', method: 'verbal' });
  });

  it('records consent when a student becomes under 18', () => {
    const adult = { ...profile, under18: false, consent: null };
    const values = { ...valuesFromProfile(adult), under18: true, consentGivenBy: 'Mala' };
    expect(updatePayload(values, adult).consent).toBeDefined();
  });
});
