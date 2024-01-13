// Require Dependencies
const jwt = require("jsonwebtoken");
const uuid = require("uuid");
const mongoose = require("mongoose");
const throttlerController = require("../throttler");
const config = require("../../config");
const colors = require("colors");
const {
  generatePrivateSeedHashPair,
  generateCoinflipRandom,
} = require("../random");
const { verifyRecaptchaResponse } = require("../recaptcha");
const { checkAndEnterRace, checkAndApplyRakeToRace } = require("../race");
const { checkAndApplyRakeback, getVipLevelFromWager } = require("../vip");
const { checkAndApplyAffiliatorCut } = require("../affiliates");
const { getCoinflipState } = require("../site-settings");
const insertNewWalletTransaction = require("../../utils/insertNewWalletTransaction");

const User = require("../../models/User");
const CoinflipGame = require("../../models/CoinflipGame");

// Calculate winner from random data
const getWinningSide = async (playerAmount, randomModule) => {
  return new Promise((resolve, reject) => {
    if (playerAmount === 2) {
      resolve(randomModule < 30 ? "red" : "blue");
    } else if (playerAmount === 3) {
      resolve(randomModule < 20 ? "red" : randomModule < 40 ? "blue" : "green");
    } else if (playerAmount === 4) {
      resolve(
        randomModule < 15
          ? "red"
          : randomModule < 30
            ? "blue"
            : randomModule < 45
              ? "green"
              : "yellow"
      );
    } else {
      reject(new Error("Couldn't calculate winner: Invalid player amount!"));
    }
  });
};

// Client animation length in milliseconds
const CLIENT_ANIMATION_LENGTH = 8500; // animation lenght

