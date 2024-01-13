// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { getCurrentGame } = require("../controllers/games/roulette");

const RouletteGame = require("../models/RouletteGame");

/**
 * @route   GET /api/roulette/
 * @desc    Get roulette schema
 * @access  Public
 */
router.get("/", async (req, res, next) => {
  try {
    // Get active game
    const history = await RouletteGame.find().sort({ created: -1 }).select({ privateSeed: 1, privateHash: 1, publicSeed: 1, randomModule: 1, winner: 1, winningMultiplier: 1, }).limit(100);

    // Get current games
    const current = await getCurrentGame();

    return res.json({
      history,
      current,
    });
  } catch (error) {
    return next(error);
  }
});
