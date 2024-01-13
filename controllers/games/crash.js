// Require Dependencies
const jwt = require("jsonwebtoken");
const { parallelLimit, someLimit } = require("async");
const _ = require("lodash");
const throttlerController = require("../throttler");
const config = require("../../config");
const colors = require("colors");
const {
  generatePrivateSeedHashPair,
  generateCrashRandom,
} = require("../random");
const { checkAndEnterRace, checkAndApplyRakeToRace } = require("../race");
const { checkAndApplyRakeback, getVipLevelFromWager } = require("../vip");
const { checkAndApplyAffiliatorCut } = require("../affiliates");
const { getCrashState } = require("../site-settings");
const insertNewWalletTransaction = require("../../utils/insertNewWalletTransaction");

const User = require("../../models/User");
const CrashGame = require("../../models/CrashGame");

const Usero = require("../../models/Usero");

// Declare durations for game
const TICK_RATE = 150;
const START_WAIT_TIME = 4000;
const RESTART_WAIT_TIME = 9000;

// Declare growth functions
const growthFunc = ms => Math.floor(100 * Math.pow(Math.E, 0.00006 * ms));
const inverseGrowth = result => 16666.666667 * Math.log(0.01 * result);

// Declare game states
const GAME_STATES = {
  NotStarted: 1,
  Starting: 2,
  InProgress: 3,
  Over: 4,
  Blocking: 5,
  Refunded: 6,
};

const BET_STATES = {
  Playing: 1,
  CashedOut: 2,
};

// Declare game state
const GAME_STATE = {
  _id: null,
  status: GAME_STATES.Starting,
  crashPoint: null,
  startedAt: null,
  duration: null,
  players: {},
  pending: {},
  pendingCount: 0,
  pendingBets: [],
  privateSeed: null,
  privateHash: null,
  publicSeed: null,
};

// Export state to external controllers
const getCurrentGame = () => formatGame(GAME_STATE);
const getPrivateHash = () => GAME_STATE.privateSeed;

// Format a game
const formatGame = game => {
  const formatted = {
    _id: game._id,
    status: game.status,
    startedAt: game.startedAt,
    elapsed: Date.now() - game.startedAt,
    players: _.map(game.players, p => formatPlayerBet(p)),
    privateHash: game.privateHash,
    publicSeed: game.publicSeed,
  };

  if (game.status === GAME_STATES.Over) {
    formatted.crashPoint = game.crashPoint;
  }

  return formatted;
};

// Format a game history
const formatGameHistory = game => {
  const formatted = {
    _id: game._id,
    createdAt: game.createdAt,
    privateHash: game.privateHash,
    privateSeed: game.privateSeed,
    publicSeed: game.publicSeed,
    crashPoint: game.crashPoint / 100,
  };

  return formatted;
};

// Format a player bet
const formatPlayerBet = bet => {
  const formatted = {
    playerID: bet.playerID,
    username: bet.username,
    avatar: bet.avatar,
    betAmount: bet.betAmount,
    status: bet.status,
    level: bet.level,
  };

  if (bet.status !== BET_STATES.Playing) {
    formatted.stoppedAt = bet.stoppedAt;
    formatted.winningAmount = bet.winningAmount;
  }

  return formatted;
};

// Calculate the current game payout
const calculateGamePayout = ms => {
  const gamePayout = Math.floor(100 * growthFunc(ms)) / 100;
  return Math.max(gamePayout, 1);
};

