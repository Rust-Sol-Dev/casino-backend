// Require Dependencies
const mongoose = require("mongoose");

// Setup CryptoTransaction Schema
const CryptoTransactionSchema = new mongoose.Schema({
  type: String, // "deposit" || "withdraw"

  currency: String, // e.g "BTC", "ETH" or "LTC"
  siteValue: Number,
  cryptoValue: Number,
  address: String, // Wallet address to send money

  txid: String, // Blockchain transaction id
  state: Number, // 1 = pending, 2 = declined, 3 = completed, 4 = manual hold

  _user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  created: {
    type: Date,
    default: Date.now,
  },
});

// Create and export the new model
const CryptoTransaction = (module.exports = mongoose.model(
  "CryptoTransaction",
  CryptoTransactionSchema
));
