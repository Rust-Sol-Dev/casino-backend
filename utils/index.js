// Require and combine all utils, then export them
const connectDatabase = require("./connectDatabase");
const insertNewWalletTransaction = require("./insertNewWalletTransaction");

module.exports = { connectDatabase, insertNewWalletTransaction };
