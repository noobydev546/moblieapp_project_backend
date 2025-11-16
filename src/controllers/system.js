const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt");

// --- PUBLIC FUNCTIONS (No token required) ---

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

async function listTimeSlots(req, res) {
  const roomId = req.params?.roomId || req.query?.roomId;
  if (!roomId) return res.status(400).json({ error: "roomId is required" });

  let con;
  try {
    con = await getConnection();
    await con.execute("SET time_zone = '+07:00'");
    const [rows] = await con.execute(
      `
      SELECT
        ts.slot_id,
        ts.room_id,
        ts.time_period,
        CASE
          WHEN r.status = 'Disable' 
            OR ts.status = 'Disable' 
            OR STR_TO_DATE(CONCAT(CURDATE(), ' ', SUBSTRING_INDEX(ts.time_period, '-', -1)), '%Y-%m-%d %H:%i') < NOW() 
            THEN 'Disable'
          WHEN bh.status = 'approved' THEN 'Reserved'
          WHEN bh.status = 'pending' THEN 'Pending'
          ELSE 'Free'
        END AS time_slot_status
      FROM time_slots ts
      JOIN rooms r ON ts.room_id = r.room_id
      LEFT JOIN booking_history bh
        ON ts.slot_id = bh.slot_id
        AND bh.booking_date = CURDATE() 
        AND (bh.status = 'pending' OR bh.status = 'approved')
      WHERE ts.room_id = ?
      ORDER BY ts.slot_id
      `,
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

async function listRoomsWithAllTimeSlots(req, res) {
  let con;
  try {
    con = await getConnection();
    await con.execute("SET time_zone = '+07:00'");
    const [rows] = await con.execute(
      `
      SELECT
        r.room_id,
        r.room_name,
        r.status AS room_status,
        ts.slot_id,
        ts.time_period,
        CASE
          WHEN r.status = 'Disable' 
            OR ts.status = 'Disable' 
            OR STR_TO_DATE(CONCAT(CURDATE(), ' ', SUBSTRING_INDEX(ts.time_period, '-', -1)), '%Y-%m-%d %H:%i') < NOW() 
            THEN 'Disable'
          WHEN bh.status = 'approved' THEN 'Reserved'
          WHEN bh.status = 'pending' THEN 'Pending'
          ELSE 'Free'
        END AS status
      FROM rooms r
      JOIN time_slots ts ON r.room_id = ts.room_id
      LEFT JOIN booking_history bh
        ON ts.slot_id = bh.slot_id
        AND bh.booking_date = CURDATE()
        AND (bh.status = 'approved' OR bh.status = 'pending')
      ORDER BY r.room_name, ts.slot_id;
      `
    );

    const groupedRooms = {};
    for (const row of rows) {
      if (!groupedRooms[row.room_id]) {
        groupedRooms[row.room_id] = {
          room_id: row.room_id,
          roomName: row.room_name,
          status: row.room_status,
          timeSlots: [],
        };
      }
      groupedRooms[row.room_id].timeSlots.push({
        slot_id: row.slot_id,
        time_period: row.time_period,
        status: row.status,
      });
    }
    const result = Object.values(groupedRooms);
    res.json(result);
  } catch (err) {
    console.error("listRoomsWithAllTimeSlots error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

// --- PROTECTED FUNCTIONS (Token required) ---

async function createRoom(req, res) {
  const { id: created_by_id, role } = req.user;
  if (role !== "staff") {
    return res
      .status(403)
      .json({ error: "Forbidden: You do not have permission." });
  }
  const { room_name, room_description, status } = req.body;

  if (!room_name)
    return res.status(400).json({ error: "room_name is required" });
  if (!room_description)
    return res.status(400).json({ error: "room_description is required" });
  if (!status)
    return res.status(400).json({ error: "status is required" });
  if (!["Available", "Disable"].includes(status))
    return res.status(400).json({ error: "Invalid status value" });

  let con;
  try {
    con = await getConnection();
    await con.beginTransaction();

    const [result] = await con.execute(
      "INSERT INTO rooms (room_name, room_description, created_by, status) VALUES (?, ?, ?, ?)",
      [
        room_name,
        room_description,
        created_by_id,
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

    const params = [];
    const placeholders = defaultSlots.map(() => "(?, ?, ?)").join(", ");
    defaultSlots.forEach((p) => {
      params.push(roomId, p, "Free");
    });
    await con.execute(
      `INSERT INTO time_slots (room_id, time_period, status) VALUES ${placeholders}`,
      params
    );

    await con.commit();

    res.status(201).json({
      room_id: roomId,
      room_name,
      room_description,
      created_by: created_by_id, // Send back the ID of the creator
      status,
    });
  } catch (err) {
    if (con) await con.rollback();
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
  // ✅ 1. PERMISSION CHECK
  if (req.user.role !== "staff") {
    return res
      .status(403)
      .json({ error: "Forbidden: You do not have permission." });
  }

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
      [room_name, room_description, status, id]
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
  // ✅ 1. PERMISSION CHECK
  if (req.user.role !== "staff") {
    return res
      .status(403)
      .json({ error: "Forbidden: You do not have permission." });
  }

  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "room id is required" });

  let con;
  try {
    con = await getConnection();
    await con.beginTransaction();

    // Note: You should consider what to do with booking_history
    // This currently orphans history records.
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
    if (con) await con.rollback();
    console.error("deleteRoom error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function createBooking(req, res) {
  // ✅ 1. Get user ID SECURELY from the token
  const { id: user_id } = req.user;

  // ✅ 2. Get other data from body
  const { room_id, slot_id, booking_date, reason } = req.body;

  if (!room_id || !slot_id || !booking_date) {
    return res
      .status(400)
      .json({ error: "room_id, slot_id and booking_date are required" });
  }

  let con;
  try {
    con = await getConnection();
    await con.execute("SET time_zone = '+07:00'");
    await con.beginTransaction();

    // ✅ 3. Check using the SECURE user_id from the token
    const [existingUserBookings] = await con.execute(
      "SELECT history_id FROM booking_history WHERE user_id = ? AND booking_date = CURDATE() AND (status = 'pending' OR status = 'approved')",
      [user_id] // Use secure ID
    );

    if (existingUserBookings.length > 0) {
      await con.rollback();
      return res
        .status(409)
        .json({
          error:
            "You already have an active or approved booking for this date. You can only make a new request if your previous one is rejected.",
        });
    }

    const [slotRows] = await con.execute(
      "SELECT status FROM time_slots WHERE slot_id = ? FOR UPDATE",
      [slot_id]
    );

    if (slotRows.length === 0) {
      await con.rollback();
      return res.status(404).json({ error: "Time slot not found." });
    }
    if (slotRows[0].status === "Disable") {
      await con.rollback();
      return res
        .status(409)
        .json({ error: "This time slot is permanently disabled." });
    }

    const [existingSlotBookings] = await con.execute(
      "SELECT history_id FROM booking_history WHERE slot_id = ? AND booking_date = CURDATE() AND (status = 'pending' OR status = 'approved') FOR UPDATE",
      [slot_id]
    );

    if (existingSlotBookings.length > 0) {
      await con.rollback();
      return res
        .status(409)
        .json({ error: "This time slot is no longer available. Please refresh." });
    }

    const [result] = await con.execute(
      "INSERT INTO booking_history (user_id, room_id, slot_id, booking_date, reason, status) VALUES (?, ?, ?, CURDATE(), ?, 'pending')",
      [user_id, room_id, slot_id, reason || null] // ✅ 4. Use secure ID
    );

    await con.commit();

    res.status(201).json({
      history_id: result.insertId,
      user_id, // ✅ 5. Send back the secure ID
      room_id,
      slot_id,
      booking_date: "Booking for today",
      reason,
      status: "pending",
    });
  } catch (err) {
    if (con) await con.rollback();
    console.error("createBooking error:", err);
    res.status(500).json({ error: "Database error during booking" });
  } finally {
    if (con) con.release();
  }
}

async function listUserBookings(req, res) {
  // ✅ 1. Get user info SECURELY from token
  // We no longer need to trust req.params or req.query for user info
  const { id: userId, role: userRole } = req.user;

  let con;
  try {
    con = await getConnection();
    let query = "";
    let params = [userId]; // Default params now use the secure ID

    switch (userRole) { // ✅ 2. Use secure role from token
      case "student":
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            DATE_FORMAT(bh.booking_date, '%Y-%m-%d') as booking_date,
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
          ORDER BY bh.history_id DESC;`;
        // params is already [userId]
        break;

      case "lecturer":
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            DATE_FORMAT(bh.booking_date, '%Y-%m-%d') as booking_date,
            ts.time_period,
            ts.status as time_slot_status,
            bh.status,
            u_student.username as student_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          JOIN users u_student ON bh.user_id = u_student.user_id
          WHERE bh.status = 'pending'
          ORDER BY bh.history_id DESC;`;
        params = []; // Lecturer sees all pending
        break;

      case "staff":
        // ✅ 3. Added 'staff' case (optional, but good practice)
        // Staff sees ALL bookings
        query = `
          SELECT 
            bh.history_id,
            r.room_name,
            DATE_FORMAT(bh.booking_date, '%Y-%m-%d') as booking_date,
            ts.time_period,
            bh.status,
            u_student.username as student_name,
            u_approver.username as approver_name
          FROM booking_history bh
          JOIN rooms r ON bh.room_id = r.room_id
          JOIN time_slots ts ON bh.slot_id = ts.slot_id
          JOIN users u_student ON bh.user_id = u_student.user_id
          LEFT JOIN users u_approver ON bh.approver_id = u_approver.user_id
          ORDER BY bh.history_id DESC;`;
        params = []; // Staff sees all
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
  // ✅ 1. Get approver info SECURELY from token
  const { id: approver_id, role: approver_role } = req.user;

  // ✅ 2. PERMISSION CHECK
  if (approver_role !== "lecturer" && approver_role !== "staff") {
    return res
      .status(403)
      .json({ error: "Forbidden: You do not have permission to approve." });
  }

  const { history_id } = req.params;
  const { action, reason } = req.body; // ✅ 3. 'approver_id' is removed from body

  if (!history_id || !action)
    return res.status(400).json({ error: "history_id and action are required" });
  if (!["approved", "rejected"].includes(action))
    return res.status(400).json({ error: "action must be approved or rejected" });
  if (action === "rejected" && (!reason || reason.trim().length === 0)) {
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

    if (bookingRows[0].status !== "pending") {
      await con.rollback();
      return res
        .status(409)
        .json({ error: "This booking has already been processed." });
    }

    const updateReason = action === "rejected" ? reason : null;
    const [result] = await con.execute(
      "UPDATE booking_history SET status = ?, approver_id = ?, approved_at = CURRENT_TIMESTAMP, reason = ? WHERE history_id = ?",
      [action, approver_id, updateReason, history_id] // ✅ 4. Use secure approver_id
    );

    if (result.affectedRows === 0) {
      await con.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    await con.commit();

    res.json({ message: `Booking ${action}` });
  } catch (err) {
    if (con) await con.rollback();
    console.error("approveBooking error:", err);
    res.status(500).json({ error: "Database error during approval" });
  } finally {
    if (con) con.release();
  }
}

async function addLecturer(req, res) {
  // ✅ 1. PERMISSION CHECK
  if (req.user.role !== "staff") {
    return res
      .status(403)
      .json({ error: "Forbidden: You do not have permission." });
  }

  const { username, email, password, confirmPassword } = req.body;
  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({
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
  // ✅ 1. Get user ID SECURELY from token
  const { id: user_id } = req.user;

  // ✅ 2. Get passwords from body
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "oldPassword and newPassword are required" });
  }

  let con;
  try {
    con = await getConnection();
    const [users] = await con.execute(
      "SELECT password FROM users WHERE user_id = ?",
      [user_id] // ✅ 3. Use secure ID
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
      user_id, // ✅ 4. Use secure ID
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("changePassword error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

// --- HISTORY FUNCTIONS (PROTECTED) ---

async function listRoomsWithHistoryCount(req, res) {
  // ✅ 1. Get user info SECURELY from token
  const { id: userId, role } = req.user;

  // (No longer need req.query)

  let con;
  let query = "";
  let params = [userId]; // Default params use secure ID

  try {
    con = await getConnection();

    switch (role) { // ✅ 2. Use secure role
      case "lecturer":
        query = `
          SELECT 
            r.room_id, 
            r.room_name, 
            r.status,
            COUNT(bh.history_id) as history_count
          FROM rooms r
          LEFT JOIN booking_history bh 
            ON r.room_id = bh.room_id 
            AND bh.approver_id = ? 
            AND (bh.status = 'approved' OR bh.status = 'rejected')
          GROUP BY r.room_id, r.room_name, r.status
          ORDER BY r.room_name;
        `;
        // params is already [userId]
        break;

      case "staff":
        query = `
          SELECT 
            r.room_id, 
            r.room_name, 
            r.status,
            COUNT(bh.history_id) as history_count
          FROM rooms r
          LEFT JOIN booking_history bh 
            ON r.room_id = bh.room_id
          GROUP BY r.room_id, r.room_name, r.status
          ORDER BY r.room_name;
        `;
        params = []; // No params needed for staff
        break;

      default:
        // A student might be trying to access this?
        return res.status(403).json({ error: "Forbidden: You do not have permission." });
    }

    const [rows] = await con.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("listRoomsWithHistoryCount error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function getRoomHistory(req, res) {
  const { roomId } = req.params;

  // ✅ 1. Get user info SECURELY from token
  const { id: userId, role } = req.user;

  if (!roomId) {
    return res.status(400).json({ error: "roomId is required" });
  }

  let con;
  let query = "";
  let params = [roomId, userId]; // Default params

  try {
    con = await getConnection();
    await con.execute("SET time_zone = '+07:00'");

    switch (role) { // ✅ 2. Use secure role
      case "lecturer":
        query = `
      SELECT 
        DATE_FORMAT(bh.booking_date, '%Y-%m-%d') AS booking_date,
        ts.time_period,
        bh.status,
        bh.reason,
        u_student.username as student_name
      FROM booking_history bh
      JOIN time_slots ts ON bh.slot_id = ts.slot_id
      JOIN users u_student ON bh.user_id = u_student.user_id
      WHERE bh.room_id = ? 
        AND bh.approver_id = ? 
        AND (bh.status = 'approved' OR bh.status = 'rejected')
      ORDER BY bh.history_id DESC
    `;
        // params is already [roomId, userId]
        break;

      case "staff":
        query = `
      SELECT 
        DATE_FORMAT(bh.booking_date, '%Y-%m-%d') AS booking_date,
        ts.time_period,
        bh.status,
        bh.reason,
        u_student.username as student_name,
        u_approver.username as approver_name
      FROM booking_history bh
      JOIN rooms r ON bh.room_id = r.room_id
      JOIN time_slots ts ON bh.slot_id = ts.slot_id
      JOIN users u_student ON bh.user_id = u_student.user_id
      LEFT JOIN users u_approver ON bh.approver_id = u_approver.user_id
      WHERE bh.room_id = ? 
      ORDER BY bh.history_id DESC
    `;
        params = [roomId]; // Staff just needs room ID
        break;

      default:
        // A student might be trying to access this?
        return res.status(403).json({ error: "Forbidden: You do not have permission." });
    }

    const [rows] = await con.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("getRoomHistory error:", err);
    res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

module.exports = {
  // Public
  listRooms,
  getRoom,
  listTimeSlots,
  listRoomsWithAllTimeSlots,
  // Protected
  createRoom,
  updateRoom,
  deleteRoom,
  createBooking,
  listUserBookings,
  approveBooking,
  addLecturer,
  changePassword,
  getRoomHistory,
  listRoomsWithHistoryCount,
};