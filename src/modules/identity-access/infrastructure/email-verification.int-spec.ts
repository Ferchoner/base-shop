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
  DuplicateValueError,
  type EmailMessage,
  EmailSender,
  hashLinkToken,
  InvalidOrExpiredTokenError,
  newId,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ChangeEmail } from '../application/change-email.use-case.js';
import { ConfirmEmail } from '../application/confirm-email.use-case.js';
import { PasswordHasher } from '../application/password-hasher.js';
import { RectifyCustomer } from '../application/rectify-customer.use-case.js';
import { RegisterCustomer } from '../application/register-customer.use-case.js';
import { ResendEmailVerification } from '../application/resend-email-verification.use-case.js';
import { SameEmailError } from '../domain/identity-errors.js';
import { PasswordPolicyViolationError } from '../domain/password.js';
import type { UserId } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';

const PASSWORD = 'una frase larga y segura';
const SIGN_UP = {
  email: 'Maria@Example.com',
  password: PASSWORD,
  firstNames: 'María',
  lastNames: 'López',
  privacyNoticeVersion: '2026-09',
};
const AUDITED = ['auth.email-change', 'customers.rectify'];
/** In the common password list (`data/passwords/`), in capitals. */
const LISTED = '1Q2W3E4R5T6Y7U8I';

/** Keeps the emails instead of sending them. */
class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The token of the last verification link sent to `to`. */
  lastToken(to: string): string {
    const message = this.sent.filter((sent) => sent.to === to).at(-1);
    const token = /verify-email\?token=([\w-]+)/.exec(message?.text ?? '');
    if (token === null) throw new Error(`No verification link to ${to}`);
    return token[1];
  }
}

