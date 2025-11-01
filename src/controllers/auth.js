const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt");

async function login(req, res) {
  // <-- CHANGED: Only 'username' and 'password' are expected
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      // <-- CHANGED: Updated error message
      .json({ error: "username and password are required" });
  }

  // <-- CHANGED: Updated SQL query to only check username
  const sql = "SELECT * FROM `users` WHERE username = ?";
  let con;
  try {
    con = await getConnection();
    // <-- CHANGED: Pass only the username
    const [results] = await con.execute(sql, [username]);

    if (results.length !== 1) {
      // No user found with that username
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = results[0];
    const same = await bcrypt.compare(password, user.password);

    if (same) {
      // return minimal user info including role so client can route accordingly
      return res.json({
        username: user.username,
        id: user.user_id, // Flutter app will receive this as 'id'
        role: user.role,
      });
    } else {
      // Password did not match
      return res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function register(req, res) {
  const { username, email, password, confirmPassword, role } = req.body;
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
    const userRole =
      role && ["student", "staff", "lecturer"].includes(role)
        ? role
        : "student";

    const [result] = await con.execute(
      "INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)",
      [username, hashed, email, userRole]
    );

    return res
      .status(201)
      .json({ id: result.insertId, username, email, role: userRole });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Database error" });
  } finally {
    if (con) con.release();
  }
}

async function hashPassword(req, res) {
  const raw = req.params.raw;
  if (!raw) return res.status(400).send("raw param is required");
  try {
    const hash = await bcrypt.hash(raw, 10);
    res.send(hash);
  } catch (err) {
    console.error("hashPassword error:", err);
    res.status(500).send("Error creating password");
  }
}

module.exports = { login, register, hashPassword };
