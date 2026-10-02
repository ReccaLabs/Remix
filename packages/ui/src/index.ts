// Foundations (also used by remix.lk)
export { cn } from './cn';
export { Logo, type LogoProps } from './logo';
export { buttonClass, type ButtonSize, type ButtonVariant } from './button';
export { Badge, Container, DisplayHeading, Eyebrow, IconTile } from './layout';
export type { LinkComponent, LinkLikeProps } from './link';

// Actions
export { Button, type ButtonProps } from './actions/button';

// Forms
export { Field, FieldError, type FieldControlProps, type FieldProps } from './forms/field';
export { Input, type InputProps } from './forms/input';
export { PasswordInput, type PasswordInputProps } from './forms/password-input';
export { PhoneInput, type PhoneInputProps } from './forms/phone-input';
export { Checkbox, type CheckboxProps } from './forms/checkbox';
export type { ControlSize } from './forms/control';

// Feedback
export { StatusBadge, type StatusBadgeProps, type StatusTone } from './feedback/status-badge';
export { EmptyState, type EmptyStateProps } from './feedback/empty-state';
export { Skeleton, type SkeletonProps } from './feedback/skeleton';
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastOptions,
  type ToastProviderProps,
  type ToastTone,
} from './feedback/toast';
export { ConfirmDialog, type ConfirmDialogProps } from './feedback/confirm-dialog';

// Data
export { StatCard, type StatCardProps } from './data/stat-card';
export { DataTable, type DataTableColumn, type DataTableProps } from './data/data-table';

// App shells
export {
  AdminShell,
  PlatformShell,
  PortalShell,
  type AdminShellProps,
  type PlatformShellProps,
  type PortalShellProps,
} from './shells/shells';
export type { ShellProps } from './shells/shell-frame';
export type { ShellNavBadge, ShellNavItem, ShellTone } from './shells/nav';
export { ShellTenant, ShellUser, type ShellTenantProps, type ShellUserProps } from './shells/parts';
