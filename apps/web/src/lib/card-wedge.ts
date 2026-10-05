/** Keyboard-wedge readers send a continuous burst then Enter. Slow typing is never a scan. */
export function createWedgeDetector() {
  let value = '';
  let last = -Infinity;
  return (key: string, time: number): string | null => {
    if (time - last >= 50 || time < last) value = '';
    last = time;
    if (key === 'Enter') {
      const scan = value.length >= 3 ? value : null;
      value = '';
      return scan;
    }
    if (/^[!-~]$/.test(key)) value = (value + key).slice(-128);
    else value = '';
    return null;
  };
}
