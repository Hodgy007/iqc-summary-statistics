// /api/insights: streamed AI summary through the Vercel AI Gateway

const mockStreamText = jest.fn();
jest.mock('ai', () => ({ streamText: (...args) => mockStreamText(...args) }));
jest.mock('../lib/auth.js', () => ({
  requireAuth: jest.fn().mockResolvedValue({ id: 1, email: 'a@lab', role: 'admin', permission: 'full_access' }),
}));

const { default: handler, describeInsightsError } = require('../api/insights.js');

process.env.AI_GATEWAY_API_KEY = 'test-key';

function createRes() {
  return {
    statusCode: null, headers: {}, chunks: [], ended: false,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(chunk) { this.chunks.push(chunk); },
    end() { this.ended = true; },
    get text() { return this.chunks.join(''); },
  };
}

const req = {
  method: 'POST',
  body: {
    resultsData: [{ parameter: 'Ca', level: '1', combined: { count: 20, mean: 2.3, cv: 1.2 } }],
    dateRange: '01/06/2026 to 30/06/2026',
  },
};

async function* chunks(...parts) { for (const p of parts) yield p; }

beforeEach(() => mockStreamText.mockReset());

test('streams the model text followed by the disclaimer', async () => {
  mockStreamText.mockReturnValue({ textStream: chunks('## Executive summary\n', 'All fine.') });
  const res = createRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.text).toMatch(/^## Executive summary\nAll fine\./);
  expect(res.text).toMatch(/## Disclaimer/);
  expect(res.ended).toBe(true);
});

test('does not send temperature (Claude Opus 4.7 rejects sampling parameters)', async () => {
  mockStreamText.mockReturnValue({ textStream: chunks('ok') });
  await handler(req, createRes());
  expect(mockStreamText.mock.calls[0][0]).not.toHaveProperty('temperature');
});

test('a gateway error reported via onError is shown to the user, not swallowed', async () => {
  // streamText reports provider errors through onError and ends the stream early
  mockStreamText.mockImplementation(opts => {
    const error = Object.assign(new Error('A positive credit balance is required'), { statusCode: 402 });
    return {
      textStream: (async function* () { opts.onError({ error }); })(),
    };
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = createRes();
  await handler(req, res);
  spy.mockRestore();
  expect(res.text).toMatch(/no credit/);
  expect(res.text).not.toMatch(/## Disclaimer/);
  expect(res.ended).toBe(true);
});

test('describeInsightsError maps status codes without exposing raw messages', () => {
  expect(describeInsightsError({ statusCode: 402 })).toMatch(/no credit/);
  expect(describeInsightsError({ cause: { statusCode: 401 } })).toMatch(/credentials/);
  expect(describeInsightsError({ statusCode: 429 })).toMatch(/rate limited/);
  const generic = describeInsightsError(new Error('secret internal detail'));
  expect(generic).toMatch(/could not generate/);
  expect(generic).not.toMatch(/secret/);
});