/** Sign-up, email verification and email change against PostgreSQL 18 (T-121, UC-IAM-01 to 03 and 10, ADR-0117). */
describe('Email verification (T-121)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    email.sent.length = 0;
    await prisma.emailVerificationToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: { in: AUDITED } } });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  const register = (changes: Partial<typeof SIGN_UP> = {}) =>
    run(() =>
      moduleRef.get(RegisterCustomer).execute({ ...SIGN_UP, ...changes }),
    );
  const confirm = (token: string) =>
    run(() => moduleRef.get(ConfirmEmail).execute({ token }));
  const resend = (address: string) =>
    run(() =>
      moduleRef.get(ResendEmailVerification).execute({ email: address }),
    );
  const changeEmail = (
    userId: UserId,
    newEmail: string,
    currentPassword = PASSWORD,
  ) =>
    run(() =>
      moduleRef.get(ChangeEmail).execute({ userId, newEmail, currentPassword }),
    );
  const stored = (id: UserId) =>
    prisma.user.findUniqueOrThrow({ where: { id } });

  describe('signing up (UC-IAM-01)', () => {
    it('creates an unverified customer and sends a link whose token is stored only as a hash', async () => {
      const id = await register();

      expect(await stored(id)).toMatchObject({
        type: 'CUSTOMER',
        status: 'ACTIVE',
        email: 'maria@example.com',
        emailVerifiedAt: null,
        mustChangePassword: false,
        privacyNoticeVersion: '2026-09',
      });
      // Signing up is activity (ADR-0152).
      const { createdAt, lastActiveAt } = await prisma.user.findUniqueOrThrow({
        where: { id },
      });
      expect(lastActiveAt).toEqual(createdAt);
      const token = email.lastToken('maria@example.com');
      const [row] = await prisma.emailVerificationToken.findMany({
        where: { userId: id },
      });
      expect(row).toMatchObject({
        email: 'maria@example.com',
        tokenHash: hashLinkToken(token),
        usedAt: null,
        invalidatedAt: null,
      });
      const lifetime = row.expiresAt.getTime() - row.createdAt.getTime();
      expect(Math.abs(lifetime - 86_400_000)).toBeLessThan(5_000);
    });

    it('rejects a taken email, whatever its case, telling so (ADR-0062)', async () => {
      await register();

      await expect(register({ email: 'MARIA@example.com' })).rejects.toThrow(
        new DuplicateValueError('email'),
      );
    });

    it('rejects a password outside the policy on its field, and creates nothing', async () => {
      const attempt = register({ password: LISTED });

      await expect(attempt).rejects.toThrow(PasswordPolicyViolationError);
      await expect(attempt).rejects.toMatchObject({
        details: {
          errors: [
            expect.objectContaining({
              field: 'password',
              code: 'commonPassword',
            }),
          ],
        },
      });
      expect(await prisma.user.count()).toBe(0);
      expect(email.sent).toEqual([]);
    });
  });

  describe('confirming (UC-IAM-02)', () => {
    it('verifies the email once', async () => {
      const id = await register();
      const token = email.lastToken('maria@example.com');

      await confirm(token);

      expect((await stored(id)).emailVerifiedAt).not.toBeNull();
      await expect(confirm(token)).rejects.toThrow(InvalidOrExpiredTokenError);
    });

    it('rejects an expired link, an unknown one, and one of a suspended account', async () => {
      const id = await register();
      const token = email.lastToken('maria@example.com');
      await prisma.emailVerificationToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(confirm(token)).rejects.toThrow(InvalidOrExpiredTokenError);
      await expect(confirm('x'.repeat(43))).rejects.toThrow(
        InvalidOrExpiredTokenError,
      );

      await resend('maria@example.com');
      await prisma.user.update({
        where: { id },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      await expect(
        confirm(email.lastToken('maria@example.com')),
      ).rejects.toThrow(InvalidOrExpiredTokenError);
      expect((await stored(id)).emailVerifiedAt).toBeNull();
    });
  });

  describe('resending (UC-IAM-03)', () => {
    it('sends a new link that replaces the earlier one', async () => {
      const id = await register();
      const first = email.lastToken('maria@example.com');

      await resend(' MARIA@example.com ');
      const second = email.lastToken('maria@example.com');

      expect(second).not.toBe(first);
      await expect(confirm(first)).rejects.toThrow(InvalidOrExpiredTokenError);
      await confirm(second);
      expect((await stored(id)).emailVerifiedAt).not.toBeNull();
    });

    it('sends nothing for an unknown, verified, suspended or staff email', async () => {
      await register();
      await confirm(email.lastToken('maria@example.com'));
      await register({ email: 'suspendida@example.com' });
      await prisma.user.updateMany({
        where: { email: 'suspendida@example.com' },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });
      await prisma.user.create({
        data: {
          id: newId(),
          type: 'STAFF',
          email: 'staff@example.com',
          firstNames: 'Luis',
          lastNames: 'García',
          passwordHash: 'not-a-real-hash',
        },
      });
      email.sent.length = 0;

      for (const address of [
        'nadie@example.com',
        'maria@example.com',
        'suspendida@example.com',
        'staff@example.com',
      ]) {
        await resend(address);
      }

      expect(email.sent).toEqual([]);
    });
  });

  describe('changing the email (UC-IAM-10)', () => {
    it('changes it unverified, links the new address and tells the previous one', async () => {
      const id = await register();
      const oldLink = email.lastToken('maria@example.com');
      await confirm(oldLink);
      email.sent.length = 0;

      expect(await changeEmail(id, 'Nueva@Example.com')).toEqual({
        outcome: 'CHANGED',
      });

      expect(await stored(id)).toMatchObject({
        email: 'nueva@example.com',
        emailVerifiedAt: null,
      });
      expect(email.sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
        { to: 'nueva@example.com', subject: 'Confirma tu correo' },
        { to: 'maria@example.com', subject: 'Tu correo cambió' },
      ]);
      await confirm(email.lastToken('nueva@example.com'));
      expect((await stored(id)).emailVerifiedAt).not.toBeNull();
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'auth.email-change' },
        }),
      ).toEqual([
        expect.objectContaining({
          result: 'SUCCESS',
          resourceId: id,
          changes: { email: { changed: true } },
        }),
      ]);
    });

    it('makes a link sent to the previous address useless', async () => {
      const id = await register();
      const oldLink = email.lastToken('maria@example.com');

      await changeEmail(id, 'nueva@example.com');

      await expect(confirm(oldLink)).rejects.toThrow(
        InvalidOrExpiredTokenError,
      );
    });

    it('refuses a wrong password, changes nothing and audits the attempt', async () => {
      const id = await register();
      email.sent.length = 0;

      expect(
        await changeEmail(id, 'nueva@example.com', `${PASSWORD}!`),
      ).toEqual({ outcome: 'INVALID_CURRENT_PASSWORD' });

      expect((await stored(id)).email).toBe('maria@example.com');
      expect(email.sent).toEqual([]);
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'auth.email-change' },
        }),
      ).toEqual([expect.objectContaining({ result: 'DENIED' })]);
    });

    it('rejects the same email and a taken one', async () => {
      const id = await register();
      await register({ email: 'otra@example.com' });

      await expect(changeEmail(id, 'MARIA@example.com')).rejects.toThrow(
        SameEmailError,
      );
      await expect(changeEmail(id, 'otra@example.com')).rejects.toThrow(
        new DuplicateValueError('email'),
      );
      expect((await stored(id)).email).toBe('maria@example.com');
    });
  });

  describe('rectifying (ADR-0067)', () => {
    it('changes only the names given, audited without their values', async () => {
      const id = await register();

      await run(() =>
        moduleRef
          .get(RectifyCustomer)
          .execute({ userId: id, lastNames: 'López Hernández' }),
      );

      expect(await stored(id)).toMatchObject({
        firstNames: 'María',
        lastNames: 'López Hernández',
        version: 2,
      });
      expect(
        await prisma.auditLog.findMany({
          where: { action: 'customers.rectify' },
        }),
      ).toEqual([
        expect.objectContaining({
          resourceId: id,
          changes: { lastNames: { changed: true } },
        }),
      ]);
    });

    it('saves and audits nothing when nothing changes', async () => {
      const id = await register();

      await run(() =>
        moduleRef
          .get(RectifyCustomer)
          .execute({ userId: id, firstNames: 'María' }),
      );

      expect((await stored(id)).version).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { action: 'customers.rectify' } }),
      ).toBe(0);
    });
  });

  it('never keeps a password it hashed as plain text', async () => {
    const id = await register();

    const { passwordHash } = await stored(id);
    await expect(
      moduleRef.get(PasswordHasher).verify(PASSWORD, passwordHash),
    ).resolves.toBe(true);
    expect(passwordHash).not.toContain(PASSWORD);
  });
});
