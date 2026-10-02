import { ShellFrame, type ShellProps } from './shell-frame';

export type PortalShellProps = ShellProps;
export type AdminShellProps = ShellProps;
export type PlatformShellProps = ShellProps;

/**
 * Student portal (`<tenant>/app`). Phones: bottom tabs Home · Classes · Pay · Live · Me.
 * Desktop: 240 px white sidebar. Active item uses the tenant's brand colour.
 * Pages render their own mobile title bar; pass `header` only for a shell-wide bar.
 */
export function PortalShell(props: PortalShellProps) {
  return (
    <ShellFrame
      {...props}
      config={{
        sidebarTone: 'light',
        sidebarClass: 'bg-surface border-line w-60 border-r',
        headerClass: 'bg-surface border-line border-b',
        dense: false,
      }}
    />
  );
}

/**
 * Institute admin (`<tenant>/admin`). Phones: bottom tabs Home · Students · Fees · Classes · More.
 * Desktop: 248 px light sidebar with dense 36 px items, white top bar.
 */
export function AdminShell(props: AdminShellProps) {
  return (
    <ShellFrame
      {...props}
      config={{
        sidebarTone: 'light',
        sidebarClass: 'bg-surface border-line w-62 border-r',
        headerClass: 'bg-surface border-line border-b',
        dense: true,
      }}
    />
  );
}

/**
 * Platform admin (`admin.remix.lk`). Dark `night` sidebar (232 px) on desktop; on phones a dark
 * top bar and light bottom tabs, as in Platform Admin.dc.html.
 */
export function PlatformShell(props: PlatformShellProps) {
  return (
    <ShellFrame
      {...props}
      config={{
        sidebarTone: 'dark',
        sidebarClass: 'bg-night w-58',
        headerClass: 'bg-night text-white lg:bg-surface lg:text-ink lg:border-line lg:border-b',
        dense: true,
      }}
    />
  );
}
