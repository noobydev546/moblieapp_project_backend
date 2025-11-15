const { getConnection } = require("../config/db.js");
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken'); // <-- 1. IMPORT JWT

// 2. DEFINE YOUR SECRET KEY
// !! IMPORTANT: In a real app, load this from a .env file, do NOT hardcode it.
// e.g., const JWT_SECRET = process.env.JWT_SECRET;
const JWT_SECRET = 'your-super-secret-key-that-no-one-should-know'; 

async function login(req, res) {
    const { username, password } = req.body;
    if (!username || !password) {
        return res
            .status(400)
            .json({ error: "username and password are required" });
    }

    const sql = "SELECT * FROM `users` WHERE username = ?";
    let con;
    try {
        con = await getConnection();
        const [results] = await con.execute(sql, [username]);

        if (results.length !== 1) {
            // No user found
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = results[0];
        const same = await bcrypt.compare(password, user.password);

        if (same) {
            // ✅ PASSWORD IS CORRECT - CREATE AND SEND TOKEN
            
            // 3. Create the payload (data to store in the token)
            const payload = {
                id: user.user_id,
                username: user.username,
                role: user.role,
                email: user.email
            };

            // 4. Sign the token
            const token = jwt.sign(payload, JWT_SECRET, {
                expiresIn: '1h' // Token will expire in 1 hour
            });

            // 5. Send the token back to the client
            return res.json({
                message: "Login successful",
                token: token
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