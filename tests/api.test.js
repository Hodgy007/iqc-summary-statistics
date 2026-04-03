// API handler tests with mocked dependencies

// Mock neon
const mockSql = jest.fn();
jest.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));

// Mock bcryptjs
const mockCompare = jest.fn();
const mockHash = jest.fn();
jest.mock('bcryptjs', () => ({
  compare: (...args) => mockCompare(...args),
  hash: (...args) => mockHash(...args),
}));

// Mock jose
const mockJwtVerify = jest.fn();
const mockSign = jest.fn();
jest.mock('jose', () => ({
  jwtVerify: (...args) => mockJwtVerify(...args),
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: mockSign,
  })),
}));

// Set env vars
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

// Helper to create mock req/res
function createMockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader(key, val) { this.headers[key] = val; },
  };
  return res;
}

function createMockReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    body: {},
    query: {},
    ...overrides,
  };
}

// =============================================
// Auth: Login
// =============================================
describe('Login API', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Re-require after mock reset
    handler = require('../api/auth/login.js').default;
  });

  test('rejects non-POST methods', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('rejects missing email', async () => {
    const req = createMockReq({ method: 'POST', body: { password: 'test123' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('rejects missing password', async () => {
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('rejects invalid credentials', async () => {
    mockSql.mockResolvedValueOnce([]);
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'wrong' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('rejects wrong password', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'test@test.com', password_hash: 'hash', status: 'approved' }]);
    mockCompare.mockResolvedValueOnce(false);
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'wrong' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('rejects pending accounts with generic message to prevent timing oracle', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'test@test.com', password_hash: 'hash', status: 'pending' }]);
    mockCompare.mockResolvedValueOnce(true);
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'correct' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('rejects denied accounts with generic message to prevent timing oracle', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'test@test.com', password_hash: 'hash', status: 'denied' }]);
    mockCompare.mockResolvedValueOnce(true);
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'correct' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test('successful login sets HttpOnly cookie and returns user', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 1, email: 'test@test.com', password_hash: 'hash',
      status: 'approved', role: 'user', permission: 'view_only',
    }]);
    mockCompare.mockResolvedValueOnce(true);
    mockSign.mockResolvedValueOnce('jwt-token');

    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'correct' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('test@test.com');
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('Secure');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
  });
});

// =============================================
// Auth: Register
// =============================================
describe('Register API', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handler = require('../api/auth/register.js').default;
  });

  test('rejects non-POST methods', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('rejects short passwords', async () => {
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'short' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('8 characters');
  });

  test('rejects missing fields', async () => {
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('rejects duplicate email', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1 }]); // existing user found
    const req = createMockReq({ method: 'POST', body: { email: 'test@test.com', password: 'password123' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('already registered');
  });

  test('first user becomes admin with auto-login', async () => {
    mockSql.mockResolvedValueOnce([]); // no existing user
    mockSql.mockResolvedValueOnce([{ count: 0 }]); // first user
    mockHash.mockResolvedValueOnce('hashed');
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }]);
    mockSign.mockResolvedValueOnce('jwt-token');

    const req = createMockReq({ method: 'POST', body: { email: 'admin@test.com', password: 'password123' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('admin');
    expect(res.headers['Set-Cookie']).toContain('token=');
  });

  test('subsequent users are pending with view_only', async () => {
    mockSql.mockResolvedValueOnce([]); // no existing user with this email
    mockSql.mockResolvedValueOnce([{ count: 5 }]); // not first user
    mockHash.mockResolvedValueOnce('hashed');
    mockSql.mockResolvedValueOnce([{ id: 2, email: 'user@test.com', role: 'user', status: 'pending', permission: 'view_only' }]);

    const req = createMockReq({ method: 'POST', body: { email: 'user@test.com', password: 'password123' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.pending).toBe(true);
  });
});

// =============================================
// Auth: Logout
// =============================================
describe('Logout API', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handler = require('../api/auth/logout.js').default;
  });

  test('rejects non-POST methods', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('clears cookie on logout', async () => {
    const req = createMockReq({ method: 'POST' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });
});

// =============================================
// Auth: Me
// =============================================
describe('Me API', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handler = require('../api/auth/me.js').default;
  });

  test('rejects non-GET methods', async () => {
    const req = createMockReq({ method: 'POST' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  test('returns 401 without auth cookie', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('returns user data with valid auth', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'test@test.com', role: 'user', status: 'approved', permission: 'view_only' }]);

    const req = createMockReq({ method: 'GET', headers: { cookie: 'token=valid-jwt' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.user.email).toBe('test@test.com');
  });
});

// =============================================
// Admin: Users
// =============================================
describe('Admin Users API', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handler = require('../api/admin/users.js').default;
  });

  test('rejects unauthenticated requests', async () => {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  test('rejects non-admin users', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 2 } });
    mockSql.mockResolvedValueOnce([{ id: 2, email: 'user@test.com', role: 'user', status: 'approved', permission: 'view_only' }]);

    const req = createMockReq({ method: 'GET', headers: { cookie: 'token=valid-jwt' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  test('validates status values on PUT', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql
      .mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }])
      .mockResolvedValueOnce([{ role: 'user' }]) // target user
      .mockResolvedValueOnce([]); // update

    const req = createMockReq({
      method: 'PUT',
      headers: { cookie: 'token=admin-jwt' },
      body: { userId: 2, status: 'approved', permission: 'full_access' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  test('rejects PUT without userId', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }]);

    const req = createMockReq({
      method: 'PUT',
      headers: { cookie: 'token=admin-jwt' },
      body: { status: 'approved' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  test('rejects unsupported methods', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }]);

    const req = createMockReq({ method: 'DELETE', headers: { cookie: 'token=admin-jwt' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  test('prevents admin from modifying own account', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql.mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }]);

    const req = createMockReq({
      method: 'PUT',
      headers: { cookie: 'token=admin-jwt' },
      body: { userId: 1, status: 'denied' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Cannot modify your own account');
  });
});

// =============================================
// Reports: IDOR protection
// =============================================
describe('Reports IDOR Protection', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handler = require('../api/reports/[id].js').default;
  });

  test('prevents non-owner non-admin from deleting reports', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 2 } });
    mockSql
      .mockResolvedValueOnce([{ id: 2, email: 'user@test.com', role: 'user', status: 'approved', permission: 'full_access' }])
      .mockResolvedValueOnce([{ user_id: 1 }]); // report owned by user 1

    const req = createMockReq({
      method: 'DELETE',
      headers: { cookie: 'token=user-jwt' },
      query: { id: '5' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('own reports');
  });

  test('allows admin to delete any report', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 1 } });
    mockSql
      .mockResolvedValueOnce([{ id: 1, email: 'admin@test.com', role: 'admin', status: 'approved', permission: 'full_access' }])
      .mockResolvedValueOnce([{ user_id: 2 }]) // report owned by user 2
      .mockResolvedValueOnce([]); // delete

    const req = createMockReq({
      method: 'DELETE',
      headers: { cookie: 'token=admin-jwt' },
      query: { id: '5' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  test('allows owner to delete own report', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { id: 2 } });
    mockSql
      .mockResolvedValueOnce([{ id: 2, email: 'user@test.com', role: 'user', status: 'approved', permission: 'full_access' }])
      .mockResolvedValueOnce([{ user_id: 2 }]) // report owned by same user
      .mockResolvedValueOnce([]); // delete

    const req = createMockReq({
      method: 'DELETE',
      headers: { cookie: 'token=user-jwt' },
      query: { id: '5' },
    });
    const res = createMockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });
});
