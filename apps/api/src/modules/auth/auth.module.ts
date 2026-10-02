import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthController } from './auth.controller';
import { DbSessionAuthenticator } from './db-session-authenticator';
import { LoginService } from './login.service';
import { PasswordService } from './passwords';
import { SessionService } from './session.service';

/**
 * AUTH-01, AUTH-05 (basic), sessions and devices (ADR 0004). Global so the core module can bind
 * `SESSION_AUTHENTICATOR` to {@link DbSessionAuthenticator}.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuditService, PasswordService, SessionService, LoginService, DbSessionAuthenticator],
  exports: [DbSessionAuthenticator, AuditService],
})
export class AuthModule {}
