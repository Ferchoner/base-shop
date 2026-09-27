import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/platform/http/configure-http.js';
import { AppLogger } from '../src/platform/logging/app-logger.js';

const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

describe('Logging (e2e, T-118)', () => {
  let app: INestApplication<App>;
  let output: string[];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // Same setup as main.ts.
    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(AppLogger));
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    output = [];
    const capture = (chunk: unknown) => {
      output.push(String(chunk).replace(ANSI_COLOR, ''));
      return true;
    };
    jest.spyOn(process.stdout, 'write').mockImplementation(capture);
    jest.spyOn(process.stderr, 'write').mockImplementation(capture);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The request line of the HTTP logger, written when the response finishes. */
  async function requestLine(path: string): Promise<{
    line: string;
    correlationId: string;
  }> {
    const response = await request(app.getHttpServer()).get(path);
    await new Promise((resolve) => setImmediate(resolve));
    const line = output.find((entry) => entry.includes('[HTTP]')) ?? '';
    return { line, correlationId: response.headers['x-correlation-id'] };
  }

  it('writes one line per request with method, path, status, duration and correlation id', async () => {
    const { line, correlationId } = await requestLine('/v1/unknown');

    expect(line).toMatch(/GET \/v1\/unknown 404 \d+\.\d ms/);
    expect(line).toContain(`[HTTP] [${correlationId}]`);
  });

  it('never writes the query string, which may hold personal data', async () => {
    const { line } = await requestLine(
      '/v1/unknown?email=ana@example.com&token=secret',
    );

    expect(line).toContain('GET /v1/unknown 404');
    expect(line).not.toContain('email');
    expect(line).not.toContain('secret');
  });

  it('gives each request its own correlation id in the log', async () => {
    const first = await requestLine('/v1/first');
    output.length = 0;
    const second = await requestLine('/v1/second');

    expect(first.line).toContain(first.correlationId);
    expect(second.line).toContain(second.correlationId);
    expect(first.correlationId).not.toBe(second.correlationId);
  });
});
