const express = require('express');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// 1. GET /api/canteen/menu - Get all food items
router.get('/menu', (req, res) => {
  const { category, search } = req.query;
  let query = 'SELECT * FROM canteen_items WHERE 1=1';
  const params = [];

  if (category && category !== 'All') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }

  query += ' ORDER BY category ASC, name ASC';
  const items = db.prepare(query).all(...params);
  res.json({ items });
});

// 2. POST /api/canteen/items - Staff / Admin adds a new food item
router.post('/items', requireRole(['Canteen', 'Admin']), (req, res) => {
  const { name, description, price, category = 'Main Course', imageUrl, isAvailable = 1 } = req.body;

  if (!name || price === undefined || price === null) {
    return res.status(400).json({ error: 'Food item name and price are required.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO canteen_items (name, description, price, category, image_url, is_available)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      description || null,
      parseFloat(price),
      category,
      imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
      isAvailable ? 1 : 0
    );

    res.status(201).json({
      message: `Food item '${name}' added to canteen menu!`,
      itemId: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add food item: ' + err.message });
  }
});

// 3. PUT /api/canteen/items/:id - Staff / Admin edits food item
router.put('/items/:id', requireRole(['Canteen', 'Admin']), (req, res) => {
  const itemId = req.params.id;
  const { name, description, price, category, imageUrl, isAvailable } = req.body;

  try {
    const current = db.prepare('SELECT * FROM canteen_items WHERE id = ?').get(itemId);
    if (!current) return res.status(404).json({ error: 'Food item not found.' });

    db.prepare(`
      UPDATE canteen_items
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          price = COALESCE(?, price),
          category = COALESCE(?, category),
          image_url = COALESCE(?, image_url),
          is_available = COALESCE(?, is_available),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      description !== undefined ? description : null,
      price !== undefined ? parseFloat(price) : null,
      category || null,
      imageUrl || null,
      isAvailable !== undefined ? (isAvailable ? 1 : 0) : null,
      itemId
    );

    res.json({ message: 'Food item updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update food item: ' + err.message });
  }
});

// 4. DELETE /api/canteen/items/:id - Staff / Admin deletes food item
router.delete('/items/:id', requireRole(['Canteen', 'Admin']), (req, res) => {
  const itemId = req.params.id;
  try {
    db.prepare('DELETE FROM canteen_items WHERE id = ?').run(itemId);
    res.json({ message: 'Food item deleted from menu.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item: ' + err.message });
  }
});

// 5. POST /api/canteen/orders - Student places an order
router.post('/orders', requireRole(['Student']), (req, res) => {
  const student = db.prepare(`
    SELECT s.id, u.name as student_name, c.name as class_name
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN classes c ON s.class_id = c.id
    WHERE s.user_id = ?
  `).get(req.user.id);

  if (!student) {
    return res.status(404).json({ error: 'Student record not found.' });
  }

  const { items, orderNotes, paymentMode = 'Campus Card / Cash' } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Please select at least one item to place an order.' });
  }

  try {
    // Calculate total and prepare items
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of items) {
      const dbItem = db.prepare('SELECT * FROM canteen_items WHERE id = ?').get(item.itemId);
      if (!dbItem) {
        return res.status(400).json({ error: `Item with ID ${item.itemId} not found in menu.` });
      }
      if (!dbItem.is_available) {
        return res.status(400).json({ error: `'${dbItem.name}' is currently unavailable.` });
      }

      const qty = parseInt(item.quantity, 10) || 1;
      const subtotal = dbItem.price * qty;
      totalAmount += subtotal;

      validatedItems.push({
        itemId: dbItem.id,
        itemName: dbItem.name,
        price: dbItem.price,
        quantity: qty,
        subtotal
      });
    }

    const orderNumber = 'ORD-' + Date.now().toString().slice(-6);

    const result = db.prepare(`
      INSERT INTO canteen_orders (order_number, student_id, student_name, class_name, total_amount, status, payment_mode, order_notes)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
    `).run(orderNumber, student.id, student.student_name, student.class_name, totalAmount, paymentMode, orderNotes || null);

    const orderId = result.lastInsertRowid;

    const insertOrderItem = db.prepare(`
      INSERT INTO canteen_order_items (order_id, item_id, item_name, price_per_item, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const v of validatedItems) {
      insertOrderItem.run(orderId, v.itemId, v.itemName, v.price, v.quantity, v.subtotal);
    }

    // Insert notification
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'CANTEEN_ORDER')
    `).run(
      req.user.id,
      `Canteen Order Placed: #${orderNumber}`,
      `Your food order #${orderNumber} for ₹${totalAmount} has been received by the Canteen counter and is currently Pending confirmation.`
    );

    res.status(201).json({
      message: `Order #${orderNumber} placed successfully! Total: ₹${totalAmount}`,
      orderId,
      orderNumber,
      totalAmount
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to place order: ' + err.message });
  }
});

// 6. GET /api/canteen/my-orders - Logged-in student's orders
router.get('/my-orders', requireRole(['Student']), (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(404).json({ error: 'Student record not found.' });

  const orders = db.prepare(`
    SELECT * FROM canteen_orders
    WHERE student_id = ?
    ORDER BY id DESC
  `).all(student.id);

  const ordersWithItems = orders.map(o => {
    const items = db.prepare('SELECT * FROM canteen_order_items WHERE order_id = ?').all(o.id);
    return { ...o, items };
  });

  res.json({ orders: ordersWithItems });
});

// 7. GET /api/canteen/all-orders - Canteen Staff / Admin order desk
router.get('/all-orders', requireRole(['Canteen', 'Admin']), (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM canteen_orders WHERE 1=1';
  const params = [];

  if (status && status !== 'All') {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY id DESC';
  const orders = db.prepare(query).all(...params);

  const ordersWithItems = orders.map(o => {
    const items = db.prepare('SELECT * FROM canteen_order_items WHERE order_id = ?').all(o.id);
    return { ...o, items };
  });

  res.json({ orders: ordersWithItems });
});

// 8. PUT /api/canteen/orders/:id/status - Update order status (Pending -> Confirmed -> Preparing -> Ready -> Completed)
router.put('/orders/:id/status', requireRole(['Canteen', 'Admin']), (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const order = db.prepare(`
      SELECT o.*, s.user_id as student_user_id
      FROM canteen_orders o
      JOIN students s ON o.student_id = s.id
      WHERE o.id = ?
    `).get(orderId);

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    db.prepare(`
      UPDATE canteen_orders
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, orderId);

    // Notify student of order status change
    let statusMsg = `Your canteen order #${order.order_number} is now marked as ${status}.`;
    if (status === 'Ready') {
      statusMsg = `🔔 Token #${order.order_number} is READY! Please collect your hot food from the Canteen counter.`;
    } else if (status === 'Preparing') {
      statusMsg = `🍳 Chef is now preparing your food order #${order.order_number}.`;
    }

    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'CANTEEN_STATUS')
    `).run(order.student_user_id, `Canteen Order Status: ${status}`, statusMsg);

    res.json({ message: `Order #${order.order_number} updated to ${status}.`, status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status: ' + err.message });
  }
});

module.exports = router;
