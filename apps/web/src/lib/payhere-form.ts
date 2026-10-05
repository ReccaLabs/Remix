import type { CheckoutResponse } from '@remix/types/api';

/** Only our two gateway actions may receive a signed form; never build HTML from API values. */
export function submitPayhereForm(checkout: CheckoutResponse): void {
  if (
    !['https://sandbox.payhere.lk/pay/checkout', 'https://www.payhere.lk/pay/checkout'].includes(
      checkout.actionUrl,
    )
  )
    throw new Error('Invalid checkout action');
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = checkout.actionUrl;
  form.hidden = true;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    form.append(field);
  }
  document.body.append(form);
  try {
    HTMLFormElement.prototype.submit.call(form);
  } finally {
    form.remove();
  }
}
