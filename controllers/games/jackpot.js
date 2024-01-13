// Require Dependencies
const jwt = require("jsonwebtoken");
const uuid = require("uuid");
const mongoose = require("mongoose");
const throttlerController = require("../throttler");
const config = require("../../config");
const colors = require("colors");
const {
  generatePrivateSeedHashPair,
  generateJackpotRandom,
} = require("../random");
const { checkAndEnterRace, checkAndApplyRakeToRace } = require("../race");
const { checkAndApplyRakeback, getVipLevelFromWager } = require("../vip");
const { checkAndApplyAffiliatorCut } = require("../affiliates");
const { getJackpotState } = require("../site-settings");
const insertNewWalletTransaction = require("../../utils/insertNewWalletTransaction");

const User = require("../../models/User");
const JackpotGame = require("../../models/JackpotGame");

// Declare game state LOW
const GAME_STATE = {
  _id: null,
  joinable: false,
  AnimationEndedStatus: false,
  playerWinnerIndex: null,
  timeLeft: 0,
  winner: null,
  pieStartAngle: -90,
  pieEndAngle: 270,
  winningTicketCalc: 0,
  maxTicketCalc: 0,
  AnimationDuration: 0,
  players: [],
  status: 1,
  privateSeed: null,
  privateHash: null,
  publicSeed: null,
  randomModule: 0,
  intervalId: null,
  intervalId2: null,
};

// Declare game state Middle
const GAME_STATE_MIDDLE = {
  _id: null,
  joinable: false,
  AnimationEndedStatus: false,
  playerWinnerIndex: null,
  timeLeft: 0,
  winner: null,
  pieStartAngle: -90,
  pieEndAngle: 270,
  winningTicketCalc: 0,
  maxTicketCalc: 0,
  AnimationDuration: 0,
  players: [],
  status: 1,
  privateSeed: null,
  privateHash: null,
  publicSeed: null,
  randomModule: 0,
  intervalId: null,
  intervalId2: null,
};

// Declare game state HIGH
const GAME_STATE_HIGH = {
  _id: null,
  joinable: false,
  AnimationEndedStatus: false,
  playerWinnerIndex: null,
  timeLeft: 0,
  winner: null,
  pieStartAngle: -90,
  pieEndAngle: 270,
  winningTicketCalc: 0,
  maxTicketCalc: 0,
  AnimationDuration: 0,
  players: [],
  status: 1,
  privateSeed: null,
  privateHash: null,
  publicSeed: null,
  randomModule: 0,
  intervalId: null,
  intervalId2: null,
};

// Declare client animation (spin) length
const CLIENT_ANIMATION_LENGTH = 18000;

// Export Low state to external controllers
const getCurrentGameLow = () => ({
  ...GAME_STATE,
  pieStartAngle: GAME_STATE.pieStartAngle,
  pieEndAngle: GAME_STATE.pieEndAngle,
  winningTicketCalc: GAME_STATE.winningTicketCalc,
  maxTicketCalc: GAME_STATE.maxTicketCalc,
  AnimationEndedStatus: GAME_STATE.AnimationEndedStatus,
  playerWinnerIndex: GAME_STATE.playerWinnerIndex,
  privateSeed: null,
  intervalId: null,
  intervalId2: null,
});

// Export Middle state to external controllers
const getCurrentGameMiddle = () => ({
  ...GAME_STATE_MIDDLE,
  pieStartAngle: GAME_STATE_MIDDLE.pieStartAngle,
  pieEndAngle: GAME_STATE_MIDDLE.pieEndAngle,
  winningTicketCalc: GAME_STATE_MIDDLE.winningTicketCalc,
  maxTicketCalc: GAME_STATE_MIDDLE.maxTicketCalc,
  AnimationEndedStatus: GAME_STATE_MIDDLE.AnimationEndedStatus,
  playerWinnerIndex: GAME_STATE_MIDDLE.playerWinnerIndex,
  privateSeed: null,
  intervalId: null,
  intervalId2: null,
});

// Export High state to external controllers
const getCurrentGameHigh = () => ({
  ...GAME_STATE_HIGH,
  pieStartAngle: GAME_STATE_HIGH.pieStartAngle,
  pieEndAngle: GAME_STATE_HIGH.pieEndAngle,
  winningTicketCalc: GAME_STATE_HIGH.winningTicketCalc,
  maxTicketCalc: GAME_STATE_HIGH.maxTicketCalc,
  AnimationEndedStatus: GAME_STATE_HIGH.AnimationEndedStatus,
  playerWinnerIndex: GAME_STATE_HIGH.playerWinnerIndex,
  privateSeed: null,
  intervalId: null,
  intervalId2: null,
});

