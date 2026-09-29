import { randomUUID } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { RequirePermissions } from '../src/platform/auth/authorization.decorators.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';
import {
  signedInAs,
  useTestAuthentication,
} from './support/test-authentication.js';

/** Every administrative route declares its permission (ADR-0111); a staff member without it gets 403. */
@Controller('admin/test-audit')
class AdminAuditTestController {
  @Get('secret/:id')
  @RequirePermissions('audit.read')
  secret() {
    return { ok: true };
  }
}

@Controller('test-audit')
class PublicAuditTestController {
  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException();
  }
}

/** A staff member whose roles lack `audit.read`. */
function staffWithoutPermission(id: string) {
  return signedInAs({
    id,
    type: 'STAFF',
    permissions: ['orders.read'],
    mustChangePassword: false,
    sessionId: randomUUID(),
  });
}

describe('Audit of denied administrative access (e2e, T-127)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AdminAuditTestController, PublicAuditTestController],
    }).compile();
    app = moduleFixture.createNestApplication();
    useTestAuthentication(app);
    configureHttp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'http.access-denied' },
    });
  });

  const deniedEntries = () =>
    prisma.auditLog.findMany({ where: { action: 'http.access-denied' } });

  it('records a 403 on /v1/admin as DENIED, with who, where and the route', async () => {
    const userId = randomUUID();

    const response = await request(app.getHttpServer())
      .get('/v1/admin/test-audit/secret/42?email=ana@example.com')
      .set(staffWithoutPermission(userId))
      .set('User-Agent', 'audit-e2e')
      .expect(403);

    const [entry] = await deniedEntries();
    expect(entry).toMatchObject({
      actorType: 'USER',
      actorId: userId,
      result: 'DENIED',
      resourceType: 'route',
      resourceId: 'GET /v1/admin/test-audit/secret/:id',
      userAgent: 'audit-e2e',
      correlationId: response.headers['x-correlation-id'],
    });
    expect(entry.ip).not.toBeNull();
  });

  it('does not change the error response', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/test-audit/secret/42')
      .set(staffWithoutPermission(randomUUID()))
      .expect(403);

    expect(response.body.type).toBe('/problems/forbidden');
  });

  it('does not audit a 403 outside /v1/admin', async () => {
    await request(app.getHttpServer())
      .get('/v1/test-audit/forbidden')
      .set(staffWithoutPermission(randomUUID()))
      .expect(403);

    expect(await deniedEntries()).toHaveLength(0);
  });

  it('does not audit a 404 on /v1/admin', async () => {
    await request(app.getHttpServer()).get('/v1/admin/unknown').expect(404);

    expect(await deniedEntries()).toHaveLength(0);
  });
});
