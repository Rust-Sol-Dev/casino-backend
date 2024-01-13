// Require Dependencies
const axios = require("axios");
const qs = require("querystring");
const config = require("../config");
const Twilio = require("twilio");

// Declare additional variables
const VERIFY_SERVICE_SID = config.authentication.twilio.verifyServiceSid;

// Setup Twilio Client
const TwilioClient = Twilio(
  config.authentication.twilio.accountSid,
  config.authentication.twilio.authToken
);

// Send a SMS verfication message to the desired phone number
async function sendVerficationTextMessage(phoneNumber) {
  return new Promise(async (resolve, reject) => {
    try {
      // Request data
      const data = {
        to: phoneNumber,
        channel: "sms",
      };

      // Make request to Twilio API
      const verification = await TwilioClient.verify
        .services(VERIFY_SERVICE_SID)
        .verifications.create(data);

      // Resolve to continue successfully
      resolve(verification);
    } catch (error) {
      reject(error);
    }
  });
}

// Verify that code was right using the API
async function verifyTextMessageCode(phoneNumber, code) {
  return new Promise(async (resolve, reject) => {
    try {
      // Request data
      const data = {
        to: phoneNumber,
        code,
      };

      // Make request to Twilio API
      const verification = await TwilioClient.verify
        .services(VERIFY_SERVICE_SID)
        .verificationChecks.create(data);

      // If verification was successfull
      if (verification.status === "approved") {
        // Resolve to continue successfully
        resolve(verification);
      } else {
        reject(
          new Error("Invalid verification code. Please double-check your code!")
        );
      }
    } catch (error) {
      reject(error);
    }
  });
}

// Export functions
module.exports = { sendVerficationTextMessage, verifyTextMessageCode };
