import { cn } from '@remix/ui';
import type { MDXComponents } from 'mdx/types';
import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Element → design-token mapping for MDX (guides). Required by @next/mdx in the App Router.
 * The article column caps the measure at ~68ch; these styles only handle rhythm and type.
 */

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Heading id for in-page links, e.g. "Step 1: Turn on the waiting room" → "step-1-turn-on-the-waiting-room". */
function slugify(node: ReactNode): string {
  return textOf(node)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function MdxLink({ href = '', className, children, ...props }: ComponentPropsWithoutRef<'a'>) {
  const cls = cn(
    'text-brand font-medium underline decoration-brand-line underline-offset-[3px] hover:decoration-brand',
    className,
  );

  // Internal page → locale-aware Link (adds /en/…).
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  // External → new tab, no opener/referrer.
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...props}>
        {children}
      </a>
    );
  }
  // #anchors, mailto:, tel:
  return (
    <a href={href} className={cls} {...props}>
      {children}
    </a>
  );
}

const components: MDXComponents = {
  h2: ({ children, className, ...props }) => (
    <h2
      id={slugify(children)}
      className={cn(
        'font-display text-ink mb-4 mt-12 text-balance text-[26px] font-bold leading-[1.15] tracking-[-0.02em] first:mt-0 sm:text-[30px]',
        className,
      )}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }) => (
    <h3
      id={slugify(children)}
      className={cn(
        'text-ink mb-3 mt-8 text-xl font-semibold leading-7 tracking-[-0.01em]',
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn('text-ink mb-2 mt-6 text-lg font-semibold leading-7', className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('text-ink-2 my-5 text-pretty', className)} {...props} />
  ),
  a: MdxLink,
  ul: ({ className, ...props }) => (
    <ul
      className={cn('text-ink-2 marker:text-muted my-5 list-disc space-y-2 pl-6', className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        'text-ink-2 marker:text-muted my-5 list-decimal space-y-2 pl-6 marker:font-semibold',
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn('text-pretty pl-1', className)} {...props} />,
  strong: ({ className, ...props }) => (
    <strong className={cn('text-ink font-semibold', className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'border-accent bg-accent-tint text-ink [&_p]:text-ink my-8 rounded-r-md border-l-4 px-5 py-1 [&_p]:my-4',
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn('border-line-warm my-12 border-t', className)} {...props} />
  ),
  code: ({ className, ...props }) => (
    <code
      className={cn(
        'bg-paper-2 text-ink rounded-xs px-1.5 py-0.5 font-mono text-[0.875em]',
        className,
      )}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        'bg-night my-6 overflow-x-auto rounded-md p-5 font-mono text-sm leading-6 text-white [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit',
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="border-line-warm my-8 overflow-x-auto rounded-md border">
      <table className={cn('w-full border-collapse text-left text-[15px]', className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        'bg-paper-3 text-ink border-line-warm border-b px-4 py-3 font-semibold',
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn('text-ink-2 border-line-warm-soft border-b px-4 py-3 align-top', className)}
      {...props}
    />
  ),
};

export function useMDXComponents(overrides: MDXComponents = {}): MDXComponents {
  return { ...components, ...overrides };
}
