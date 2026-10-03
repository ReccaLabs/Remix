'use client';

import { cn } from '@remix/ui';
import {
  IMPORT_FIELDS,
  type ImportJob,
  type ImportPreviewResponse,
  type ImportRow,
  type StudentImportRequest,
} from '@remix/types/api';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { downloadTextFile } from '@/lib/import/download';
import { buildErrorCsv, type ErrorFileLabels } from '@/lib/import/error-file';
import { applyMapping, guessMapping, type Mapping } from '@/lib/import/mapping';
import { FileReadError, readTable, type FileProblem, type Table } from '@/lib/import/read-table';
import { actionError, currentMonth, type ActionError } from '@/lib/people';
import { DoneStep, RunningStep } from './finish-steps';
import { MappingStep } from './mapping-step';
import { ReviewStep, type ImportOptions } from './review-step';
import { UploadStep } from './upload-step';
import { useResultText } from './use-result-text';

type Stage = 'upload' | 'map' | 'review' | 'running' | 'done';

/** The job is polled this often; after {@link SLOW_AFTER} polls the page says it is slow. */
export const POLL_MS = 1000;
const SLOW_AFTER = 60;
const MAX_POLL_FAILURES = 3;

const STEPS = ['upload', 'map', 'review', 'done'] as const;
const stepOf = (stage: Stage): (typeof STEPS)[number] => (stage === 'running' ? 'review' : stage);

/**
 * Admin → Students → Import (STU-04, DAT-01): upload → match columns → check (dry run) → import
 * (queued job, polled) → result with a downloadable file of the rows that were left out.
 * The file never leaves the browser: only the mapped rows are sent, and the server validates them
 * again when it commits.
 */
