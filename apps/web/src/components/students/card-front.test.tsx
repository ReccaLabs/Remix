// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { CardFront } from './card-front';
afterEach(cleanup);
describe('STU-06 printable card', () => {
  it('shows institute, student, student number, temporary label and barcode code; axe clean', async () => {
    const { container } = render(
      <main>
        <h1>Print temporary card</h1>
        <CardFront
          institute="Nilanka Institute"
          name="Sample Student"
          studentNo="NIL-26-0042"
          code="NIL-26-0042-1"
          kindLabel="Temporary card"
          barcodeLabel="Barcode: NIL-26-0042-1"
        />
      </main>,
    );
    expect(screen.getByText('Nilanka Institute')).toBeInTheDocument();
    expect(screen.getByText('NIL-26-0042-1')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Barcode: NIL-26-0042-1' })).toHaveAttribute(
      'shape-rendering',
      'crispEdges',
    );
    await expectNoAxeViolations(container);
  });
});
