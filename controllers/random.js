// Require Dependencies
const config = require("../config");
const Chance = require("chance");
const crypto = require("crypto");
const { getPublicSeed } = require("./blockchain");

// Generate a secure random number
const generatePrivateSeed = async () => {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(256, (error, buffer) => {
      if (error) reject(error);
      else resolve(buffer.toString("hex"));
    });
  });
};

// Hash an input (private seed) to SHA256
const buildPrivateHash = async seed => {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash("sha256").update(seed).digest("hex");

      resolve(hash);
    } catch (error) {
      reject(error);
    }
  });
};

// Generate a private seed and hash pair
const generatePrivateSeedHashPair = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const seed = await generatePrivateSeed();
      const hash = await buildPrivateHash(seed);

      resolve({ seed, hash });
    } catch (error) {
      reject(error);
    }
  });
};

// Generate battles random data
const generateBattlesRandom = async (gameId, privateSeed) => {
  return new Promise(async (resolve, reject) => {
    try {

      const publicSeed = await getPublicSeed();

      // Combine privateSeed, gameId, and publicSeed to create a new hash
      const combinedSeed = `${privateSeed}-${gameId}-${publicSeed}`;
      const hash = crypto.createHash("sha256").update(combinedSeed).digest("hex");

      // Resolve promise and return data
      resolve({ hash, publicSeed });
    } catch (error) {
      reject(error);
    }
  });
};

// Generate coinflip random data
const generateCoinflipRandom = async (gameId, privateSeed) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get a new public seed from blockchain
      const publicSeed = await getPublicSeed();

      // Construct a new chance instance with
      // privateSeed-roundId-publicSeed pair
      const chance = new Chance(`${privateSeed}-${gameId}-${publicSeed}`);

      // Generate a random, repeatable module to determine round result
      const module = chance.floating({ min: 0, max: 60, fixed: 7 });

      // Resolve promise and return data
      resolve({ publicSeed, module });
    } catch (error) {
      reject(error);
    }
  });
};


// Generate jackpot random data
const generateJackpotRandom = async (gameId, privateSeed, maxTicket) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get a new public seed from blockchain
      const publicSeed = await getPublicSeed();

      // Construct a new chance instance with
      // gameId-privateSeed-publicSeed pair
      const chance = new Chance(`${gameId}-${privateSeed}-${publicSeed}`);

      // Generate a random, repeatable module to determine round result
      const randomModule = chance.floating({ min: 0, max: 100, fixed: 7 });

      // Calculate winning ticket
      let winningTicket = Math.round(maxTicket * (randomModule / 100));

      // If winning ticket is over max ticket then round down the value
      if (winningTicket > maxTicket) {
        winningTicket = Math.floor(maxTicket * randomModule);
      }

      // Resolve promise and return data
      resolve({ module: randomModule, winningTicket, publicSeed });
    } catch (error) {
      reject(error);
    }
  });
};

// Generate roulette first round random data
const generateRouletteFirstRandom = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get a new public seed from blockchain
      const publicSeed = await getPublicSeed();

      // Resolve promise and return data
      resolve({ publicSeed });
    } catch (error) {
      reject(error);
    }
  });
};

// Generate roulette random data
const generateRouletteRandom = async (
  gameId,
  privateSeed,
  publicSeed,
  roundNumber
) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Construct a new chance instance with
      // privateSeed-roundId-publicSeed-roundNumber pair
      const chance = new Chance(
        `${privateSeed}-${gameId}-${publicSeed}-${roundNumber}`
      );

      // Generate a random, repeatable module to determine round result (index from 0-14)
      const module = chance.integer({ min: 0, max: 14 });

      // Resolve promise and return data
      resolve({ publicSeed, module });
    } catch (error) {
      reject(error);
    }
  });
};

// Generate crash random data
const generateCrashRandom = async privateSeed => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get a new public seed from blockchain
      const publicSeed = await getPublicSeed();
      // Generate Crash Point with seed and salt
      const crashPoint = await generateCrashPoint(privateSeed, publicSeed);
      // Resolve promise and return data
      resolve({ publicSeed, crashPoint });
    } catch (error) {
      reject(error);
    }
  });
};

const generateCrashPoint = (seed, salt) => {
  const hash = crypto.createHmac("sha256", seed).update(salt).digest("hex");

  const hs = parseInt(100 / (config.games.crash.houseEdge * 100));
  if (isCrashHashDivisible(hash, hs)) {
    return 100;
  }

  const h = parseInt(hash.slice(0, 52 / 4), 16);
  const e = Math.pow(2, 52);

  return Math.floor((100 * e - h) / (e - h));
};

const isCrashHashDivisible = (hash, mod) => {
  let val = 0;

  let o = hash.length % 4;
  for (let i = o > 0 ? o - 4 : 0; i < hash.length; i += 4) {
    val = ((val << 16) + parseInt(hash.substring(i, i + 4), 16)) % mod;
  }

  return val === 0;
};

// Export all functions
module.exports = {
  generatePrivateSeedHashPair,
  generateCoinflipRandom,
  generateRouletteRandom,
  generateRouletteFirstRandom,
  generateJackpotRandom,
  generateCrashRandom,
  generateBattlesRandom,
};
