import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// ---------- Configuration ----------
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not defined.');
  process.exit(1);
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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided.' });
  }
  const token = authHeader.split(' ')[1];
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
  const { username, password } = req.body;

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required.' });
  }

  const expectedUser = process.env.APP_USER;
  const storedHash = process.env.APP_PASSWORD_HASH;

  if (!expectedUser || !storedHash) {
    console.error('Missing APP_USER or APP_PASSWORD_HASH in env.');
    return res.status(500).json({ success: false, error: 'Server config error.' });
  }

  if (username !== expectedUser) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }

  const isValid = await verifyPassword(password, storedHash);
  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }

  const token = generateToken({ username });
  res.json({ success: true, token });
});

// Example protected route – you can also mount it separately
router.get('/profile', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Export the router as default
export default router;