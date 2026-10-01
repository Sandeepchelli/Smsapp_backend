const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * STRICT LOGIN ENDPOINT:
 * Accepts ONLY username and password.
 * NEVER accepts or requires a role parameter from the client.
 * Backend verifies credentials and automatically identifies the user's role from the database.
 */
router.post('/login', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { username, password } = req.body || {};

    // Enforce required fields
    if (!username || !password) {
      return res.status(400).json({ error: 'Username / ID and Password are required.' });
    }

    const cleanUsername = String(username).trim();

    // 1. Fetch user from database solely by username / ID
    const stmt = db.prepare(`
      SELECT id, name, username, password_hash, role, post, email, phone, is_active
      FROM users
      WHERE LOWER(username) = LOWER(?)
    `);
    const user = stmt.get(cleanUsername);

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid Username/ID or Password.' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'This account has been disabled. Please contact the administrator.' });
    }

    // 2. Verify password with bcrypt
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid Username/ID or Password.' });
    }

    // 3. Role is automatically read from the database (NEVER chosen by user)
    const userRole = user.role;
    const userPost = user.post;

    // 4. Issue secure JWT token encoding verified identity & role
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: userRole,
        name: user.name,
        post: userPost
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 5. Return token and verified user profile
    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: userRole,
        post: userPost,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error('Login route error:', err);
    return res.status(500).json({ error: 'Internal server error during authentication: ' + err.message });
  }
});

/**
 * Verify session and retrieve current user profile directly from DB.
 * Guarantees that if an Admin updates a role, subsequent requests immediately reflect the new role.
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

module.exports = router;
