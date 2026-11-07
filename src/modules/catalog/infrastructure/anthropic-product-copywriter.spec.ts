import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProblemException } from '../../../platform/http/problem-details/problem.exception.js';
import type { CopyRequest } from '../application/product-copywriter.js';
import { AnthropicProductCopywriter } from './anthropic-product-copywriter.js';

const REQUEST: CopyRequest = {
  title: 'Camisa de lino',
  currentDescription: null,
  variantOptions: [{ talla: 'M' }],
  language: 'es',
  tone: 'friendly',
};

const DRAFT = {
  title: 'Camisa de lino fresca',
  description: 'Ligera y cómoda.',
  highlights: ['Lino', 'Talla M'],
};

/**
 * A local stand-in for the Claude API: the SDK reads `ANTHROPIC_BASE_URL`, so no request leaves the machine and
 * no key is spent. It answers what `reply` says and keeps the bodies it received.
 */
let server: Server;
let reply: { status: number; body: unknown };
const received: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      received.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received.length = 0;
});

function message(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 80 },
  };
}

const copywriter = (apiKey = 'sk-ant-test') =>
  new AnthropicProductCopywriter({ apiKey, model: 'claude-opus-5-5' });
const withoutKey = () =>
  new AnthropicProductCopywriter({
    apiKey: undefined,
    model: 'claude-opus-5-5',
  });

async function expectUnavailable(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProblemException);
  expect((error as ProblemException).code).toBe('ai-unavailable');
}

describe('AnthropicProductCopywriter', () => {
  it('returns the draft the model wrote, from the product data alone', async () => {
    reply = { status: 200, body: message(JSON.stringify(DRAFT)) };

    await expect(copywriter().draft(REQUEST)).resolves.toEqual(DRAFT);

    const [body] = received;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(JSON.stringify(body.messages)).toContain('Camisa de lino');
  });

  it('is unavailable without a key, without calling the API', async () => {
    await expectUnavailable(withoutKey().draft(REQUEST));
    expect(received).toEqual([]);
  });

  it('is unavailable when the API rejects the request', async () => {
    reply = {
      status: 400,
      body: {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'bad model' },
      },
    };

    await expectUnavailable(copywriter().draft(REQUEST));
  });

  it('is unavailable when the model declines', async () => {
    reply = { status: 200, body: message('', 'refusal') };

    await expectUnavailable(copywriter().draft(REQUEST));
  });
});
