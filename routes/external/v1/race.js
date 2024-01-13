// Require Dependencies
const express = require("express");
const router = (module.exports = express.Router());
const config = require("../../../config");
const colors = require("colors/safe");
const { check, validationResult } = require("express-validator");
const { agenda } = require("../../../controllers/jobs");
const insertNewWalletTransaction = require("../../../utils/insertNewWalletTransaction");

const User = require("../../../models/User");
const Race = require("../../../models/Race");
const RaceEntry = require("../../../models/RaceEntry");

/**
 * @route   GET /api/external/v1/race/
 * @desc    Get active race
 * @access  Private
 */
router.get("/", async (req, res, next) => {
  try {
    // Get active race from db
    const race = await Race.findOne({ active: true });

    return res.json(race);
  } catch (error) {
    return next(error);
  }
});

/**
 * @route   POST /api/external/v1/race/end
 * @desc    End current active race
 * @access  Private
 */
router.post("/end", async (req, res, next) => {
  try {
    // Get active race from db
    const race = await Race.findOne({ active: true });

    // If there is no active race
    if (!race) {
      res.status(400);
      return next(new Error("No active race found!"));
    }

    // Get race participants
    const participants = await RaceEntry.find({ _race: race.id }).lean();

    // Variable to hold winner data
    const winners = [];

    // Payout winners
    for (let index = 0; index < participants.length; index++) {
      const userId = participants.sort((a, b) => b.value - a.value)[index]._user;

      // If user is in the winning place
      if (index <= config.games.race.prizeDistribution.length - 1) {
        const payout =
          race.prize * (config.games.race.prizeDistribution[index] / 100);

        // Add to array
        winners.push(userId);

        // Update user
        await User.updateOne(
          { _id: userId },
          { $inc: { wallet: Math.abs(payout) }, }
        );
        insertNewWalletTransaction(
          userId,
          Math.abs(payout),
          `Race win #${index + 1}`,
          { raceId: race.id }
        );
      }
    }

    // Update race document
    await Race.updateOne(
      { _id: race.id },
      {
        $set: {
          active: false,
          endingDate: Date.now(),
          winners,
        },
      }
    );

    req.app.get("socketio").of("/chat").emit("race-state-changed", winners);

    console.log(colors.green("Race >> Manually ended race"), race.id);
    return res.sendStatus(200);
  } catch (error) {
    return next(error);
  }
});

/**
 * @route   PUT /api/external/v1/race/create
 * @desc    Create new race
 * @access  Private
 */
const validationChecks = [
  check("endingDate", "Ending date is required!")
    .notEmpty()
    .isInt({ min: Date.now() })
    .withMessage(
      "Invalid ending date type, must be an UNIX timestamp greater than now"
    ),
  check("prize", "Prize amount is required!")
    .isFloat()
    .withMessage("Invalid prize amount type, must be an float")
    .toFloat(),
];
router.put("/create", validationChecks, async (req, res, next) => {
  const errors = validationResult(req);

  // Check for validation errors
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { prize, endingDate } = req.body;
  try {
    // Get active race from db
    const race = await Race.findOne({ active: true });

    // If there is active race
    if (race) {
      res.status(400);
      return next(
        new Error("Please end the current race before starting a new one!")
      );
    }

    // Create a new race document
    const newRace = new Race({
      // Basic fields
      active: true,
      prize,
      endingDate,
    });

    // Save new document
    await newRace.save();

    req.app.get("socketio").of("/chat").emit("race-state-changed", newRace.id);

    // Schedule new agenda job to automatically end this race
    await agenda.schedule(new Date(endingDate), "endActiveRace", { _id: newRace.id });

    return res.sendStatus(200);
  } catch (error) {
    return next(error);
  }
});
