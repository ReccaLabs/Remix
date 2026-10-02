/** Elements inside a clickable row that handle their own clicks. */
export const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"]';

/** True when a click on a row actually landed on a control inside it. */
export function isFromControl(target: EventTarget | null, row: Element) {
  if (!(target instanceof Element)) return false;
  const control = target.closest(INTERACTIVE_SELECTOR);
  return control !== null && control !== row && row.contains(control);
}
