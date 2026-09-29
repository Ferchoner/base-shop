import { createHash } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  type EmailMessage,
  EmailSender,
  newId,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ChangeEmail } from '../application/change-email.use-case.js';
import { hashLinkToken } from '../application/link-tokens.js';
import { PasswordHasher } from '../application/password-hasher.js';
import { RequestPasswordReset } from '../application/request-password-reset.use-case.js';
import { ResetPassword } from '../application/reset-password.use-case.js';
import { ResolveSignedInAccount } from '../application/resolve-signed-in-account.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { InvalidOrExpiredTokenError } from '../domain/identity-errors.js';
import { PasswordPolicyViolationError } from '../domain/password.js';
import type { SessionId } from '../domain/session.js';
import type { UserId } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';

const PASSWORD = 'una frase larga y segura';
const NEW_PASSWORD = 'otra frase nueva y segura';
/** Operator role of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** Keeps the emails instead of sending them. */
class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The token of the last recovery link sent to `to`. */
  lastToken(to: string): string {
    const message = this.sent.filter((sent) => sent.to === to).at(-1);
    const token = /reset-password\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No recovery link to ${to}`);
    return token[1];
  }
}

/** Password recovery against PostgreSQL 18 (T-123, UC-IAM-07 and 08, ADR-0056, ADR-0118). */
describe('Password recovery (T-123)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let passwordHash: string;
  const email = new RecordingEmailSender();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AppCacheModule,
        RateLimitingModule,
        MailModule,
        AuditModule,
        IdentityAccessModule,
      ],
    })
      .overrideProvider(EmailSender)
      .useValue(email)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    passwordHash = await moduleRef.get(PasswordHasher).hash(PASSWORD);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    email.sent.length = 0;
    await prisma.passwordResetToken.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['auth.login', 'auth.password-reset', 'auth.email-change'],
        },
      },
    });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  async function insertUser(
    options: {
      type?: 'CUSTOMER' | 'STAFF';
      status?: 'ACTIVE' | 'SUSPENDED';
      mustChangePassword?: boolean;
      verified?: boolean;
    } = {},
  ): Promise<{ id: UserId; email: string }> {
    const id = newId<'User'>();
    const address = `${id}@example.com`;
    const type = options.type ?? 'CUSTOMER';
    await prisma.user.create({
      data: {
        id,
        type,
        status: options.status ?? 'ACTIVE',
        suspendedAt: options.status === 'SUSPENDED' ? new Date() : null,
        email: address,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        mustChangePassword: options.mustChangePassword ?? false,
        emailVerifiedAt: options.verified ? new Date() : null,
        roles: { create: type === 'STAFF' ? [{ roleId: OPERATOR }] : [] },
      },
    });
    return { id, email: address };
  }

  const request = (address: string) =>
    run(() => moduleRef.get(RequestPasswordReset).execute({ email: address }));
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    run(() => moduleRef.get(ResetPassword).execute({ token, newPassword }));
  const signIn = (address: string, password: string) =>
    run(() => moduleRef.get(SignIn).execute({ email: address, password }));
  const stored = (id: UserId) =>
    prisma.user.findUniqueOrThrow({ where: { id } });

  async function sessionOf(address: string): Promise<SessionId> {
    const result = await signIn(address, PASSWORD);
    if (result.outcome !== 'AUTHENTICATED') throw new Error(result.outcome);
    const hash = createHash('sha256')
      .update(result.tokens.refreshToken)
      .digest('hex');
    const row = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hash },
    });
    return row.sessionId as SessionId;
  }

  describe('requesting (UC-IAM-07)', () => {
    it('sends a link whose token is stored only as a hash, for 30 minutes', async () => {
      const customer = await insertUser();

      await request(customer.email.toUpperCase());

      const token = email.lastToken(customer.email);
      const [row] = await prisma.passwordResetToken.findMany({
        where: { userId: customer.id },
      });
      expect(row).toMatchObject({
        tokenHash: hashLinkToken(token),
        usedAt: null,
        invalidatedAt: null,
      });
      const lifetime = row.expiresAt.getTime() - row.createdAt.getTime();
      expect(Math.abs(lifetime - 1_800_000)).toBeLessThan(5_000);
    });

    it('sends to staff and unverified customers, never to suspended accounts or unknown emails', async () => {
      const staff = await insertUser({ type: 'STAFF' });
      const unverified = await insertUser();
      const suspended = await insertUser({ status: 'SUSPENDED' });

      for (const address of [
        staff.email,
        unverified.email,
        suspended.email,
        'nadie@example.com',
      ]) {
        await request(address);
      }

      expect(email.sent.map(({ to }) => to)).toEqual([
        staff.email,
        unverified.email,
      ]);
    });

    it('replaces the earlier link with a new one', async () => {
      const customer = await insertUser();
      await request(customer.email);
      const first = email.lastToken(customer.email);

      await request(customer.email);

      await expect(reset(first)).rejects.toThrow(InvalidOrExpiredTokenError);
      await reset(email.lastToken(customer.email));
    });
  });

  describe('resetting (UC-IAM-08)', () => {
    it('sets the password, ends every session, audits and tells the owner', async () => {
      const customer = await insertUser({ verified: true });
      const sessions = [
        await sessionOf(customer.email),
        await sessionOf(customer.email),
      ];
      await request(customer.email);
      const token = email.lastToken(customer.email);
      email.sent.length = 0;

      await reset(token);

      expect(await signIn(customer.email, NEW_PASSWORD)).toMatchObject({
        outcome: 'AUTHENTICATED',
      });
      expect(await signIn(customer.email, PASSWORD)).toEqual({
        outcome: 'INVALID_CREDENTIALS',
      });
      for (const session of sessions) {
        expect(
          await run(() =>
            moduleRef.get(ResolveSignedInAccount).execute(customer.id, session),
          ),
        ).toBeNull();
      }
      expect(email.sent).toEqual([
        expect.objectContaining({
          to: customer.email,
          subject: 'Tu contraseña cambió',
        }),
      ]);
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'auth.password-reset' },
        }),
      ).toEqual([
        expect.objectContaining({
          result: 'SUCCESS',
          actorType: 'USER',
          actorId: customer.id,
          resourceId: customer.id,
          changes: { passwordHash: { changed: true } },
        }),
      ]);
      await expect(reset(token)).rejects.toThrow(InvalidOrExpiredTokenError);
    });

    it('ends the temporary password of a staff member and verifies an unverified email', async () => {
      const staff = await insertUser({
        type: 'STAFF',
        mustChangePassword: true,
      });
      await request(staff.email);

      await reset(email.lastToken(staff.email));

      expect(await stored(staff.id)).toMatchObject({
        mustChangePassword: false,
        emailVerifiedAt: expect.any(Date),
      });
    });

    it('keeps the link usable when the new password breaks the policy', async () => {
      const customer = await insertUser();
      await request(customer.email);
      const token = email.lastToken(customer.email);

      const attempt = reset(token, 'corta');

      await expect(attempt).rejects.toThrow(PasswordPolicyViolationError);
      await expect(attempt).rejects.toMatchObject({
        details: {
          errors: [
            expect.objectContaining({
              field: 'newPassword',
              code: 'passwordLength',
            }),
          ],
        },
      });
      await reset(token);
      expect(await signIn(customer.email, NEW_PASSWORD)).toMatchObject({
        outcome: 'AUTHENTICATED',
      });
    });

    it('rejects an expired link, an unknown one, and one of an account suspended meanwhile', async () => {
      const customer = await insertUser();
      await request(customer.email);
      const expired = email.lastToken(customer.email);
      await prisma.passwordResetToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(reset(expired)).rejects.toThrow(InvalidOrExpiredTokenError);
      await expect(reset('x'.repeat(43))).rejects.toThrow(
        InvalidOrExpiredTokenError,
      );

      await request(customer.email);
      await prisma.user.update({
        where: { id: customer.id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      await expect(reset(email.lastToken(customer.email))).rejects.toThrow(
        InvalidOrExpiredTokenError,
      );
    });
  });

  it('makes a link sent before a change of email useless (ADR-0118)', async () => {
    const customer = await insertUser();
    await request(customer.email);
    const token = email.lastToken(customer.email);

    await run(() =>
      moduleRef.get(ChangeEmail).execute({
        userId: customer.id,
        newEmail: 'nueva@example.com',
        currentPassword: PASSWORD,
      }),
    );

    await expect(reset(token)).rejects.toThrow(InvalidOrExpiredTokenError);
  });
});
