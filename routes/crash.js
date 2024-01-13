// Require Dependencies
const config = require("../config");
const express = require("express");
const _ = require("lodash");
const { validateJWT } = require("../middleware/auth");
const router = (module.exports = express.Router());
const {
  getCurrentGame,
  getPublicSeed,
  formatGameHistory,
} = require("../controllers/games/crash");

const CrashGame = require("../models/CrashGame");

/**
 * @route   GET /api/crash/
 * @desc    Get crash schema
 * @access  Public
 */
router.get("/", async (req, res, next) => {
  try {
    // Get active game
    const history = await CrashGame.find({
      status: 4,
    })
      .sort({ created: -1 })
      .limit(35);

    // Get current games
    const current = await getCurrentGame();

    return res.json({
      current,
      history: history.map(formatGameHistory),
      options: _.pick(config.games.crash, "maxProfit"),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @route   GET /api/crash/me
 * @desc    Get user crash data
 * @access  Private
 */
router.get("/me", validateJWT, async (req, res, next) => {
  try {
    // Get current games
    const current = await getCurrentGame();

    // Check players array for user bet
    const userBet = _.find(current.players, { playerID: req.user.id });

    return res.json({
      bet: userBet ? userBet : null,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @route   GET /api/crash/service
 * @desc    Get crash service data
 * @access  Private
 */
router.get("/service", async (req, res, next) => {
  try {
    // Get current games
    const current = await getCurrentGame();
    const privateHash = await getPrivateHash();

    return res.json({
      ...current,
      privateHash,
    });
  } catch (error) {
    return next(error);
  }
});
