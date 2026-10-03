'use client';

import { buttonClass } from '@remix/ui';
import { IMPORT_MAX_ROWS } from '@remix/types/api';
import { FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type DragEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { MAX_FILE_BYTES, type FileProblem } from '@/lib/import/read-table';

const MB = MAX_FILE_BYTES / (1024 * 1024);

/**
 * Step 1 of the import wizard (STU-04): pick or drop a CSV / `.xlsx`. The file is read in the
 * browser by the parent; this step only hands over the `File` and shows why one was refused.
 */
export function UploadStep({
  reading,
  problem,
  onFile,
}: {
  reading: boolean;
  problem: FileProblem | null;
  onFile: (file: File) => void;
}) {
  const t = useTranslations('import.upload');
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [over, setOver] = useState(false);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${inputId}-title`} className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted m-0 mt-1 max-w-prose">
          {t('body', { rows: IMPORT_MAX_ROWS, mb: MB })}
        </p>
      </div>

      {problem ? (
        <FormAlert>{t(`errors.${problem}`, { rows: IMPORT_MAX_ROWS, mb: MB })}</FormAlert>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={drop}
        className={`bg-surface flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center ${over ? 'border-brand bg-brand-soft' : 'border-line-strong'}`}
      >
        <span aria-hidden className="text-muted">
          {reading ? (
            <LoaderCircle size={32} className="animate-spin" />
          ) : (
            <FileSpreadsheet size={32} />
          )}
        </span>
        <label
          htmlFor={inputId}
          className={buttonClass({
            variant: 'primary',
            size: 'lg',
            className:
              'has-[:focus-visible]:outline-brand cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
          })}
        >
          <Upload aria-hidden size={18} />
          {t('choose')}
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={reading}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Allow choosing the same file again after fixing it.
              event.currentTarget.value = '';
              if (file) onFile(file);
            }}
          />
        </label>
        <p className="text-muted m-0 text-sm">{t('drop')}</p>
        <p role="status" className="text-ink-2 m-0 min-h-5 text-sm">
          {reading ? t('reading') : null}
        </p>
      </div>

      <div className="bg-surface border-line flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <p className="m-0 font-medium">{t('required')}</p>
        <h3 className="m-0 mt-1 font-semibold">{t('tipsTitle')}</h3>
        <p className="text-muted m-0">{t('tips')}</p>
      </div>
    </section>
  );
}
