import { jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [key, ...rest] = c.trim().split('=');
    cookies[key] = rest.join('=');
  });
  return cookies;
}

export async function requireAuth(req, res, options = {}) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.token;

  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    // Re-fetch user from DB for current status/permissions
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT id, email, role, status, permission FROM users WHERE id = ${payload.id}`;
    if (rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return null;
    }

    const user = rows[0];

    if (user.status !== 'approved') {
      res.status(403).json({ error: 'Account not approved' });
      return null;
    }

    if (options.role && user.role !== options.role) {
      res.status(403).json({ error: 'Insufficient role' });
      return null;
    }

    if (options.permission && user.role !== 'admin' && user.permission !== options.permission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return null;
    }

    return user;
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}
