// Require Dependencies
const axios = require("axios");
const config = require("../config");

// Declare useful variables
const GOOGLE_RECAPTCHA_API = "https://www.google.com/recaptcha/api/siteverify";

// Verify user's recaptcha response token
async function verifyRecaptchaResponse(response) {
  return new Promise(async (resolve, reject) => {
    try {
      const apiResponse = await axios.post(
        `${GOOGLE_RECAPTCHA_API}?secret=${config.authentication.reCaptcha.secretKey}&response=${response}`
      );

      // Check if response was valid
      if (apiResponse.data.success) {
        resolve(true);
      } else {
        resolve(false);
      }
    } catch (error) {
      reject(error);
    }
  });
}

// Export functions
module.exports = { verifyRecaptchaResponse };
