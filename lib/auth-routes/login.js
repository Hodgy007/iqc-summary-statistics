import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { logActivity } from '../activity.js';

// Simple in-memory rate limiter
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  // Prune expired entries so the map can't grow unboundedly in a warm instance
  for (const [key, rec] of loginAttempts) {
    if (now - rec.firstAttempt > WINDOW_MS) loginAttempts.delete(key);
  }
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // Denied accounts get the same generic message as a wrong password, so a
    // caller cannot distinguish "denied" from "does not exist". Pending
    // accounts, however, are issued a session so the client can show the
    // "Account Pending" screen (requireAuth still blocks every data endpoint
    // for a non-approved user). This only reveals pending state to someone who
    // already holds the correct password, which registration already discloses.
    if (user.status !== 'approved' && user.status !== 'pending') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({ id: user.id, email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);

    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);

    if (user.status === 'pending') {
      await logActivity(user.id, 'login', 'Signed in (pending approval)');
      return res.status(200).json({ success: true, pending: true, user: { email: user.email, role: user.role, permission: user.permission } });
    }

    await logActivity(user.id, 'login', `Signed in`);
    res.status(200).json({ success: true, user: { email: user.email, role: user.role, permission: user.permission } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
