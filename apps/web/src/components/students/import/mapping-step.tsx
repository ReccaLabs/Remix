'use client';

import { Button, Field } from '@remix/ui';
import { IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS, type ImportField } from '@remix/types/api';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { duplicateColumns, missingRequired, type Mapping } from '@/lib/import/mapping';
import type { Table } from '@/lib/import/read-table';

const SAMPLE_ROWS = 3;

const isRequired = (field: ImportField): boolean =>
  (REQUIRED_IMPORT_FIELDS as readonly ImportField[]).includes(field);

/**
 * Step 2 (STU-04): which column of the file is which student detail. Name and phone must be
 * matched; the guess from the headings is only a starting point.
 */
export function MappingStep({
  table,
  mapping,
  onChange,
  onBack,
  onNext,
}: {
  table: Table;
  mapping: Mapping;
  onChange: (mapping: Mapping) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations('import.map');
  const [tried, setTried] = useState(false);
  const heading = (index: number) => table.headers[index] || t('columnFallback', { n: index + 1 });

  const missing = missingRequired(mapping);
  const shared = duplicateColumns(mapping);
  const names = (fields: readonly ImportField[]) => fields.map((f) => t(`fields.${f}`)).join(', ');

  function next() {
    setTried(true);
    if (missing.length === 0 && shared.length === 0) onNext();
  }

  return (
    <section aria-labelledby="map-title" className="flex flex-col gap-5">
      <div>
        <h2 id="map-title" className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted m-0 mt-1 max-w-prose">{t('body')}</p>
      </div>

      {tried && missing.length > 0 ? (
        <FormAlert>{t('missing', { fields: names(missing) })}</FormAlert>
      ) : null}
      {tried && shared.length > 0 ? (
        <FormAlert>{t('shared', { fields: names(shared) })}</FormAlert>
      ) : null}

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_FIELDS.map((field) => {
          const required = isRequired(field);
          const bad = tried && (missing.includes(field) || shared.includes(field));
          return (
            <Field
              key={field}
              label={t(`fields.${field}`)}
              optional={required ? undefined : t('optional')}
              hint={t(`hints.${field}`)}
              error={
                bad ? (missing.includes(field) ? t('requiredError') : t('sharedError')) : undefined
              }
            >
              <Select
                value={mapping[field] === null ? '' : String(mapping[field])}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  onChange({ ...mapping, [field]: value === '' ? null : Number(value) });
                }}
              >
                <option value="">{t('notInFile')}</option>
                {table.headers.map((_, index) => (
                  // Columns are positional and may repeat names, so the index is the identity.
                  <option key={index} value={index}>
                    {heading(index)}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">{t('sample')}</h3>
        <div
          className="border-line bg-surface overflow-x-auto rounded-lg border"
          // Scrollable region must be keyboard reachable (axe: scrollable-region-focusable).
          tabIndex={0}
          role="region"
          aria-label={t('sampleCaption')}
        >
          <table className="w-full min-w-max text-left text-sm">
            <caption className="sr-only">{t('sampleCaption')}</caption>
            <thead>
              <tr className="border-line border-b">
                {table.headers.map((_, index) => (
                  <th key={index} scope="col" className="text-muted px-3 py-2 font-medium">
                    {heading(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, SAMPLE_ROWS).map((row, r) => (
                <tr key={r} className="border-line-soft border-b last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={c} className="max-w-56 truncate px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden size={18} />
          {t('back')}
        </Button>
        <Button size="lg" onClick={next}>
          {t('next')}
          <ArrowRight aria-hidden size={18} />
        </Button>
      </div>
    </section>
  );
}
