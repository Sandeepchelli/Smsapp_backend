const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * Check if initial setup is complete (i.e. at least 1 user exists in database)
 */
router.get('/setup-status', (req, res) => {
  try {
    const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;
    res.json({
      isSetup: userCount > 0,
      userCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check setup status: ' + err.message });
  }
});

/**
 * First-time setup endpoint: Create the initial Principal / Administrator account.
 * Only allowed when 0 users exist in the database.
 */
router.post('/setup-admin', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;
    if (userCount > 0) {
      return res.status(403).json({ error: 'Initial administrator account already exists. Please log in.' });
    }

    const { name, username, password, email, phone, post, department } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, Username / ID, and Password are required.' });
    }

    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, post, email, phone, employee_id, department, is_active)
      VALUES (?, ?, ?, 'Admin', ?, ?, ?, 'PRIN-001', ?, 1)
    `).run(
      name.trim(),
      cleanUsername,
      hash,
      post ? post.trim() : 'Principal & Head Administrator',
      email ? email.trim() : null,
      phone ? phone.trim() : null,
      department ? department.trim() : 'Administration'
    );

    const newUserId = result.lastInsertRowid;
    const user = db.prepare(`
      SELECT id, name, username, role, post, email, phone
      FROM users WHERE id = ?
    `).get(newUserId);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        post: user.post
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(201).json({
      message: 'Principal / Administrator account created successfully.',
      token,
      user
    });
  } catch (err) {
    console.error('Setup admin error:', err);
    return res.status(500).json({ error: 'Failed to initialize administrator: ' + err.message });
  }
});

/**
 * STRICT LOGIN ENDPOINT:
 * Accepts ONLY username and password.
 * NEVER accepts or requires a role parameter from the client.
 * Backend verifies credentials against database and automatically identifies the user's role.
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

    // 2. Verify password with bcrypt against stored hash in database
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid Username/ID or Password.' });
    }

    // 3. Role is automatically read from the database
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
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

module.exports = router;
