// Require Dependencies
const mongoose = require("mongoose");
const SchemaTypes = mongoose.Schema.Types;

// Setup User Schema
const UsernameChangeSchema = new mongoose.Schema({
    // related fields
    id_user: String,

    // When this userID last changed his username 
    used: {
        type: Date,
        default: Date.now,
    },
});

// Create and export the new model
const UsernameChange = (module.exports = mongoose.model("UsernameChange", UsernameChangeSchema));