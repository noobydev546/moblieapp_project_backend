const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt");

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const sql = "SELECT * FROM `users` WHERE username = ?";
  try {
    const con = await getConnection();
    const [results] = await con.execute(sql, [username]);
    if (results.length !== 1) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const user = results[0];
    const same = await bcrypt.compare(password, user.password);
    if (same) {
      // return minimal user info including role so client can route accordingly
      return res.json({
        username: user.username,
        id: user.user_id,
        role: user.role,
      });
    } else {
      return res.status(401).json({ error: "Invalid username or password" });
    }
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: "Database error" });
  }
}

async function register(req, res) {
  const { username, email, password, confirmPassword, role } = req.body;
  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({ error: "username, email, password and confirmPassword are required" });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: "password and confirmPassword do not match" });
  }

  try {
    const con = await getConnection();
    // check if username or email already exists
    const [existing] = await con.execute(
      "SELECT user_id FROM users WHERE username = ? OR email = ?",
      [username, email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "username or email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const userRole = role && ['student','staff','lecturer'].includes(role) ? role : 'student';

    const [result] = await con.execute(
      "INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)",
      [username, hashed, email, userRole]
    );

    return res.status(201).json({ id: result.insertId, username, email, role: userRole });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: "Database error" });
  }
}

async function hashPassword(req, res) {
  const raw = req.params.raw;
  if (!raw) return res.status(400).send('raw param is required');
  try {
    const hash = await bcrypt.hash(raw, 10);
    res.send(hash);
  } catch (err) {
    console.error('hashPassword error:', err);
    res.status(500).send("Error creating password");
  }
}

module.exports = { login, register, hashPassword };