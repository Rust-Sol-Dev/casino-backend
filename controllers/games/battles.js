// Require Dependencies
const jwt = require("jsonwebtoken");
const { parallelLimit } = require("async");
const _ = require("lodash");
const throttlerController = require("../throttler");
const config = require("../../config");
const colors = require("colors");
const {
  generatePrivateSeedHashPair, generateBattlesRandom, 
} = require("../random");
const { checkAndEnterRace, checkAndApplyRakeToRace } = require("../race");
const { checkAndApplyRakeback, getVipLevelFromWager } = require("../vip");
const { checkAndApplyAffiliatorCut } = require("../affiliates");
const { getBattlesState } = require("../site-settings");
const insertNewWalletTransaction = require("../../utils/insertNewWalletTransaction");
const fs = require('fs');

const User = require("../../models/User");
const BattlesGame = require("../../models/BattlesGame");
const seedrandom = require("seedrandom");

const caseList = require("./cases.json");

let PENDING_GAMES = [];

// Get socket.io instance
const listen = async (io) => {

  function isPlayerAlreadyJoined(playersArray, playerId) {
    return playersArray.some(player => String(player.id) === String(playerId));
  }

  const generateCaseResult = async (caseObj, hash, playerCount, roundNum, players) => {
    const caseInfo = caseList.find((caseItem) => caseItem.slug === caseObj.slug);
    if (!caseInfo) {
      throw new Error(`Case information not found for slug: ${caseObj.slug}`);
    }

    
    const result = [];

    for (let i = 1; i <= playerCount; i++) {
      const seed = `${hash}:${i}:${roundNum}`;
      const rollNumber = seedrandom(seed)()
      const ticket = ~~(rollNumber * 100000)

      const item = caseInfo.items.find(
        (item) => ticket >= item.ticketsStart && ticket <= item.ticketsEnd
      );

      const drop = {
        item: {
          name: item.name,
          color: item.color,
          type: item.type,
          chance: item.chance,
          stattrack: item.stattrack,
          image: item.image,
          price: item.price,
          ticketsStart: item.ticketsStart,
          ticketsEnd: item.ticketsEnd,
        },
        result: ticket,
        battlePlayerId: 0,
        team: i,
        userId: players[i - 1].id,
        seed: `${hash}:${i}:${roundNum}`,
      };

      result.push(drop);
    }
  
    return result;
  };

  function getRandomWeightedItems(data, totalItems) {
    const itemList = data.items;
    let weightedList = [];

    for (const item of itemList) {
      const weight = item.ticketsEnd - item.ticketsStart + 1;
      for (let i = 0; i < weight; i++) {
        weightedList.push(item);
      }
    }

    for (let i = weightedList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weightedList[i], weightedList[j]] = [weightedList[j], weightedList[i]];
    }

    return weightedList.slice(0, totalItems);
  }
  

  const delay = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  const runGame = async (battleId) => {
    const pendingGameIndex = PENDING_GAMES.findIndex(game => String(game._id) === String(battleId));
    if (pendingGameIndex === -1) {
      return console.error("Battle not found in PENDING_GAMES.");
    }
    let battle = PENDING_GAMES[pendingGameIndex];

    // Remove the battle from PENDING_GAMES
    PENDING_GAMES.splice(pendingGameIndex, 1);

    let provablyData = await generatePrivateSeedHashPair();
    
    // Generate random data
    const randomData = await generateBattlesRandom(
      battle._id,
      provablyData.seed
    );

    console.log(
      colors.red("Battles >> Starting game"),
      battle._id,
      colors.red("with hash"),
      provablyData.hash
    );

    battle.status = 2;
    battle.privateHash = provablyData.hash;
    battle.publicSeed = randomData.publicSeed;

    // Push the updated battle to the database
    await BattlesGame.updateOne({ _id: battle.id }, {
      $set: {
        status: battle.status,
        privateHash: battle.privateHash,
        publicSeed: battle.publicSeed,
      },
    });
  
    io.of("/battles").to("battles").emit("battles:start", {
      battleId: battleId,
      hash: battle.privateHash,
      publicSeed: battle.publicSeed,
    });
  
    await delay(3000);
  
    let resArr = [];
    for (let i = 0; i < battle.cases.length; i++) {
      const caseResult = await generateCaseResult(
        battle.cases[i],
        randomData.hash,
        battle.playerCount,
        i + 1,
        battle.players
      );
  
      resArr.push(caseResult);
      x = battle.eachCaseResult;
      x.push(caseResult);
      battle.eachCaseResult = x;
      await BattlesGame.updateOne({ _id: battle.id }, { $set: { eachCaseResult: x }});
      await battle.save();

      io.of("/battles").to("battles").emit("battles:round", {
        battleId: battleId,
        result: caseResult,
        img: getRandomWeightedItems(caseList.find((caseItem) => caseItem.slug === battle.cases[i].slug), 33),
        caseNumber: i,
      });
  
      await delay(7000);
    }

    await delay(1500)
    battle.status = 3;
    battle.privateSeed = provablyData.seed;

    // Push the updated battle to the database
    await BattlesGame.updateOne({ _id: battle.id }, {
      $set: {
            privateSeed: battle.privateSeed,
          },
    });

    await battle.save();
  
    let playerBals = [];
    for (let i = 0; i < battle.players.length; i++) {
      let bal = 0;
      for (let j = 0; j < battle.eachCaseResult.length; j++) {
        bal += parseFloat((battle.eachCaseResult[j][i].item.price).toFixed(2));
      }
      playerBals.push(bal);
    }
  
    // code to resolve winner
    let winningTeam = 0;
    let winAmount = 0;
    let isEqual = false;
    let equals = [];
  
    if (battle.game_type === 4) {
      const team1Balance = playerBals[0] + playerBals[1];
      const team2Balance = playerBals[2] + playerBals[3];
      winAmount = parseFloat(((team1Balance + team2Balance) / 2).toFixed(2));

      if(team1Balance == team2Balance) {
        winAmount = parseFloat((winAmount/2).toFixed(2));
        isEqual = true;
      } else {
        if (battle.isCrazyMode) {
          if (team1Balance < team2Balance) {
            winningTeam = 1;
          } else if (team2Balance < team1Balance) {
            winningTeam = 2;
          } else {
            isEqual = true;
          }
        } else {
          if (team1Balance > team2Balance) {
            winningTeam = 1;
          } else if (team2Balance > team1Balance) {
            winningTeam = 2;
          } else {
            isEqual = true;
          }
        }
      }

      for(let i = 0; i < 4; i++) {
        if(battle.players[i].id == "bot1" || battle.players[i].id == "bot2" || battle.players[i].id == "bot3") continue;
        if(isEqual) {
          await User.updateOne(
            { _id: battle.players[i].id },
            {
              $inc: {
                wallet: +Math.abs(parseFloat(winAmount.toFixed(2))),
              },
            }
          );
          insertNewWalletTransaction(battle.players[i].id, +Math.abs(parseFloat(winAmount.toFixed(2))), "Battles win", { battlesGameId: battle._id });
          io.of("/battles").to(battle.players[i].id).emit("update-wallet", +Math.abs(parseFloat(winAmount.toFixed(2))));
        } else {
          if(winningTeam == 1 && i > 1) continue;
          if(winningTeam == 2 && i <= 1) continue;
          await User.updateOne({ _id: battle.players[i].id },{$inc: {wallet: +Math.abs(parseFloat(winAmount.toFixed(2))),},});
          insertNewWalletTransaction(battle.players[i].id, +Math.abs(parseFloat(winAmount.toFixed(2))), "Battles win", { battlesGameId: battle._id });
          io.of("/battles").to(battle.players[i].id).emit("update-wallet", +Math.abs(parseFloat(winAmount.toFixed(2))));
        }
      }
    } else {
      let maxBalance = Math.max(...playerBals);
      let maxPlayerIndices = [];
      let minBalance = Math.min(...playerBals);
      let minPlayerIndices = [];
  
      for (let i = 0; i < playerBals.length; i++) {
        if (playerBals[i] === maxBalance) {
          maxPlayerIndices.push(i);
        }

        if (playerBals[i] === minBalance) {
          minPlayerIndices.push(i);
        }
      }
  
      winAmount = parseFloat(playerBals.reduce((accumulator, currentValue) => accumulator + currentValue,0).toFixed(2));
  
      if (battle.isCrazyMode) {
        if (minPlayerIndices.length > 1) {
          isEqual = true;
          equals = minPlayerIndices;
          winAmount = parseFloat((winAmount / equals.length).toFixed(2));
        } else {
          winningTeam = minPlayerIndices[0] + 1;
        }
      } else {
        if (maxPlayerIndices.length > 1) {
          isEqual = true;
          equals = maxPlayerIndices;
          winAmount = parseFloat((winAmount / equals.length).toFixed(2));
        } else {
          winningTeam = maxPlayerIndices[0] + 1;
        }
      }

      for(let i = 0; i < battle.players.length; i++) {
        if(battle.players[i].id == "bot1" || battle.players[i].id == "bot2" || battle.players[i].id == "bot3") continue;
        if(isEqual) {
          if(equals[i] != i) continue;
          await User.updateOne(
            { _id: battle.players[i].id },
            {
              $inc: {
                wallet: +Math.abs(parseFloat(winAmount.toFixed(2))),
              },
            }
          );
          insertNewWalletTransaction(battle.players[i].id, +Math.abs(parseFloat(winAmount.toFixed(2))), "Battles win", { battlesGameId: battle._id });
          io.of("/battles").to(battle.players[i].id).emit("update-wallet", +Math.abs(parseFloat(winAmount.toFixed(2))));
        } else {
          if(winningTeam != i+1) continue;
          await User.updateOne(
            { _id: battle.players[i].id },
            {
              $inc: {
                wallet: +Math.abs(parseFloat(winAmount.toFixed(2))),
              },
            }
          );
          insertNewWalletTransaction(battle.players[i].id, +Math.abs(parseFloat(winAmount.toFixed(2))), "Battles win", { battlesGameId: battle._id });
          io.of("/battles").to(battle.players[i].id).emit("update-wallet", +Math.abs(parseFloat(winAmount.toFixed(2))));
        }
      }
    }

    for(let i = 0; i < equals.length; i++) {
      equals[i] += 1;
    }
  
    battle.win = {
      battleId: battleId,
      winningTeam: winningTeam,
      winAmount: winAmount,
      pc: battle.playerCount,
      bt: battle.game_type,
      isEqual: isEqual,
      equals: equals,
    };
    await battle.save();
  
    io.of("/battles").to("battles").emit("battles:finished", {
      battleId: battleId,
      winningTeam: winningTeam,
      winAmount: winAmount,
      pc: battle.playerCount,
      bt: battle.game_type,
      isEqual: isEqual,
      equals: equals,
      privateSeed: provablyData.seed,
    });
  };
  

  // Listen for new websocket connections
  io.of("/battles").on("connection", socket => {
    let loggedIn = false;
    let user = null;

    socket.join("battles");

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
            // socket.emit("notify:success", "Successfully authenticated!");
          }
        }
        // return socket.emit("alert success", "Socket Authenticated!");
      } catch (error) {
        loggedIn = false;
        user = null;
        return socket.emit("notify:error", "Authentication token is not valid");
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

    socket.on("battles:create", async (      
      selectedCases,
      selectedType,
      selectedMode,
      totalCost,
      totalCaseCount,
      ) => {
      // Validate user input
      if (!loggedIn)
        return socket.emit("battles:error", "You are not logged in!");
      if(totalCaseCount > 50)
        return socket.emit("battles:error", "Cases amount must not be greater than 50");
      if (typeof totalCost !== "number" || isNaN(totalCost))
        return socket.emit("battles:error", "Invalid totalCost type!");
      if(selectedCases.length == 0) 
        return socket.emit("battles:error", "No cases selected!");

      if(selectedMode != '1v1' && selectedMode != '1v1v1' && selectedMode != '1v1v1v1' && selectedMode != '2v2') 
        return socket.emit("battles:error", "Not a valid gamemode! If you continue to try and break the code, you will be ip blacklisted.");

      let c = 0, verifiedCases = [];
      totalCost = 0;
      for(const item of selectedCases) {
        const last = caseList.find((caseItem) => caseItem.slug === item.slug);
        if(!last) return socket.emit("battles:error", "Not a valid case! If you continue to try and break the code, you will be ip blacklisted.");
        verifiedCases.push(last)
        totalCost += last.price;
      }

      if(!selectedType && selectedType != 'standard' && selectedType != 'crazy' && selectedType != 'terminal' && selectedType != 'group')
        return socket.emit("battles:error", "Invalid game type!");
      if(!selectedMode && selectedMode != '1v1' && selectedMode != '1v1v1' && selectedMode != '1v1v1v1' && selectedMode != '2v2')
        return socket.emit("battles:error", "Invalid mode type!");

      // Get battles enabled status
      const isEnabled = getBattlesState();
  
      // If battles is disabled
      if (!isEnabled) {
        return socket.emit(
          "battles:error",
          "Battles is currently disabled! Contact admins for more information."
        );
      }   

      try {
        // Get user from database
        const dbUser = await User.findOne({ _id: user.id });

        // If user has restricted bets
        if (dbUser.betsLocked) {
          return socket.emit(
            "battles:error",
            "Your account has an betting restriction. Please contact support for more information."
          );
        }

        // If user can afford this bet
        if (dbUser.wallet < parseFloat(totalCost.toFixed(2))) {
          return socket.emit("battles:error", "You can't afford to create this battle!");
        }
        const gameTypeInt = selectedMode == '1v1' ? 1 : selectedMode == '1v1v1' ? 2 : selectedMode == '1v1v1v1' ? 3 : selectedMode == '2v2' ? 4 : 0;
        const newGame = BattlesGame({
          betAmount: totalCost, 
          privateGame: false,

          game_type: gameTypeInt,

          isCrazyMode: "crazy" == String(selectedType),

          privateHash: "Not Generated",
          publicSeed: "Not Generated",
          privateSeed: "Not Generated",

          playerCount: gameTypeInt == 1 ? 2 : gameTypeInt == 2 ? 3 : gameTypeInt == 3 ? 4 : gameTypeInt == 4 ? 4 : 0,
          cases: verifiedCases,

          eachCaseResult: [],

          players: [{
            id: dbUser.id,
            username: dbUser.username,
            pfp: dbUser.avatar,
            level: getVipLevelFromWager(dbUser.wager),
          }],

          _creator: dbUser._id,

          isBotCalled: false,

          status: 1,
        });

        await newGame.save();
        PENDING_GAMES.push(newGame);

        // Remove bet amount from user's balance
        await User.updateOne(
          { _id: user.id },
          {
            $inc: {
              wallet: -Math.abs(parseFloat(totalCost.toFixed(2))),
              wager: Math.abs(parseFloat(totalCost.toFixed(2))),
              wagerNeededForWithdraw: -Math.abs(
                parseFloat(totalCost.toFixed(2))
              ),
              bets_placed: +1
            },
          }
        );

        insertNewWalletTransaction(user.id, -Math.abs(parseFloat(totalCost.toFixed(2))), "Battles creation", { battlesGameId: newGame._id });

        // Update local wallet
        io.of("/battles").to(user.id).emit("update-wallet", -Math.abs(parseFloat(totalCost.toFixed(2))));

        // Update user's race progress if there is an active race
        await checkAndEnterRace(user.id, Math.abs(parseFloat(totalCost.toFixed(2))));

        // Calculate house edge
        const houseRake = parseFloat(totalCost.toFixed(2)) * config.games.battles.houseEdge;

        // Apply 5% rake to current race prize pool
        await checkAndApplyRakeToRace(houseRake * 0.05);

        // Apply user's rakeback if eligible
        await checkAndApplyRakeback(user.id, houseRake);

        // Apply cut of house edge to user's affiliator
        await checkAndApplyAffiliatorCut(user.id, houseRake);

        io.of("/battles").to("battles").emit("battles:new", {
          id: newGame._id,
          price: newGame.betAmount,
          cases: newGame.cases,
          casesRoundResults: [],
          players: [{
            id: user._id,
            username: user.username,
            pfp: user.avatar,
            level: getVipLevelFromWager(user.wager),
          }],
          isCrazyMode: newGame.isCrazyMode,
          gameType: newGame.game_type,
          status: newGame.status,
          playerCount: newGame.playerCount,
        });
        return socket.emit("battles:created", newGame._id);
      } catch (error) {
        console.error(error);

        return socket.emit(
          "battles:error",
          "There was an error while proccessing your battles creation"
        );
      }
    });

    socket.on("battles:reqdata", async (id) => {
      try {
        if(!id)
          return socket.emit("battles:error", "Not a valid battle id!");

        
        const gameData = PENDING_GAMES.find(game => String(game._id) === id) ? PENDING_GAMES.find(game => String(game._id) === id) :  await BattlesGame.findOne({ _id: id });

        if(!gameData)
          return socket.emit("battles:error", "Not a valid battle id!");

        const gd = {
          id: gameData._id,
          price: gameData.betAmount,
          cases: gameData.cases,
          casesRoundResults: gameData.eachCaseResult,
          players: gameData.players,
          isCrazyMode: gameData.isCrazyMode,
          hash: gameData.privateHash,
          publicSeed: gameData.publicSeed,
          privateSeed: gameData.privateSeed,
          gameType: gameData.game_type,
          status: gameData.status,
          win: gameData.win,
          playerCount: gameData.game_type == 1 ? 2 : gameData.game_type == 2 ? 3 : gameData.game_type == 3 ? 4 : gameData.game_type == 4 ? 4 : 0,
        };
        return socket.emit("battles:data", gd);
      } catch (error) {
        console.error(error);

        return socket.emit(
          "battles:error",
          "There was an error while getting battles data"
        );
      }
    });
    
    socket.on("battles:join", async (battleId) => {
      try {
        if (!loggedIn)
          return socket.emit("battles:error", "You are not logged in!");
        
        user = await User.findOne({ _id: user.id });
        //let battle = await BattlesGame.findOne({ _id: battleId });

        const pendingGame = PENDING_GAMES.find(game => String(game._id) === String(battleId));
        let battle;
    
        if (pendingGame) {
          battle = pendingGame;
        } else {
          battle = await BattlesGame.findOne({ _id: battleId });
          if (!battle) {
            return socket.emit("battles:error", "The game you are trying to join is invalid!");
          }
        }

        const betAmount = battle.betAmount;

        if(betAmount > user.wallet) 
          return socket.emit("battles:error", "You can't afford to join this game!")
        

        if(isPlayerAlreadyJoined(battle.players, user.id)) 
          return socket.emit("battles:error", "You have already joined this game!");


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
              bets_placed: +1
            },
          }
        );
        insertNewWalletTransaction(user.id, -Math.abs(parseFloat(betAmount.toFixed(2))), "Battles join", { battlesGameId: battle._id });

        // Update local wallet
        io.of("/battles").to(user.id).emit("update-wallet", -Math.abs(parseFloat(betAmount.toFixed(2))));

        // Update user's race progress if there is an active race
        await checkAndEnterRace(
          user.id,
          Math.abs(parseFloat(betAmount.toFixed(2)))
        );

        const houseRake = parseFloat(betAmount.toFixed(2)) * config.games.crash.houseEdge;
        await checkAndApplyRakeToRace(houseRake * 0.05);
        await checkAndApplyRakeback(user.id, houseRake);
        await checkAndApplyAffiliatorCut(user.id, houseRake);

        const player = {
          id: user.id,
          username: user.username,
          level: getVipLevelFromWager(user.wager),
          pfp: user.avatar
        };

        let newPlayers = [
          ...battle.players,
          player
        ]

        await BattlesGame.findOneAndUpdate({ _id: battleId }, { $set: { players: [...newPlayers] }});

        const index = PENDING_GAMES.findIndex(game => String(game._id) === String(battleId));
        PENDING_GAMES[index].players = newPlayers;
        battle = PENDING_GAMES[index];
        await BattlesGame.findOneAndUpdate({ _id: battleId }, { $set: { players: [...newPlayers] }});

        io.of("/battles").to("battles").emit("battles:join", {
          battleId: battle._id,
          player: battle.players.length + 1,
          user: player
        });

        if(battle.players.length == battle.playerCount) {
          runGame(battle._id);
        }

      } catch (error) {
        console.error(error);

        return socket.emit(
          "battles:error",
          "There was an error while joining this battle"
        );
      }
    });
    
    socket.on("battles:callbot", async (battleId) => {
      try {
        if (!loggedIn)
          return socket.emit("battles:error", "You are not logged in!");

        // await BattlesGame.findOne({ _id: battleId });
        let battle = PENDING_GAMES.find(game => String(game._id) === String(battleId));
        
        if(String(battle._creator) != user.id) {
          return socket.emit(
            "battles:error",
            "To call bots you must be the creator!"
          );
        }

        const bot1 = {
          id: "bot1",
          username: "ShuffleBot1",
          pfp: "https://upload.wikimedia.org/wikipedia/en/thumb/a/af/Pop_Smoke_in_2020_%281%29_%282%29_%281%29.jpg/220px-Pop_Smoke_in_2020_%281%29_%282%29_%281%29.jpg"
        };

        const bot2 = {
          id: "bot2",
          username: "ShuffleBot2",
          pfp: "https://static.tvtropes.org/pmwiki/pub/images/big_boss_2_857.jpg"
        };

        const bot3 = {
          id: "bot3",
          username: "ShuffleBot3",
          pfp: "https://images.heb.com/is/image/HEBGrocery/prd-medium/000145080.jpg"
        };

        const numBotsNeeded = battle.playerCount - battle.players.length;

        let bots = [];

        if(numBotsNeeded == 1) {
          bots.push(bot1);
        } else if(numBotsNeeded == 2) {
          bots.push(bot1);
          bots.push(bot2);
        } else if(numBotsNeeded == 3) {
          bots.push(bot1);
          bots.push(bot2);
          bots.push(bot3);
        }

        let newPlayers = [
          ...battle.players,
          ...bots
        ]

        await BattlesGame.findOneAndUpdate({ _id: battleId }, { $set: { players: [...newPlayers] }});
        const index = PENDING_GAMES.findIndex(game => String(game._id) === String(battleId));
        PENDING_GAMES[index].players = newPlayers
        battle = PENDING_GAMES[index];

        for(let i = 0; i < numBotsNeeded; i++) {
          let botPlayer;
          if (i === 0) {
            botPlayer = bot1;
          } else if (i === 1) {
            botPlayer = bot2;
          } else if (i === 2) {
            botPlayer = bot3;
          }        
          io.of("/battles").to("battles").emit("battles:join", {
            battleId: battle._id,
            player: battle.players.length + i + 1,
            user: botPlayer
          });
        }

        runGame(battle._id);
      } catch (error) {
        console.error(error);

        return socket.emit(
          "battles:error",
          "There was an error while calling bots for this battle"
        );
      }
    });
  });

};

// Export functions
module.exports = {
  listen,
};
