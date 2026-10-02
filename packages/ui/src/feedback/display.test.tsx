import { render, screen } from '@testing-library/react';
import { BookOpen, Check } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';
import { StatusBadge, type StatusTone } from './status-badge';

describe('StatusBadge', () => {
  const tones: StatusTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

  it.each(tones)('renders the status word for %s (never colour alone)', (tone) => {
    render(<StatusBadge tone={tone}>Status {tone}</StatusBadge>);
    expect(screen.getByText(`Status ${tone}`)).toBeVisible();
  });

  it('hides the dot or icon from screen readers', () => {
    const { container } = render(
      <>
        <StatusBadge tone="success">Paid</StatusBadge>
        <StatusBadge tone="neutral" icon={<Check size={12} />}>
          Finished
        </StatusBadge>
      </>,
    );
    const marks = container.querySelectorAll('span[aria-hidden="true"]');
    expect(marks).toHaveLength(2);
    expect(screen.getByText('Paid').textContent).toBe('Paid');
  });

  it('can be text only', () => {
    const { container } = render(
      <StatusBadge tone="neutral" icon={null} appearance="outline">
        Scheduled
      </StatusBadge>,
    );
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('uses the AA ink colour on the soft background', () => {
    render(<StatusBadge tone="warning">Slip waiting</StatusBadge>);
    expect(screen.getByText('Slip waiting').className).toContain('text-warning-ink');
  });
});

describe('EmptyState', () => {
  it('renders a heading at the chosen level, the explanation and one action', async () => {
    const { container } = render(
      <EmptyState
        icon={<BookOpen />}
        title="No classes yet"
        description="Create your first class to start enrolling students."
        headingLevel={3}
        action={<button type="button">Create class</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'No classes yet' })).toBeInTheDocument();
    expect(screen.getByText(/Create your first class/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create class' })).toBeInTheDocument();
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('Skeleton', () => {
  it('is decorative', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el?.className).toContain('motion-safe:animate-pulse');
  });
});
