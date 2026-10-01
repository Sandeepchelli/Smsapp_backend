const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// 1. GET /api/library/books - List all books (Public to authenticated users)
router.get('/books', (req, res) => {
  const { search, category } = req.query;
  let query = 'SELECT * FROM books WHERE 1=1';
  const params = [];

  if (category && category !== 'All') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (title LIKE ? OR author LIKE ? OR book_code LIKE ? OR category LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY title ASC';

  const books = db.prepare(query).all(...params);
  res.json({ books });
});

// 2. GET /api/library/my-books - Student's borrowed books
router.get('/my-books', requireRole(['Student', 'Admin']), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const loans = db.prepare(`
    SELECT bl.*, b.book_code, b.title as book_title, b.author, b.category, b.shelf_location,
           u.name as issued_by_name
    FROM book_loans bl
    JOIN books b ON bl.book_id = b.id
    LEFT JOIN users u ON bl.issued_by = u.id
    WHERE bl.student_id = ?
    ORDER BY bl.id DESC
  `).all(student.id);

  const activeLoans = loans.filter(l => l.status === 'ISSUED');
  const pastLoans = loans.filter(l => l.status === 'RETURNED');

  res.json({
    activeLoans,
    pastLoans,
    totalBorrowed: loans.length
  });
});

// 3. GET /api/library/ward-books - Parent's linked ward borrowed books
router.get('/ward-books', requireRole(['Parent', 'Admin']), (req, res) => {
  const parentId = req.user.id;
  let student = db.prepare(`
    SELECT s.id, u.name as student_name, s.roll_no, c.name as class_name
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    WHERE s.parent_id = ?
  `).get(parentId);

  if (!student && req.user.role === 'Admin') {
    student = db.prepare(`
      SELECT s.id, u.name as student_name, s.roll_no, c.name as class_name
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN classes c ON s.class_id = c.id
      LIMIT 1
    `).get();
  }

  if (!student) return res.status(404).json({ error: 'No linked ward found.' });

  const loans = db.prepare(`
    SELECT bl.*, b.book_code, b.title as book_title, b.author, b.category, b.shelf_location
    FROM book_loans bl
    JOIN books b ON bl.book_id = b.id
    WHERE bl.student_id = ?
    ORDER BY bl.id DESC
  `).all(student.id);

  res.json({
    ward: student,
    loans
  });
});

// 4. GET /api/library/active-loans - Librarian/Admin view of all active loans
router.get('/active-loans', requireRole(['Librarian', 'Admin', 'Teacher']), (req, res) => {
  const { status = 'ISSUED', search } = req.query;
  let query = `
    SELECT bl.*, b.book_code, b.title as book_title, b.author, b.category, b.shelf_location,
           u.name as student_name, s.roll_no, c.name as class_name,
           p.name as parent_name, p.phone as parent_phone
    FROM book_loans bl
    JOIN books b ON bl.book_id = b.id
    JOIN students s ON bl.student_id = s.id
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'All') {
    query += ' AND bl.status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (b.title LIKE ? OR b.book_code LIKE ? OR u.name LIKE ? OR s.roll_no LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY bl.id DESC';

  const loans = db.prepare(query).all(...params);
  res.json({ loans });
});

// 5. POST /api/library/books - Librarian/Admin adds book
router.post('/books', requireRole(['Librarian', 'Admin']), (req, res) => {
  const { bookCode, title, author, category, isbn, totalQty = 1, shelfLocation, description, imageUrl } = req.body;

  if (!bookCode || !title || !author || !category) {
    return res.status(400).json({ error: 'Book code, title, author, and category are required.' });
  }

  const qty = parseInt(totalQty, 10) || 1;

  try {
    const stmt = db.prepare(`
      INSERT INTO books (book_code, title, author, category, isbn, total_qty, available_qty, borrowed_qty, shelf_location, description, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const result = stmt.run(
      bookCode.trim(),
      title.trim(),
      author.trim(),
      category.trim(),
      isbn || null,
      qty,
      qty,
      shelfLocation || null,
      description || null,
      imageUrl || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300'
    );

    res.status(201).json({ message: `Book '${title}' cataloged successfully.`, bookId: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Failed to add book: ' + err.message });
  }
});

// 6. PUT /api/library/books/:id - Librarian/Admin updates book
router.put('/books/:id', requireRole(['Librarian', 'Admin']), (req, res) => {
  const { bookCode, title, author, category, isbn, totalQty, shelfLocation, description, imageUrl } = req.body;
  const bookId = req.params.id;

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  const newTotal = parseInt(totalQty, 10) || book.total_qty;
  const newAvailable = Math.max(0, newTotal - (book.borrowed_qty || 0));

  try {
    db.prepare(`
      UPDATE books
      SET book_code = COALESCE(?, book_code),
          title = COALESCE(?, title),
          author = COALESCE(?, author),
          category = COALESCE(?, category),
          isbn = COALESCE(?, isbn),
          total_qty = ?,
          available_qty = ?,
          shelf_location = COALESCE(?, shelf_location),
          description = COALESCE(?, description),
          image_url = COALESCE(?, image_url)
      WHERE id = ?
    `).run(
      bookCode ? bookCode.trim() : null,
      title ? title.trim() : null,
      author ? author.trim() : null,
      category || null,
      isbn || null,
      newTotal,
      newAvailable,
      shelfLocation || null,
      description || null,
      imageUrl || null,
      bookId
    );

    res.json({ message: 'Book details updated successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update book: ' + err.message });
  }
});


// 7. POST /api/library/issue - Librarian issues book to student
router.post('/issue', requireRole(['Librarian', 'Admin']), (req, res) => {
  const { bookId, studentId, dueDate } = req.body;
  const librarianId = req.user.id;

  if (!bookId || !studentId || !dueDate) {
    return res.status(400).json({ error: 'bookId, studentId, and dueDate are required.' });
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  if (book.available_qty <= 0) {
    return res.status(400).json({ error: 'Book is currently out of stock (Zero available copies).' });
  }

  const student = db.prepare(`
    SELECT s.*, u.name as student_name, s.user_id as student_user_id, p.id as parent_user_id
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN users p ON s.parent_id = p.id
    WHERE s.id = ?
  `).get(studentId);

  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const issueDate = new Date().toISOString().split('T')[0];

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Decrement available, increment borrowed
    db.prepare(`
      UPDATE books
      SET available_qty = available_qty - 1, borrowed_qty = borrowed_qty + 1
      WHERE id = ?
    `).run(bookId);

    // 2. Insert book loan record
    db.prepare(`
      INSERT INTO book_loans (book_id, student_id, issue_date, due_date, status, issued_by)
      VALUES (?, ?, ?, ?, 'ISSUED', ?)
    `).run(bookId, studentId, issueDate, dueDate, librarianId);

    // 3. Notify student and parent
    const insertNotif = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
    const notifMsg = `Library Book Issued: "${book.title}" (${book.book_code}).\nIssue Date: ${issueDate} | Return Due Date: ${dueDate}.\nPlease return the book on or before the due date to avoid overdue fines.`;

    insertNotif.run(student.user_id, 'Library Book Issued', notifMsg, 'LIBRARY_LOAN');
    if (student.parent_id) {
      insertNotif.run(student.parent_id, `Library Book Issued: ${student.student_name}`, notifMsg, 'LIBRARY_LOAN');
    }

    db.exec('COMMIT;');
    res.json({ message: `Book "${book.title}" successfully issued to ${student.student_name}. Due Date: ${dueDate}` });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'Failed to issue book: ' + err.message });
  }
});

