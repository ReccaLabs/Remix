import * as schema from './schema';

export { schema };
export {
  createDb,
  createOwnerDb,
  verifyAppRole,
  type Db,
  type DbOptions,
  type Queryable,
  type Schema,
  type Tx,
} from './client';
export { withTenant } from './tenant';
export {
  resolveTenantByHost,
  TENANT_CACHE_TTL_SECONDS,
  type ResolveTenantOptions,
  type TenantCache,
} from './resolve';
export { classifyHost, normaliseHost, type HostTarget } from './host';
export {
  allocateNumbers,
  formatStudentNo,
  MAX_NUMBER_BLOCK,
  type CounterKind,
  type NumberBlock,
} from './counters';
export { runMigrations } from './migrate';
export { ARGON2ID_OPTIONS, hashPassword } from './password';
export {
  ACTOR_KINDS,
  AUTH_TICKET_KINDS,
  USER_STATUSES,
  type ActorKind,
  type AuthTicketKind,
  type UserStatus,
} from './schema/enums';