// Get socket.io instance
const listen = io => {
  // Add previous LOW game to history (database)
  const addCurrentGameToHistoryLow = async () => {
    const game = { ...GAME_STATE };

    // Delete not needed props
    delete game.joinable;
    delete game.timeLeft;
    delete game.intervalId;

    try {
      // Push game to db
      const newGame = new JackpotGame(game);

      // Save the new document
      await newGame.save();

      // Add to local history
    } catch (error) {
      console.log("Error while saving Jackpot game to the database:", error);
    }
  };

  // Add previous MIDDLE game to history (database)
  const addCurrentGameToHistoryMiddle = async () => {
    const game = { ...GAME_STATE_MIDDLE };

    // Delete not needed props
    delete game.joinable;
    delete game.timeLeft;
    delete game.intervalId;

    try {
      // Push game to db
      const newGame = new JackpotGame(game);

      // Save the new document
      await newGame.save();

      // Add to local history
    } catch (error) {
      console.log("Error while saving Jackpot game to the database:", error);
    }
  };

  // Add previous HIGH game to history (database)
  const addCurrentGameToHistoryHigh = async () => {
    const game = { ...GAME_STATE_HIGH };

    // Delete not needed props
    delete game.joinable;
    delete game.timeLeft;
    delete game.intervalId;

    try {
      // Push game to db
      const newGame = new JackpotGame(game);

      // Save the new document
      await newGame.save();

      // Add to local history
    } catch (error) {
      console.log("Error while saving jackpot game to the database:", error);
    }
  };

  // Payout winner LOW and start a new game
  const payoutWinnerLow = async () => {
    try {
      // Calculate profit
      const profit = GAME_STATE.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0);
      const houseRake = profit * config.games.jackpot.feePercentage;
      const feeMultiplier = 1 - config.games.jackpot.feePercentage;
      const wonAmount = profit * feeMultiplier;

      // Payout winner
      await User.updateOne(
        { _id: GAME_STATE.winner._id },
        {
          $inc: {
            wallet: Math.abs(wonAmount),
          },
        }
      );
      insertNewWalletTransaction(
        GAME_STATE.winner._id,
        Math.abs(wonAmount),
        "Jackpot win",
        { jackpotGameId: GAME_STATE._id }
      );

      // Update local wallet
      io.of("/jackpot")
        .to(String(GAME_STATE.winner._id))
        .emit("update-wallet", Math.abs(wonAmount));

      // Apply 0.5% rake to current race prize pool
      await checkAndApplyRakeToRace(houseRake * 0.005);

      // Apply user's rakeback if eligible
      await checkAndApplyRakeback(GAME_STATE.winner._id, houseRake);

      // Apply cut of house edge to user's affiliator
      await checkAndApplyAffiliatorCut(GAME_STATE.winner._id, houseRake);

      // Add to history and start new game
      addCurrentGameToHistoryLow();
      startNewGameLow();
    } catch (error) {
      console.log("Error while payouting jackpot game:", error);
    }
  };

  // Payout winner MIDDLE and start a new game
  const payoutWinnerMiddle = async () => {
    try {
      // Calculate profit
      const profit = GAME_STATE_MIDDLE.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0);
      const houseRake = profit * config.games.jackpot.feePercentage;
      const feeMultiplier = 1 - config.games.jackpot.feePercentage;
      const wonAmount = profit * feeMultiplier;

      // Payout winner
      await User.updateOne(
        { _id: GAME_STATE_MIDDLE.winner._id },
        {
          $inc: {
            wallet: Math.abs(wonAmount),
          },
        }
      );
      insertNewWalletTransaction(
        GAME_STATE_MIDDLE.winner._id,
        Math.abs(wonAmount),
        "Jackpot win",
        { jackpotGameId: GAME_STATE_MIDDLE._id }
      );

      // Update local wallet
      io.of("/jackpot")
        .to(String(GAME_STATE_MIDDLE.winner._id))
        .emit("update-wallet", Math.abs(wonAmount));

      // Apply 0.5% rake to current race prize pool
      await checkAndApplyRakeToRace(houseRake * 0.005);

      // Apply user's rakeback if eligible
      await checkAndApplyRakeback(GAME_STATE_MIDDLE.winner._id, houseRake);

      // Apply cut of house edge to user's affiliator
      await checkAndApplyAffiliatorCut(GAME_STATE_MIDDLE.winner._id, houseRake);

      // Add to history and start new game
      addCurrentGameToHistoryMiddle();
      startNewGameMiddle();
    } catch (error) {
      console.log("Error while payouting jackpot game:", error);
    }
  };

  // Payout winner HIGH and start a new game
  const payoutWinnerHigh = async () => {
    try {
      // Calculate profit
      const profit = GAME_STATE_HIGH.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0);
      const houseRake = profit * config.games.jackpot.feePercentage;
      const feeMultiplier = 1 - config.games.jackpot.feePercentage;
      const wonAmount = profit * feeMultiplier;

      // Payout winner
      await User.updateOne(
        { _id: GAME_STATE_HIGH.winner._id },
        {
          $inc: {
            wallet: Math.abs(wonAmount),
          },
        }
      );
      insertNewWalletTransaction(
        GAME_STATE_HIGH.winner._id,
        Math.abs(wonAmount),
        "Jackpot win",
        { jackpotGameId: GAME_STATE_HIGH._id }
      );

      // Update local wallet
      io.of("/jackpot")
        .to(String(GAME_STATE_HIGH.winner._id))
        .emit("update-wallet", Math.abs(wonAmount));

      // Apply 0.5% rake to current race prize pool
      await checkAndApplyRakeToRace(houseRake * 0.005);

      // Apply user's rakeback if eligible
      await checkAndApplyRakeback(GAME_STATE_HIGH.winner._id, houseRake);

      // Apply cut of house edge to user's affiliator
      await checkAndApplyAffiliatorCut(GAME_STATE_HIGH.winner._id, houseRake);

      // Add to history and start new game
      addCurrentGameToHistoryHigh();
      startNewGameHigh();
    } catch (error) {
      console.log("Error while payouting jackpot game:", error);
    }
  };

  // End Low Game and show winner
  const EndGameLow = async () => {

    GAME_STATE.status = 4;

    const winningTicket = GAME_STATE.winner.winningTicket;
    const maxTicket = GAME_STATE.players[GAME_STATE.players.length - 1].tickets.max;

    GAME_STATE.winningTicketCalc = winningTicket;
    GAME_STATE.maxTicketCalc = maxTicket;

    io.of("/jackpot").emit("game-rolled-low", GAME_STATE.winningTicketCalc, GAME_STATE.maxTicketCalc, GAME_STATE.AnimationDuration);

    GAME_STATE.intervalId2 = setInterval(() => {
      // Decrement time left
      GAME_STATE.AnimationDuration -= 10;

      // Check if timer has reached 0
      if (GAME_STATE.AnimationDuration <= 0) {
        return clearInterval(GAME_STATE.intervalId2);
      }
    }, 10);

    // ShowPotWinner some seconds before CLIENT_ANIMATION_LENGTH finishes and game resets
    setTimeout(() => {
      GAME_STATE.AnimationEndedStatus = true;
      GAME_STATE.playerWinnerIndex = GAME_STATE.players.findIndex(player => player._id === GAME_STATE.winner._id);
      io.of("/jackpot").emit("pottitlehigh-updated-low", GAME_STATE.AnimationEndedStatus, GAME_STATE.playerWinnerIndex);
    }, 11500);

    // Wait for animation
    setTimeout(() => {
      payoutWinnerLow();
    }, CLIENT_ANIMATION_LENGTH);
  }

  // End Middle Game and show winner
  const EndGameMiddle = async () => {

    GAME_STATE_MIDDLE.status = 4;

    const winningTicket = GAME_STATE_MIDDLE.winner.winningTicket;
    const maxTicket = GAME_STATE_MIDDLE.players[GAME_STATE_MIDDLE.players.length - 1].tickets.max;

    GAME_STATE_MIDDLE.winningTicketCalc = winningTicket;
    GAME_STATE_MIDDLE.maxTicketCalc = maxTicket;

    io.of("/jackpot").emit("game-rolled-middle", GAME_STATE_MIDDLE.winningTicketCalc, GAME_STATE_MIDDLE.maxTicketCalc, GAME_STATE_MIDDLE.AnimationDuration);

    GAME_STATE_MIDDLE.intervalId2 = setInterval(() => {
      // Decrement time left
      GAME_STATE_MIDDLE.AnimationDuration -= 10;

      // Check if timer has reached 0
      if (GAME_STATE_MIDDLE.AnimationDuration <= 0) {
        return clearInterval(GAME_STATE_MIDDLE.intervalId2);
      }
    }, 10);

    // ShowPotWinner some seconds before CLIENT_ANIMATION_LENGTH finishes and game resets
    setTimeout(() => {
      GAME_STATE_MIDDLE.AnimationEndedStatus = true;
      GAME_STATE_MIDDLE.playerWinnerIndex = GAME_STATE_MIDDLE.players.findIndex(player => player._id === GAME_STATE_MIDDLE.winner._id);
      io.of("/jackpot").emit("pottitlehigh-updated-middle", GAME_STATE_MIDDLE.AnimationEndedStatus, GAME_STATE_MIDDLE.playerWinnerIndex);
    }, 11500);

    // Wait for animation
    setTimeout(() => {
      payoutWinnerMiddle();
    }, CLIENT_ANIMATION_LENGTH);
  }

  // End HIGH Game and show winner
  const EndGameHigh = async () => {

    GAME_STATE_HIGH.status = 4;

    const winningTicket = GAME_STATE_HIGH.winner.winningTicket;
    const maxTicket = GAME_STATE_HIGH.players[GAME_STATE_HIGH.players.length - 1].tickets.max;

    GAME_STATE_HIGH.winningTicketCalc = winningTicket;
    GAME_STATE_HIGH.maxTicketCalc = maxTicket;

    io.of("/jackpot").emit("game-rolled-high", GAME_STATE_HIGH.winningTicketCalc, GAME_STATE_HIGH.maxTicketCalc, GAME_STATE_HIGH.AnimationDuration);

    GAME_STATE_HIGH.intervalId2 = setInterval(() => {
      // Decrement time left
      GAME_STATE_HIGH.AnimationDuration -= 10;

      // Check if timer has reached 0
      if (GAME_STATE_HIGH.AnimationDuration <= 0) {
        return clearInterval(GAME_STATE_HIGH.intervalId2);
      }
    }, 10);

    // ShowPotWinner some seconds before CLIENT_ANIMATION_LENGTH finishes and game resets
    setTimeout(() => {
      GAME_STATE_HIGH.AnimationEndedStatus = true;
      GAME_STATE_HIGH.playerWinnerIndex = GAME_STATE_HIGH.players.findIndex(player => player._id === GAME_STATE_HIGH.winner._id);
      io.of("/jackpot").emit("pottitlehigh-updated-high", GAME_STATE_HIGH.AnimationEndedStatus, GAME_STATE_HIGH.playerWinnerIndex);
    }, 11500);

    // Wait for animation
    setTimeout(() => {
      payoutWinnerHigh();
    }, CLIENT_ANIMATION_LENGTH);
  }

  // End current LOW game
  const endCurrentJackpotGameLow = async () => {
    console.log(colors.gray("Jackpot >> Rolling current game"));

    GAME_STATE.joinable = false;

    // Get max ticket in the game
    const maxTicket = GAME_STATE.players[GAME_STATE.players.length - 1];

    try {
      // Generate random data
      const randomData = await generateJackpotRandom(
        GAME_STATE._id,
        GAME_STATE.privateSeed,
        maxTicket ? maxTicket.tickets.max : 0
      );

      // Loop through players to find winner to the next round
      for (let index = 0; index < GAME_STATE.players.length; index++) {
        const player = GAME_STATE.players[index];

        // If player has winning ticket
        if (randomData.winningTicket >= player.tickets.min && randomData.winningTicket <= player.tickets.max) {
          // Update local object
          GAME_STATE.randomModule = randomData.module;
          GAME_STATE.publicSeed = randomData.publicSeed;
          GAME_STATE.winner = {
            ...player,
            winningTicket: randomData.winningTicket,
            randomModule: randomData.module,
          };
        }
      }
      // End Game and show winner
      EndGameLow();
    } catch (error) {
      console.log("Couldn't end Jackpot game:", error);

      // Notify clients that we had an error
      io.of("/jackpot").emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry
        endCurrentJackpotGameLow();

        return clearTimeout(timeout);
      }, 20000);
    }
  };

  // End current MIDDLE game
  const endCurrentJackpotGameMiddle = async () => {
    console.log(colors.gray("Jackpot >> Rolling current game"));

    GAME_STATE_MIDDLE.joinable = false;

    // Get max ticket in the game
    const maxTicket = GAME_STATE_MIDDLE.players[GAME_STATE_MIDDLE.players.length - 1];

    try {
      // Generate random data
      const randomData = await generateJackpotRandom(
        GAME_STATE_MIDDLE._id,
        GAME_STATE_MIDDLE.privateSeed,
        maxTicket ? maxTicket.tickets.max : 0
      );

      // Loop through players to find winner to the next round
      for (let index = 0; index < GAME_STATE_MIDDLE.players.length; index++) {
        const player = GAME_STATE_MIDDLE.players[index];

        // If player has winning ticket
        if (randomData.winningTicket >= player.tickets.min && randomData.winningTicket <= player.tickets.max) {
          // Update local object
          GAME_STATE_MIDDLE.randomModule = randomData.module;
          GAME_STATE_MIDDLE.publicSeed = randomData.publicSeed;
          GAME_STATE_MIDDLE.winner = {
            ...player,
            winningTicket: randomData.winningTicket,
            randomModule: randomData.module,
          };
        }
      }
      // End Game and show winner
      EndGameMiddle();
    } catch (error) {
      console.log("Couldn't end Jackpot game:", error);

      // Notify clients that we had an error
      io.of("/jackpot").emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry
        endCurrentJackpotGameMiddle();

        return clearTimeout(timeout);
      }, 20000);
    }
  };

  // End current HIGH game
  const endCurrentJackpotGameHigh = async () => {
    console.log(colors.gray("Jackpot >> Rolling current game"));

    GAME_STATE_HIGH.joinable = false;

    // Get max ticket in the game
    const maxTicket = GAME_STATE_HIGH.players[GAME_STATE_HIGH.players.length - 1];

    try {
      // Generate random data
      const randomData = await generateJackpotRandom(
        GAME_STATE_HIGH._id,
        GAME_STATE_HIGH.privateSeed,
        maxTicket ? maxTicket.tickets.max : 0
      );

      // Loop through players to find winner to the next round
      for (let index = 0; index < GAME_STATE_HIGH.players.length; index++) {
        const player = GAME_STATE_HIGH.players[index];

        // If player has winning ticket
        if (randomData.winningTicket >= player.tickets.min && randomData.winningTicket <= player.tickets.max) {
          // Update local object
          GAME_STATE_HIGH.randomModule = randomData.module;
          GAME_STATE_HIGH.publicSeed = randomData.publicSeed;
          GAME_STATE_HIGH.winner = {
            ...player,
            winningTicket: randomData.winningTicket,
            randomModule: randomData.module,
          };
        }
      }
      // End Game and show winner
      EndGameHigh();
    } catch (error) {
      console.log("Couldn't end jackpot game:", error);

      // Notify clients that we had an error
      io.of("/jackpot").emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry
        endCurrentJackpotGameHigh();

        return clearTimeout(timeout);
      }, 20000);
    }
  };

  // Add player to LOW jackpot game
  const addPlayerToCurrentGameLow = async player => {
    // Calculate game total value
    const totalValue = parseFloat(
      GAME_STATE.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0)
        .toFixed(2)
    );

    // Generate tickets
    player.tickets = {
      min: totalValue * 100,
      max: totalValue * 100 + player.betAmount * 100 - 1,
    };
    player.winningPercentage =
      100 - ((totalValue - player.betAmount) / totalValue) * 100;

    // Add player to the game state
    GAME_STATE.players.push(player);

    // Update chance for every player
    GAME_STATE.players.forEach((player, i) => {
      // Calculate game total value
      const totalValue = parseFloat(
        GAME_STATE.players
          .map(bet => bet.betAmount)
          .reduce((a, b) => a + b, 0)
          .toFixed(2)
      );
      const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
      GAME_STATE.players[i].winningPercentage = chance;
    });

    // Emit to clients
    io.of("/jackpot").emit("new-player-low", player);
    io.of("/jackpot").emit("percentages-updated-low", GAME_STATE.players);

    // If there are 2 players start the game
    if (GAME_STATE.players.length === 2) {

      GAME_STATE.pieStartAngle = 90;
      GAME_STATE.pieEndAngle = -270;

      // Notify clients
      io.of("/jackpot").emit("countdown-started-low", GAME_STATE.timeLeft, GAME_STATE.pieStartAngle, GAME_STATE.pieEndAngle);

      // Start a new game interval
      GAME_STATE.status = 2;
      GAME_STATE.intervalId = setInterval(() => {
        // Decrement time left
        GAME_STATE.timeLeft -= 10;

        // Check if timer has reached 0
        if (GAME_STATE.timeLeft <= 0) {
          endCurrentJackpotGameLow();
          return clearInterval(GAME_STATE.intervalId);
        }
      }, 10);
    }
  };

  // Add player to Middle jackpot game
  const addPlayerToCurrentGameMiddle = async player => {
    // Calculate game total value
    const totalValue = parseFloat(
      GAME_STATE_MIDDLE.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0)
        .toFixed(2)
    );

    // Generate tickets
    player.tickets = {
      min: totalValue * 100,
      max: totalValue * 100 + player.betAmount * 100 - 1,
    };
    player.winningPercentage =
      100 - ((totalValue - player.betAmount) / totalValue) * 100;

    // Add player to the game state
    GAME_STATE_MIDDLE.players.push(player);

    // Update chance for every player
    GAME_STATE_MIDDLE.players.forEach((player, i) => {
      // Calculate game total value
      const totalValue = parseFloat(
        GAME_STATE_MIDDLE.players
          .map(bet => bet.betAmount)
          .reduce((a, b) => a + b, 0)
          .toFixed(2)
      );
      const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
      GAME_STATE_MIDDLE.players[i].winningPercentage = chance;
    });

    // Emit to clients
    io.of("/jackpot").emit("new-player-middle", player);
    io.of("/jackpot").emit("percentages-updated-middle", GAME_STATE_MIDDLE.players);

    // If there are 2 players start the game
    if (GAME_STATE_MIDDLE.players.length === 2) {

      GAME_STATE_MIDDLE.pieStartAngle = 90;
      GAME_STATE_MIDDLE.pieEndAngle = -270;

      // Notify clients
      io.of("/jackpot").emit("countdown-started-middle", GAME_STATE_MIDDLE.timeLeft, GAME_STATE_MIDDLE.pieStartAngle, GAME_STATE_MIDDLE.pieEndAngle);

      // Start a new game interval
      GAME_STATE_MIDDLE.status = 2;
      GAME_STATE_MIDDLE.intervalId = setInterval(() => {
        // Decrement time left
        GAME_STATE_MIDDLE.timeLeft -= 10;

        // Check if timer has reached 0
        if (GAME_STATE_MIDDLE.timeLeft <= 0) {
          endCurrentJackpotGameMiddle();
          return clearInterval(GAME_STATE_MIDDLE.intervalId);
        }
      }, 10);
    }
  };

  // Add player to HIGH jackpot game
  const addPlayerToCurrentGameHigh = async player => {
    // Calculate game total value
    const totalValue = parseFloat(
      GAME_STATE_HIGH.players
        .map(bet => bet.betAmount)
        .reduce((a, b) => a + b, 0)
        .toFixed(2)
    );

    // Generate tickets
    player.tickets = {
      min: totalValue * 100,
      max: totalValue * 100 + player.betAmount * 100 - 1,
    };
    player.winningPercentage =
      100 - ((totalValue - player.betAmount) / totalValue) * 100;

    // Add player to the game state
    GAME_STATE_HIGH.players.push(player);

    // Update chance for every player
    GAME_STATE_HIGH.players.forEach((player, i) => {
      // Calculate game total value
      const totalValue = parseFloat(
        GAME_STATE_HIGH.players
          .map(bet => bet.betAmount)
          .reduce((a, b) => a + b, 0)
          .toFixed(2)
      );
      const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
      GAME_STATE_HIGH.players[i].winningPercentage = chance;
    });

    // Emit to clients
    io.of("/jackpot").emit("new-player-high", player);
    io.of("/jackpot").emit("percentages-updated-high", GAME_STATE_HIGH.players);

    // If there are 2 players start the game
    if (GAME_STATE_HIGH.players.length === 2) {

      GAME_STATE_HIGH.pieStartAngle = 90;
      GAME_STATE_HIGH.pieEndAngle = -270;

      // Notify clients
      io.of("/jackpot").emit("countdown-started-high", GAME_STATE_HIGH.timeLeft, GAME_STATE_HIGH.pieStartAngle, GAME_STATE_HIGH.pieEndAngle);

      // Start a new game interval
      GAME_STATE_HIGH.status = 2;
      GAME_STATE_HIGH.intervalId = setInterval(() => {
        // Decrement time left
        GAME_STATE_HIGH.timeLeft -= 10;

        // Check if timer has reached 0
        if (GAME_STATE_HIGH.timeLeft <= 0) {
          endCurrentJackpotGameHigh();
          return clearInterval(GAME_STATE_HIGH.intervalId);
        }
      }, 10);
    }
  };

  // Start a new LOW game
  const startNewGameLow = async () => {
    // Generate pre-roll provably fair data
    const provablyData = await generatePrivateSeedHashPair();

    // Reset state
    GAME_STATE.joinable = true;
    GAME_STATE.status = 1;
    /**
     * Status List:
     *
     * 1 - Waiting for players
     * 2 - On Countdown
     * 3 - Picking next round players //    not used anymore
     * 4 - Rolling
     * (5 - Ended)
     */
    GAME_STATE.timeLeft = config.games.jackpot.waitingTime;
    GAME_STATE.AnimationDuration = 10000;
    GAME_STATE.winner = null;
    GAME_STATE.AnimationEndedStatus = false;
    GAME_STATE.playerWinnerIndex = null;
    GAME_STATE.players = [];
    GAME_STATE.pieStartAngle = -90;
    GAME_STATE.pieEndAngle = 270;
    GAME_STATE.winningTicketCalc = 0;
    GAME_STATE.maxTicketCalc = 0;
    GAME_STATE.privateSeed = provablyData.seed;
    GAME_STATE.privateHash = provablyData.hash;
    GAME_STATE.publicSeed = null;
    GAME_STATE.randomModule = 0;
    GAME_STATE._id = mongoose.Types.ObjectId();

    // Clear game main interval
    clearInterval(GAME_STATE.intervalId);
    clearInterval(GAME_STATE.intervalId2);

    // Emit to clients
    io.of("/jackpot").emit("new-round-low", GAME_STATE.timeLeft, GAME_STATE._id, GAME_STATE.privateHash);
  };

  // Initially start a new LOW game
  startNewGameLow();

  // Start a new MIDDLE game
  const startNewGameMiddle = async () => {
    // Generate pre-roll provably fair data
    const provablyData = await generatePrivateSeedHashPair();

    // Reset state
    GAME_STATE_MIDDLE.joinable = true;
    GAME_STATE_MIDDLE.status = 1;
    /**
     * Status List:
     *
     * 1 - Waiting for players
     * 2 - On Countdown
     * 3 - Picking next round players // not used anymore
     * 4 - Rolling
     * (5 - Ended)
     */
    GAME_STATE_MIDDLE.timeLeft = config.games.jackpot.waitingTime;
    GAME_STATE_MIDDLE.AnimationDuration = 10000;
    GAME_STATE_MIDDLE.winner = null;
    GAME_STATE_MIDDLE.AnimationEndedStatus = false;
    GAME_STATE_MIDDLE.playerWinnerIndex = null;
    GAME_STATE_MIDDLE.players = [];
    GAME_STATE_MIDDLE.pieStartAngle = -90;
    GAME_STATE_MIDDLE.pieEndAngle = 270;
    GAME_STATE_MIDDLE.winningTicketCalc = 0;
    GAME_STATE_MIDDLE.maxTicketCalc = 0;
    GAME_STATE_MIDDLE.privateSeed = provablyData.seed;
    GAME_STATE_MIDDLE.privateHash = provablyData.hash;
    GAME_STATE_MIDDLE.publicSeed = null;
    GAME_STATE_MIDDLE.randomModule = 0;
    GAME_STATE_MIDDLE._id = mongoose.Types.ObjectId();

    // Clear game main interval
    clearInterval(GAME_STATE_MIDDLE.intervalId);
    clearInterval(GAME_STATE_MIDDLE.intervalId2);

    // Emit to clients
    io.of("/jackpot").emit("new-round-middle", GAME_STATE_MIDDLE.timeLeft, GAME_STATE_MIDDLE._id, GAME_STATE_MIDDLE.privateHash);
  };

  // Initially start a new Middle game
  startNewGameMiddle();

  // Start a new HIGH game
  const startNewGameHigh = async () => {
    // Generate pre-roll provably fair data
    const provablyData = await generatePrivateSeedHashPair();

    // Reset state
    GAME_STATE_HIGH.joinable = true;
    GAME_STATE_HIGH.status = 1;
    /**
     * Status List:
     *
     * 1 - Waiting for players
     * 2 - On Countdown
     * 3 - Picking next round players // not used anymore
     * 4 - Rolling
     * (5 - Ended)
     */
    GAME_STATE_HIGH.timeLeft = config.games.jackpot.waitingTime;
    GAME_STATE_HIGH.AnimationDuration = 10000;
    GAME_STATE_HIGH.winner = null;
    GAME_STATE_HIGH.AnimationEndedStatus = false;
    GAME_STATE_HIGH.playerWinnerIndex = null;
    GAME_STATE_HIGH.players = [];
    GAME_STATE_HIGH.pieStartAngle = -90;
    GAME_STATE_HIGH.pieEndAngle = 270;
    GAME_STATE_HIGH.winningTicketCalc = 0;
    GAME_STATE_HIGH.maxTicketCalc = 0;
    GAME_STATE_HIGH.privateSeed = provablyData.seed;
    GAME_STATE_HIGH.privateHash = provablyData.hash;
    GAME_STATE_HIGH.publicSeed = null;
    GAME_STATE_HIGH.randomModule = 0;
    GAME_STATE_HIGH._id = mongoose.Types.ObjectId();

    // Clear game main interval
    clearInterval(GAME_STATE_HIGH.intervalId);
    clearInterval(GAME_STATE_HIGH.intervalId2);

    // Emit to clients
    io.of("/jackpot").emit("new-round-high", GAME_STATE_HIGH.timeLeft, GAME_STATE_HIGH._id, GAME_STATE_HIGH.privateHash);
  };

  // Initially start a new High game
  startNewGameHigh();

  // Listen for new websocket connections
  io.of("/jackpot").on("connection", socket => {
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
     * @description Join a current LOW game
     * @param {number} betAmount Bet amount // Low Pot
     */
    socket.on("join-game-low", async betAmount => {
      // Validate user input
      if (typeof betAmount !== "number" || isNaN(betAmount))
        return socket.emit("game-join-error-low", "Invalid Bet Amount Type!");
      if (!loggedIn)
        return socket.emit("game-join-error-low", "You are not logged in!");

      // Get jackpot enabled status
      const isEnabled = getJackpotState();

      // If jackpot is disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error-low",
          "Jackpot gamemode is currently disabled! Contact admins for more information."
        );
      }

      // More validation on the bet value
      const { minBetAmountLow, maxBetAmountLow } = config.games.jackpot;
      if (!GAME_STATE.players.map(player => player._id).includes(user.id) && (parseFloat(betAmount.toFixed(2)) < minBetAmountLow || parseFloat(betAmount.toFixed(2)) > maxBetAmountLow)) {
        return socket.emit(
          "game-join-error-low",
          `Your bet must be a minimum of ${minBetAmountLow} credits and a maximum of ${maxBetAmountLow} credits!`
        );
      }

      if (parseFloat(betAmount.toFixed(2)) < 0.1) {
        return socket.emit(
          "game-join-error-middle",
          `Bet atleast 0.1$ to increase your current bet.`
        );
      }

      // Check if current game is joinable
      if (!GAME_STATE.joinable)
        return socket.emit("game-join-error-low", "Cannot join this game!");

      // If user has already joined this game
      if (GAME_STATE.players.map(player => player._id).includes(user.id)) {
        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-low",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-low",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-low", "You can't afford this bet!");
          }

          let player_indexCheck = GAME_STATE.players.findIndex(p => p._id === user.id);

          if ((GAME_STATE.players[player_indexCheck].betAmount + parseFloat(betAmount.toFixed(2))) > maxBetAmountLow) {
            return socket.emit("game-join-error-low", `Your bet will reach more than the max. bet amount allowed on this pot.`);
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE._id }
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

          // Get exising user entry
          const exisitingEntry = GAME_STATE.players.map(player => player._id).includes(user.id);

          if (exisitingEntry) {

            let player_index = GAME_STATE.players.findIndex(p => p._id === user.id);

            GAME_STATE.players[player_index].betAmount = GAME_STATE.players[player_index].betAmount + parseFloat(betAmount.toFixed(2));

            // Generate/update new tickets
            GAME_STATE.players.forEach((player, i) => {

              if (i === 0) {
                let minTicket1 = 0;
                let maxTicket1 = player.betAmount * 100 - 1;
                GAME_STATE.players[i].tickets.min = minTicket1;
                GAME_STATE.players[i].tickets.max = maxTicket1;
              }
              else {
                let lastPlayer = i - 1;
                let minTicket2 = GAME_STATE.players[lastPlayer].tickets.max + 1;
                let maxTicket2 = GAME_STATE.players[lastPlayer].tickets.max + 1 + player.betAmount * 100 - 1;
                GAME_STATE.players[i].tickets.min = minTicket2;
                GAME_STATE.players[i].tickets.max = maxTicket2;
              }
            });

            const totalValue = parseFloat(
              GAME_STATE.players
                .map(bet => bet.betAmount)
                .reduce((a, b) => a + b, 0)
                .toFixed(2)
            );

            GAME_STATE.players[player_index].winningPercentage =
              100 - ((totalValue - GAME_STATE.players[player_index].betAmount) / totalValue) * 100;


            // Update chance for every player
            GAME_STATE.players.forEach((player, i) => {
              // Calculate game total value
              const totalValue = parseFloat(
                GAME_STATE.players
                  .map(bet => bet.betAmount)
                  .reduce((a, b) => a + b, 0)
                  .toFixed(2)
              );
              const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
              GAME_STATE.players[i].winningPercentage = chance;
            });

            // Emit to clients
            // io.of("/jackpot").emit("new-player", GAME_STATE.players[player_index]);
            io.of("/jackpot").emit("percentages-updated-low", GAME_STATE.players);

            // Update client
            socket.emit("game-join-success-low");
          }
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-low",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      } else {

        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-low",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-low",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // Check if max. amount of players (45) in a game was reached
          if (GAME_STATE.players.length === 45) {
            return socket.emit("game-join-error-low", "Low pot reached max. of 45 players.");
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-low", "You can't afford this bet!");
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE._id }
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
            betAmount: parseFloat(betAmount.toFixed(2)), // Convert two-decimal into float
            level: getVipLevelFromWager(dbUser.wager),
            betId: uuid.v4(),
          };

          // Add player to the game
          addPlayerToCurrentGameLow(player);

          // Update client
          socket.emit("game-join-success-low");
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-low",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      }
    });

    /**
     * @description Join a current Middle game
     * @param {number} betAmount Bet amount // MIDDLE Pot
     */
    socket.on("join-game-middle", async betAmount => {
      // Validate user input
      if (typeof betAmount !== "number" || isNaN(betAmount))
        return socket.emit("game-join-error-middle", "Invalid Bet Amount Type!");
      if (!loggedIn)
        return socket.emit("game-join-error-middle", "You are not logged in!");

      // Get jackpot enabled status
      const isEnabled = getJackpotState();

      // If jackpot is disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error-middle",
          "Jackpot gamemode is currently disabled! Contact admins for more information."
        );
      }

      // More validation on the bet value
      const { minBetAmountMid, maxBetAmountMid } = config.games.jackpot;
      if (!GAME_STATE_MIDDLE.players.map(player => player._id).includes(user.id) && (parseFloat(betAmount.toFixed(2)) < minBetAmountMid || parseFloat(betAmount.toFixed(2)) > maxBetAmountMid)) {
        return socket.emit(
          "game-join-error-middle",
          `Your bet must be a minimum of ${minBetAmountMid} credits and a maximum of ${maxBetAmountMid} credits!`
        );
      }

      if (parseFloat(betAmount.toFixed(2)) < 0.1) {
        return socket.emit(
          "game-join-error-middle",
          `Bet atleast 0.1$ to increase your current bet.`
        );
      }

      // Check if current game is joinable
      if (!GAME_STATE_MIDDLE.joinable)
        return socket.emit("game-join-error-middle", "Cannot join this game!");

      // If user has already joined this game
      if (GAME_STATE_MIDDLE.players.map(player => player._id).includes(user.id)) {
        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-middle",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-middle",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-middle", "You can't afford this bet!");
          }

          let player_indexCheck = GAME_STATE_MIDDLE.players.findIndex(p => p._id === user.id);

          if ((GAME_STATE_MIDDLE.players[player_indexCheck].betAmount + parseFloat(betAmount.toFixed(2))) > maxBetAmountMid) {
            return socket.emit("game-join-error-middle", `Your bet will reach more than the max. bet amount allowed on this pot.`);
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE_MIDDLE._id }
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

          // Get exising user entry
          const exisitingEntry = GAME_STATE_MIDDLE.players.map(player => player._id).includes(user.id);

          if (exisitingEntry) {

            let player_index = GAME_STATE_MIDDLE.players.findIndex(p => p._id === user.id);

            GAME_STATE_MIDDLE.players[player_index].betAmount = GAME_STATE_MIDDLE.players[player_index].betAmount + parseFloat(betAmount.toFixed(2));

            // Generate/update new tickets
            GAME_STATE_MIDDLE.players.forEach((player, i) => {

              if (i === 0) {
                let minTicket1 = 0;
                let maxTicket1 = player.betAmount * 100 - 1;
                GAME_STATE_MIDDLE.players[i].tickets.min = minTicket1;
                GAME_STATE_MIDDLE.players[i].tickets.max = maxTicket1;
              }
              else {
                let lastPlayer = i - 1;
                let minTicket2 = GAME_STATE_MIDDLE.players[lastPlayer].tickets.max + 1;
                let maxTicket2 = GAME_STATE_MIDDLE.players[lastPlayer].tickets.max + 1 + player.betAmount * 100 - 1;
                GAME_STATE_MIDDLE.players[i].tickets.min = minTicket2;
                GAME_STATE_MIDDLE.players[i].tickets.max = maxTicket2;
              }
            });

            const totalValue = parseFloat(
              GAME_STATE_MIDDLE.players
                .map(bet => bet.betAmount)
                .reduce((a, b) => a + b, 0)
                .toFixed(2)
            );

            GAME_STATE_MIDDLE.players[player_index].winningPercentage =
              100 - ((totalValue - GAME_STATE_MIDDLE.players[player_index].betAmount) / totalValue) * 100;


            // Update chance for every player
            GAME_STATE_MIDDLE.players.forEach((player, i) => {
              // Calculate game total value
              const totalValue = parseFloat(
                GAME_STATE_MIDDLE.players
                  .map(bet => bet.betAmount)
                  .reduce((a, b) => a + b, 0)
                  .toFixed(2)
              );
              const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
              GAME_STATE_MIDDLE.players[i].winningPercentage = chance;
            });

            // Emit to clients
            // io.of("/jackpot").emit("new-player", GAME_STATE_MIDDLE.players[player_index]);
            io.of("/jackpot").emit("percentages-updated-middle", GAME_STATE_MIDDLE.players);

            // Update client
            socket.emit("game-join-success-middle");
          }
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-middle",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      } else {

        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-middle",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-middle",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // Check if max. amount of players (45) in a game was reached
          if (GAME_STATE_MIDDLE.players.length === 45) {
            return socket.emit("game-join-error-middle", "Medium pot reached max. of 45 players.");
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-middle", "You can't afford this bet!");
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE_MIDDLE._id }
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
            betAmount: parseFloat(betAmount.toFixed(2)), // Convert two-decimal into float
            level: getVipLevelFromWager(dbUser.wager),
            betId: uuid.v4(),
          };

          // Add player to the game
          addPlayerToCurrentGameMiddle(player);

          // Update client
          socket.emit("game-join-success-middle");
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-middle",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      }
    });

    /**
    * @description Join a current High game
    * @param {number} betAmount Bet amount // HIGH Pot
    */
    socket.on("join-game-high", async betAmount => {
      // Validate user input
      if (typeof betAmount !== "number" || isNaN(betAmount))
        return socket.emit("game-join-error-high", "Invalid Bet Amount Type!");
      if (!loggedIn)
        return socket.emit("game-join-error-high", "You are not logged in!");

      // Get jackpot enabled status
      const isEnabled = getJackpotState();

      // If jackpot is disabled
      if (!isEnabled) {
        return socket.emit(
          "game-join-error-high",
          "Jackpot gamemode is currently disabled! Contact admins for more information."
        );
      }

      // More validation on the bet value
      const { minBetAmountHigh, maxBetAmountHigh } = config.games.jackpot;
      if (!GAME_STATE_HIGH.players.map(player => player._id).includes(user.id) && (parseFloat(betAmount.toFixed(2)) < minBetAmountHigh || parseFloat(betAmount.toFixed(2)) > maxBetAmountHigh)) {
        return socket.emit(
          "game-join-error-high",
          `Your bet must be a minimum of ${minBetAmountHigh} credits and a maximum of ${maxBetAmountHigh} credits!`
        );
      }

      if (parseFloat(betAmount.toFixed(2)) < 0.1) {
        return socket.emit(
          "game-join-error-middle",
          `Bet atleast 0.1$ to increase your current bet.`
        );
      }

      // Check if current game is joinable
      if (!GAME_STATE_HIGH.joinable)
        return socket.emit("game-join-error-high", "Cannot join this game!");

      // If user has already joined this game
      if (GAME_STATE_HIGH.players.map(player => player._id).includes(user.id)) {
        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-high",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-high",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-high", "You can't afford this bet!");
          }

          let player_indexCheck = GAME_STATE_HIGH.players.findIndex(p => p._id === user.id);

          if ((GAME_STATE_HIGH.players[player_indexCheck].betAmount + parseFloat(betAmount.toFixed(2))) > maxBetAmountHigh) {
            return socket.emit("game-join-error-high", `Your bet will reach more than the max. bet amount allowed on this pot.`);
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE_HIGH._id }
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

          // Get exising user entry
          const exisitingEntry = GAME_STATE_HIGH.players.map(player => player._id).includes(user.id);

          if (exisitingEntry) {

            let player_index = GAME_STATE_HIGH.players.findIndex(p => p._id === user.id);

            GAME_STATE_HIGH.players[player_index].betAmount = GAME_STATE_HIGH.players[player_index].betAmount + parseFloat(betAmount.toFixed(2));

            // Generate/update new tickets
            GAME_STATE_HIGH.players.forEach((player, i) => {

              if (i === 0) {
                let minTicket1 = 0;
                let maxTicket1 = player.betAmount * 100 - 1;
                GAME_STATE_HIGH.players[i].tickets.min = minTicket1;
                GAME_STATE_HIGH.players[i].tickets.max = maxTicket1;
              }
              else {
                let lastPlayer = i - 1;
                let minTicket2 = GAME_STATE_HIGH.players[lastPlayer].tickets.max + 1;
                let maxTicket2 = GAME_STATE_HIGH.players[lastPlayer].tickets.max + 1 + player.betAmount * 100 - 1;
                GAME_STATE_HIGH.players[i].tickets.min = minTicket2;
                GAME_STATE_HIGH.players[i].tickets.max = maxTicket2;
              }
            });

            const totalValue = parseFloat(
              GAME_STATE_HIGH.players
                .map(bet => bet.betAmount)
                .reduce((a, b) => a + b, 0)
                .toFixed(2)
            );

            GAME_STATE_HIGH.players[player_index].winningPercentage =
              100 - ((totalValue - GAME_STATE_HIGH.players[player_index].betAmount) / totalValue) * 100;


            // Update chance for every player
            GAME_STATE_HIGH.players.forEach((player, i) => {
              // Calculate game total value
              const totalValue = parseFloat(
                GAME_STATE_HIGH.players
                  .map(bet => bet.betAmount)
                  .reduce((a, b) => a + b, 0)
                  .toFixed(2)
              );
              const chance = 100 - ((totalValue - player.betAmount) / totalValue) * 100;
              GAME_STATE_HIGH.players[i].winningPercentage = chance;
            });

            // Emit to clients
            // io.of("/jackpot").emit("new-player", GAME_STATE_HIGH.players[player_index]);
            io.of("/jackpot").emit("percentages-updated-high", GAME_STATE_HIGH.players);

            // Update client
            socket.emit("game-join-success-high");
          }
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-high",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      } else {

        try {
          // Get user from database
          const dbUser = await User.findOne({ _id: user.id });

          // If user is self-excluded
          if (dbUser.selfExcludes.jackpot > Date.now()) {
            return socket.emit(
              "game-join-error-high",
              `You have self-excluded yourself for another ${((dbUser.selfExcludes.jackpot - Date.now()) / 3600000).toFixed(1)} hours.`
            );
          }

          // If user has restricted bets
          if (dbUser.betsLocked) {
            return socket.emit(
              "game-join-error-high",
              "Your account has an betting restriction. Please contact support for more information."
            );
          }

          // Check if max. amount of players (45) in a game was reached
          if (GAME_STATE_HIGH.players.length === 45) {
            return socket.emit("game-join-error-high", "High pot reached max. of 45 players.");
          }

          // If user can afford this bet
          if (dbUser.wallet < parseFloat(betAmount.toFixed(2))) {
            return socket.emit("game-join-error-high", "You can't afford this bet!");
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
            "Jackpot play",
            { jackpotGameId: GAME_STATE_HIGH._id }
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
            betAmount: parseFloat(betAmount.toFixed(2)), // Convert two-decimal into float
            level: getVipLevelFromWager(dbUser.wager),
            betId: uuid.v4(),
          };

          // Add player to the game
          addPlayerToCurrentGameHigh(player);

          // Update client
          socket.emit("game-join-success-high");
        } catch (error) {
          console.log("Error while placing a jackpot bet:", error);
          return socket.emit(
            "game-join-error-high",
            "Your bet couldn't be placed: Internal server error, please try again later!"
          );
        }
      }
    });
  });
};

// Export functions
module.exports = { listen, getCurrentGameLow, getCurrentGameMiddle, getCurrentGameHigh };
