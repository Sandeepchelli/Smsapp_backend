const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ─── ROLE MAPPING ──────────────────────────────────────────────────────────────
// Maps target audience labels to user roles in the DB
const AUDIENCE_ROLE_MAP = {
  'All': null, // null means everyone
  'Teacher': ['Teacher'],
  'Student': ['Student'],
  'Parent': ['Parent'],
  'Cashier': ['Cashier'],
  'Library Staff': ['Librarian', 'Library Staff'],
  'Librarian': ['Librarian', 'Library Staff'],
  'Driver': ['Driver'],
  'Watchman': ['Watchman'],
  'Attender': ['Attender', 'Attendant'],
  'Lab Technician': ['Lab Technician'],
  'Canteen Staff': ['Canteen', 'Canteen Staff'],
  'College Management Staff': ['Cashier', 'Librarian', 'Lab Technician', 'Driver', 'Watchman', 'Attender', 'Attendant', 'OfficeStaff', 'Canteen', 'Canteen Staff', 'Library Staff', 'Cleaner', 'Other']
};

/**
 * Check if a user should receive a notice based on target_audience and target_user_ids
 */
function isNoticeForUser(notice, userId, userRole) {
  // Specific user targeting
  if (notice.target_audience === 'Specific' && notice.target_user_ids) {
    try {
      const ids = JSON.parse(notice.target_user_ids);
      return ids.includes(userId);
    } catch {
      return false;
    }
  }

  // 'All' audience
  if (notice.target_audience === 'All') return true;

  // Role-based targeting
  const roles = AUDIENCE_ROLE_MAP[notice.target_audience];
  if (roles && roles.includes(userRole)) return true;

  return false;
}

// ─── GET MY NOTICES ────────────────────────────────────────────────────────────
// GET /api/notices - Get all notices visible to the current user
router.get('/', (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Get all notices
    const allNotices = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();

    // Filter notices the user should receive
    const myNotices = allNotices.filter(n => isNoticeForUser(n, userId, userRole));

    // Check which ones are read
    const readIds = new Set(
      db.prepare('SELECT notice_id FROM notice_reads WHERE user_id = ?').all(userId).map(r => r.notice_id)
    );

    const noticesWithReadStatus = myNotices.map(n => ({
      ...n,
      is_read: readIds.has(n.id)
    }));

    res.json({ notices: noticesWithReadStatus });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notices: ' + err.message });
  }
});

// GET /api/notices/unread-count - Count of unread notices for this user
router.get('/unread-count', (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const allNotices = db.prepare('SELECT id, target_audience, target_user_ids FROM notices').all();

    const myNoticeIds = allNotices
      .filter(n => isNoticeForUser(n, userId, userRole))
      .map(n => n.id);

    if (myNoticeIds.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const readIds = new Set(
      db.prepare('SELECT notice_id FROM notice_reads WHERE user_id = ?').all(userId).map(r => r.notice_id)
    );

    const unreadCount = myNoticeIds.filter(id => !readIds.has(id)).length;
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to count unread notices: ' + err.message });
  }
});

// PUT /api/notices/:id/read - Mark notice as read
router.put('/:id/read', (req, res) => {
  const noticeId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  try {
    db.prepare(`
      INSERT INTO notice_reads (notice_id, user_id) VALUES (?, ?)
      ON CONFLICT(notice_id, user_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP
    `).run(noticeId, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notice as read: ' + err.message });
  }
});

// PUT /api/notices/read-all - Mark all my notices as read
router.put('/read-all', (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const allNotices = db.prepare('SELECT id, target_audience, target_user_ids FROM notices').all();
    const myNoticeIds = allNotices
      .filter(n => isNoticeForUser(n, userId, userRole))
      .map(n => n.id);

    const insertRead = db.prepare(`
      INSERT INTO notice_reads (notice_id, user_id) VALUES (?, ?)
      ON CONFLICT(notice_id, user_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP
    `);

    db.exec('BEGIN TRANSACTION;');
    myNoticeIds.forEach(id => insertRead.run(id, userId));
    db.exec('COMMIT;');

    res.json({ success: true, markedCount: myNoticeIds.length });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'Failed to mark all as read: ' + err.message });
  }
});

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────────

