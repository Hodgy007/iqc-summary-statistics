import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { logActivity } from '../lib/activity.js';

// Simple in-memory rate limiter
const registerAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const record = registerAttempts.get(ip);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    registerAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    // Check if email already exists
    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
    if (existing.length > 0) return res.status(400).json({ error: 'Email already registered' });

    // Check if this is the first user (becomes admin)
    const count = await sql`SELECT COUNT(*)::int as count FROM users`;
    const isFirst = count[0].count === 0;

    const password_hash = await bcrypt.hash(password, 10);
    const role = isFirst ? 'admin' : 'user';
    const status = isFirst ? 'approved' : 'pending';
    const permission = isFirst ? 'full_access' : 'view_only';

    const rows = await sql`
      INSERT INTO users (email, password_hash, role, status, permission)
      VALUES (${email.toLowerCase()}, ${password_hash}, ${role}, ${status}, ${permission})
      RETURNING id, email, role, status, permission
    `;
    const user = rows[0];

    if (isFirst) {
      // Auto-login the first admin
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const token = await new SignJWT({ id: user.id, email: user.email })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('7d')
        .sign(secret);

      res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      logActivity(user.id, 'register', 'First user registered as admin');
      return res.status(201).json({ success: true, user: { email: user.email, role: user.role, permission: user.permission } });
    }

    await logActivity(user.id, 'register', 'New user registered (pending approval)');
    res.status(201).json({ success: true, pending: true, message: 'Account created. Awaiting admin approval.' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
