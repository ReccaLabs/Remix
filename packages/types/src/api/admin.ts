import { z } from 'zod';
import { timetableSlotSchema } from './classes';
import { brandColorSchema, LOCALES } from './tenant';

/** Admin dashboard skeleton (real counts). Money and attendance tiles arrive in Phases 3/5. */
export const dashboardResponseSchema = z.object({
  counts: z.object({
    activeStudents: z.number().int().nonnegative(),
    invitedStudents: z.number().int().nonnegative(),
    classes: z.number().int().nonnegative(),
    staff: z.number().int().nonnegative(),
    newStudentsThisMonth: z.number().int().nonnegative(),
  }),
  /** CLS-06 — today in Asia/Colombo, ordered by start time. */
  todaysClasses: z.array(timetableSlotSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

/**
 * TEN-03 — theme. Images are https URLs until the upload pipeline lands (Phase 4).
 * The brand colour must keep white button text readable (`hasReadableContrast`).
 */
export const themeSchema = z.object({
  brandColor: brandColorSchema.nullable(),
  logoUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
  faviconUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
});
export type Theme = z.infer<typeof themeSchema>;

export const updateThemeSchema = z.strictObject({
  brandColor: brandColorSchema
    .refine((c) => hasReadableContrast(c), 'Pick a darker colour so white text stays readable')
    .nullable()
    .optional(),
  logoUrl: themeSchema.shape.logoUrl.optional(),
  faviconUrl: themeSchema.shape.faviconUrl.optional(),
});
export type UpdateThemeRequest = z.input<typeof updateThemeSchema>;

/** Settings → General. */
export const generalSettingsSchema = z.object({
  name: z.string(),
  defaultLocale: z.enum(LOCALES),
});
export const updateGeneralSettingsSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    defaultLocale: z.enum(LOCALES).optional(),
  })
  .refine((s) => Object.keys(s).length > 0, 'Nothing to update');
export type UpdateGeneralSettingsRequest = z.input<typeof updateGeneralSettingsSchema>;

/** WCAG 2.x relative luminance of `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** White text on the brand colour meets WCAG AA for normal text (≥ 4.5:1). */
export function hasReadableContrast(brandColor: string): boolean {
  return contrastRatio(brandColor, '#ffffff') >= 4.5;
}
