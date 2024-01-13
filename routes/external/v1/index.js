// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { validateJWT, allowAdminsOnly } = require("../../../middleware/auth");

// Authentication middleware
router.use(validateJWT);
router.use(allowAdminsOnly);

// Authentication test endpoint
router.get("/testAuthentication", (req, res) => {
  return res.json({
    success: true,
  });
});

// Define endpoints
router.use("/controls", require("./controls"));
router.use("/users", require("./users"));
router.use("/statistics", require("./statistics"));
router.use("/transactions", require("./transactions"));
router.use("/coupons", require("./coupons"));
router.use("/race", require("./race"));
router.use("/trivia", require("./trivia"));
router.use("/vip", require("./vip"));
