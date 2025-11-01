const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt"); // For addLecturer and changePassword

// System controller for room booking: rooms, time slots, bookings

async function listRooms(req, res) {
  let con;
  try {
    con = await getConnection();
    const [rows] = await con.execute(
      "SELECT room_id, room_name, room_description, created_by, status FROM rooms"
    );
    res.json(rows);
  } catch (err) {
    console.error("listRooms error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function getRoom(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "room id is required" });
  let con;
  try {
    con = await getConnection();
    const [rows] = await con.execute(
      "SELECT room_id, room_name, room_description, created_by, status FROM rooms WHERE room_id = ?",
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Room not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("getRoom error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function createRoom(req, res) {
  const { room_name, room_description, created_by, status } = req.body;

  if (!room_name)
    return res.status(400).json({ error: "room_name is required" });
  if (!status)
    return res.status(400).json({ error: "status is required" });
  if (!["Available", "Disable"].includes(status))
    return res.status(400).json({ error: "Invalid status value" });

  let con;
  try {
    con = await getConnection();
    const [result] = await con.execute(
      "INSERT INTO rooms (room_name, room_description, created_by, status) VALUES (?, ?, ?, ?)",
      [
        room_name,
        room_description || null,
        created_by || null,
        status,
      ]
    );

    const roomId = result.insertId;
    const defaultSlots = [
      "08:00-10:00",
      "10:00-12:00",
      "13:00-15:00",
      "15:00-17:00",
    ];
    try {
      const params = [];
      const placeholders = defaultSlots.map(() => "(?, ?, ?)").join(", ");
      defaultSlots.forEach((p) => {
        params.push(roomId, p, "Free");
      });
      await con.execute(
        `INSERT INTO time_slots (room_id, time_period, status) VALUES ${placeholders}`,
        params
      );
    } catch (slotErr) {
      console.error("createRoom - inserting default slots error:", slotErr);
    }

    res.status(201).json({
      room_id: roomId,
      room_name,
      room_description,
      created_by,
      status,
    });
  } catch (err) {
    console.error("createRoom error:", err);
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Room name already exists" });
    }
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function updateRoom(req, res) {
  const { id } = req.params;
  const { room_name, room_description, status } = req.body;
  if (!id) return res.status(400).json({ error: "room id is required" });

  if (status && !["Available", "Disable"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  let con;
  try {
    con = await getConnection();
    const [result] = await con.execute(
      "UPDATE rooms SET room_name = COALESCE(?, room_name), room_description = COALESCE(?, room_description), status = COALESCE(?, status) WHERE room_id = ?",
      [
        room_name,
        room_description,
        status,
        id,
      ]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Room not found" });
    res.json({ message: "Room updated" });
  } catch (err) {
    console.error("updateRoom error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function deleteRoom(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "room id is required" });
  let con;
  try {
    con = await getConnection();
    await con.beginTransaction();
    await con.execute("DELETE FROM time_slots WHERE room_id = ?", [id]);
    const [result] = await con.execute("DELETE FROM rooms WHERE room_id = ?", [
      id,
    ]);
    if (result.affectedRows === 0) {
      await con.rollback();
      return res.status(404).json({ error: "Room not found" });
    }
    await con.commit();
    res.json({ message: "Room and its time slots deleted" });
  } catch (err) {
    console.error("deleteRoom error:", err);
    try {
      if (con) await con.rollback();
    } catch (e) {
      console.error("Rollback error:", e);
    }
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function listTimeSlots(req, res) {
  const roomId = req.params?.roomId || req.query?.roomId;
  if (!roomId) return res.status(400).json({ error: "roomId is required" });
  let con;
  try {
    con = await getConnection();
    const [rows] = await con.execute(
      "SELECT slot_id, room_id, time_period, status as time_slot_status FROM time_slots WHERE room_id = ?",
      [roomId]
    );
    res.json(rows);
  } catch (err) {
    console.error("listTimeSlots error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function createBooking(req, res) {
  const { user_id, room_id, slot_id, booking_date, reason } = req.body;
  if (!user_id || !room_id || !slot_id || !booking_date) {
    return res
      .status(400)
      .json({
        error: "user_id, room_id, slot_id and booking_date are required",
      });
  }

  let con;
  try {
    con = await getConnection();

    const [existingBookings] = await con.execute(
      "SELECT history_id FROM booking_history WHERE user_id = ? AND booking_date = ? AND (status = 'pending' OR status = 'approved')",
      [user_id, booking_date]
    );

    if (existingBookings.length > 0) {
      return res
        .status(409)
        .json({ error: "You already have an active or approved booking for this date. You can only make a new request if your previous one is rejected." });
    }

    await con.beginTransaction();

    const [result] = await con.execute(
      "INSERT INTO booking_history (user_id, room_id, slot_id, booking_date, reason, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [user_id, room_id, slot_id, booking_date, reason || null]
    );

    await con.execute(
      "UPDATE time_slots SET status = 'Pending' WHERE slot_id = ?",
      [slot_id]
    );

    await con.commit();

    res
      .status(201)
      .json({
        history_id: result.insertId,
        user_id,
        room_id,
        slot_id,
        booking_date,
        reason,
        status: "pending",
      });
  } catch (err) {
    console.error("createBooking error:", err);
    if (con) {
      try {
        await con.rollback();
      } catch (rollBackErr) {
        console.error("createBooking rollback error:", rollBackErr);
      }
    }
    res.status(500).json({ error: "Database error during booking" });
  } finally {
    if (con) con.release();
  }
}

async function listUserBookings(req, res) {
  const userId = req.params?.userId || req.query?.userId || req.body?.user_id;
  const userRole = req.query?.role;
  if (!userId || !userRole)
    return res.status(400).json({ error: "userId and role are required" });

  let con;
  try {
    con = await getConnection();
    let query = "";
    let params = [userId]; // Default params

    switch (userRole) {
      case "student":
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            ts.status as time_slot_status,
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

      case "lecturer":
        // This query is for "pending requests" for a lecturer
        // It joins users to get the student name
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            ts.status as time_slot_status,
            bh.status,
            u_student.username as student_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          JOIN users u_student ON bh.user_id = u_student.user_id
          WHERE bh.status = 'pending'
          ORDER BY bh.booking_date ASC, ts.time_period`;
        params = []; // No userId needed for this query
        break;

      case "staff":
        // Staff see: Room name, Date, Time slot, status, student name, etc.
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            bh.booking_date,
            ts.time_period,
            ts.status as time_slot_status,
            bh.status,
            u_student.username as student_name,
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
          JOIN users u_student ON bh.user_id = u_student.user_id
          WHERE r.created_by = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      default:
        return res.status(400).json({ error: "Invalid role specified" });
    }

    const [rows] = await con.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("listUserBookings error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function approveBooking(req, res) {
  const { history_id } = req.params;
  const { approver_id, action, reason } = req.body; // Added 'reason'
  if (!history_id || !approver_id || !action)
    return res
      .status(400)
      .json({ error: "history_id, approver_id and action are required" });
  if (!["approved", "rejected"].includes(action))
    return res
      .status(400)
      .json({ error: "action must be approved or rejected" });
  if (action === 'rejected' && (!reason || reason.trim().isEmpty)) {
     return res.status(400).json({ error: "reason is required for rejection" });
  }

  let con;
  try {
    con = await getConnection();
    await con.beginTransaction();

    const [bookingRows] = await con.execute(
      "SELECT slot_id, status FROM booking_history WHERE history_id = ? FOR UPDATE",
      [history_id]
    );

    if (bookingRows.length === 0) {
      await con.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }
    
    if (bookingRows[0].status !== 'pending') {
      await con.rollback();
      return res.status(409).json({ error: "This booking has already been processed." });
    }

    const slot_id = bookingRows[0].slot_id;

    // Update the 'reason' column only if rejecting
    const updateReason = action === 'rejected' ? reason : null;
    const [result] = await con.execute(
      "UPDATE booking_history SET status = ?, approver_id = ?, approved_at = CURRENT_TIMESTAMP, reason = ? WHERE history_id = ?",
      [action, approver_id, updateReason, history_id]
    );

    if (result.affectedRows === 0) {
      await con.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    const newSlotStatus = action === 'approved' ? 'Reserved' : 'Free';
    await con.execute(
      "UPDATE time_slots SET status = ? WHERE slot_id = ?",
      [newSlotStatus, slot_id]
    );

    await con.commit();

    res.json({ message: `Booking ${action}` });
  } catch (err) {
    console.error("approveBooking error:", err);
    if (con) {
      try {
        await con.rollback();
      } catch (rollBackErr) {
        console.error("approveBooking rollback error:", rollBackErr);
      }
    }
    res.status(500).json({ error: "Database error during approval" });
  } finally {
    if (con) con.release();
  }
}

async function addLecturer(req, res) {
  const { username, email, password, confirmPassword } = req.body;
  if (!username || !email || !password || !confirmPassword) {
    return res
      .status(400)
      .json({
        error: "username, email, password and confirmPassword are required",
      });
  }
  if (password !== confirmPassword) {
    return res
      .status(400)
      .json({ error: "password and confirmPassword do not match" });
  }

  let con;
  try {
    con = await getConnection();
    const [existing] = await con.execute(
      "SELECT user_id FROM users WHERE username = ? OR email = ?",
      [username, email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "username or email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const userRole = "lecturer";

    const [result] = await con.execute(
      "INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)",
      [username, hashed, email, userRole]
    );

    return res
      .status(201)
      .json({ id: result.insertId, username, email, role: userRole });
  } catch (err) {
    console.error("addLecturer error:", err);
    return res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function changePassword(req, res) {
  const { user_id, oldPassword, newPassword } = req.body;
  if (!user_id || !oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "user_id, oldPassword, and newPassword are required" });
  }

  let con;
  try {
    con = await getConnection();
    const [users] = await con.execute(
      "SELECT password FROM users WHERE user_id = ?",
      [user_id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentHashedPassword = users[0].password;

    const isMatch = await bcrypt.compare(oldPassword, currentHashedPassword);

    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect old password" });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    await con.execute("UPDATE users SET password = ? WHERE user_id = ?", [
      newHashedPassword,
      user_id,
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("changePassword error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
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
  addLecturer,
  changePassword,
};