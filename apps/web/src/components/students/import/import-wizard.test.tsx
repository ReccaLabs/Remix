// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob, ImportPreviewResponse } from '@remix/types/api';
import common from '../../../../messages/en/common.json';
import errors from '../../../../messages/en/errors.json';
import importMessages from '../../../../messages/en/import.json';
import { expectNoAxeViolations } from '../../../../test/axe';
import { parseCsv } from '@/lib/import/csv';
import { ImportWizard } from './import-wizard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/students/import',
}));

const JOB_ID = '0193f1c2-7b1d-7c3e-9a4f-0000000000d1';
const PREVIEW = '/api/v1/admin/imports/students/preview';
const COMMIT = '/api/v1/admin/imports/students/commit';

const CSV = [
  'Student Name,Mobile,School,Classes,Notes',
  'Nimali Perera,077 123 4567,Ananda College,Physics Theory,ok',
  '"=HYPERLINK(""http://evil.example"",""x"")",not a phone,,,bad',
  'Kasun Silva,071 111 2222,,,already here',
  'Hiruni Fernando,0773456789,,Chemistry,ok',
].join('\n');

const previewResponse: ImportPreviewResponse = {
  summary: { total: 4, ok: 2, errors: 1, duplicates: 1 },
  rows: [
    { rowNo: 1, status: 'ok', errors: [], duplicateOf: null },
    {
      rowNo: 2,
      status: 'error',
      errors: [{ field: 'phone', message: 'Enter a Sri Lankan mobile number, e.g. 077 123 4567' }],
      duplicateOf: null,
    },
    {
      rowNo: 3,
      status: 'duplicate',
      errors: [],
      duplicateOf: { studentNo: 'BR-0042', rowNo: null },
    },
    { rowNo: 4, status: 'ok', errors: [], duplicateOf: null },
  ],
};

const doneJob: ImportJob = {
  id: JOB_ID,
  status: 'done',
  createdAt: '2026-10-15T04:30:00.000Z',
  finishedAt: '2026-10-15T04:30:02.000Z',
  summary: previewResponse.summary,
  created: 2,
  enrolled: 2,
  rows: previewResponse.rows,
};
const queuedJob: ImportJob = {
  ...doneJob,
  status: 'queued',
  finishedAt: null,
  summary: null,
  created: null,
  enrolled: null,
  rows: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[] = [];
let blobs: Blob[] = [];

/** A fake API: preview, commit (202), then `polls` queued/running answers before done. */
function stubApi(options: { polls?: number; failJob?: boolean; commitStatus?: number } = {}) {
  calls = [];
  let polled = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      if (url.endsWith(PREVIEW)) return json(previewResponse);
      if (url.endsWith(COMMIT)) {
        return options.commitStatus
          ? json(
              {
                type: 'https://remix.lk/problems/rate-limited',
                title: 'Too many requests',
                status: options.commitStatus,
                code: 'RATE_LIMITED',
              },
              options.commitStatus,
            )
          : json(queuedJob, 202);
      }
      if (url.endsWith(`/imports/${JOB_ID}`)) {
        polled += 1;
        if (polled <= (options.polls ?? 1)) return json({ ...queuedJob, status: 'running' });
        return json(
          options.failJob ? { ...doneJob, status: 'failed', rows: null, summary: null } : doneJob,
        );
      }
      return json({}, 404);
    }),
  );
}

beforeEach(() => {
  blobs = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom cannot navigate to a blob: URL; the download link click is a no-op here.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWizard() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Colombo"
      messages={{ common, errors, import: importMessages }}
    >
      <ImportWizard />
    </NextIntlClientProvider>,
  );
}

async function upload(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText(/choose a file/i), file);
}

const csvFile = (text = CSV, name = 'students.csv') => new File([text], name, { type: 'text/csv' });

async function toReview(user: ReturnType<typeof userEvent.setup>) {
  await upload(user, csvFile());
  await screen.findByRole('heading', { name: 'Match your columns' });
  await user.click(screen.getByRole('button', { name: /check my students/i }));
  await screen.findByRole('heading', { name: 'Check before you import' });
  await screen.findByRole('table');
}

