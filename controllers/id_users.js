// models
const UsernameChange = require("../models/UsernameChange");

// main function
async function hasAlreadyChangedName(id_user) {
    const id_users = await UsernameChange.find({ id_user });

    let is_banned = false;

    for (const id of id_users) {
        let saved = new Date(id.used).getTime();
        let curr = new Date().getTime();
        // check if an userID was saved in the last hour.
        if (curr - saved < 3600000) {
            is_banned = true;
            break;
        }
    }

    return is_banned;
}

// second function
async function addNewChange(id_user) {
    let insert = new UsernameChange({
        id_user
    });

    await insert.save();
}

module.exports = { hasAlreadyChangedName, addNewChange };