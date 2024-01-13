// Require Dependencies
const mongoose = require("mongoose");
const SchemaTypes = mongoose.Schema.Types;

// Setup Race Schema
const RaceSchema = new mongoose.Schema({
  // Basic fields
  active: Boolean,
  prize: Number,
  endingDate: Date,

  // Race winners
  winners: {
    type: [
      {
        type: SchemaTypes.ObjectId,
        ref: "User",
      },
    ],
    default: [],
  },

  // When race was created
  created: {
    type: Date,
    default: Date.now,
  },
});

// Create and export the new model
const Race = (module.exports = mongoose.model("Race", RaceSchema));
