import { normalizeNfcUid } from '@remix/types/api';

interface NdefRecord {
  recordType: string;
  data?: DataView;
  encoding?: string;
}
interface NdefEvent {
  serialNumber: string;
  message: { records: NdefRecord[] };
}
interface NdefReader {
  scan(options: { signal: AbortSignal }): Promise<void>;
  onreading: ((event: NdefEvent) => void) | null;
  onreadingerror: (() => void) | null;
}
type NfcWindow = Window & { NDEFReader?: new () => NdefReader };
export const supportsNfc = () =>
  typeof window !== 'undefined' && Boolean((window as NfcWindow).NDEFReader);
export const subscribeHardware = () => () => undefined;
export const noHardware = () => false;

/** NFC chips carry an NDEF text card code, or their serial is used for an unprogrammed chip. */
export function nfcCardInput(event: NdefEvent): string {
  const text = event.message.records.find((record) => record.recordType === 'text' && record.data);
  if (text?.data) return new TextDecoder(text.encoding ?? 'utf-8').decode(text.data).trim();
  return normalizeNfcUid(event.serialNumber);
}

/** Reading only: aborting the signal closes the scan, including on navigation/unmount. */
export async function scanNfc(
  signal: AbortSignal,
  onRead: (value: string, serial: string) => void,
  onError: () => void,
): Promise<void> {
  const Reader = (window as NfcWindow).NDEFReader;
  if (!Reader) throw new Error('NFC unavailable');
  const reader = new Reader();
  reader.onreading = (event) => {
    if (!signal.aborted) onRead(nfcCardInput(event), normalizeNfcUid(event.serialNumber));
  };
  reader.onreadingerror = () => {
    if (!signal.aborted) onError();
  };
  const clear = () => {
    reader.onreading = null;
    reader.onreadingerror = null;
  };
  signal.addEventListener('abort', clear, { once: true });
  if (signal.aborted) {
    clear();
    return;
  }
  try { await reader.scan({ signal }); }
  catch (error) { clear(); signal.removeEventListener('abort', clear); throw error; }
}