export function ImportWizard() {
  const t = useTranslations('import');
  const tFile = useTranslations('import.errorFile');
  const tStatus = useTranslations('import.review.status');
  const describe = useResultText();

  const [stage, setStage] = useState<Stage>('upload');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [commitFailure, setCommitFailure] = useState<ActionError | null>(null);
  const [options, setOptions] = useState<ImportOptions>(() => ({
    enrolFrom: currentMonth(),
    sendWelcomeSms: false,
  }));
  const [committing, setCommitting] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [polls, setPolls] = useState(0);
  // Bumped to cancel the check/poll of an earlier attempt when the user goes back.
  const attempt = useRef(0);

  const labels: ErrorFileLabels = {
    row: tFile('row'),
    status: tFile('status'),
    problems: tFile('problems'),
    fields: Object.fromEntries(IMPORT_FIELDS.map((f) => [f, tFile(`fields.${f}`)])) as Record<
      (typeof IMPORT_FIELDS)[number],
      string
    >,
    statusWord: (s) => tStatus(s),
    describe,
  };

  function download(results: ImportPreviewResponse['rows']) {
    downloadTextFile(tFile('name'), buildErrorCsv(rows, results, labels));
  }

  async function onFile(file: File) {
    setProblem(null);
    setReading(true);
    try {
      const read = await readTable(file);
      setTable(read);
      setFileName(file.name);
      setMapping(guessMapping(read.headers));
      setStage('map');
    } catch (error) {
      setProblem(error instanceof FileReadError ? error.problem : 'unreadable');
    } finally {
      setReading(false);
    }
  }

  async function check() {
    if (!table || !mapping) return;
    const mapped = applyMapping(table.rows, mapping);
    const mine = ++attempt.current;
    setRows(mapped);
    setPreview(null);
    setFailure(null);
    setStage('review');
    try {
      const { api } = createBrowserApi();
      const result = await api.call('previewStudentImport', { rows: mapped });
      if (attempt.current === mine) setPreview(result);
    } catch (error) {
      if (attempt.current === mine) setFailure(actionError(error));
    }
  }

  async function commit() {
    if (!preview) return;
    const mine = ++attempt.current;
    setCommitting(true);
    setCommitFailure(null);
    const body: StudentImportRequest = {
      rows,
      sendWelcomeSms: options.sendWelcomeSms,
      ...(mapping?.classes === null ? {} : { enrolFrom: options.enrolFrom }),
    };
    try {
      const { api } = createBrowserApi();
      const queued = await api.call('commitStudentImport', body);
      if (attempt.current !== mine) return;
      setJob(queued);
      setPolls(0);
      setStage('running');
    } catch (error) {
      if (attempt.current === mine) setCommitFailure(actionError(error));
    } finally {
      setCommitting(false);
    }
  }

  // Poll the queued job until the worker finishes it.
  const jobId = job?.id;
  const running = stage === 'running';
  useEffect(() => {
    if (!running || !jobId) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { api } = createBrowserApi();
    const tick = async () => {
      try {
        const next = await api.call('getImportJob', { params: { id: jobId } });
        if (cancelled) return;
        failures = 0;
        setJob(next);
        if (next.status === 'done' || next.status === 'failed') {
          setStage('done');
          return;
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setJob((j) => (j ? { ...j, status: 'failed' } : j));
          setStage('done');
          return;
        }
      }
      setPolls((n) => n + 1);
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, jobId]);

  function reset() {
    attempt.current += 1;
    setStage('upload');
    setTable(null);
    setMapping(null);
    setRows([]);
    setPreview(null);
    setFailure(null);
    setCommitFailure(null);
    setJob(null);
    setProblem(null);
    setOptions({ enrolFrom: currentMonth(), sendWelcomeSms: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={stepOf(stage)} />

      {stage === 'upload' ? (
        <UploadStep reading={reading} problem={problem} onFile={onFile} />
      ) : null}

      {stage === 'map' && table && mapping ? (
        <>
          <p className="text-muted m-0 text-sm">
            {t('upload.loaded', {
              name: fileName,
              rows: table.rows.length,
              columns: table.headers.length,
            })}
          </p>
          <MappingStep
            table={table}
            mapping={mapping}
            onChange={setMapping}
            onBack={reset}
            onNext={() => void check()}
          />
        </>
      ) : null}

      {stage === 'review' && mapping ? (
        <ReviewStep
          rows={rows}
          preview={preview}
          failure={failure}
          commitFailure={commitFailure}
          hasClasses={mapping.classes !== null}
          options={options}
          onOptions={setOptions}
          committing={committing}
          onBack={() => {
            attempt.current += 1;
            setPreview(null);
            setFailure(null);
            setStage('map');
          }}
          onDownload={() => {
            if (preview) download(preview.rows);
          }}
          onCommit={() => void commit()}
        />
      ) : null}

      {stage === 'running' && job ? (
        <RunningStep
          count={preview?.summary.ok ?? 0}
          status={job.status}
          slow={polls >= SLOW_AFTER}
        />
      ) : null}

      {stage === 'done' && job ? (
        <DoneStep
          job={job}
          onDownload={() => {
            if (job.rows) download(job.rows);
          }}
          onAnother={reset}
          onRetry={() => {
            setJob(null);
            setStage('review');
          }}
        />
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: (typeof STEPS)[number] }) {
  const t = useTranslations('import.steps');
  const at = STEPS.indexOf(current);
  return (
    <nav aria-label={t('label')}>
      <ol className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {STEPS.map((step, index) => {
          const done = index < at;
          const active = index === at;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm',
                active ? 'text-ink font-semibold' : 'text-muted',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 flex-none items-center justify-center rounded-full border text-xs font-semibold',
                  active && 'border-brand bg-brand text-white',
                  done && 'border-success bg-success-soft text-success-ink',
                  !active && !done && 'border-line-strong',
                )}
              >
                {done ? <Check size={14} /> : index + 1}
              </span>
              {t(step)}
              {active ? <span className="sr-only"> ({t('current')})</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
