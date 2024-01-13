// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { validateJWT } = require("../middleware/auth");
const {
  vipLevels,
  vipLevelNAME,
  vipLevelCOLORS,
  getVipLevelFromWager,
  getNextVipLevelFromWager,
} = require("../controllers/vip");
const insertNewWalletTransaction = require("../utils/insertNewWalletTransaction");

const User = require("../models/User");
const config = require("../config");

/**
 * @route   GET /api/vip/
 * @desc    Get authenticated user's vip status
 * @access  Private
 */
router.get("/", validateJWT, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.user.id });

    // Find the corresponding levels
    const currentLevel = getVipLevelFromWager(user.wager);
    const nextLevel = getNextVipLevelFromWager(user.wager);
    const majorLevelNames = vipLevelNAME;
    const majorLevelColors = vipLevelCOLORS;
    const allLevels = vipLevels;

    return res.json({
      allLevels,
      majorLevelNames,
      majorLevelColors,
      currentLevel,
      nextLevel,
      rakebackBalance: user.rakebackBalance,
      wager: user.wager,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @route   POST /api/vip/claim
 * @desc    Claim your rakeback balance
 * @access  Private
 */
router.post("/claim", validateJWT, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.user.id });

    // Check if user has enough rakeback to claim
    if (user.rakebackBalance < config.games.vip.minRakebackClaim) {
      res.status(400);
      return next(
        new Error(
          `You must have atleast $${config.games.vip.minRakebackClaim} rakeback collected before claiming it!`
        )
      );
    }
    else {
      // Update user document
      await User.updateOne(
        { _id: user.id },
        {
          $inc: { wallet: user.rakebackBalance },
          $set: { rakebackBalance: 0 },
        }
      );
      insertNewWalletTransaction(
        user.id,
        user.rakebackBalance,
        "VIP rakeback claim"
      );

      return res.json({ rakebackClaimed: user.rakebackBalance });
    }
  } catch (error) {
    return next(error);
  }
});
