const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/notifications - List user's notifications
router.get('/', (req, res) => {
  const stmt = db.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? 
    ORDER BY id DESC 
    LIMIT 100
  `);
  const notifications = stmt.all(req.user.id);
  res.json({ notifications });
});

// GET /api/notifications/unread-count
router.get('/unread-count', (req, res) => {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count 
    FROM notifications 
    WHERE user_id = ? AND is_read = 0
  `);
  const result = stmt.get(req.user.id);
  res.json({ unreadCount: result ? result.count : 0 });
});

// PUT /api/notifications/:id/read - Mark one as read
router.put('/:id/read', (req, res) => {
  const stmt = db.prepare(`
    UPDATE notifications 
    SET is_read = 1 
    WHERE id = ? AND user_id = ?
  `);
  stmt.run(req.params.id, req.user.id);
  res.json({ success: true });
});

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', (req, res) => {
  const stmt = db.prepare(`
    UPDATE notifications 
    SET is_read = 1 
    WHERE user_id = ?
  `);
  stmt.run(req.user.id);
  res.json({ success: true });
});

module.exports = router;
