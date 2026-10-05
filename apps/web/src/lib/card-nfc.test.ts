// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nfcCardInput, scanNfc, supportsNfc } from './card-nfc';

afterEach(() => vi.unstubAllGlobals());
describe('STU-06 read-only Web NFC', () => {
  it('uses the first NDEF text record before the serial and normalises an unprogrammed chip UID', () => {
    const data = new DataView(new TextEncoder().encode('NIL-26-0042-1').buffer);
    expect(
      nfcCardInput({
        serialNumber: '04:a2:1b:9c',
        message: {
          records: [
            { recordType: 'url' },
            { recordType: 'text', data },
            { recordType: 'text', data: new DataView(new TextEncoder().encode('OTHER').buffer) },
          ],
        },
      }),
    ).toBe('NIL-26-0042-1');
    expect(nfcCardInput({ serialNumber: '04:a2:1b:9c', message: { records: [] } })).toBe(
      '04A21B9C',
    );
  });
  it('hides unsupported hardware and aborts the reader without writing to a chip', async () => {
    expect(supportsNfc()).toBe(false);
    const options: { signal: AbortSignal }[] = [];
    class Reader {
      static instance: Reader | undefined;
      onreading = null;
      onreadingerror = null;
      constructor() {
        Reader.instance = this;
      }
      async scan(option: { signal: AbortSignal }) {
        options.push(option);
      }
    }
    vi.stubGlobal('NDEFReader', Reader);
    expect(supportsNfc()).toBe(true);
    const abort = new AbortController();
    await scanNfc(abort.signal, vi.fn(), vi.fn());
    expect(options[0]?.signal).toBe(abort.signal);
    abort.abort();
    expect(Reader.instance?.onreading).toBeNull();
    expect(Reader.instance?.onreadingerror).toBeNull();
  });
});