// 8. POST /api/library/return - Librarian records book return
router.post('/return', requireRole(['Librarian', 'Admin']), (req, res) => {
  const { loanId, fineAmount = 0 } = req.body;

  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });

  const loan = db.prepare(`
    SELECT bl.*, b.title as book_title, b.id as book_id, s.user_id as student_user_id
    FROM book_loans bl
    JOIN books b ON bl.book_id = b.id
    JOIN students s ON bl.student_id = s.id
    WHERE bl.id = ?
  `).get(loanId);

  if (!loan) return res.status(404).json({ error: 'Loan record not found.' });
  if (loan.status === 'RETURNED') return res.status(400).json({ error: 'Book already marked as returned.' });

  const returnDate = new Date().toISOString().split('T')[0];

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Update loan status
    db.prepare(`
      UPDATE book_loans
      SET status = 'RETURNED', return_date = ?, fine_amount = ?
      WHERE id = ?
    `).run(returnDate, parseFloat(fineAmount) || 0, loanId);

    // 2. Increment available, decrement borrowed
    db.prepare(`
      UPDATE books
      SET available_qty = available_qty + 1, borrowed_qty = MAX(0, borrowed_qty - 1)
      WHERE id = ?
    `).run(loan.book_id);

    // 3. Notify student
    const insertNotif = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
    insertNotif.run(
      loan.student_user_id,
      'Library Book Returned',
      `You returned "${loan.book_title}" on ${returnDate}. Thank you!`,
      'LIBRARY_LOAN'
    );

    db.exec('COMMIT;');
    res.json({ message: `Book "${loan.book_title}" successfully marked as returned on ${returnDate}.` });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ error: 'Failed to process return: ' + err.message });
  }
});

// 9. DELETE /api/library/books/:id - Admin deletes book record
router.delete('/books/:id', requireRole(['Admin']), (req, res) => {
  const bookId = req.params.id;

  const activeLoanCount = db.prepare(`
    SELECT COUNT(*) as count FROM book_loans WHERE book_id = ? AND status = 'ISSUED'
  `).get(bookId).count;

  if (activeLoanCount > 0) {
    return res.status(400).json({
      error: `Cannot delete book. There are ${activeLoanCount} active borrowed copies outstanding. Please return them first.`
    });
  }

  db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  res.json({ message: 'Book deleted from catalog successfully.' });
});

module.exports = router;
