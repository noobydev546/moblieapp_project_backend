const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt"); // <-- ADDED: For addLecturer

// System controller for room booking: rooms, time slots, bookings

async function listRooms(req, res) {
  let con;
  try {
    con = await getConnection();
    // Select the new status column
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
    // Also select status here
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
  // Get status from the request body
  const { room_name, room_description, created_by, status } = req.body;

  // Add validation for status
  if (!room_name)
    return res.status(400).json({ error: "room_name is required" });
  if (!status)
    return res.status(400).json({ error: "status is required" });
  if (!["Available", "Disable"].includes(status))
    return res.status(400).json({ error: "Invalid status value" });

  let con;
  try {
    con = await getConnection();
    // INSERT the new status
    const [result] = await con.execute(
      "INSERT INTO rooms (room_name, room_description, created_by, status) VALUES (?, ?, ?, ?)",
      [
        room_name,
        room_description || null,
        created_by || null,
        status, // Add status here
      ]
    );

    // after creating room, insert default 4 time slots for that room
    const roomId = result.insertId;
    const defaultSlots = [
      "08:00-10:00",
      "10:00-12:00",
      "13:00-15:00",
      "15:00-17:00",
    ];
    try {
      // If time_slots table has a status column, insert default status for each slot
      // We'll attempt to insert (room_id, time_period, status).
      const params = [];
      const hasStatusInsert = true; // assume new schema includes status
      if (hasStatusInsert) {
        const placeholders = defaultSlots.map(() => "(?, ?, ?)").join(", ");
        defaultSlots.forEach((p) => {
          params.push(roomId, p, "Free");
        });
        await con.execute(
          `INSERT INTO time_slots (room_id, time_period, status) VALUES ${placeholders}`,
          params
        );
      } else {
        // Fallback if time_slots doesn't have status (legacy)
        const placeholders = defaultSlots.map(() => "(?, ?)").join(", ");
        defaultSlots.forEach((p) => {
          params.push(roomId, p);
        });
        await con.execute(
          `INSERT INTO time_slots (room_id, time_period) VALUES ${placeholders}`,
          params
        );
      }
    } catch (slotErr) {
      console.error("createRoom - inserting default slots error:", slotErr);
      // not fatal for room creation; continue but warn
    }

    res.status(201).json({
      room_id: roomId,
      room_name,
      room_description,
      created_by,
      status, // Include status in response
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
  // Get status from the request body
  const { room_name, room_description, status } = req.body;
  if (!id) return res.status(400).json({ error: "room id is required" });

  // Optional: Validate status if provided
  if (status && !["Available", "Disable"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  let con;
  try {
    con = await getConnection();
    // UPDATE the new status column
    const [result] = await con.execute(
      "UPDATE rooms SET room_name = COALESCE(?, room_name), room_description = COALESCE(?, room_description), status = COALESCE(?, status) WHERE room_id = ?",
      [
        room_name,
        room_description,
        status, // Add status here
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
  let con; // Define connection outside try block for rollback access
  try {
    con = await getConnection();
    // ensure atomic delete: remove time_slots then room (DB has FK with cascade but play safe)
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
      if (con) await con.rollback(); // Rollback on error
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
    const [result] = await con.execute(
      "INSERT INTO booking_history (user_id, room_id, slot_id, booking_date, reason, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [user_id, room_id, slot_id, booking_date, reason || null]
    );
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
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function listUserBookings(req, res) {
  const userId = req.params?.userId || req.query?.userId || req.body?.user_id;
  const userRole = req.query?.role; // 'student', 'lecturer', or 'staff'
  if (!userId || !userRole)
    return res.status(400).json({ error: "userId and role are required" });

  let con;
  try {
    con = await getConnection();
    let query = "";

    switch (userRole) {
      case "student":
        // Students see: Room name, Date, Time slot, status, reject reason, approver name
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
        // Lecturers see: Room name, Date, Time slot, status, reject reason, student name
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
            u_student.username as student_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          JOIN users u_student ON bh.user_id = u_student.user_id
          WHERE bh.approver_id = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      case "staff":
        // Staff see: Room name, Date, Time slot, status, reject reason, approver name
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
          WHERE r.created_by = ?
          ORDER BY bh.booking_date DESC, ts.time_period`;
        break;

      default:
        return res.status(400).json({ error: "Invalid role specified" });
    }

    const [rows] = await con.execute(query, [userId]);
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
  const { approver_id, action } = req.body; // action: 'approved' or 'rejected'
  if (!history_id || !approver_id || !action)
    return res
      .status(400)
      .json({ error: "history_id, approver_id and action are required" });
  if (!["approved", "rejected"].includes(action))
    return res
      .status(400)
      .json({ error: "action must be approved or rejected" });

  let con;
  try {
    con = await getConnection();
    const [result] = await con.execute(
      "UPDATE booking_history SET status = ?, approver_id = ?, approved_at = CURRENT_TIMESTAMP WHERE history_id = ?",
      [action, approver_id, history_id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Booking not found" });
    res.json({ message: `Booking ${action}` });
  } catch (err) {
    console.error("approveBooking error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

// <-- NEW FUNCTION ADDED -->
async function addLecturer(req, res) {
  // This function is intended to be used by 'staff' roles
  // It registers a new user with the 'lecturer' role.
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
    // check if username or email already exists
    const [existing] = await con.execute(
      "SELECT user_id FROM users WHERE username = ? OR email = ?",
      [username, email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "username or email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    // Role is hardcoded to 'lecturer'
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
  addLecturer, // <-- ADDED: Export new function
};
