const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

/**
 * GET /api/staff/me/attendance
 * Staff member views their own attendance records.
 * Optional query: ?month=YYYY-MM  or  ?year=YYYY
 */
router.get("/me/attendance", (req, res) => {
  const userId = req.user.id;
  const { month, year } = req.query;

  let query = "SELECT * FROM staff_attendance WHERE staff_id = ?";
  const params = [userId];

  if (month) {
    query += " AND date LIKE ?";
    params.push(`${month}%`);
  } else if (year) {
    query += " AND date LIKE ?";
    params.push(`${year}%`);
  }

  query += " ORDER BY date DESC";

  try {
    const records = db.prepare(query).all(...params);

    const present = records.filter(r => r.status === "Present").length;
    const absent = records.filter(r => r.status === "Absent").length;
    const leave = records.filter(r => r.status === "Leave").length;
    const halfDay = records.filter(r => r.status === "Half-Day").length;

    res.json({
      attendance: records,
      summary: { total: records.length, present, absent, leave, halfDay }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch attendance: " + err.message });
  }
});

/**
 * GET /api/staff/me/profile
 * Staff member fetches their own full profile.
 */
router.get("/me/profile", (req, res) => {
  const user = db.prepare(
    "SELECT id, name, username, role, post, email, phone, employee_id, department, profile_photo, is_active, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
});

module.exports = router;
