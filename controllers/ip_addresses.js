// models
const RegIp = require("../models/RegIp");

// main function
async function hasAlreadyCreatedAccount(ip_address) {
    const ip_addresses = await RegIp.find({ ip_address });

    let is_banned = false;

    for (const ip of ip_addresses) {
        let saved = new Date(ip.used).getTime();
        let curr = new Date().getTime();
        // check if an ip address was saved in the last 8 hours.
        if (curr - saved < 28800000) {
            is_banned = true;
            break;
        }
    }

    return is_banned;
}

// second function
async function addIPAddress(ip_address) {
    let insert = new RegIp({
        ip_address
    });

    await insert.save();
}

module.exports = { hasAlreadyCreatedAccount, addIPAddress };