const { getConnection } = require("../config/db.js");

// System controller for room booking: rooms, time slots, bookings

async function listRooms(req, res) {
  try {
    const con = await getConnection();
    const [rows] = await con.execute("SELECT room_id, room_name, room_description, created_by FROM rooms");
    res.json(rows);
  } catch (err) {
    console.error('listRooms error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function getRoom(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'room id is required' });
  try {
    const con = await getConnection();
    const [rows] = await con.execute("SELECT room_id, room_name, room_description, created_by FROM rooms WHERE room_id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('getRoom error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function createRoom(req, res) {
  const { room_name, room_description, created_by } = req.body;
  if (!room_name) return res.status(400).json({ error: 'room_name is required' });
  try {
    const con = await getConnection();
    const [result] = await con.execute(
      "INSERT INTO rooms (room_name, room_description, created_by) VALUES (?, ?, ?)",
      [room_name, room_description || null, created_by || null]
    );
    // after creating room, insert default 4 time slots for that room
    const roomId = result.insertId;
    const defaultSlots = ['08:00-10:00','10:00-12:00','13:00-15:00','15:00-17:00'];
    try {
      const placeholders = defaultSlots.map(() => '(?, ?)').join(', ');
      const params = [];
      defaultSlots.forEach((p) => { params.push(roomId, p); });
      await con.execute(`INSERT INTO time_slots (room_id, time_period) VALUES ${placeholders}`, params);
    } catch (slotErr) {
      console.error('createRoom - inserting default slots error:', slotErr);
      // not fatal for room creation; continue but warn
    }

    res.status(201).json({ room_id: roomId, room_name, room_description, created_by });
  } catch (err) {
    console.error('createRoom error:', err);
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Room name already exists' });
    }
    res.status(500).json({ error: 'Database error' });
  }
}

async function updateRoom(req, res) {
  const { id } = req.params;
  const { room_name, room_description } = req.body;
  if (!id) return res.status(400).json({ error: 'room id is required' });
  try {
    const con = await getConnection();
    const [result] = await con.execute(
      "UPDATE rooms SET room_name = COALESCE(?, room_name), room_description = COALESCE(?, room_description) WHERE room_id = ?",
      [room_name, room_description, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ message: 'Room updated' });
  } catch (err) {
    console.error('updateRoom error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function deleteRoom(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'room id is required' });
  try {
    const con = await getConnection();
    // ensure atomic delete: remove time_slots then room (DB has FK with cascade but play safe)
    await con.beginTransaction();
    await con.execute("DELETE FROM time_slots WHERE room_id = ?", [id]);
    const [result] = await con.execute("DELETE FROM rooms WHERE room_id = ?", [id]);
    if (result.affectedRows === 0) {
      await con.rollback();
      return res.status(404).json({ error: 'Room not found' });
    }
    await con.commit();
    res.json({ message: 'Room and its time slots deleted' });
  } catch (err) {
    console.error('deleteRoom error:', err);
    try {
      const con = await getConnection();
      await con.rollback();
    } catch (e) {
      // ignore rollback errors
    }
    res.status(500).json({ error: 'Database error' });
  }
}

async function listTimeSlots(req, res) {
  const roomId = req.params?.roomId || req.query?.roomId;
  if (!roomId) return res.status(400).json({ error: 'roomId is required' });
  try {
    const con = await getConnection();
    const [rows] = await con.execute("SELECT slot_id, room_id, time_period FROM time_slots WHERE room_id = ?", [roomId]);
    res.json(rows);
  } catch (err) {
    console.error('listTimeSlots error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function createBooking(req, res) {
  const { user_id, room_id, slot_id, booking_date, reason } = req.body;
  if (!user_id || !room_id || !slot_id || !booking_date) {
    return res.status(400).json({ error: 'user_id, room_id, slot_id and booking_date are required' });
  }
  try {
    const con = await getConnection();
    const [result] = await con.execute(
      "INSERT INTO booking_history (user_id, room_id, slot_id, booking_date, reason, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [user_id, room_id, slot_id, booking_date, reason || null]
    );
    res.status(201).json({ history_id: result.insertId, user_id, room_id, slot_id, booking_date, reason, status: 'pending' });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function listUserBookings(req, res) {
  const userId = req.params?.userId || req.query?.userId || req.body?.user_id;
  const userRole = req.query?.role;  // 'student', 'lecturer', or 'staff'
  if (!userId || !userRole) return res.status(400).json({ error: 'userId and role are required' });

  try {
    const con = await getConnection();
    let query = '';
    
    switch(userRole) {
      case 'student':
        // Students see: Room name, Date, Time slot, status, reject reason, approver name
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            bh.status,
            CASE 
              WHEN bh.status = 'rejected' THEN bh.reason
              ELSE NULL
            END as reject_reason,
            CASE 
              WHEN bh.approver_id IS NOT NULL THEN CONCAT(u_approver.username)
              ELSE NULL
            END as approver_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          LEFT JOIN users u_approver ON bh.approver_id = u_approver.user_id
          WHERE bh.user_id = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      case 'lecturer':
        // Lecturers see: Room name, Date, Time slot, status, reject reason, student name
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            bh.status,
            CASE 
              WHEN bh.status = 'rejected' THEN bh.reason
              ELSE NULL
            END as reject_reason,
            u_student.username as student_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          JOIN users u_student ON bh.user_id = u_student.user_id
          WHERE bh.approver_id = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      case 'staff':
        // Staff see: Room name, Date, Time slot, status, reject reason, approver name
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            bh.status,
            CASE 
              WHEN bh.status = 'rejected' THEN bh.reason
              ELSE NULL
            END as reject_reason,
            CASE 
              WHEN bh.approver_id IS NOT NULL THEN CONCAT(u_approver.username)
              ELSE NULL
            END as approver_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          LEFT JOIN users u_approver ON bh.approver_id = u_approver.user_id
          WHERE r.created_by = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid role specified' });
    }

    const [rows] = await con.execute(query, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('listUserBookings error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

async function approveBooking(req, res) {
  const { history_id } = req.params;
  const { approver_id, action } = req.body; // action: 'approved' or 'rejected'
  if (!history_id || !approver_id || !action) return res.status(400).json({ error: 'history_id, approver_id and action are required' });
  if (!['approved','rejected'].includes(action)) return res.status(400).json({ error: 'action must be approved or rejected' });
  try {
    const con = await getConnection();
    const [result] = await con.execute(
      "UPDATE booking_history SET status = ?, approver_id = ?, approved_at = CURRENT_TIMESTAMP WHERE history_id = ?",
      [action, approver_id, history_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: `Booking ${action}` });
  } catch (err) {
    console.error('approveBooking error:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  listTimeSlots,
  createBooking,
  listUserBookings,
  approveBooking,
};
