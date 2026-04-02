import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      return res.status(201).json({ success: true, user: { email: user.email, role: user.role, permission: user.permission } });
    }

    res.status(201).json({ success: true, pending: true, message: 'Account created. Awaiting admin approval.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
