// Require Dependencies
const axios = require("axios");

// Declare additional variables
const LOYALTY_BADGE_CLASSID = "3106076676";

// Check that user has CS:GO Loyalty Badge in his inventory
async function checkInventoryForLoyaltyBadge(steamId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Get user's Steam inventory from Steam API
      const response = await axios.get(
        `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=5000`
      );

      // Get Loyalty Badge
      const found = response.data.descriptions.find(
        item => item.appid === 730 && item.classid === LOYALTY_BADGE_CLASSID
      );

      // If user has loyalty badge
      if (found) {
        resolve(true);
      } else {
        resolve(false);
      }
    } catch (error) {
      // If user has set their privacy settings to hidden
      if (error.response && error.response.status === 403) {
        reject(
          new Error("You must set your inventory visibility to public first!")
        );
      } else {
        reject(error);
      }
    }
  });
}

// Export functions
module.exports = { checkInventoryForLoyaltyBadge };
