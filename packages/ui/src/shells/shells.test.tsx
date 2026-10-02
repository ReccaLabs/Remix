import { render, screen, within } from '@testing-library/react';
import {
  BookOpen,
  Building2,
  House,
  LayoutDashboard,
  Menu,
  User,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { LinkLikeProps } from '../link';
import { expectNoAxeViolations } from '../test/axe';
import type { ShellNavItem } from './nav';
import { ShellTenant, ShellUser } from './parts';
import { AdminShell, PlatformShell, PortalShell } from './shells';

const portalNav: ShellNavItem[] = [
  { href: '/app', label: 'Home', icon: <House />, active: true },
  { href: '/app/classes', label: 'Classes', icon: <BookOpen /> },
  { href: '/app/pay', label: 'Pay', icon: <Wallet />, badge: { label: '1 fee due' } },
  { href: '/app/live', label: 'Live', icon: <Video /> },
  { href: '/app/me', label: 'Me', icon: <User /> },
];

const labels = {
  navLabel: 'Main',
  mobileNavLabel: 'Main (tabs)',
  skipLinkLabel: 'Skip to content',
};

describe('PortalShell', () => {
  it('marks only the active item with aria-current="page" in both navs', () => {
    render(
      <PortalShell nav={portalNav} {...labels}>
        <h1>Home</h1>
      </PortalShell>,
    );
    for (const name of ['Main', 'Main (tabs)']) {
      const nav = screen.getByRole('navigation', { name });
      const current = within(nav)
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName('Home');
      expect(current[0]?.className).toContain('text-brand');
    }
  });

  it('speaks the badge as part of the link name', () => {
    render(
      <PortalShell nav={portalNav} {...labels}>
        <p>x</p>
      </PortalShell>,
    );
    const tabs = screen.getByRole('navigation', { name: 'Main (tabs)' });
    expect(within(tabs).getByRole('link', { name: 'Pay 1 fee due' })).toHaveAttribute(
      'href',
      '/app/pay',
    );
  });

  it('has a skip link to a focusable main landmark', () => {
    render(
      <PortalShell nav={portalNav} {...labels} mainId="content">
        <h1>Home</h1>
      </PortalShell>,
    );
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#content');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('renders links through the provided linkComponent', () => {
    const seen: string[] = [];
    function RouterLink({ href, children, ...rest }: LinkLikeProps & { children?: ReactNode }) {
      seen.push(href);
      return (
        <a href={href} data-router="" {...rest}>
          {children}
        </a>
      );
    }
    render(
      <PortalShell nav={portalNav} {...labels} linkComponent={RouterLink}>
        <p>x</p>
      </PortalShell>,
    );
    expect(seen).toContain('/app/classes');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Classes' })).toHaveAttribute('data-router');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <PortalShell
        nav={portalNav}
        {...labels}
        tenant={<ShellTenant name="Sample Institute" initials="SI" />}
        user={<ShellUser name="Sample Student" meta="BR-0001" initials="SS" />}
      >
        <h1>Home</h1>
      </PortalShell>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('AdminShell', () => {
  const nav: ShellNavItem[] = [
    { href: '/admin', label: 'Dashboard', icon: <LayoutDashboard /> },
    { href: '/admin/students', label: 'Students', icon: <Users />, active: true },
    {
      href: '/admin/fees',
      label: 'Fees & payments',
      icon: <Wallet />,
      badge: { text: '18', label: '18 bank slips waiting', tone: 'warning' },
    },
    { href: '/admin/classes', label: 'Classes', icon: <BookOpen /> },
  ];
  const mobileNav: ShellNavItem[] = [
    { href: '/admin', label: 'Home', icon: <LayoutDashboard /> },
    { href: '/admin/students', label: 'Students', icon: <Users />, active: true },
    { href: '/admin/fees', label: 'Fees', icon: <Wallet /> },
    { href: '/admin/classes', label: 'Classes', icon: <BookOpen /> },
    { href: '/admin/more', label: 'More', icon: <Menu /> },
  ];

  it('uses separate sidebar and bottom-tab items, each marking the active page', () => {
    render(
      <AdminShell nav={nav} mobileNav={mobileNav} {...labels} header={<span>Top bar</span>}>
        <h1>Students</h1>
      </AdminShell>,
    );
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getAllByRole('link')).toHaveLength(4);
    expect(within(sidebar).getByRole('link', { name: 'Students' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(
      within(sidebar).getByRole('link', { name: 'Fees & payments 18 bank slips waiting' }),
    ).toBeInTheDocument();

    const tabs = screen.getByRole('navigation', { name: 'Main (tabs)' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Students', 'Fees', 'Classes', 'More']);
    expect(within(tabs).getByRole('link', { name: 'Students' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('banner')).toHaveTextContent('Top bar');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <AdminShell
        nav={nav}
        mobileNav={mobileNav}
        {...labels}
        tenant={<ShellTenant name="Sample Institute" subtitle="sample.remix.lk" initials="SI" />}
        sidebarFooter={<p>Plan usage</p>}
        user={<ShellUser name="Sample Owner" meta="Owner" initials="SO" />}
        header={<span>Top bar</span>}
      >
        <h1>Students</h1>
      </AdminShell>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('PlatformShell', () => {
  const nav: ShellNavItem[] = [
    { href: '/', label: 'Overview', icon: <LayoutDashboard /> },
    { href: '/institutes', label: 'Institutes', icon: <Building2 />, active: true },
  ];

  it('renders the dark sidebar and marks the active page', async () => {
    const { container } = render(
      <PlatformShell
        nav={nav}
        {...labels}
        tenant={<ShellTenant name="ReMix" tone="dark" />}
        user={<ShellUser name="Sample Staff" meta="Support" initials="SS" tone="dark" />}
      >
        <h1>Institutes</h1>
      </PlatformShell>,
    );
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    const active = within(sidebar).getByRole('link', { name: 'Institutes' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.className).toContain('text-white');
    expect(sidebar.parentElement?.className).toContain('bg-night');
    await expectNoAxeViolations(container);
  });
});