// GET /api/notices/admin/all - Admin: view all notices they created
router.get('/admin/all', requireRole(['Admin']), (req, res) => {
  try {
    const notices = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();
    // Add read counts
    const enriched = notices.map(n => {
      const readCount = db.prepare('SELECT COUNT(*) as count FROM notice_reads WHERE notice_id = ?').get(n.id).count;
      return { ...n, read_count: readCount };
    });
    res.json({ notices: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin notices: ' + err.message });
  }
});

// POST /api/notices - Admin: Create a notice/announcement
router.post('/', requireRole(['Admin']), (req, res) => {
  const { title, description, priority, targetAudience, targetUserIds, attachmentUrl, noticeDate } = req.body;
  const createdBy = req.user.id;
  const createdByName = req.user.name;

  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required.' });
  }

  try {
    const date = noticeDate || new Date().toISOString().split('T')[0];
    const targetUserIdsJson = targetUserIds && targetUserIds.length > 0 ? JSON.stringify(targetUserIds) : null;

    const result = db.prepare(`
      INSERT INTO notices (title, description, priority, target_audience, target_user_ids, attachment_url, created_by, created_by_name, notice_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      description.trim(),
      priority || 'Normal',
      targetAudience || 'All',
      targetUserIdsJson,
      attachmentUrl || null,
      createdBy,
      createdByName,
      date
    );

    const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Notice published successfully.', notice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create notice: ' + err.message });
  }
});

// PUT /api/notices/:id - Admin: Edit a notice
router.put('/:id', requireRole(['Admin']), (req, res) => {
  const noticeId = req.params.id;
  const { title, description, priority, targetAudience, targetUserIds, attachmentUrl, noticeDate } = req.body;

  try {
    const notice = db.prepare('SELECT id FROM notices WHERE id = ?').get(noticeId);
    if (!notice) return res.status(404).json({ error: 'Notice not found.' });

    const targetUserIdsJson = targetUserIds && targetUserIds.length > 0 ? JSON.stringify(targetUserIds) : null;

    db.prepare(`
      UPDATE notices SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        priority = COALESCE(?, priority),
        target_audience = COALESCE(?, target_audience),
        target_user_ids = ?,
        attachment_url = ?,
        notice_date = COALESCE(?, notice_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title || null,
      description || null,
      priority || null,
      targetAudience || null,
      targetUserIdsJson,
      attachmentUrl || null,
      noticeDate || null,
      noticeId
    );

    const updated = db.prepare('SELECT * FROM notices WHERE id = ?').get(noticeId);
    res.json({ message: 'Notice updated.', notice: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notice: ' + err.message });
  }
});

// DELETE /api/notices/:id - Admin: Delete a notice
router.delete('/:id', requireRole(['Admin']), (req, res) => {
  const noticeId = req.params.id;
  try {
    const notice = db.prepare('SELECT id, title FROM notices WHERE id = ?').get(noticeId);
    if (!notice) return res.status(404).json({ error: 'Notice not found.' });

    db.prepare('DELETE FROM notice_reads WHERE notice_id = ?').run(noticeId);
    db.prepare('DELETE FROM notices WHERE id = ?').run(noticeId);

    res.json({ message: `Notice "${notice.title}" deleted.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notice: ' + err.message });
  }
});

// GET /api/notices/users-list - Admin: Get list of users for specific targeting
router.get('/users-list', requireRole(['Admin']), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, role, post, username
      FROM users
      WHERE role NOT IN ('Student', 'Parent') OR role = 'Student' OR role = 'Parent'
      ORDER BY role, name
    `).all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users list: ' + err.message });
  }
});

module.exports = router;
