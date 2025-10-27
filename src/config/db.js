const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

let _conn = null;

async function getConnection() {
  if (!_conn) {
    _conn = (await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    })).promise();
  }
  return _conn;
}

module.exports = { getConnection };
