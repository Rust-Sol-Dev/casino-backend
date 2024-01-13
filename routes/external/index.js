// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());

// Use versioned api
router.use("/v1", require("./v1"));