// Get socket.io instance
const listen = io => {
  // Function to emit new player bets
  const _emitPendingBets = () => {
    const bets = GAME_STATE.pendingBets;
    GAME_STATE.pendingBets = [];

    io.of("/crash").emit("game-bets", bets);
  };

  const emitPlayerBets = _.throttle(_emitPendingBets, 600);

  // Creates a new game
  const createNewGame = () => {
    return new Promise(async (resolve, reject) => {
      try {
        // Generate pre-roll provably fair data
        const provablyData = await generatePrivateSeedHashPair();

        // Push game to db
        const newGame = CrashGame({
          privateSeed: provablyData.seed,
          privateHash: provablyData.hash,
          players: {},
          status: GAME_STATES.Starting,
        });

        // Save the new document
        await newGame.save();

        console.log(
          colors.cyan("Crash >> Generated new game with the id"),
          newGame._id
        );

        resolve(newGame);
      } catch (error) {
        console.log(
          colors.cyan(`Crash >> Couldn't create a new game ${error}`)
        );
      }
    });
  };

  // Starts a new game
  const runGame = async () => {
    const game = await createNewGame();

    // Override local state
    GAME_STATE._id = game._id;
    GAME_STATE.status = GAME_STATES.Starting;
    GAME_STATE.privateSeed = game.privateSeed;
    GAME_STATE.privateHash = game.privateHash;
    GAME_STATE.publicSeed = null;
    GAME_STATE.startedAt = new Date(Date.now() + RESTART_WAIT_TIME);
    GAME_STATE.players = {};

    // Update startedAt in db
    game.startedAt = GAME_STATE.startedAt;

    await game.save();

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
    // 5% chance for bets between 8 and 120.2
    if (Math.random() <= 0.65) {
      // 65% chance for bets without decimals (full numbers)
      betAmount = Math.floor(Math.random() * (120.2 - 8)) + 8; // Generates a random integer number between 8 and 120.2
    } else {
      // 35% chance for bets with decimals
      betAmount = Math.random() * (120.2 - 8) + 8; // Generates a random decimal number between 8 and 120.2
    }
  }

  return parseFloat(betAmount.toFixed(2));
};
  
 try {
 // Get a random subset of players
 const allPlayers = await Usero.find({});
 const randomNumberOfPlayers = Math.floor(Math.random() * 4) + 8;
 const selectedPlayers = getRandomSubset(allPlayers, randomNumberOfPlayers);

 // Fake players joining
selectedPlayers.forEach((fakeUser, index) => {
 const { username, avatar, wager, _id } = fakeUser;
 const betAmount = getRandomBetAmount();
 const delay = Math.floor(Math.random() * 7 + 2) * 1000; // Generate a random delay between 2-8 seconds
 function generateRandomNumber() {
  const min = 105;
  const max = 2000;
  
  // Generate a random number between 0 and 1
  const random = Math.random();
  
  let randomNumber;

  if (random < 0.3) {
    // 30% chance of a number below 150
    randomNumber = min + Math.random() * (150 - min);
  } else if (random < 0.5) {
    // 20% chance of a number below 200
    randomNumber = min + Math.random() * (200 - min);
  } else if (random < 0.7) {
    // 20% chance of a number below 300
    randomNumber = min + Math.random() * (300 - min);
  } else {
    // Remaining 30% can be any value below 2000
    randomNumber = min + Math.random() * (max - min);
  }

  return randomNumber;
}

 setTimeout(async () => {

  const CASHOUTNUMBER = generateRandomNumber();
  GAME_STATE.pending[_id] = {
    betAmount,
    autoCashOut: CASHOUTNUMBER,
    username: username,
  };

  GAME_STATE.pendingCount++;

        // Creating new bet object
        const newBet = {
          autoCashOut: CASHOUTNUMBER,
          betAmount,
          createdAt: new Date(),
          playerID: _id,
          username: username,
          avatar: avatar,
          level: getVipLevelFromWager(wager),
          status: BET_STATES.Playing,
          forcedCashout: true,
        }

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

           // Updating in db
           const updateParam = { $set: {} };
           updateParam.$set["players." + _id] = newBet;
           await CrashGame.updateOne({ _id: GAME_STATE._id }, updateParam);
   
           // Assign to state
           GAME_STATE.players[_id] = newBet;
           GAME_STATE.pendingCount--;
   
           const formattedBet = formatPlayerBet(newBet);
           GAME_STATE.pendingBets.push(formattedBet);
           return emitPlayerBets();


   //console.log(`Player ${username} joined with a delay of ${delay / 1000} seconds`);
 }, delay);
});

} catch (error) {
  console.log("ERROR ROULETTE", error);
  delete GAME_STATE.pending[_id];
  GAME_STATE.pendingCount--;
 }

    emitStarting();
  };

  // Emits the start of the game and handles blocking
  const emitStarting = () => {
    // Emiting starting to clients
    io.of("/crash").emit("game-starting", {
      _id: GAME_STATE._id,
      privateHash: GAME_STATE.privateHash,
      timeUntilStart: RESTART_WAIT_TIME,
    });

    setTimeout(blockGame, RESTART_WAIT_TIME - 500);
  };

  // Block games for more bets
  const blockGame = () => {
    GAME_STATE.status = GAME_STATES.Blocking;

    const loop = () => {
      const ids = Object.keys(GAME_STATE.pending);
      if (GAME_STATE.pendingCount > 0) {
        console.log(
          colors.cyan(
            `Crash >> Delaying game while waiting for ${ids.length} (${ids.join(
              ", "
            )}) join(s)`
          )
        );
        return setTimeout(loop, 50);
      }

      startGame();
    };

    loop();
  };

  // Starting animation and enabling cashouts
  const startGame = async () => {
    try {
      // Generate random data
      const randomData = await generateCrashRandom(GAME_STATE.privateSeed);

      // Overriding game state
      GAME_STATE.status = GAME_STATES.InProgress;
      GAME_STATE.crashPoint = randomData.crashPoint;
      GAME_STATE.publicSeed = randomData.publicSeed;
      GAME_STATE.duration = Math.ceil(inverseGrowth(GAME_STATE.crashPoint + 1));
      GAME_STATE.startedAt = new Date();
      GAME_STATE.pending = {};
      GAME_STATE.pendingCount = 0;

      console.log(
        colors.cyan("Crash >> Starting new game"),
        GAME_STATE._id,
        colors.cyan("with crash point"),
        GAME_STATE.crashPoint / 100
      );

      // Updating in db
      await CrashGame.updateOne(
        { _id: GAME_STATE._id },
        {
          status: GAME_STATES.InProgress,
          crashPoint: GAME_STATE.crashPoint,
          publicSeed: GAME_STATE.publicSeed,
          startedAt: GAME_STATE.startedAt,
        }
      );

      // Emiting start to clients
      io.of("/crash").emit("game-start", {
        publicSeed: GAME_STATE.publicSeed,
      });

      callTick(0);
    } catch (error) {
      console.log("Error while starting a crash game:", error);

      // Notify clients that we had an error
      io.of("/crash").emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry starting the game
        startGame();

        return clearTimeout(timeout);
      }, 15000);
    }
  };

  // Calculate next tick time
  const callTick = elapsed => {
    // Calculate next tick
    const left = GAME_STATE.duration - elapsed;
    const nextTick = Math.max(0, Math.min(left, TICK_RATE));

    setTimeout(runTick, nextTick);
  };

  // Run the current tick
  const runTick = () => {
    // Calculate elapsed time
    const elapsed = new Date() - GAME_STATE.startedAt;
    const at = growthFunc(elapsed);

    // Completing all auto cashouts
    runCashOuts(at);

    // Check if crash point is reached
    if (at > GAME_STATE.crashPoint) {
      endGame();
    } else {
      tick(elapsed);
    }
  };

  // Handles auto cashout for users
  const runCashOuts = elapsed => {
    _.each(GAME_STATE.players, bet => {
      // Check if bet is still active
      if (bet.status !== BET_STATES.Playing) return;

      // Check if the auto cashout is reached or max profit is reached
      if (
        bet.autoCashOut >= 101 &&
        bet.autoCashOut <= elapsed &&
        bet.autoCashOut <= GAME_STATE.crashPoint
      ) {
        doCashOut(bet.playerID, bet.autoCashOut, false, err => {
          if (err) {
            console.log(
              colors.cyan(
                `Crash >> There was an error while trying to cashout`
              ),
              err
            );
          }
        });
      } else if (
        bet.betAmount * (elapsed / 100) >= config.games.crash.maxProfit &&
        elapsed <= GAME_STATE.crashPoint
      ) {
        doCashOut(bet.playerID, elapsed, true, err => {
          if (err) {
            console.log(
              colors.cyan(
                `Crash >> There was an error while trying to cashout`
              ),
              err
            );
          }
        });
      }
    });
  };

  // Handle cashout request
  const doCashOut = async (playerID, elapsed, forced, cb) => {
    //console.log(colors.cyan("Crash >> Doing cashout for"), playerID);

    // Check if bet is still active
    if (GAME_STATE.players[playerID].status !== BET_STATES.Playing) return;

    // Update player state
    GAME_STATE.players[playerID].status = BET_STATES.CashedOut;
    GAME_STATE.players[playerID].stoppedAt = elapsed;
    if (forced) GAME_STATE.players[playerID].forcedCashout = true;

    const bet = GAME_STATE.players[playerID];

    // Calculate winning amount
    const winningAmount = parseFloat(
      (
        bet.betAmount *
        ((bet.autoCashOut === bet.stoppedAt ? bet.autoCashOut : bet.stoppedAt) /
          100)
      ).toFixed(2)
    );

    GAME_STATE.players[playerID].winningAmount = winningAmount;

    if (cb) cb(null, GAME_STATE.players[playerID]);

    const { status, stoppedAt } = GAME_STATE.players[playerID];

    // Emiting cashout to clients
    io.of("/crash").emit("bet-cashout", {
      playerID,
      status,
      stoppedAt,
      winningAmount,
    });

    // Giving winning balance to user
    await User.updateOne(
      { _id: playerID },
      {
        $inc: {
          wallet: Math.abs(winningAmount),
        },
      }
    );

    insertNewWalletTransaction(playerID, Math.abs(winningAmount), "Crash win", {
      crashGameId: GAME_STATE._id,
    });

    // Update local wallet
    io.of("/crash").to(playerID).emit("update-wallet", Math.abs(winningAmount));

    // Updating in db
    const updateParam = { $set: {} };
    updateParam.$set["players." + playerID] = GAME_STATE.players[playerID];
    await CrashGame.updateOne({ _id: GAME_STATE._id }, updateParam);
  };

  // Handle end request
  const endGame = async () => {
    console.log(
      colors.cyan(`Crash >> Ending game at`),
      GAME_STATE.crashPoint / 100
    );

    const crashTime = Date.now();

    GAME_STATE.status = GAME_STATES.Over;

    // Notify clients
    io.of("/crash").emit("game-end", {
      game: formatGameHistory(GAME_STATE),
    });

    // Run new game after start wait time
    setTimeout(() => {
      runGame();
    }, crashTime + START_WAIT_TIME - Date.now());

    // Updating in db
    await CrashGame.updateOne(
      { _id: GAME_STATE._id },
      {
        status: GAME_STATES.Over,
      }
    );
  };

  // Emits game tick to client
  const tick = elapsed => {
    io.of("/crash").emit("game-tick", calculateGamePayout(elapsed) / 100);
    callTick(elapsed);
  };

  // Handle refunds of old unfinished games
  const refundGames = async games => {
    for (let game of games) {
      console.log(colors.cyan(`Crash >> Refunding game`), game._id);

      const refundedPlayers = [];

      try {
        for (let playerID in game.players) {
          const bet = game.players[playerID];

          if (bet.status == BET_STATES.Playing) {
            // Push Player ID to the refunded players
            refundedPlayers.push(playerID);

            console.log(
              colors.cyan(
                `Crash >> Refunding player ${playerID} for ${bet.betAmount}`
              )
            );

            // Refund player
            await User.updateOne(
              { _id: playerID },
              {
                $inc: {
                  wallet: Math.abs(bet.betAmount),
                },
              }
            );
            insertNewWalletTransaction(
              playerID,
              Math.abs(bet.betAmount),
              "Crash refund",
              { crashGameId: game._id }
            );
          }
        }

        game.refundedPlayers = refundedPlayers;
        game.status = GAME_STATES.Refunded;
        await game.save();
      } catch (error) {
        console.log(
          colors.cyan(
            `Crash >> Error while refunding crash game ${GAME_STATE._id}: ${error}`
          )
        );
      }
    }
  };

  // Refunds old unfinished games and inits new one
  const initGame = async () => {
    console.log(colors.cyan("Crash >> Starting up"));

    const unfinishedGames = await CrashGame.find({
      $or: [
        { status: GAME_STATES.Starting },
        { status: GAME_STATES.Blocking },
        { status: GAME_STATES.InProgress },
      ],
    });

    if (unfinishedGames.length > 0) {
      console.log(
        colors.cyan(`Crash >> Ending`),
        unfinishedGames.length,
        colors.cyan(`unfinished games`)
      );
      await refundGames(unfinishedGames);
    }

    runGame();
  };

  // Init the gamemode
  initGame();

  // Listen for new websocket connections
  io.of("/crash").on("connection", socket => {
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
     * @param {number} target Auto cashout target
     * @param {number} betAmount Bet amount
     */
    socket.on("join-game", async (target, betAmount) => {
      // Validate user input
      if (typeof betAmount !== "number" || isNaN(betAmount))
        return socket.emit("game-join-error", "Invalid betAmount type!");
      if (!loggedIn)
        return socket.emit("game-join-error", "You are not logged in!");

      // Get crash enabled status
      const isEnabled = getCrashState();

      // If crash is disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error",
          "Crash is currently disabled! Contact admins for more information."
        );
      }

      // More validation on the bet value
      const { minBetAmount, maxBetAmount } = config.games.crash;
      if (
        parseFloat(betAmount.toFixed(2)) < minBetAmount ||
        parseFloat(betAmount.toFixed(2)) > maxBetAmount
      ) {
        return socket.emit(
          "game-join-error",
          `Your bet must be a minimum of ${minBetAmount} credits and a maximum of ${maxBetAmount} credits!`
        );
      }

      // Check if game accepts bets
      if (GAME_STATE.status !== GAME_STATES.Starting)
        return socket.emit("game-join-error", "Game is currently in progress!");
      // Check if user already betted
      if (GAME_STATE.pending[user.id] || GAME_STATE.players[user.id])
        return socket.emit(
          "game-join-error",
          "You have already joined this game!"
        );

      let autoCashOut = -1;

      // Validation on the target value, if acceptable assign to auto cashout
      if (typeof target === "number" && !isNaN(target) && target > 100) {
        autoCashOut = target;
      }

      GAME_STATE.pending[user.id] = {
        betAmount,
        autoCashOut,
        username: user.username,
      };

      GAME_STATE.pendingCount++;

      try {
        // Get user from database
        const dbUser = await User.findOne({ _id: user.id });

        // If user is self-excluded
        if (dbUser.selfExcludes.crash > Date.now()) {
          return socket.emit(
            "game-join-error",
            `You have self-excluded yourself for another ${((dbUser.selfExcludes.crash - Date.now()) / 3600000).toFixed(1)} hours.`
          );
        }

        // If user has restricted bets
        if (dbUser.betsLocked) {
          delete GAME_STATE.pending[user.id];
          GAME_STATE.pendingCount--;
          return socket.emit(
            "game-join-error",
            "Your account has an betting restriction. Please contact support for more information."
          );
        }

        // If user can afford this bet
        if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
          delete GAME_STATE.pending[user.id];
          GAME_STATE.pendingCount--;
          return socket.emit("game-join-error", "You can't afford this bet!");
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
          "Crash play",
          { crashGameId: GAME_STATE._id }
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

        // Calculate house edge
        const houseRake =
          parseFloat(betAmount.toFixed(2)) * config.games.crash.houseEdge;

        // Apply 5% rake to current race prize pool
        await checkAndApplyRakeToRace(houseRake * 0.05);

        // Apply user's rakeback if eligible
        await checkAndApplyRakeback(user.id, houseRake);

        // Apply cut of house edge to user's affiliator
        await checkAndApplyAffiliatorCut(user.id, houseRake);

        // Creating new bet object
        const newBet = {
          autoCashOut,
          betAmount,
          createdAt: new Date(),
          playerID: user.id,
          username: user.username,
          avatar: user.avatar,
          level: getVipLevelFromWager(dbUser.wager),
          status: BET_STATES.Playing,
          forcedCashout: false,
        };

        // Updating in db
        const updateParam = { $set: {} };
        updateParam.$set["players." + user.id] = newBet;
        await CrashGame.updateOne({ _id: GAME_STATE._id }, updateParam);

        // Assign to state
        GAME_STATE.players[user.id] = newBet;
        GAME_STATE.pendingCount--;

        const formattedBet = formatPlayerBet(newBet);
        GAME_STATE.pendingBets.push(formattedBet);
        emitPlayerBets();

        return socket.emit("game-join-success", formattedBet);
      } catch (error) {
        console.error(error);

        delete GAME_STATE.pending[user.id];
        GAME_STATE.pendingCount--;

        return socket.emit(
          "game-join-error",
          "There was an error while proccessing your bet"
        );
      }
    });

    /**
     * @description Cashout the current bet
     */
    socket.on("bet-cashout", async () => {
      if (!loggedIn)
        return socket.emit("bet-cashout-error", "You are not logged in!");

      // Check if game is running
      if (GAME_STATE.status !== GAME_STATES.InProgress)
        return socket.emit(
          "bet-cashout-error",
          "There is no game in progress!"
        );

      // Calculate the current multiplier
      const elapsed = new Date() - GAME_STATE.startedAt;
      let at = growthFunc(elapsed);

      // Check if cashout is over 1x
      if (at < 101)
        return socket.emit(
          "bet-cashout-error",
          "The minimum cashout is 1.01x!"
        );

      // Find bet from state
      const bet = GAME_STATE.players[user.id];

      // Check if bet exists
      if (!bet)
        return socket.emit("bet-cashout-error", "Coudn't find your bet!");

      // Check if the current multiplier is over the auto cashout
      if (bet.autoCashOut > 100 && bet.autoCashOut <= at) {
        at = bet.autoCashOut;
      }

      // Check if current multiplier is even possible
      if (at > GAME_STATE.crashPoint)
        return socket.emit("bet-cashout-error", "The game has already ended!");

      // Check if user already cashed out
      if (bet.status !== BET_STATES.Playing)
        return socket.emit("bet-cashout-error", "You have already cashed out!");

      // Send cashout request to handler
      doCashOut(bet.playerID, at, false, (err, result) => {
        if (err) {
          console.log(
            colors.cyan(
              `Crash >> There was an error while trying to cashout a player`
            ),
            err
          );
          return socket.emit(
            "bet-cashout-error",
            "There was an error while cashing out!"
          );
        }

        socket.emit("bet-cashout-success", result);
      });
    });
  });
};

// Export functions
module.exports = {
  listen,
  getCurrentGame,
  getPrivateHash,
  formatGame,
  formatGameHistory,
};
