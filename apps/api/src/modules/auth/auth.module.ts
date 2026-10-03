import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AccountController, AdminStudentAuthController } from './account.controller';
import { AccountService } from './account.service';
import { AuthCookies } from './auth-cookies';
import { AuthFlowsController } from './auth-flows.controller';
import { AuthNotifications } from './auth-notifications';
import { AuthSmsService } from './auth-sms.service';
import { AuthController } from './auth.controller';
import { CodeSendLimits } from './code-send-limits';
import { DbSessionAuthenticator } from './db-session-authenticator';
import { InviteService } from './invite.service';
import { LoginService } from './login.service';
import { OtpService } from './otp.service';
import { PasswordService } from './passwords';
import { SessionIssuer } from './session-issuer';
import { SessionService } from './session.service';

/**
 * AUTH-01…05, 07…09: sessions and devices (ADR 0004), SMS codes, device limit, two-step,
 * invitations, "Me" and staff actions on student sign-ins. Global so the core module can bind
 * `SESSION_AUTHENTICATOR` to {@link DbSessionAuthenticator} and the people module can call
 * {@link AuthNotifications}.
 */
@Global()
@Module({
  controllers: [AuthController, AuthFlowsController, AccountController, AdminStudentAuthController],
  providers: [
    AuditService,
    PasswordService,
    SessionService,
    SessionIssuer,
    AuthCookies,
    AuthSmsService,
    CodeSendLimits,
    LoginService,
    OtpService,
    InviteService,
    AccountService,
    AuthNotifications,
    DbSessionAuthenticator,
  ],
  exports: [DbSessionAuthenticator, AuditService, AuthNotifications],
})
export class AuthModule {}
