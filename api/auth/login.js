import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

// Simple in-memory rate limiter
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
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

    // Return same generic message for non-approved accounts to avoid timing oracle
    if (user.status !== 'approved') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({ id: user.id, email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);

    res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
    res.status(200).json({ success: true, user: { email: user.email, role: user.role, permission: user.permission } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
