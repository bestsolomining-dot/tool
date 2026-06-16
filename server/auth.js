import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import express from 'express';

// ---------- Configuration ----------
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev-only';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not defined.');
}

// ---------- Utility exports ----------
export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
};

export const authMiddleware = (req, res, next) => {
  let token = '';
  const authHeader = req.headers?.authorization;

  // 1. Check Authorization Header (Bearer Token)
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. Fallback to Query Parameter (essential for WebSocket handshakes)
  if (!token && req.query?.token) {
    token = String(req.query.token);
  } else if (!token && req.url && req.url.includes('token=')) {
    // Robust manual extraction if req.query isn't populated yet during upgrade
    const match = req.url.match(/[?&]token=([^&]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided.' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
  }
  req.user = decoded;
  next();
};

export const hashPassword = async (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = async (plain, hash) => bcrypt.compare(plain, hash);

// ---------- Default Router (mountable) ----------
const router = express.Router();

// Login route (using the utilities above)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Basic validation
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required.' });
    }

    const expectedUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    if (!expectedUser || !adminPass) {
      console.error('❌ Login Failed: ADMIN_USER or ADMIN_PASS is undefined in process.env');
      return res.status(500).json({ success: false, error: 'Server configuration error: Authentication credentials are not set.' });
    }

    if (username !== expectedUser) {
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    // Support both plain text and bcrypt hashes for convenience
    let isValid = false;
    if (adminPass.startsWith('$2')) {
      isValid = await verifyPassword(password, adminPass);
    } else {
      isValid = (password === adminPass);
    }

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    }

    const token = generateToken({ username });
    res.json({ success: true, token });
  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error during login.' });
  }
});

// Example protected route – you can also mount it separately
router.get('/profile', (req, res) => {
  res.json({ user: req.user });
});

// Export the router as default
export default router;