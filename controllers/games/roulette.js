// Require Dependencies
const jwt = require("jsonwebtoken");
const uuid = require("uuid");
const mongoose = require("mongoose");
const throttlerController = require("../throttler");
const config = require("../../config");
const colors = require("colors");
const {
  generatePrivateSeedHashPair,
  generateRouletteRandom,
  generateRouletteFirstRandom,
} = require("../random");
const { checkAndEnterRace, checkAndApplyRakeToRace } = require("../race");
const { checkAndApplyRakeback, getVipLevelFromWager } = require("../vip");
const { checkAndApplyAffiliatorCut } = require("../affiliates");
const { getRouletteState } = require("../site-settings");
const insertNewWalletTransaction = require("../../utils/insertNewWalletTransaction");

const User = require("../../models/User");
const RouletteGame = require("../../models/RouletteGame");

const Usero = require("../../models/Usero");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const BACKEND_URL = IS_PRODUCTION
  ? config.site.backend.productionUrl
  : config.site.backend.developmentUrl;

// Declare game state
const GAME_STATE = {
  joinable: false,
  timeLeft: 0,
  winner: null,
  winningMultiplier: null,
  AnimationDuration: 0,
  AnimationDurationTotal: 0,
  players: [],
  privateSeed: null,
  privateHash: null,
  publicSeed: null,
  randomModule: 0,
  _id: null,
  intervalId: null,
  rollStatus: null,
  intervalId2: null,
  intervalId3: null,
};

// Declare client animation (spin) length
const CLIENT_ANIMATION_LENGTH = 5500;
const ANIMATION_END = 6500; //how much to wait after animation finished

// Declare roulette wheel order
const ROULETTE_ORDER = [0, 11, 5, 10, 6, 9, 7, 8, 1, 14, 2, 13, 3, 12, 4];

// Export state to external controllers
const getCurrentGame = () => ({
  ...GAME_STATE,
  rollStart: GAME_STATE.rollStatus ? GAME_STATE.rollStatus.rollStart - +new Date() : null,
  privateSeed: null,
  intervalId: null,
  intervalId2: null,
  intervalId3: null,
});

// Calculate winner from random data
const getWinningColor = async winningMultiplier => {
  return new Promise((resolve, reject) => {
    if (winningMultiplier === 1 || winningMultiplier === 2 || winningMultiplier === 3 || winningMultiplier === 4 || winningMultiplier === 5 || winningMultiplier === 6 || winningMultiplier === 7) {
      resolve("red");
    } else if (winningMultiplier === 14 || winningMultiplier === 13 || winningMultiplier === 12 || winningMultiplier === 11 || winningMultiplier === 10 || winningMultiplier === 9 || winningMultiplier === 8) {
      resolve("black");
    } else if (winningMultiplier === 0) {
      resolve("green");
    } else {
      reject(
        new Error("Couldn't calculate winner: Invalid multiplier amount!")
      );
    }
  });
};

