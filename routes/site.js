// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { getMaintenanceState } = require("../controllers/site-settings");

/**
 * @route   GET /api/site/
 * @desc    Get site schema
 * @access  Public
 */
router.get("/", async (req, res) => {
  const launchDate = new Date("2020-07-05T19:00:00");

  return res.json({
    maintenanceEnabled: getMaintenanceState(),
    launchDate: launchDate.toISOString(),
    launched: Date.now() > launchDate.getTime(),
  });
});
