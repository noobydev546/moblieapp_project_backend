const { Router } = require("express");
const { login, register, hashPassword } = require("../controllers/auth.js");

const router = Router();

router.get("/password/:raw", hashPassword);
router.post("/login", login);
router.post("/register", register);

module.exports = router;
