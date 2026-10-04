import { createHash } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { EventsModule } from '../../../platform/events/events.module.js';
import { RateLimitingModule } from '../../../platform/http/rate-limiting/rate-limiting.module.js';
import { MailModule } from '../../../platform/mail/mail.module.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import {
  EmailDeliveryError,
  type EmailMessage,
  EmailSender,
  newId,
} from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { ChangePassword } from '../application/change-password.use-case.js';
import { PasswordHasher } from '../application/password-hasher.js';
import { ResolveSignedInAccount } from '../application/resolve-signed-in-account.js';
import { SignIn } from '../application/sign-in.use-case.js';
import { PasswordPolicyViolationError } from '../domain/password.js';
import type { SessionId } from '../domain/session.js';
import type { UserId, UserType } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';

const PASSWORD = 'una frase larga y segura';
const NEW_PASSWORD = 'otra frase larga y distinta';
/** Operator role of the migration `20260928120000_identity_initial_roles` (ADR-0043). */
const OPERATOR = '01a0ea00-c755-706d-9721-83f80a3d8630';

/** Keeps the emails instead of sending them; fails when told to. */
class RecordingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];
  failing = false;

  send(message: EmailMessage): Promise<void> {
    if (this.failing) {
      return Promise.reject(new EmailDeliveryError('SMTP unavailable'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

/** Changing the password against PostgreSQL 18 (T-120 part b, UC-IAM-09, ADR-0047, ADR-0072, ADR-0115). */
describe('Changing the password (T-120)', () => {
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
        EventsModule,
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
    email.failing = false;
    await prisma.refreshToken.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.auditLog.deleteMany({
      where: { action: { in: ['auth.login', 'auth.password-change'] } },
    });
  });

  function run<T>(work: () => Promise<T>): Promise<T> {
    return cls.run(work);
  }

  async function insertUser(
    type: UserType = 'CUSTOMER',
    mustChangePassword = false,
  ): Promise<{ id: UserId; email: string }> {
    const id = newId<'User'>();
    const address = `${id}@example.com`;
    await prisma.user.create({
      data: {
        id,
        type,
        email: address,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        passwordHash,
        mustChangePassword,
        roles: {
          create: type === 'STAFF' ? [{ roleId: OPERATOR }] : [],
        },
      },
    });
    return { id, email: address };
  }

  /** Signs in and returns the session. */
  async function startSession(address: string): Promise<SessionId> {
    const result = await run(() =>
      moduleRef.get(SignIn).execute({ email: address, password: PASSWORD }),
    );
    if (result.outcome !== 'AUTHENTICATED') throw new Error(result.outcome);
    const row = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(result.tokens.refreshToken) },
    });
    return row.sessionId as SessionId;
  }

  const change = (
    userId: UserId,
    sessionId: SessionId,
    currentPassword: string,
    newPassword: string,
  ) =>
    run(() =>
      moduleRef
        .get(ChangePassword)
        .execute({ userId, sessionId, currentPassword, newPassword }),
    );
  const signIn = (address: string, password: string) =>
    run(() => moduleRef.get(SignIn).execute({ email: address, password }));
  const resolve = (userId: UserId, sessionId: SessionId) =>
    run(() => moduleRef.get(ResolveSignedInAccount).execute(userId, sessionId));

  it('changes the password, keeps this session and revokes the others', async () => {
    const customer = await insertUser();
    const current = await startSession(customer.email);
    const other = await startSession(customer.email);

    expect(await change(customer.id, current, PASSWORD, NEW_PASSWORD)).toEqual({
      outcome: 'CHANGED',
    });

    expect(await resolve(customer.id, current)).not.toBeNull();
    expect(await resolve(customer.id, other)).toBeNull();
    expect(await signIn(customer.email, NEW_PASSWORD)).toMatchObject({
      outcome: 'AUTHENTICATED',
    });
    expect(await signIn(customer.email, PASSWORD)).toEqual({
      outcome: 'INVALID_CREDENTIALS',
    });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(stored.passwordChangedAt).not.toBeNull();
    expect(stored.version).toBe(2);
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('audits the change without the hashes, and tells the owner by email', async () => {
    const customer = await insertUser();
    const session = await startSession(customer.email);

    await change(customer.id, session, PASSWORD, NEW_PASSWORD);

    const [entry] = await prisma.auditLog.findMany({
      where: { action: 'auth.password-change' },
    });
    expect(entry).toMatchObject({
      result: 'SUCCESS',
      resourceId: customer.id,
      changes: { passwordHash: { changed: true } },
    });
    expect(email.sent).toEqual([
      expect.objectContaining({
        to: customer.email,
        subject: 'Tu contraseña cambió',
      }),
    ]);
  });

  it('ends the temporary password of a staff member, who then has every permission of their roles', async () => {
    const staff = await insertUser('STAFF', true);
    const session = await startSession(staff.email);

    await change(staff.id, session, PASSWORD, NEW_PASSWORD);

    expect(await resolve(staff.id, session)).toMatchObject({
      mustChangePassword: false,
    });
    const [entry] = await prisma.auditLog.findMany({
      where: { action: 'auth.password-change' },
    });
    expect(entry.changes).toEqual({
      passwordHash: { changed: true },
      mustChangePassword: { changed: true },
    });
  });

  it('refuses a wrong current password, changes nothing and audits the attempt', async () => {
    const customer = await insertUser();
    const current = await startSession(customer.email);
    const other = await startSession(customer.email);

    expect(
      await change(customer.id, current, `${PASSWORD}!`, NEW_PASSWORD),
    ).toEqual({ outcome: 'INVALID_CURRENT_PASSWORD' });
    // The current password is checked first, so the policy tells nothing to someone who does not know it.
    expect(await change(customer.id, current, `${PASSWORD}!`, 'corta')).toEqual(
      { outcome: 'INVALID_CURRENT_PASSWORD' },
    );

    expect(await resolve(customer.id, other)).not.toBeNull();
    expect(await signIn(customer.email, PASSWORD)).toMatchObject({
      outcome: 'AUTHENTICATED',
    });
    expect(
      await prisma.auditLog.findMany({
        where: { action: 'auth.password-change' },
      }),
    ).toEqual([
      expect.objectContaining({ result: 'DENIED', resourceId: customer.id }),
      expect.objectContaining({ result: 'DENIED', resourceId: customer.id }),
    ]);
    expect(email.sent).toEqual([]);
  });

  it.each([
    ['a short password', 'corta', 'passwordLength'],
    ['a common one', '1Q2W3E4R5T6Y7U8I', 'commonPassword'],
    ['the current one', PASSWORD, 'samePassword'],
    [
      'a password with a line break',
      'una frase\nlarga y distinta',
      'passwordCharacters',
    ],
  ])('rejects %s and changes nothing', async (_, newPassword, problem) => {
    const customer = await insertUser();
    const current = await startSession(customer.email);
    const other = await startSession(customer.email);

    const attempt = change(customer.id, current, PASSWORD, newPassword);

    await expect(attempt).rejects.toThrow(PasswordPolicyViolationError);
    await expect(attempt).rejects.toMatchObject({
      problem,
      details: { errors: [expect.objectContaining({ field: 'newPassword' })] },
    });
    expect(await resolve(customer.id, other)).not.toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: customer.id } }))
        .version,
    ).toBe(1);
    expect(email.sent).toEqual([]);
  });

  it('keeps the change when the email cannot be sent', async () => {
    const customer = await insertUser();
    const session = await startSession(customer.email);
    email.failing = true;

    expect(await change(customer.id, session, PASSWORD, NEW_PASSWORD)).toEqual({
      outcome: 'CHANGED',
    });
    expect(await signIn(customer.email, NEW_PASSWORD)).toMatchObject({
      outcome: 'AUTHENTICATED',
    });
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
