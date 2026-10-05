// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { CashCounter } from './cash-counter';
import { CameraCardScanner } from './camera-card-scanner';
import { FEES, STUDENT, json, wrap } from './test-fixtures';

const CODE = 'TT-00001-1';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(
  status: 'active' | 'ordered' | 'revoked' | 'studentNo' | 'unknown' = 'active',
  archived = false,
) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/cards/lookup'))
        return status === 'unknown'
          ? json({ type: 'about:blank', title: 'Unknown', status: 404, code: 'NOT_FOUND' }, 404)
          : json({
              matchedBy: status === 'studentNo' ? 'studentNo' : 'card',
              card:
                status === 'studentNo'
                  ? null
                  : { id: '0193f1c2-7b1d-7c3e-9a4f-000000000901', kind: 'temporary', status },
              student: {
                id: STUDENT.id,
                studentNo: STUDENT.studentNo,
                displayName: STUDENT.displayName,
                archived,
              },
            });
      if (url.endsWith('/fees')) return json(FEES);
      return json({ page: 1, pageSize: 25, total: 1, items: [STUDENT] });
    }),
  );
  return { urls, ...wrap(<CashCounter />), user: userEvent.setup() };
}
describe('FEE-07 scan first, search second', () => {
  it('discards a lookup if the cashier changes the input before it resolves', async () => {
    let resolve: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    wrap(<CashCounter />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search student'), `${CODE}{Enter}`);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search student'));
    resolve(
      json({
        matchedBy: 'card',
        card: { id: '0193f1c2-7b1d-7c3e-9a4f-000000000901', kind: 'temporary', status: 'active' },
        student: {
          id: STUDENT.id,
          studentNo: STUDENT.studentNo,
          displayName: STUDENT.displayName,
          archived: false,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByLabelText(/Physics.*September/)).toBeNull();
    expect(screen.queryByText('Temporary card')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('Enter loads open months directly with a temporary-card badge and hides unsupported readers; axe clean', async () => {
    const { user, urls, container } = setup();
    expect(screen.queryByRole('button', { name: 'Scan with camera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tap card' })).toBeNull();
    await user.type(screen.getByLabelText('Search student'), `${CODE}{Enter}`);
    await screen.findByLabelText(/Physics.*September/);
    expect(urls[0]).toContain('/cards/lookup');
    expect(urls.some((url) => url.includes('/students?'))).toBe(false);
    expect(screen.getByText('Temporary card')).toHaveClass('text-success-ink');
    await expectNoAxeViolations(container);
  });
  for (const status of ['ordered', 'revoked'] as const)
    it(`explains ${status} with a word and colour and does not load months`, async () => {
      const { user, urls } = setup(status);
      await user.type(screen.getByLabelText('Search student'), `${CODE}{Enter}`);
      const message = await screen.findByRole('alert');
      expect(message).toHaveTextContent(
        status === 'ordered' ? 'has not been handed over yet' : 'Card revoked',
      );
      expect(message).toHaveClass(status === 'ordered' ? 'text-warning-ink' : 'text-danger-ink');
      expect(urls.some((url) => url.endsWith('/fees'))).toBe(false);
    });
  it('falls back to name/phone search only on an unknown lookup', async () => {
    const { user, urls } = setup('unknown');
    await user.type(screen.getByLabelText('Search student'), 'Sample{Enter}');
    await screen.findByRole('button', { name: /Choose Sample Student/ });
    expect(urls[0]).toContain('/cards/lookup');
    expect(urls[1]).toContain('/students?');
  });
  it('accepts a bare student number and warns for archived students', async () => {
    const { user } = setup('studentNo', true);
    await user.type(screen.getByLabelText('Search student'), `${STUDENT.studentNo}{Enter}`);
    await screen.findByLabelText(/Physics.*September/);
    expect(screen.getByRole('alert')).toHaveTextContent('Archived student');
    expect(screen.queryByText('Temporary card')).toBeNull();
  });
  it('catches a wedge burst ending in Enter while the search field has no focus', async () => {
    const { urls } = setup();
    (screen.getByLabelText('Search student') as HTMLInputElement).blur();
    for (const [n, key] of [...CODE, 'Enter'].entries()) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'timeStamp', { value: n * 5 });
      fireEvent(document.body, event);
    }
    await screen.findByLabelText(/Physics.*September/);
    expect(urls[0]).toContain('/cards/lookup');
  });
});

describe('STU-06 camera stream cleanup', () => {
  function camera() {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    const media = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: media } });
    class Detector {
      static async getSupportedFormats() {
        return ['qr_code', 'code_128'];
      }
      async detect() {
        return [];
      }
    }
    vi.stubGlobal('BarcodeDetector', Detector);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    return { stop, media, stream };
  }
  it('stops every camera track on close/unmount and requests no microphone', async () => {
    const { stop, media } = camera();
    const { unmount } = wrap(<CameraCardScanner onRead={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(media).toHaveBeenCalled());
    expect(media).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    unmount();
    expect(stop).toHaveBeenCalled();
  });
  it('stops a stream whose permission request finishes after unmount', async () => {
    const { stop, media, stream } = camera();
    let resolve: (value: typeof stream) => void = () => undefined;
    media.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as Promise<typeof stream>,
    );
    const { unmount } = wrap(<CameraCardScanner onRead={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(media).toHaveBeenCalled());
    unmount();
    resolve(stream);
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});
