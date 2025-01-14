// Require Dependencies
const mongoose = require("mongoose");
const SchemaTypes = mongoose.Schema.Types;

// Setup User Schema
const RegIpSchema = new mongoose.Schema({
  // Authentication related fields
  ip_address: String,

  // When this ip was used to register
  used: {
    type: Date,
    default: Date.now,
  },
});

// Create and export the new model
const RegIp = (module.exports = mongoose.model("RegIp", RegIpSchema));