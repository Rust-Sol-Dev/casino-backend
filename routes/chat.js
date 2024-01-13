// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const { getChatMessages, getRainStatus, getTriviaTimeStatus, getTriviaCountdownStatus } = require("../controllers/chat");

const Trivia = require("../models/Trivia");

/**
 * @route   GET /api/chat/history
 * @desc    Get 30 last chat messages from state
 * @access  Public
 */
router.get("/history", async (req, res, next) => {
  try {
    const messages = getChatMessages();
    const rain = getRainStatus();
    const triviaTime = getTriviaTimeStatus();
    const triviaCountdownStarted = getTriviaCountdownStatus();
    const trivia = await Trivia.findOne({ active: true }).select({
      active: 1,
      question: 1,
      prize: 1,
      winnerAmount: 1,
      winners: 1,
    });

    return res.json({
      messages: messages
        .sort((a, b) => a.created - b.created)
        .slice(Math.max(messages.length - 30, 0)),
      rain,
      triviaTime,
      triviaCountdownStarted,
      trivia,
    });
  } catch (error) {
    return next(error);
  }
});
