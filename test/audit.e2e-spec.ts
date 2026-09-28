import { randomUUID } from 'node:crypto';
import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  type INestApplication,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { PrismaService } from '../src/platform/persistence/prisma.service.js';

/** Stands in for authentication (T-120): the user id comes from a test header. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: { id: string } }>();
    const userId = req.headers['x-test-user'];
    if (userId) req.user = { id: userId };
    return true;
  }
}

@Controller('admin/test-audit')
@UseGuards(FakeAuthGuard)
class AdminAuditTestController {
  @Get('secret/:id')
  secret() {
    throw new ForbiddenException();
  }
}

@Controller('test-audit')
@UseGuards(FakeAuthGuard)
class PublicAuditTestController {
  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException();
  }
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
      .set('x-test-user', userId)
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
      .set('x-test-user', randomUUID())
      .expect(403);

    expect(response.body.type).toBe('/problems/forbidden');
  });

  it('does not audit a 403 outside /v1/admin', async () => {
    await request(app.getHttpServer())
      .get('/v1/test-audit/forbidden')
      .set('x-test-user', randomUUID())
      .expect(403);

    expect(await deniedEntries()).toHaveLength(0);
  });

  it('does not audit a 404 on /v1/admin', async () => {
    await request(app.getHttpServer()).get('/v1/admin/unknown').expect(404);

    expect(await deniedEntries()).toHaveLength(0);
  });
});
