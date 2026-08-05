// Single entry point for every /api/auth/* route.
//
// These were five separate files under api/, and Vercel turns every file in
// that directory into its own Serverless Function. The Hobby plan caps a
// deployment at 12, which this project had exceeded. Routing them through one
// dynamic route keeps the URLs identical while costing a single function; the
// handlers themselves live in lib/auth-routes/ so they stay out of the count.
import login from '../../lib/auth-routes/login.js';
import logout from '../../lib/auth-routes/logout.js';
import me from '../../lib/auth-routes/me.js';
import register from '../../lib/auth-routes/register.js';
import changePassword from '../../lib/auth-routes/change-password.js';

const ROUTES = {
  'login': login,
  'logout': logout,
  'me': me,
  'register': register,
  'change-password': changePassword,
};

export default async function handler(req, res) {
  const { action } = req.query;
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
  if (!route) return res.status(404).json({ error: 'Not found' });
  return route(req, res);
}
