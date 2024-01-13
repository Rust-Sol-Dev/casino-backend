// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const config = require("../../../config");
const {
  getVipLevelFromWager,
  getNextVipLevelFromWager,
} = require("../../../controllers/vip");

const User = require("../../../models/User");

/**
 * @route   GET /api/external/v1/vip/list
 * @desc    Get current VIP users
 * @access  Private
 */
router.get("/list", async (req, res, next) => {
  try {
    const minWager = config.games.vip.levels.sort(
      (a, b) => a.wagerNeeded - b.wagerNeeded
    )[1].wagerNeeded;

    // Get all active vip users
    const users = await User.find({ wager: { $gte: minWager } }).lean();

    return res.json(
      users.map(user => ({
        ...user,
        extraStatistics: {
          currentRank: getVipLevelFromWager(user.wager),
          nextRank: getNextVipLevelFromWager(user.wager),
        },
      }))
    );
  } catch (error) {
    return next(error);
  }
});