// Get socket.io instance
const listen = io => {
  // Listen for new websocket connections
  io.of("/coinflip").on("connection", socket => {
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
     * @description Create a new coinflip game
     *
     * @param {number} players How many players (2, 3 or 4)
     * @param {string} color What color is the side
     * @param {number} betAmount Bet amount
     * @param {boolean} private Whether this is a private game
     * @param {number} costMultiplier How much is paid for the opponents (0 < costMultiplier < 1)
     */
    socket.on(
      "create-new-game",
      async (players, color, betAmount, private, costMultiplier) => {
        // Validate user input
        if (typeof players !== "number" || ![2, 3, 4].includes(players))
          return socket.emit("game-creation-error", "Invalid Players Type!");
        if (
          typeof color !== "string" ||
          !["red", "blue", "yellow", "green"].includes(color)
        )
          return socket.emit("game-creation-error", "Invalid Color Type!");
        if (typeof betAmount !== "number" || isNaN(betAmount))
          return socket.emit("game-creation-error", "Invalid Bet Amount Type!");
        if (
          typeof costMultiplier !== "number" ||
          isNaN(costMultiplier) ||
          parseFloat(costMultiplier.toFixed(2)) > 1 ||
          parseFloat(costMultiplier.toFixed(2)) < 0
        )
          return socket.emit(
            "game-creation-error",
            "Invalid Cost multiplier type!"
          );
        if (typeof private !== "boolean")
          return socket.emit(
            "game-creation-error",
            "Invalid Private toggle type!"
          );
        if (!loggedIn)
          return socket.emit("game-creation-error", "You are not logged in!");

        // Get coinflip enabled status
        const isEnabled = getCoinflipState();

        // If coinflip are disabled
        if (!isEnabled) {
          return socket.emit(
            "game-creation-error",
            "Coinflip gamemode is currently disabled! Contact admins for more information."
          );
        }

        // More validation on the bet value
        const { minBetAmount, maxBetAmount } = config.games.coinflip;
        if (
          parseFloat(betAmount.toFixed(2)) < minBetAmount ||
          parseFloat(betAmount.toFixed(2)) > maxBetAmount
        ) {
          return socket.emit(
            "game-creation-error",
            `Your bet must be a minimum of ${minBetAmount} credits and a maximum of ${maxBetAmount} credits!`
          );
        }

        // Check if color is not in the game
        const disabledColors =
          players === 2 ? ["green", "yellow"] : players === 3 ? ["yellow"] : [];
        if (disabledColors.includes(color)) {
          return socket.emit(
            "game-creation-error",
            "Cannot select this color!"
          );
        }

        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.coinflip > Date.now()) {
            return socket.emit(
              "game-join-error",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.coinflip - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-creation-error",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // If it's an private game
          if (private) {
            const playerAmount = players - 1;
            const gamePrice =
              parseFloat(betAmount.toFixed(2)) +
              parseFloat(betAmount.toFixed(2)) *
              parseFloat(costMultiplier.toFixed(2)) *
              playerAmount;

            // If user can afford this bet
            if (dbUser.wallet < gamePrice) {
              return socket.emit(
                "game-creation-error",
                "You can't afford this bet!"
              );
            }

            const newGame = new CoinflipGame();

            // Remove bet amount from user's balance
            await User.updateOne(
              { _id: user.id },
              {
                $inc: {
                  wallet: -Math.abs(gamePrice),
                  wager: Math.abs(gamePrice),
                  wagerNeededForWithdraw: -Math.abs(gamePrice),
                },
              }
            );
            insertNewWalletTransaction(
              user.id,
              -Math.abs(gamePrice),
              "Coinflip game creation",
              { coinflipGameId: newGame.id }
            );

            // Update local wallet
            socket.emit("update-wallet", -Math.abs(gamePrice));

            // Update user's race progress if there is an active race
            await checkAndEnterRace(user.id, Math.abs(gamePrice));

            // Calculate house edge
            const houseEdge =
              parseFloat(betAmount.toFixed(2)) *
              config.games.coinflip.feePercentage;

            // Apply user's rakeback if eligible
            await checkAndApplyRakeback(user.id, houseEdge);

            // Apply cut of house edge to user's affiliator
            await checkAndApplyAffiliatorCut(user.id, houseEdge);

            // Generate pre-roll provably fair data
            const provablyData = await generatePrivateSeedHashPair();

            // Create unique invite code for this game
            const inviteCode = uuid.v4();

            // Create new document
            // Basic fields
            newGame.betAmount = parseFloat(betAmount.toFixed(2));
            newGame.privateGame = true;
            newGame.playerAmount = players;
            newGame.costMultiplier = parseFloat(costMultiplier.toFixed(2)); // How many percentage of the joining cost does the creator pay (only for private games)
            newGame.inviteCode = inviteCode; // Custom invite link (only for private games)
            newGame.totalBetAmount = (players * (parseFloat(betAmount.toFixed(2)))); // Total Bet amount of all players

            // Provably Fair fields
            newGame.privateSeed = provablyData.seed;
            newGame.privateHash = provablyData.hash;

            // All players that joined
            newGame.players = [
              {
                _id: user.id,
                username: user.username,
                avatar: user.avatar,
                level: getVipLevelFromWager(dbUser.wager),
                color,
              },
            ];

            // UserID of who created this game
            newGame._creator = user.id;

            // Save the document
            await newGame.save();

            // Create invite link for this game
            const inviteLink = `/coinflip/private/${inviteCode}`;

            // Construct a object without seed
            const parsedGame = {
              ...newGame.toObject(),
              ownPrivateGame: true,
              inviteLink,
            };
            delete parsedGame.privateSeed;

            // Notify client
            io.of("/coinflip").emit("new-coinflip-game", parsedGame);
            //socket.emit("new-coinflip-game", parsedGame);
            socket.emit("private-game-created", inviteLink);
            //socket.emit("notify-success", "Successfully created a new game!");

            console.log(
              colors.cyan("Coinflip >> Created a new game"),
              newGame.id,
              colors.cyan("worth"),
              `$${parseFloat(betAmount.toFixed(2))}.`,
              colors.cyan("Private:"),
              private
            );
          } else {
            // If user can afford this bet
            if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
              return socket.emit(
                "game-creation-error",
                "You can't afford this bet!"
              );
            }

            const newGame = new CoinflipGame();

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
              "Coinflip game creation",
              { coinflipGameId: newGame.id }
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
            const houseEdge =
              parseFloat(betAmount.toFixed(2)) *
              config.games.coinflip.feePercentage;

            // Apply user's rakeback if eligible
            await checkAndApplyRakeback(user.id, houseEdge);

            // Apply cut of house edge to user's affiliator
            await checkAndApplyAffiliatorCut(user.id, houseEdge);

            // Generate pre-roll provably fair data
            const provablyData = await generatePrivateSeedHashPair();

            // Basic fields
            newGame.betAmount = parseFloat(betAmount.toFixed(2));
            newGame.privateGame = false;
            newGame.playerAmount = players;
            newGame.costMultiplier = 0; // How many percentage of the joining cost does the creator pay (only for private games)
            newGame.inviteCode = null; // Custom invite link (only for private games)
            newGame.totalBetAmount = (players * (parseFloat(betAmount.toFixed(2)))); // Total Bet amount of all players

            // Provably Fair fields
            newGame.privateSeed = provablyData.seed;
            newGame.privateHash = provablyData.hash;

            // All players that joined
            newGame.players = [
              {
                _id: user.id,
                username: user.username,
                avatar: user.avatar,
                level: getVipLevelFromWager(dbUser.wager),
                color,
              },
            ];

            // UserID of who created this game
            newGame._creator = user.id;

            // Save the document
            await newGame.save();

            // Construct a object without seed
            const parsedGame = { ...newGame.toObject() };
            delete parsedGame.privateSeed;

            // Notify clients
            io.of("/coinflip").emit("new-coinflip-game", parsedGame);
            //socket.emit("notify-success", "Successfully created a new game!");

            console.log(
              colors.cyan("Coinflip >> Created a new game"),
              newGame.id,
              colors.cyan("worth"),
              `$${parseFloat(betAmount.toFixed(2))}.`,
              colors.cyan("Private:"),
              private
            );
          }
        } catch (error) {
          console.log("Error while creating Coinflip game:", error);
          return socket.emit(
            "game-creation-error",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      }
    );

    /**
     * @description Join a coinflip game
     *
     * @param {string} gameId The game's GameID
     * @param {string} color What color side to bet on
     * @param {string} recaptchaResponse Required if game type is private
     */
    socket.on("join-game", async (gameId, color, recaptchaResponse) => {
      // Validate user input
      if (typeof gameId !== "string" || gameId.length !== 24)
        return socket.emit("game-join-error", "Invalid GameID Type!");
      if (
        typeof color !== "string" ||
        !["red", "blue", "yellow", "green"].includes(color)
      )
        return socket.emit("game-join-error", "Invalid Color Type!");
      if (!loggedIn)
        return socket.emit("game-join-error", "You are not logged in!");

      // Get coinflip enabled status
      const isEnabled = getCoinflipState();

      // If coinflip are disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error",
          "Coinflip gamemode is currently disabled! Contact admins for more information."
        );
      }

      try {
        // Get user from database
        const dbUser = await User.findOne({ _id: user.id });

        // If user is self-excluded
        if (dbUser.selfExcludes.coinflip > Date.now()) {
          return socket.emit(
            "game-join-error",
            `You have self-excluded yourself for another ${((dbUser.selfExcludes.coinflip - Date.now()) / 3600000).toFixed(1)} hours.`
          );
        }

        // If user has restricted bets
        if (dbUser.betsLocked) {
          return socket.emit(
            "game-join-error",
            "Your account has an betting restriction. Please contact support for more information."
          );
        }

        // Find game from DB
        const game = await CoinflipGame.findOne({ _id: gameId, status: 1 });

        // If this game exists
        if (!game) {
          return socket.emit(
            "game-join-error",
            "Couldn't find an active game with that GameID!"
          );
        }

        // Check if user has already joined this game
        if (game.players.map(player => player._id).includes(user.id)) {
          return socket.emit(
            "game-join-error",
            "You have already joined this game!"
          );
        }

        // Check if that color is already taken
        if (game.players.map(player => player.color).includes(color)) {
          return socket.emit(
            "game-join-error",
            "This side has already been selected!"
          );
        }

        // Check if color is not in the game
        const disabledColors =
          game.playerAmount === 2
            ? ["green", "yellow"]
            : game.playerAmount === 3
              ? ["yellow"]
              : [];
        if (disabledColors.includes(color)) {
          return socket.emit("game-join-error", "This side is not in the game!");
        }

        // Check if this is an private game
        if (game.privateGame) {
          // Verify reCaptcha response
          const valid = await verifyRecaptchaResponse(recaptchaResponse);

          // If captcha wasn't valid
          if (!valid) {
            return socket.emit(
              "game-join-error",
              "Your captcha wasn't valid, please try again later!"
            );
          }

          // Calculate bet amount
          const betAmount =
            game.betAmount - game.betAmount * game.costMultiplier;

          // Check if user can afford this bet
          if (dbUser.wallet < betAmount) {
            return socket.emit("game-join-error", "You can't afford this bet!");
          }

          // Remove bet amount from user's balance
          await User.updateOne(
            { _id: user.id },
            {
              $inc: {
                wallet: -Math.abs(betAmount),
                wager: Math.abs(betAmount),
                wagerNeededForWithdraw: -Math.abs(betAmount),
              },
            }
          );
          insertNewWalletTransaction(
            user.id,
            -Math.abs(betAmount),
            "Coinflip game join",
            { coinflipGameId: game.id }
          );

          // Update local wallet
          socket.emit("update-wallet", -Math.abs(betAmount));

          // Update user's race progress if there is an active race
          await checkAndEnterRace(user.id, Math.abs(betAmount));

          // Calculate house edge
          const houseEdge = betAmount * config.games.coinflip.feePercentage;

          // Apply user's rakeback if eligible
          await checkAndApplyRakeback(user.id, houseEdge);

          // Apply cut of house edge to user's affiliator
          await checkAndApplyAffiliatorCut(user.id, houseEdge);
        } else {
          // Check if user can afford this bet
          if (dbUser.wallet < game.betAmount) {
            return socket.emit("game-join-error", "You can't afford this bet!");
          }

          // Remove bet amount from user's balance
          await User.updateOne(
            { _id: user.id },
            {
              $inc: {
                wallet: -Math.abs(game.betAmount),
                wager: Math.abs(game.betAmount),
                wagerNeededForWithdraw: -Math.abs(game.betAmount),
              },
            }
          );
          insertNewWalletTransaction(
            user.id,
            -Math.abs(game.betAmount),
            "Coinflip game join",
            { coinflipGameId: game.id }
          );

          // Update local wallet
          socket.emit("update-wallet", -Math.abs(game.betAmount));

          // Update user's race progress if there is an active race
          await checkAndEnterRace(user.id, Math.abs(game.betAmount));

          // Calculate house edge
          const houseEdge = game.betAmount * config.games.coinflip.feePercentage;

          // Apply user's rakeback if eligible
          await checkAndApplyRakeback(user.id, houseEdge);

          // Apply cut of house edge to user's affiliator
          await checkAndApplyAffiliatorCut(user.id, houseEdge);
        }

        // Construct a new player object
        const newPlayer = {
          _id: user.id,
          username: user.username,
          avatar: user.avatar,
          level: getVipLevelFromWager(dbUser.wager),
          color,
        };

        // Whether game is full and should roll
        const shouldRoll = game.playerAmount === game.players.length + 1;

        // Update document to disable joining
        await CoinflipGame.updateOne(
          { _id: game.id },
          {
            $set: { status: shouldRoll ? 2 : 1 },
            $push: { players: newPlayer },
          }
        );

        // Notify clients
        socket.emit("game-join-success");
        io.of("/coinflip").emit("game-joined", { _id: game.id, newPlayer });

        // If game should roll
        if (shouldRoll) {
          io.of("/coinflip").emit("game-rolling", game.id);
          console.log(colors.cyan("Coinflip >> Rolling game"), game.id);

          // Generate random data
          const randomData = await generateCoinflipRandom(
            game.id,
            game.privateSeed
          );

          // Calculate winner
          const winningSide = await getWinningSide(
            game.playerAmount,
            randomData.module
          );

          // Add new player to the cached players array
          const newPlayers = [...game.players, newPlayer];

          const winner = newPlayers.find(player => player.color === winningSide);

          // Update document
          await CoinflipGame.updateOne(
            { _id: game.id },
            {
              $set: {
                publicSeed: randomData.publicSeed,
                randomModule: randomData.module,
                privateSeed: game.privateSeed,
                _winner: winner._id,
                winningSide: winningSide,
                status: 3,
              },
            }
          );



          // Calculate profit
          const profit = game.betAmount * game.playerAmount;
          const houseRake = profit * config.games.coinflip.feePercentage;
          const feeMultiplier = 1 - config.games.coinflip.feePercentage;
          const wonAmount = profit * feeMultiplier;

          console.log(
            colors.cyan("Coinflip >> Game"),
            game.id,
            colors.cyan("rolled, winner:"),
            winner.username,
            `(${winningSide}, profit: ${wonAmount}, house edge amount: ${houseRake})`
          );

          // Payout winner
          if (game.privateGame) {
            const winnerDoc = await User.findOne({ _id: winner._id });

            await User.updateOne(
              { _id: winner._id },
              {
                $inc: {
                  wallet: Math.abs(wonAmount),
                  wagerNeededForWithdraw:
                    winnerDoc.wagerNeededForWithdraw < 0
                      ? Math.abs(winnerDoc.wagerNeededForWithdraw) +
                      wonAmount * 0.5
                      : wonAmount * 0.5, // Add 50% to required wager amount
                },
              }
            );
          } else {
            await User.updateOne(
              { _id: winner._id },
              {
                $inc: {
                  wallet: Math.abs(wonAmount),
                },
              }
            );
          }

          insertNewWalletTransaction(
            winner._id,
            Math.abs(wonAmount),
            "Coinflip game win",
            { coinflipGameId: game.id }
          );

          // Apply 0.5% rake to current race prize pool
          await checkAndApplyRakeToRace(houseRake * 0.005);

          // Notify clients
          io.of("/coinflip").emit("game-rolled", {
            _id: game.id,
            winningSide,
            randomModule: randomData.module,
            publicSeed: randomData.publicSeed,
            privateSeed: game.privateSeed,
          });

          // Wait for the animation
          setTimeout(() => {
            // Update local wallet
            io.of("/coinflip")
              .to(winner._id)
              .emit("update-wallet", Math.abs(wonAmount));
          }, CLIENT_ANIMATION_LENGTH);
        }
      } catch (error) {
        console.log("Error while joining Coinflip game:", error);
        return socket.emit(
          "game-join-error",
          "Your bet couldn't be placed: Internal server error, please try again later!"
        );
      }
    });

    /**
     * @description Call bot for a coinflip game
     *
     * @param {string} gameId The game's GameID
     */
    socket.on("call-bot", async gameId => {
      // Validate user input
      if (typeof gameId !== "string" || gameId.length !== 24)
        return socket.emit("game-call-bot-error", "Invalid GameID Type!");
      if (!loggedIn)
        return socket.emit("game-call-bot-error", "You are not logged in!");

      // Get coinflip enabled status
      const isEnabled = getCoinflipState();

      // If coinflip are disabled
      if (!isEnabled) {
        return socket.emit(
          "game-call-bot-error",
          "Coinflip gamemode is currently disabled! Contact admins for more information."
        );
      }

      try {
        // Get user from database
        const dbUser = await User.findOne({ _id: user.id });

        // If user has restricted bets
        if (dbUser.betsLocked) {
          return socket.emit(
            "game-call-bot-error",
            "Your account has an betting restriction. Please contact support for more information."
          );
        }

        // Find game from DB
        const game = await CoinflipGame.findOne({ _id: gameId, status: 1 });

        // If this game exists
        if (!game) {
          return socket.emit(
            "game-call-bot-error",
            "Couldn't find an active game with that GameID!"
          );
        }

        // Check if bot slots are available
        if (game.players.length === game.playerAmount) {
          return socket.emit(
            "game-call-bot-error",
            "This game is already full!"
          );
        }

        // Check if user is in the coinflip game
        if (!game.players.map(player => player._id).includes(user.id)) {
          return socket.emit(
            "game-call-bot-error",
            "You are not in this game!"
          );
        }

        // Check if user already voted for a bot
        if (game.voteBot.includes(user.id)) {
          return socket.emit(
            "game-call-bot-error",
            "You already voted for a bot!"
          );
        }

        // Whether game is full and should roll
        const shouldFill = game.players.length === game.voteBot.length + 1;

        // Update document
        await CoinflipGame.updateOne(
          { _id: game.id },
          {
            $push: { voteBot: user.id },
          }
        );

        // Notify clients
        socket.emit("game-call-bot-success");
        io.of("/coinflip").emit("game-called-bot", {
          _id: game.id,
          playerId: user.id,
        });

        if (shouldFill) {
          // Define a cached players array to choose winner
          const newPlayers = game.players;

          // Update document to disable joining
          await CoinflipGame.updateOne(
            { _id: game.id },
            {
              $set: {
                status: 2,
                isBotCalled: true,
              },
            }
          );

          // Get the colors that need to be filled
          let fillColors =
            game.playerAmount === 2
              ? ["red", "blue"]
              : game.playerAmount === 3
                ? ["red", "blue", "green"]
                : ["red", "blue", "green", "yellow"];

          // Filter out already joined colors
          game.players.forEach(player => {
            fillColors = fillColors.filter(color => color !== player.color);
          });

          fillColors.forEach(async color => {
            // Construct a new player object
            const newPlayer = {
              _id: mongoose.Types.ObjectId(),
              username: "Bot",
              avatar: "",
              color,
              level: {
                name: 69
              },
              isBot: true,
            };

            // Update document to disable joining
            await CoinflipGame.updateOne(
              { _id: game.id },
              {
                $push: { players: newPlayer },
              }
            );

            // Push to cached players array
            newPlayers.push(newPlayer);

            // Notify clients
            io.of("/coinflip").emit("game-joined", { _id: game.id, newPlayer });
          });

          io.of("/coinflip").emit("game-rolling", game.id);
          console.log(colors.cyan("Coinflip >> Rolling game"), game.id);

          // Generate random data
          const randomData = await generateCoinflipRandom(
            game.id,
            game.privateSeed
          );

          // Calculate winner
          const winningSide = await getWinningSide(
            game.playerAmount,
            randomData.module
          );

          const winner = newPlayers.find(player => player.color === winningSide);

          // Update document
          await CoinflipGame.updateOne(
            { _id: game.id },
            {
              $set: {
                publicSeed: randomData.publicSeed,
                randomModule: randomData.module,
                privateSeed: game.privateSeed,
                _winner: winner._id,
                winningSide: winningSide,
                status: 3,
              },
            }
          );



          // Calculate profit
          const profit = game.betAmount * game.playerAmount;
          const houseRake = profit * config.games.coinflip.feePercentage;
          const feeMultiplier = 1 - config.games.coinflip.feePercentage;
          const wonAmount = profit * feeMultiplier;

          console.log(
            colors.cyan("Coinflip >> Game"),
            game.id,
            colors.cyan("rolled, winner:"),
            winner.username,
            `(${winningSide}, profit: ${wonAmount}, house edge amount: ${houseRake})`
          );

          // Only payout if the winner is a real player
          if (!winner.isBot) {
            // Payout winner
            if (game.privateGame) {
              const winnerDoc = await User.findOne({ _id: winner._id });

              await User.updateOne(
                { _id: winner._id },
                {
                  $inc: {
                    wallet: Math.abs(wonAmount),
                    wagerNeededForWithdraw:
                      winnerDoc.wagerNeededForWithdraw < 0
                        ? Math.abs(winnerDoc.wagerNeededForWithdraw) +
                        wonAmount * 0.5
                        : wonAmount * 0.5, // Add 50% to required wager amount
                  },
                }
              );
            } else {
              await User.updateOne(
                { _id: winner._id },
                {
                  $inc: {
                    wallet: Math.abs(wonAmount),
                  },
                }
              );
            }

            insertNewWalletTransaction(
              winner._id,
              Math.abs(wonAmount),
              "Coinflip game win",
              { coinflipGameId: game.id }
            );
          }

          // Apply 0.5% rake to current race prize pool
          await checkAndApplyRakeToRace(houseRake * 0.005);

          // Notify clients
          io.of("/coinflip").emit("game-rolled", {
            _id: game.id,
            winningSide,
            randomModule: randomData.module,
            publicSeed: randomData.publicSeed,
            privateSeed: game.privateSeed,
          });

          // Wait for the animation
          if (!winner.isBot)
            setTimeout(() => {
              // Update local wallet
              io.of("/coinflip")
                .to(winner._id)
                .emit("update-wallet", Math.abs(wonAmount));
            }, CLIENT_ANIMATION_LENGTH);
        }
      } catch (error) {
        console.log("Error while calling bot for a Coinflip game:", error);
        return socket.emit(
          "game-call-bot-error",
          "A bot couldn't bet called: Internal server error, please try again later!"
        );
      }
    });
  });
};

// Export functions
module.exports = { listen };
