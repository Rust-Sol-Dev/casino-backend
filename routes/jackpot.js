// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { getCurrentGameLow, getCurrentGameMiddle, getCurrentGameHigh } = require("../controllers/games/jackpot");

const JackpotGame = require("../models/JackpotGame");

/**
 * @route   GET /api/jackpot/
 * @desc    Get jackpot schema
 * @access  Public
 */
router.get("/", async (req, res, next) => {
  try {
    // Get active game
    const history = await JackpotGame.find()
      .sort({ created: -1 })
      .select({
        privateSeed: 1,
        privateHash: 1,
        publicSeed: 1,
        randomModule: 1,
        winner: 1,
        players: 1,
      })
      .limit(25);

    // Get current games
    const current = await getCurrentGameLow();
    const currentMiddle = await getCurrentGameMiddle();
    const currentHigh = await getCurrentGameHigh();

    return res.json({
      history,
      current,
      currentMiddle,
      currentHigh,
    });
  } catch (error) {
    return next(error);
  }
});