/** jsdom's Blob is not Node's: read it the browser way. */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(new Error('read failed'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

describe('import wizard — upload', () => {
  it('shows the first step with no violations', async () => {
    const { container } = renderWizard();
    expect(screen.getByRole('heading', { name: 'Choose your file' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Import steps' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('refuses unsupported files with a reason', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWizard();
    await upload(user, new File(['x'], 'students.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/CSV and Excel/);
  });

  it('refuses an empty file', async () => {
    const user = userEvent.setup();
    renderWizard();
    await upload(user, csvFile('Name,Phone\n'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no students/i);
  });
});

describe('import wizard — column mapping', () => {
  it('guesses the columns from the headings and lets the user change them', async () => {
    const user = userEvent.setup();
    const { container } = renderWizard();
    await upload(user, csvFile());
    await screen.findByRole('heading', { name: 'Match your columns' });
    expect(screen.getByLabelText(/^Name/)).toHaveValue('0');
    expect(screen.getByLabelText(/^Phone/)).toHaveValue('1');
    expect(screen.getByLabelText(/^School/)).toHaveValue('2');
    expect(screen.getByLabelText(/^Classes/)).toHaveValue('3');
    expect(screen.getByLabelText(/^Medium/)).toHaveValue('');
    await expectNoAxeViolations(container);
  });

  it('will not continue without a name and phone column', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWizard();
    await upload(user, csvFile('Foo,Bar\n1,2\n'));
    await screen.findByRole('heading', { name: 'Match your columns' });
    await user.click(screen.getByRole('button', { name: /check my students/i }));
    expect(await screen.findByText(/Match Name, Phone to continue/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    // Matching them lifts the block.
    await user.selectOptions(screen.getByLabelText(/^Name/), '0');
    await user.selectOptions(screen.getByLabelText(/^Phone/), '1');
    await user.click(screen.getByRole('button', { name: /check my students/i }));
    await screen.findByRole('heading', { name: 'Check before you import' });
    expect(calls[0]?.url).toContain(PREVIEW);
  });

  it('refuses one column for two details', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWizard();
    await upload(user, csvFile());
    await screen.findByRole('heading', { name: 'Match your columns' });
    await user.selectOptions(screen.getByLabelText(/^School/), '0');
    await user.click(screen.getByRole('button', { name: /check my students/i }));
    expect(await screen.findByText(/only one detail/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('import wizard — dry run, import and result', () => {
  it('sends only the mapped rows to the dry run and shows each result as words', async () => {
    const user = userEvent.setup();
    stubApi();
    const { container } = renderWizard();
    await toReview(user);

    expect(calls[0]).toMatchObject({ url: expect.stringContaining(PREVIEW), method: 'POST' });
    expect(calls[0]?.body).toMatchObject({
      rows: [
        {
          displayName: 'Nimali Perera',
          phone: '077 123 4567',
          school: 'Ananda College',
          classes: 'Physics Theory',
        },
        { displayName: '=HYPERLINK("http://evil.example","x")', phone: 'not a phone' },
        { displayName: 'Kasun Silva', phone: '071 111 2222' },
        { displayName: 'Hiruni Fernando', phone: '0773456789', classes: 'Chemistry' },
      ],
    });

    expect(screen.getByText('Ready to import').closest('div')).toHaveTextContent('2');
    expect(screen.getByText('Need a fix').closest('div')).toHaveTextContent('1');
    expect(screen.getByText('Already exist').closest('div')).toHaveTextContent('1');

    // Problems first: the two rows that need attention, with words, not just colour.
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 problem rows
    expect(within(rows[1]!).getByText('Needs a fix')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Enter a Sri Lankan mobile number');
    expect(rows[2]).toHaveTextContent('already belongs to BR-0042');
    // The formula-looking name is plain text in the table.
    expect(rows[1]).toHaveTextContent('=HYPERLINK("http://evil.example","x")');

    await user.click(screen.getByRole('checkbox', { name: /only rows that need attention/i }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Import 2 students' })).toBeEnabled();
    await expectNoAxeViolations(container);
  });

  it('downloads the rows that need attention as a formula-safe CSV that can be uploaded again', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWizard();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: /download rows that need attention/i }));

    expect(blobs).toHaveLength(1);
    const buffer = await readBlob(blobs[0]!);
    const text = new TextDecoder().decode(buffer);
    const bytes = new Uint8Array(buffer);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel reads Sinhala/Tamil
    const table = parseCsv(text);
    expect(table[0]?.slice(0, 5)).toEqual(['Row', 'Result', 'What to fix', 'Name', 'Phone']);
    expect(table).toHaveLength(3);
    expect(table[1]?.slice(0, 2)).toEqual(['2', 'Needs a fix']);
    // The attacker-controlled name cannot run in Excel: it starts with an apostrophe.
    expect(table[1]?.[3]).toBe('\'=HYPERLINK("http://evil.example","x")');
    expect(table[2]?.slice(0, 2)).toEqual(['3', 'Already exists']);
    for (const cell of table.slice(1).flat()) expect(/^[=+\-@]/.test(cell)).toBe(false);
  });

  it('commits, polls the job and shows the result with a link to the students', async () => {
    const user = userEvent.setup();
    stubApi({ polls: 1 });
    const { container } = renderWizard();
    await toReview(user);

    await user.click(screen.getByRole('checkbox', { name: /send each new student a text/i }));
    await user.click(screen.getByRole('button', { name: 'Import 2 students' }));
    expect(
      await screen.findByRole('heading', { name: 'Importing your students' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Import in progress' })).toBeInTheDocument();

    const commit = calls.find((c) => c.url.endsWith(COMMIT));
    expect(commit?.body).toMatchObject({ sendWelcomeSms: true });
    expect((commit?.body as { rows: unknown[] }).rows).toHaveLength(4);
    expect((commit?.body as { enrolFrom: string }).enrolFrom).toMatch(/^\d{4}-\d{2}-01$/);

    expect(
      await screen.findByRole('heading', { name: 'Import finished' }, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 students imported.')).toBeInTheDocument();
    expect(screen.getByText('2 class enrolments added.')).toBeInTheDocument();
    expect(screen.getByText(/2 rows were left out/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View students' })).toHaveAttribute(
      'href',
      '/admin/students',
    );
    expect(calls.filter((c) => c.url.endsWith(`/imports/${JOB_ID}`)).length).toBeGreaterThanOrEqual(
      2,
    );
    await expectNoAxeViolations(container);

    // The error file of the finished job is available too.
    await user.click(screen.getByRole('button', { name: /download rows that need attention/i }));
    expect(blobs).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.getByRole('heading', { name: 'Choose your file' })).toBeInTheDocument();
  });

  it('says so when the import fails, without claiming anything was added', async () => {
    const user = userEvent.setup();
    stubApi({ polls: 0, failJob: true });
    renderWizard();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Import 2 students' }));
    expect(
      await screen.findByRole('heading', { name: "The import didn't finish" }, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was added');
  });

  it('shows why the import could not be queued and keeps the review on screen', async () => {
    const user = userEvent.setup();
    stubApi({ commitStatus: 429 });
    renderWizard();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Import 2 students' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Too many imports');
    });
    expect(screen.getByRole('button', { name: 'Import 2 students' })).toBeEnabled();
  });
});
