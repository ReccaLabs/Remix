import { cn } from './cn';

/**
 * ReMix logo — design/claude-design/ReMix Logo.dc.html
 * The X is two crossing strokes: blue for online, amber for the hall.
 * Pure CSS (no image request), scales with `size` (px). Sizes are geometric, so inline
 * styles are used for em-based geometry only — colours come from theme tokens.
 */
export interface LogoProps {
  size?: number;
  tone?: 'light' | 'dark';
  variant?: 'wordmark' | 'lockup' | 'mark';
  className?: string;
  /** Accessible name. Pass '' when the logo sits inside a link that already has a label. */
  label?: string;
}

function Cross({ tone }: { tone: 'light' | 'dark' }) {
  const stroke = 'absolute top-1/2 left-1/2 h-[0.8em] w-[0.16em] rounded-[0.08em]';
  return (
    <>
      <span
        className={cn(stroke, tone === 'dark' ? 'bg-brand-on-dark' : 'bg-brand')}
        style={{ transform: 'translate(-50%,-50%) rotate(-30deg)' }}
      />
      <span
        className={cn(stroke, 'bg-accent')}
        style={{ transform: 'translate(-50%,-50%) rotate(30deg)' }}
      />
    </>
  );
}

export function Logo({
  size = 28,
  tone = 'light',
  variant = 'wordmark',
  className,
  label = 'ReMix',
}: LogoProps) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };

  if (variant === 'mark') {
    return (
      <span
        {...a11y}
        className={cn(
          'inline-flex flex-none items-center justify-center',
          tone === 'dark' ? 'bg-surface' : 'bg-ink',
          className,
        )}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.26),
          fontSize: Math.round(size * 0.92),
        }}
      >
        <span className="relative block h-[0.72em] w-[0.56em]">
          <Cross tone={tone} />
        </span>
      </span>
    );
  }

  return (
    <span
      {...a11y}
      className={cn('inline-flex flex-col items-start gap-[0.16em]', className)}
      style={{ fontSize: size }}
    >
      <span
        className={cn(
          'font-display inline-flex items-baseline font-extrabold leading-none tracking-[-0.045em]',
          tone === 'dark' ? 'text-white' : 'text-ink',
        )}
      >
        <span>ReMi</span>
        <span className="relative ml-[0.02em] inline-block h-[0.7em] w-[0.56em]">
          <Cross tone={tone} />
        </span>
      </span>
      {variant === 'lockup' && (
        <span
          className={cn(
            'pl-[0.04em] font-sans text-[0.27em] font-medium leading-[1.2] tracking-[0.01em]',
            tone === 'dark' ? 'text-night-muted' : 'text-muted',
          )}
        >
          by Recca Labs
        </span>
      )}
    </span>
  );
}
