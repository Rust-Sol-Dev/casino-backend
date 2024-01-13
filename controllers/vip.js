// Require Dependencies
const User = require("../models/User");
const Usero = require("../models/Usero");
const config = require("../config");

const numLevels = config.games.vip.numLevels;
const minWager = config.games.vip.minWager;
const maxWager = config.games.vip.maxWager;
const rakeback = config.games.vip.rakeback;
const vipLevelNAME = config.games.vip.vipLevelNAME;
const vipLevelCOLORS = config.games.vip.vipLevelCOLORS;


function generateVIPLevels(numLevels, minWager, maxWager, rakeback, levelNames, levelColors) {
  const levels = [];
  for (let i = 0; i < numLevels; i++) {
    const level = {
      name: (i + 1).toString(),
      wagerNeeded: (minWager + (maxWager - minWager) * Math.pow(i / numLevels, 2)).toFixed(2),
      rakebackPercentage: (rakeback / (1 + Math.exp(-5 * (i / numLevels - 0.5)))).toFixed(2),
      levelName: levelNames[Math.floor(i * levelNames.length / numLevels)],
      levelColor: levelColors[Math.floor(i * levelColors.length / numLevels)],
    }
    levels.push(level);
  }
  return levels;
}

const vipLevels = generateVIPLevels(numLevels, minWager, maxWager, rakeback, vipLevelNAME, vipLevelCOLORS);

// Get user vip level
function getVipLevelFromWager(wager) {
  if (wager < vipLevels[1].wagerNeeded) {
    return vipLevels[0];
  }
  else if (wager > vipLevels[numLevels - 1].wagerNeeded) {
    return vipLevels[numLevels - 1];
  }
  else {
    return vipLevels.filter(level => wager >= level.wagerNeeded).sort((a, b) => b.wagerNeeded - a.wagerNeeded)[0];
  }
}

// Get user next vip level
function getNextVipLevelFromWager(wager) {
  return vipLevels.filter(level => wager < level.wagerNeeded).sort((a, b) => a.wagerNeeded - b.wagerNeeded)[0];
}

// Check if user is eligible for rakeback
async function checkAndApplyRakeback(userId, houseRake) {
  return new Promise(async (resolve, reject) => {
    try {
      const usero = await Usero.findOne({ _id: userId });

      if (usero) {
        // Skip rakeback calculation for excluded users
        resolve();
        return;
      }
      const user = await User.findOne({ _id: userId });

      if (!user) {
        // User not found
        resolve();
        return;
      }

      // Find the corresponding level
      const currentLevel = getVipLevelFromWager(user.wager);

      // Update document
      await User.updateOne(
        { _id: user.id },
        {
          $inc: { rakebackBalance: houseRake * (currentLevel.rakebackPercentage / 100) },
        }
      );

      // Resolve to continue successfully
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// Export functions
module.exports = {
  vipLevels,
  vipLevelNAME,
  vipLevelCOLORS,
  getVipLevelFromWager,
  getNextVipLevelFromWager,
  checkAndApplyRakeback,
};