// Get socket.io instance
const listen = io => {
  // Add previous game to history (database)
  const addCurrentGameToHistory = async () => {
    const game = { ...GAME_STATE };

    // Delete not needed props
    delete game.joinable;
    delete game.timeLeft;
    delete game.intervalId;

    try {
      // Push game to db
      const newGame = new RouletteGame(game);

      // Save the new document
      await newGame.save();

      // Add to local history
      io.of("/roulette").emit("add-game-to-history", {
        privateSeed: game.privateSeed,
        privateHash: game.privateHash,
        publicSeed: game.publicSeed,
        randomModule: game.randomModule,
        winner: game.winner,
        _id: newGame._id,
      });
    } catch (error) {
      console.log("Error while saving roulette game to the database:", error);
    }
  };

  // End current game
  const endCurrentRouletteGame = async () => {
    // Don't allow more bets
    GAME_STATE.joinable = false;

    console.log(colors.yellow("Roulette >> Rolling current game"));

    try {
      // Generate random data
      const firstRandomData = await generateRouletteFirstRandom();
      const randomData = await generateRouletteRandom(
        GAME_STATE._id,
        GAME_STATE.privateSeed,
        firstRandomData.publicSeed,
        1
      );

      // Calculate winner
      const winningIndex = Math.floor(randomData.module);
      const winningMultiplier = ROULETTE_ORDER[winningIndex];
      const winningColor = await getWinningColor(winningMultiplier);

      // Update local object
      GAME_STATE.randomModule = randomData.module;
      GAME_STATE.publicSeed = firstRandomData.publicSeed;
      GAME_STATE.winner = winningColor;

      console.log(colors.yellow("Roulette >> Game"), GAME_STATE._id, colors.yellow("rolled, winning color:"), `${winningColor} (Number ${winningMultiplier})`);

      const rollStart = +new Date();

      GAME_STATE.rollStatus = {
        rollStart,
        winningIndex,
        winningMultiplier
      }

      // Emit to clients
      io.of("/roulette").emit("game-rolled", winningIndex, winningMultiplier, GAME_STATE.AnimationDuration, GAME_STATE.AnimationDurationTotal);

      GAME_STATE.intervalId2 = setInterval(() => {
        // Decrement time left
        GAME_STATE.AnimationDuration -= 10;

        // Check if timer has reached 0
        if (GAME_STATE.AnimationDuration <= 0) {
          return clearInterval(GAME_STATE.intervalId2);
        }
      }, 10);

      GAME_STATE.intervalId3 = setInterval(() => {
        // Decrement time left
        GAME_STATE.AnimationDurationTotal -= 10;

        // Check if timer has reached 0
        if (GAME_STATE.AnimationDurationTotal <= 0) {
          return clearInterval(GAME_STATE.intervalId3);
        }
      }, 10);

      // Wait until client finishes animation
      const timeout = setTimeout(async () => {
        clearTimeout(timeout);
        // Play animation on client
        io.of("/roulette").emit("multiplier-rolled", winningMultiplier);

        // Find winners and payout
        for (let index = 0; index < GAME_STATE.players.length; index++) {
          const player = GAME_STATE.players[index];

          // If player won
          if (player.color === winningColor) {
            // Calculate profit
            if (winningMultiplier === 1 || winningMultiplier === 2 || winningMultiplier === 3 || winningMultiplier === 4 ||
              winningMultiplier === 5 || winningMultiplier === 6 || winningMultiplier === 7 || winningMultiplier === 14 ||
              winningMultiplier === 13 || winningMultiplier === 12 || winningMultiplier === 11 || winningMultiplier === 10 || winningMultiplier === 9 || winningMultiplier === 8) {
              const profit = player.betAmount * 2; // IF RED OR BLACK HITS, MULTIPLY USER BET WITH X2
              const houseRake = profit * config.games.roulette.feePercentage;
              const wonAmount = profit;

              // Payout winner
              await User.updateOne(
                { _id: player._id },
                {
                  $inc: {
                    wallet: Math.abs(wonAmount),
                  },
                }
              );
              insertNewWalletTransaction(
                player._id,
                Math.abs(wonAmount),
                "Roulette win",
                { rouletteGameId: GAME_STATE._id }
              );

              // Update local wallet
              io.of("/roulette").to(player._id).emit("update-wallet", Math.abs(wonAmount));

              // Apply 0.5% rake to current race prize pool
              await checkAndApplyRakeToRace(houseRake * 0.005);

              // Apply user's rakeback if eligible
              await checkAndApplyRakeback(player._id, houseRake);

              // Apply cut of house edge to user's affiliator
              await checkAndApplyAffiliatorCut(player._id, houseRake);
            } else if (winningMultiplier === 0) {
              const profit = player.betAmount * 14; // IF GREEN HITS, MULTIPLY USER BET WITH X14
              const houseRake = profit * config.games.roulette.feePercentage;
              const wonAmount = profit;

              // Payout winner
              await User.updateOne(
                { _id: player._id },
                {
                  $inc: {
                    wallet: Math.abs(wonAmount),
                  },
                }
              );
              insertNewWalletTransaction(
                player._id,
                Math.abs(wonAmount),
                "Roulette win",
                { rouletteGameId: GAME_STATE._id }
              );

              // Update local wallet
              io.of("/roulette").to(player._id).emit("update-wallet", Math.abs(wonAmount));

              // Apply 0.5% rake to current race prize pool
              await checkAndApplyRakeToRace(houseRake * 0.005);

              // Apply user's rakeback if eligible
              await checkAndApplyRakeback(player._id, houseRake);

              // Apply cut of house edge to user's affiliator
              await checkAndApplyAffiliatorCut(player._id, houseRake);
            }
          }
        }

        // Update multiplier
        GAME_STATE.winningMultiplier = winningMultiplier;

        // Wait for tile animation
        setTimeout(() => {
          // Reset game
          addCurrentGameToHistory();
          startNewGame();
        }, ANIMATION_END);

      }, CLIENT_ANIMATION_LENGTH);
    } catch (error) {
      console.log("Error while ending a roulette game:", error);

      // Notify clients that we had an error
      io.of("/roulette").emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry ending the game
        endCurrentRouletteGame();

        return clearTimeout(timeout);
      }, 15000);
    }
  };

  // Start a new game
  const startNewGame = async () => {
    // Generate pre-roll provably fair data
    const provablyData = await generatePrivateSeedHashPair();

    // Reset state
    GAME_STATE.players = [];
    GAME_STATE.joinable = true;
    GAME_STATE.timeLeft = config.games.roulette.waitingTime;
    GAME_STATE.AnimationDuration = 5500;
    GAME_STATE.AnimationDurationTotal = 11500;
    GAME_STATE.winner = null;
    GAME_STATE.winningMultiplier = null;
    GAME_STATE.privateSeed = provablyData.seed;
    GAME_STATE.privateHash = provablyData.hash;
    GAME_STATE.publicSeed = null;
    GAME_STATE.randomModule = 0;
    GAME_STATE.rollStatus = null;
    GAME_STATE._id = mongoose.Types.ObjectId();

    // Clear game main interval
    clearInterval(GAME_STATE.intervalId);
    clearInterval(GAME_STATE.intervalId2);
    clearInterval(GAME_STATE.intervalId3);

    console.log(colors.yellow("Roulette >> Generated new game with the id"), GAME_STATE._id);

    // Emit to clients
    io.of("/roulette").emit("new-round", config.games.roulette.waitingTime, GAME_STATE._id, GAME_STATE.privateHash);

    // Start a new game interval
    GAME_STATE.intervalId = setInterval(() => {
      // Decrement time left
      GAME_STATE.timeLeft -= 10;

      // Check if timer has reached 0
      if (GAME_STATE.timeLeft <= 0) {
        endCurrentRouletteGame();
        return clearInterval(GAME_STATE.intervalId);
      }
    }, 10);

// Function to get a random subset of an array
const getRandomSubset = (array, subsetSize) => {
  const shuffledArray = array.sort(() => 0.5 - Math.random());
  return shuffledArray.slice(0, subsetSize);
};

// Function to generate a random bet amount between 0.1 and 120.2
const getRandomBetAmount = () => {
  const randomNumber = Math.random();
  let betAmount;

  if (randomNumber <= 0.95) {
    // 95% chance for bets between 0.1 and 8
    if (Math.random() <= 0.65) {
      // 65% chance for bets without decimals (full numbers)
      betAmount = Math.floor(Math.random() * 8) + 1; // Generates a random integer between 1 and 8 (inclusive)
    } else {
      // 35% chance for bets with decimals
      betAmount = Math.random() * (8 - 0.1) + 0.1; // Generates a random decimal number between 0.1 and 8
    }
  } else {
    // 5% chance for bets between 8 and 100
    if (Math.random() <= 0.65) {
      // 65% chance for bets without decimals (full numbers)
      betAmount = Math.floor(Math.random() * (100 - 8)) + 8; // Generates a random integer number between 8 and 100
    } else {
      // 35% chance for bets with decimals
      betAmount = Math.random() * (100 - 8) + 8; // Generates a random decimal number between 8 and 100
    }
  }

  return parseFloat(betAmount.toFixed(2));
};
  
 try {
 // Get a random subset of players
 const allPlayers = await Usero.find({});
 const selectedPlayers = getRandomSubset(allPlayers, 15);

 // Fake players joining
selectedPlayers.forEach((fakeUser, index) => {
 const { username, avatar, wager, _id } = fakeUser;
 const colors = ["green", "red", "black"];
 const colorIndex = index < 5 ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3); // 0 or 1 for first 5 players, random for others
 const betAmount = getRandomBetAmount();
 const delay = Math.floor(Math.random() * 12 + 2) * 1000; // Generate a random delay between 2-13 seconds

 setTimeout(async () => {
   const player = {
     _id: _id,
     username: username,
     avatar: avatar,
     color: colors[colorIndex],
     betAmount: parseFloat(betAmount.toFixed(2)),
     level: getVipLevelFromWager(wager),
     betId: uuid.v4(),
   };

   // Remove bet amount from user's balance
   await Usero.updateOne(
     { _id: _id },
     {
       $inc: {
         wager: Math.abs(parseFloat(betAmount.toFixed(2))),
       },
     }
   );

   await checkAndEnterRace(_id, Math.abs(parseFloat(betAmount.toFixed(2))));

   GAME_STATE.players.push(player);
   io.of("/roulette").emit("new-player", player);
   //console.log(`Player ${username} joined with a delay of ${delay / 1000} seconds`);
 }, delay);
});

} catch (error) {
  console.log("ERROR ROULETTE", error);
 }


  };

  // Initially start a new game
  startNewGame();

  // Listen for new websocket connections
  io.of("/roulette").on("connection", socket => {
    let loggedIn = false;
    let user = null;

    // Throttle connnections
    socket.use(throttlerController(socket));

    // Authenticate websocket connection
    socket.on("auth", async token => {
      if (!token) {
        loggedIn = false;
        user = null;
        return socket.emit(
          "error",
          "No authentication token provided, authorization declined"
        );
      }

      try {
        // Verify token
        const decoded = jwt.verify(token, config.authentication.jwtSecret);

        user = await User.findOne({ _id: decoded.user.id });
        if (user) {
          if (parseInt(user.banExpires) > new Date().getTime()) {
            // console.log("banned");
            loggedIn = false;
            user = null;
            return socket.emit("user banned");
          } else {
            loggedIn = true;
            socket.join(String(user._id));
            // socket.emit("notify-success", "Successfully authenticated!");
          }
        }
        // return socket.emit("alert success", "Socket Authenticated!");
      } catch (error) {
        loggedIn = false;
        user = null;
        return socket.emit("notify-error", "Authentication token is not valid");
      }
    });

    // Check for users ban status
    socket.use(async (packet, next) => {
      if (loggedIn && user) {
        try {
          const dbUser = await User.findOne({ _id: user.id });

          // Check if user is banned
          if (dbUser && parseInt(dbUser.banExpires) > new Date().getTime()) {
            return socket.emit("user banned");
          } else {
            return next();
          }
        } catch (error) {
          return socket.emit("user banned");
        }
      } else {
        return next();
      }
    });

    /**
     * @description Join a current game
     *
     * @param {string} color What color to bet on
     * @param {number} betAmount Bet amount
     */
    socket.on("join-game", async (color, betAmount) => {
      // Validate user input
      if (
        typeof color !== "string" ||
        !["red", "black", "green"].includes(color)
      )
        return socket.emit("game-join-error", "Invalid Color Type!");
      if (typeof betAmount !== "number" || isNaN(betAmount))
        return socket.emit("game-join-error", "Invalid Bet Amount Type!");
      if (!loggedIn)
        return socket.emit("game-join-error", "You are not logged in!");

      // Get roulette enabled status
      const isEnabled = getRouletteState();

      // If roulette is disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error",
          "Wheel gamemode is currently disabled! Contact admins for more information."
        );
      }

      // More validation on the bet value
      const { minBetAmount, maxBetAmount } = config.games.roulette;
      if (
        parseFloat(betAmount.toFixed(2)) < minBetAmount ||
        parseFloat(betAmount.toFixed(2)) > maxBetAmount
      ) {
        return socket.emit(
          "game-join-error",
          `Your bet must be a minimum of ${minBetAmount} credits and a maximum of ${maxBetAmount} credits!`
        );
      }

      // Check if current game is joinable
      if (!GAME_STATE.joinable)
        return socket.emit("game-join-error", "Cannot join this game!");

      try {
        // Get user from database
        const dbUser = await User.findOne({ _id: user.id });

        // If user is self-excluded
        if (dbUser.selfExcludes.roulette > Date.now()) {
          return socket.emit(
            "game-join-error",
            `You have self-excluded yourself for another ${((dbUser.selfExcludes.roulette - Date.now()) / 3600000).toFixed(1)} hours.`
          );
        }

        // If user has restricted bets
        if (dbUser.betsLocked) {
          return socket.emit(
            "game-join-error",
            "Your account has an betting restriction. Please contact support for more information."
          );
        }

        // If user can afford this bet
        if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
          return socket.emit("game-join-error", "You can't afford this bet!");
        }

// Check if the user is trying to bet on both red and black in the same round
if (
  GAME_STATE.players.some(
    player =>
      player._id === user.id &&
      (player.color === "red" || player.color === "black") &&
      (color === "red" || color === "black")
  )
) {
  return socket.emit(
    "game-join-error",
    "You already placed your bet."
  );
}

// Check if the user is trying to bet on green multiple times in the same round
if (
  GAME_STATE.players.some(
    player =>
      player._id === user.id &&
      player.color === "green" &&
      color === "green"
  )
) {
  return socket.emit(
    "game-join-error",
    "You can only bet once on green in the same round!"
  );
}

        // Remove bet amount from user's balance
        await User.updateOne(
          { _id: user.id },
          {
            $inc: {
              wallet: -Math.abs(parseFloat(betAmount.toFixed(2))),
              wager: Math.abs(parseFloat(betAmount.toFixed(2))),
              wagerNeededForWithdraw: -Math.abs(
                parseFloat(betAmount.toFixed(2))
              ),
            },
          }
        );
        insertNewWalletTransaction(
          user.id,
          -Math.abs(parseFloat(betAmount.toFixed(2))),
          "Roulette play",
          { rouletteGameId: GAME_STATE._id }
        );

        // Update local wallet
        socket.emit(
          "update-wallet",
          -Math.abs(parseFloat(betAmount.toFixed(2)))
        );

        // Update user's race progress if there is an active race
        await checkAndEnterRace(
          user.id,
          Math.abs(parseFloat(betAmount.toFixed(2)))
        );

        // Contruct a new player object
        const player = {
          _id: user.id,
          username: user.username,
          avatar: user.avatar,
          color,
          betAmount: parseFloat(betAmount.toFixed(2)), // Convert two-decimal into float
          level: getVipLevelFromWager(dbUser.wager),
          betId: uuid.v4(),
        };

        // Add player to state
        GAME_STATE.players.push(player);

        // Notify clients
        io.of("/roulette").emit("new-player", player);
        return socket.emit("game-join-success");
      } catch (error) {
        console.log("Error while placing a roulette bet:", error);
        return socket.emit(
          "game-join-error",
          "Your bet couldn't be placed: Internal server error, please try again later!"
        );
      }
    });
  });
};

// Export functions
module.exports = { listen, getCurrentGame };
