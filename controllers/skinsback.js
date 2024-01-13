// Require Dependencies
const config = require("../config");

const SkinsBack = require("skinsback-sdk").API;

const sbTransaction = require("../models/sbTransaction");
const sbWithdrawTransaction = require("../models/sbWithdrawTransaction");
const CryptoTransaction = require("../models/CryptoTransaction");
const User = require("../models/User");
const insertNewWalletTransaction = require("../utils/insertNewWalletTransaction");
const { TrunkPage } = require("twilio/lib/rest/trunking/v1/trunk");

const options = {
    shop_id: config.authentication.skinsback.shop_id,
    secret_key: config.authentication.skinsback.secret_key,
};

const API = new SkinsBack(options);

var ShopItemsCSGO = [];
var ShopItemsRUST = [];
var ShopItemsDOTA2 = [];

const WITHDRAW_COMMISSION = config.authentication.skinsback.withdrawFee;

const main = async () => {
    let status = await API.serverStatus();
    return status;
};

const create_order = async (order_id, user_id) => {
    try {
        let findPending = await sbTransaction.findOne({ user_id, status: 0 });
        let isExpired = 60000 * 25; // 25 minutes till skinsback link expires
        if (findPending && findPending.unixtime + isExpired < Date.now()) {
            findPending.status = 3;
            await findPending.save();
            return await createOrder(order_id, user_id);
        }
        if (!findPending) return await createOrder(order_id, user_id);
        return findPending.hash;
    } catch (e) {
        console.error(`SkinsBack API error - create_order func -`, e.toString());
    }
};

/**
 * @description createOrder API & add into database
 */
const createOrder = async (order_id, user_id) => {
    try {
        let order = await API.createOrder(order_id);
        if (order.status == "success") {
            let hash = order.url.split("?hash=")[1];
            let transaction = new sbTransaction({
                user_id,
                order_id,
                tid: order.transaction_id,
                hash,
            });
            await transaction.save();
            return hash;
        }
        console.error(order);
        throw new Error(`Status failed`, order);
    } catch (e) {
        console.error(`SkinsBack API error - create order -`, e.toString());
    }
};

const result = async (body) => {
    try {
        let { status, transaction_id, order_id, amount, user_amount } = body;
        let findTransaction = await sbTransaction.findOne({
            order_id,
            tid: transaction_id,
        });

        if (status == "fail") {
            findTransaction.status = 2;
            await findTransaction.save();
            return;
        }

        if (status == "pending")
            return console.error(
                `[SKINSBACK] Order ID ${order_id} is still in Pending...`
            );

        if (!findTransaction) {
            throw new Error(`Could not find the transaction in the database.`);
        }

        findTransaction.status = 1;
        findTransaction.amount = amount;
        findTransaction.user_amount = user_amount;

        await findTransaction.save();

        let user = await User.findOne({ _id: findTransaction.user_id });

        // Update user document
        await User.updateOne(
            { _id: user.id },
            {
                $inc: {
                    wallet: user_amount,
                    totalDeposited: user_amount,
                    wagerNeededForWithdraw:
                        user.wagerNeededForWithdraw < 0
                            ? Math.abs(user.wagerNeededForWithdraw) + user_amount
                            : user_amount,
                },
            }
        );

        const newTransaction = new CryptoTransaction();

        // Create a new document
        newTransaction.type = "deposit"; // Transaction type
                
        newTransaction.currency = "skinsback"; // Skinsback currency name
        newTransaction.siteValue = user_amount; // Value in site balance (USD)
        newTransaction.cryptoValue = amount; // Value in skinsback currency
        newTransaction.address = transaction_id; // transaction address
                
        newTransaction.txid = `Order ID ${order_id}`; // Skinsback Buy ID
        newTransaction.state = 3; // 1 = pending, 2 = declined, 3 = completed
                
        newTransaction._user = user.id; // User who made this transaction
                
        // Save the document
        await newTransaction.save();

        await insertNewWalletTransaction(user.id, user_amount, "Skinsback Deposit", {
        transactionId: newTransaction.id,
        });

        return { success: true };
    } catch (e) {
        console.error(`SkinsBack API error - result -`, e.toString());
        return { success: false };
    }
};

const check_order_statues = async () => {
    try {
        // get all withdraw transactions with state 0 ( just added into database )
        let withdrawTransactions = await sbWithdrawTransaction.find({ state: 0 });

        // if empty, stop
        if (!withdrawTransactions) {
            //console.log("No withdraw transactions found.");
            return;
        }

        for (let x in withdrawTransactions) {
            try {
                await checkOrderStatusByID(withdrawTransactions[x]);
            } catch (error) {
                console.error(`Error Message x in wt: ${error}`);
            }
        }
    } catch (error) {
        console.error(`Error Message: ${error}`);
    }
};

const checkOrderStatusByID = async tr => {
    try {
        let { buy_id, user_id, amount } = tr;

        //console.log(`Checking Offer status for buy_id: ${buy_id}`);

        let resp = await API.getInfoAboutBoughtItem(buy_id);

        if (resp || resp.data) {
            let offer_status = resp.offer_status;

            if (offer_status === "canceled" || offer_status === "timeout" || offer_status === "invalid_trade_token" || offer_status === "user_not_tradable" || offer_status === "trade_create_error") {
                console.log(`[SKINSBACK OFFER CHECK] Offer status ${buy_id} failed, user ${user_id} got refunded back ${amount}!`);

                // if fail update in DB state > 2 == FAILED/ERROR
                await sbWithdrawTransaction.updateOne(
                    {
                        buy_id
                    },
                    {
                        $set: {
                            state: 2,
                            offer_status: "canceled"
                        }
                    }
                );

                // credit the user the amount back
                await User.updateOne({ _id: user_id }, { $inc: { wallet: amount } });
                await insertNewWalletTransaction(user_id, amount, "Skinsback Withdraw Refund");
                await CryptoTransaction.updateOne(
                    { txid: `Buy ID ${buy_id}` },
                    { $set: { state: 2 } }
                  );
                //console.log(`Transaction updated and user wallet credited back.`);
                return;
            }

            if (offer_status === "accepted") {
                console.log(`[SKINSBACK OFFER CHECK] Offer status ${buy_id} is accepted.`);

                // if success just update in db with state 1 == SUCCESS
                await sbWithdrawTransaction.updateOne(
                    {
                        buy_id
                    },
                    {
                        $set: {
                            state: 1,
                            offer_status: "accepted"
                        }
                    }
                );

                await CryptoTransaction.updateOne(
                    { txid: `Buy ID ${buy_id}` },
                    { $set: { state: 3 } }
                  );

                //console.log(`Transaction updated with success state.`);
            }
        }
    } catch (error) {
        console.error(error);
    }
};

const withdraw_itemsCSGO = async (user_id, items, tradelink) => {
    try {
        if (items.length == 0)
            return res.json({
                success: false,
                error: `You need to select at least one item to withdraw!`,
            });

        if (items.length > 5)
            return res.json({
                success: false,
                error: `You can withdraw maximum 5 items at once!`,
            });

        if (!(tradelink.includes("partner=") && tradelink.includes("token=")))
            return res.json({
                success: false,
                error: `Invalid tradelink!`,
            });

        let responses_data = [];
        let deduct_balance = 0;
        let items_value = 0;

        // tokens[0] = partner
        // tokens[1] = token
        let [partner, token] = tradelink.split("partner=")[1].split("&token=");

        let item_error_price = false;

        for (let d in items) {
            let item_price = ShopItemsCSGO.filter(i => {
                return i.name == items[d];
            }).map(i => {
                return i.price;
            });
            if (item_price.length == 0) {
                item_error_price = true;
                continue;
            }
            items_value = parseFloat(items_value) + parseFloat(item_price[0]);
        }

        if (item_error_price)
            return {
                success: false,
                error: `An error ocurred getting item's price, please refresh the withdraw inventory!`,
            };

        let dbUser = await User.findOne({ _id: user_id });

        // If user has not enough balance
        if (dbUser.wallet < items_value)
            return {
                success: false,
                error: `You don't have enough balance to withdraw these items!`,
            };

        // If user has transactions locked
        if (dbUser.transactionsLocked)
            return {
                success: false,
                error: `Your account has a transaction restriction. Please contact support for more information.`,
            };

        // If user has wager limit, check if it's been passed
        if (dbUser.wager < dbUser.customWagerLimit)
            return {
                success: false,
                error: `Because your account has wager limit, you must wager still $${(dbUser.customWagerLimit - dbUser.wager).toFixed(2)} before withdrawing!`,
            };

        // Check that user has wagered atleast 100% of his deposited amount    
        if (dbUser.wagerNeededForWithdraw > 0)
            return {
                success: false,
                error: `You must wager atleast $${dbUser.wagerNeededForWithdraw.toFixed(2)} before withdrawing!`,
            };

        // If user has deposited less than $5.00 before withdrawing, check config file for amount
        if (dbUser.totalDeposited < config.games.vip.minDepositForWithdraw)
            return {
                success: false,
                error: `You must have deposited atleast $${config.games.vip.minDepositForWithdraw} before withdrawing!`,
            };

            const createResponseReq = async item => {
                try {
                  let itemMatch = ShopItemsCSGO.find(i => i.name === item);
                  if (!itemMatch) {
                    //console.log(`Item not found: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let item_price = itemMatch.price;
                  if (item_price === undefined) {
                    //console.log(`Item price not found for item: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let resp = await API.buyItemByNameAndSendToUser({
                    partner,
                    token,
                    name: item,
                    max_price: item_price || 0,
                    game: "csgo",
                  });
              
                  //console.log(`Item: ${item}`);
                  //console.log(`Response: ${JSON.stringify(resp)}`);
              
                  if (resp && resp.offer_status) {
                    let valid_offer_statuses = ["creating_trade", "waiting_accept", "accepted"];
              
                    if (valid_offer_statuses.includes(resp.offer_status)) {
                      deduct_balance += parseFloat(item_price);
                    }
                  }
                  resp.item = JSON.stringify(resp.item);
                  responses_data.push(resp);
                  //console.log(`Responses data: ${JSON.stringify(responses_data)}`);
                } catch (e) {
                  console.error(e);
                  responses_data.push({ error: true });
                }
              };

        for (let x in items) {
            createResponseReq(items[x]);
        }

        return new Promise(async resolve => {
            let int = setInterval(async () => {
                if (responses_data.length == items.length) {
                    clearInterval(int);

                    await User.updateOne(
                        { _id: user_id },
                        {
                          $inc: {
                            wallet: -deduct_balance,
                            totalWithdrawn: deduct_balance,
                          },
                        }
                      );

                    let errors_lengt = 0;
                    for (let x in responses_data) {
                        if (responses_data[x] && responses_data[x].error) errors_lengt++;
                        else {
                            let { buy_id, offer_status, item, balance_debited_sum } =
                                responses_data[x];
                                let itemObj = JSON.parse(item);
                                let itemMatch = ShopItemsCSGO.find(i => i.name === itemObj.name);
                                let amount = itemMatch ? itemMatch.price : 0;
                            let tr = new sbWithdrawTransaction({
                                user_id,
                                buy_id,
                                offer_status,
                                item,
                                amount,
                                balance_debited_sum,
                            });

                            await tr.save();

                            const newTransaction = new CryptoTransaction();

                            // Create a new document
                            newTransaction.type = "withdraw"; // Transaction type
                
                            newTransaction.currency = "skinsback csgo"; // Skinsback currency name
                            newTransaction.siteValue = amount; // Value in site balance (USD)
                            newTransaction.cryptoValue = balance_debited_sum; // Value in skinsback currency
                            newTransaction.address = tr.id; // transaction address
                
                             newTransaction.txid = `Buy ID ${buy_id}`; // Skinsback Buy ID
                             newTransaction.state = 1; // 1 = pending, 2 = declined, 3 = completed
                
                             newTransaction._user = user_id; // User who made this transaction
                
                            // Save the document
                            await newTransaction.save();

                            await insertNewWalletTransaction(user_id, -deduct_balance, "Skinsback Withdraw", {
                                transactionId: newTransaction.id,
                              });
                        }
                    }

                    let msg = "";
                    if (errors_lengt === 0) {
                        msg = `Successfully withdrawn ${items.length} item(s).`;
                    } else if (errors_lengt < items.length) {
                        msg = `${errors_lengt} item(s) were not found anymore, but we sent ${items.length - errors_lengt} item(s) successfully. If by any chance you don't receive an item, we will handle the refund automatically!`;
                    } else {
                        return resolve({
                            success: false,
                            error: `An error occurred with the game items you were trying to withdraw. Please try refreshing the withdrawal inventory or contact support!`,
                        });
                    }
                    
                    //console.log(`responses_data`, responses_data);
                    return resolve({ success: true, msg });
                }
            }, 250);
        });
    } catch (e) {
        console.error(e);
        return { success: false, error: e.toString() };
    }
};

const withdraw_itemsRUST = async (user_id, items, tradelink) => {
    try {
        if (items.length == 0)
            return res.json({
                success: false,
                error: `You need to select at least one item to withdraw!`,
            });

        if (items.length > 5)
            return res.json({
                success: false,
                error: `You can withdraw maximum 5 items at once!`,
            });

        if (!(tradelink.includes("partner=") && tradelink.includes("token=")))
            return res.json({
                success: false,
                error: `Invalid tradelink!`,
            });

        let responses_data = [];
        let deduct_balance = 0;
        let items_value = 0;

        // tokens[0] = partner
        // tokens[1] = token
        let [partner, token] = tradelink.split("partner=")[1].split("&token=");

        let item_error_price = false;

        for (let d in items) {
            let item_price = ShopItemsRUST.filter(i => {
                return i.name == items[d];
            }).map(i => {
                return i.price;
            });
            if (item_price.length == 0) {
                item_error_price = true;
                continue;
            }
            items_value = parseFloat(items_value) + parseFloat(item_price[0]);
        }

        if (item_error_price)
            return {
                success: false,
                error: `An error ocurred getting item's price, please refresh the withdraw inventory!`,
            };

        let dbUser = await User.findOne({ _id: user_id });

        // If user has not enough balance
        if (dbUser.wallet < items_value)
            return {
                success: false,
                error: `You don't have enough balance to withdraw these items!`,
            };

        // If user has transactions locked
        if (dbUser.transactionsLocked)
            return {
                success: false,
                error: `Your account has a transaction restriction. Please contact support for more information.`,
            };

        // If user has wager limit, check if it's been passed
        if (dbUser.wager < dbUser.customWagerLimit)
            return {
                success: false,
                error: `Because your account has wager limit, you must wager still $${(dbUser.customWagerLimit - dbUser.wager).toFixed(2)} before withdrawing!`,
            };

        // Check that user has wagered atleast 100% of his deposited amount    
        if (dbUser.wagerNeededForWithdraw > 0)
            return {
                success: false,
                error: `You must wager atleast $${dbUser.wagerNeededForWithdraw.toFixed(2)} before withdrawing!`,
            };

        // If user has deposited less than $5.00 before withdrawing, check config file for amount
        if (dbUser.totalDeposited < config.games.vip.minDepositForWithdraw)
            return {
                success: false,
                error: `You must have deposited atleast $${config.games.vip.minDepositForWithdraw} before withdrawing!`,
            };

            const createResponseReq = async item => {
                try {
                  let itemMatch = ShopItemsRUST.find(i => i.name === item);
                  if (!itemMatch) {
                    //console.log(`Item not found: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let item_price = itemMatch.price;
                  if (item_price === undefined) {
                    //console.log(`Item price not found for item: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let resp = await API.buyItemByNameAndSendToUser({
                    partner,
                    token,
                    name: item,
                    max_price: item_price || 0,
                    game: "rust",
                  });
              
                  //console.log(`Item: ${item}`);
                  //console.log(`Response: ${JSON.stringify(resp)}`);
              
                  if (resp && resp.offer_status) {
                    let valid_offer_statuses = ["creating_trade", "waiting_accept", "accepted"];
              
                    if (valid_offer_statuses.includes(resp.offer_status)) {
                      deduct_balance += parseFloat(item_price);
                    }
                  }
                  resp.item = JSON.stringify(resp.item);
                  responses_data.push(resp);
                  //console.log(`Responses data: ${JSON.stringify(responses_data)}`);
                } catch (e) {
                  console.error(e);
                  responses_data.push({ error: true });
                }
              };

        for (let x in items) {
            createResponseReq(items[x]);
        }

        return new Promise(async resolve => {
            let int = setInterval(async () => {
                if (responses_data.length == items.length) {
                    clearInterval(int);

                    await User.updateOne(
                        { _id: user_id },
                        {
                          $inc: {
                            wallet: -deduct_balance,
                            totalWithdrawn: deduct_balance,
                          },
                        }
                      );

                    let errors_lengt = 0;
                    for (let x in responses_data) {
                        if (responses_data[x] && responses_data[x].error) errors_lengt++;
                        else {
                            let { buy_id, offer_status, item, balance_debited_sum } =
                                responses_data[x];
                                let itemObj = JSON.parse(item);
                                let itemMatch = ShopItemsRUST.find(i => i.name === itemObj.name);
                                let amount = itemMatch ? itemMatch.price : 0;
                            let tr = new sbWithdrawTransaction({
                                user_id,
                                buy_id,
                                offer_status,
                                item,
                                amount,
                                balance_debited_sum,
                            });

                            await tr.save();

                            const newTransaction = new CryptoTransaction();

                            // Create a new document
                            newTransaction.type = "withdraw"; // Transaction type
                
                            newTransaction.currency = "skinsback rust"; // Skinsback currency name
                            newTransaction.siteValue = amount; // Value in site balance (USD)
                            newTransaction.cryptoValue = balance_debited_sum; // Value in skinsback currency
                            newTransaction.address = tr.id; // transaction address
                
                             newTransaction.txid = `Buy ID ${buy_id}`; // Skinsback Buy ID
                             newTransaction.state = 1; // 1 = pending, 2 = declined, 3 = completed
                
                             newTransaction._user = user_id; // User who made this transaction
                
                            // Save the document
                            await newTransaction.save();

                            await insertNewWalletTransaction(user_id, -deduct_balance, "Skinsback Withdraw", {
                                transactionId: newTransaction.id,
                              });
                        }
                    }

                    let msg = "";
                    if (errors_lengt === 0) {
                        msg = `Successfully withdrawn ${items.length} item(s).`;
                    } else if (errors_lengt < items.length) {
                        msg = `${errors_lengt} item(s) were not found anymore, but we sent ${items.length - errors_lengt} item(s) successfully. If by any chance you don't receive an item, we will handle the refund automatically!`;
                    } else {
                        return resolve({
                            success: false,
                            error: `An error occurred with the game items you were trying to withdraw. Please try refreshing the withdrawal inventory or contact support!`,
                        });
                    }
                    
                    //console.log(`responses_data`, responses_data);
                    return resolve({ success: true, msg });
                }
            }, 250);
        });
    } catch (e) {
        console.error(e);
        return { success: false, error: e.toString() };
    }
};

const withdraw_itemsDOTA2 = async (user_id, items, tradelink) => {
    try {
        if (items.length == 0)
            return res.json({
                success: false,
                error: `You need to select at least one item to withdraw!`,
            });

        if (items.length > 5)
            return res.json({
                success: false,
                error: `You can withdraw maximum 5 items at once!`,
            });

        if (!(tradelink.includes("partner=") && tradelink.includes("token=")))
            return res.json({
                success: false,
                error: `Invalid tradelink!`,
            });

        let responses_data = [];
        let deduct_balance = 0;
        let items_value = 0;

        // tokens[0] = partner
        // tokens[1] = token
        let [partner, token] = tradelink.split("partner=")[1].split("&token=");

        let item_error_price = false;

        for (let d in items) {
            let item_price = ShopItemsDOTA2.filter(i => {
                return i.name == items[d];
            }).map(i => {
                return i.price;
            });
            if (item_price.length == 0) {
                item_error_price = true;
                continue;
            }
            items_value = parseFloat(items_value) + parseFloat(item_price[0]);
        }

        if (item_error_price)
            return {
                success: false,
                error: `An error ocurred getting item's price, please refresh the withdraw inventory!`,
            };

        let dbUser = await User.findOne({ _id: user_id });

        // If user has not enough balance
        if (dbUser.wallet < items_value)
            return {
                success: false,
                error: `You don't have enough balance to withdraw these items!`,
            };

        // If user has transactions locked
        if (dbUser.transactionsLocked)
            return {
                success: false,
                error: `Your account has a transaction restriction. Please contact support for more information.`,
            };

        // If user has wager limit, check if it's been passed
        if (dbUser.wager < dbUser.customWagerLimit)
            return {
                success: false,
                error: `Because your account has wager limit, you must wager still $${(dbUser.customWagerLimit - dbUser.wager).toFixed(2)} before withdrawing!`,
            };

        // Check that user has wagered atleast 100% of his deposited amount    
        if (dbUser.wagerNeededForWithdraw > 0)
            return {
                success: false,
                error: `You must wager atleast $${dbUser.wagerNeededForWithdraw.toFixed(2)} before withdrawing!`,
            };

        // If user has deposited less than $5.00 before withdrawing, check config file for amount
        if (dbUser.totalDeposited < config.games.vip.minDepositForWithdraw)
            return {
                success: false,
                error: `You must have deposited atleast $${config.games.vip.minDepositForWithdraw} before withdrawing!`,
            };

            const createResponseReq = async item => {
                try {
                  let itemMatch = ShopItemsDOTA2.find(i => i.name === item);
                  if (!itemMatch) {
                    //console.log(`Item not found: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let item_price = itemMatch.price;
                  if (item_price === undefined) {
                    //console.log(`Item price not found for item: ${item}`);
                    responses_data.push({ error: true });
                    return;
                  }
              
                  let resp = await API.buyItemByNameAndSendToUser({
                    partner,
                    token,
                    name: item,
                    max_price: item_price || 0,
                    game: "dota2",
                  });
              
                  //console.log(`Item: ${item}`);
                  //console.log(`Response: ${JSON.stringify(resp)}`);
              
                  if (resp && resp.offer_status) {
                    let valid_offer_statuses = ["creating_trade", "waiting_accept", "accepted"];
              
                    if (valid_offer_statuses.includes(resp.offer_status)) {
                      deduct_balance += parseFloat(item_price);
                    }
                  }
                  resp.item = JSON.stringify(resp.item);
                  responses_data.push(resp);
                  //console.log(`Responses data: ${JSON.stringify(responses_data)}`);
                } catch (e) {
                  console.error(e);
                  responses_data.push({ error: true });
                }
              };

        for (let x in items) {
            createResponseReq(items[x]);
        }

        return new Promise(async resolve => {
            let int = setInterval(async () => {
                if (responses_data.length == items.length) {
                    clearInterval(int);

                    await User.updateOne(
                        { _id: user_id },
                        {
                          $inc: {
                            wallet: -deduct_balance,
                            totalWithdrawn: deduct_balance,
                          },
                        }
                      );

                    let errors_lengt = 0;
                    for (let x in responses_data) {
                        if (responses_data[x] && responses_data[x].error) errors_lengt++;
                        else {
                            let { buy_id, offer_status, item, balance_debited_sum } =
                                responses_data[x];
                                let itemObj = JSON.parse(item);
                                let itemMatch = ShopItemsDOTA2.find(i => i.name === itemObj.name);
                                let amount = itemMatch ? itemMatch.price : 0;
                            let tr = new sbWithdrawTransaction({
                                user_id,
                                buy_id,
                                offer_status,
                                item,
                                amount,
                                balance_debited_sum,
                            });

                            await tr.save();

                            const newTransaction = new CryptoTransaction();

                            // Create a new document
                            newTransaction.type = "withdraw"; // Transaction type
                
                            newTransaction.currency = "skinsback dota2"; // Skinsback currency name
                            newTransaction.siteValue = amount; // Value in site balance (USD)
                            newTransaction.cryptoValue = balance_debited_sum; // Value in skinsback currency
                            newTransaction.address = tr.id; // transaction address
                
                             newTransaction.txid = `Buy ID ${buy_id}`; // Skinsback Buy ID
                             newTransaction.state = 1; // 1 = pending, 2 = declined, 3 = completed
                
                             newTransaction._user = user_id; // User who made this transaction
                
                            // Save the document
                            await newTransaction.save();

                            await insertNewWalletTransaction(user_id, -deduct_balance, "Skinsback Withdraw", {
                                transactionId: newTransaction.id,
                              });
                        }
                    }

                    let msg = "";
                    if (errors_lengt === 0) {
                        msg = `Successfully withdrawn ${items.length} item(s).`;
                    } else if (errors_lengt < items.length) {
                        msg = `${errors_lengt} item(s) were not found anymore, but we sent ${items.length - errors_lengt} item(s) successfully. If by any chance you don't receive an item, we will handle the refund automatically!`;
                    } else {
                        return resolve({
                            success: false,
                            error: `An error occurred with the game items you were trying to withdraw. Please try refreshing the withdrawal inventory or contact support!`,
                        });
                    }
                    
                    //console.log(`responses_data`, responses_data);
                    return resolve({ success: true, msg });
                }
            }, 250);
        });
    } catch (e) {
        console.error(e);
        return { success: false, error: e.toString() };
    }
};

const load_market_items_CSGO = async user_id => {
    try {
        let res = await API.getMarketPriceList("csgo");
        let items_filtered = res.items
            .filter(i => {
                return i.count > 0 && i.price > config.authentication.skinsback.withdrawMinItemPrice;
            })
            .map(i => {
                // commission for items in withdraw
                let better_price = WITHDRAW_COMMISSION;
                let price = parseFloat(parseFloat(i.price + i.price * (better_price / 100)).toFixed(2));

                return {
                    name: i.name,
                    price,
                    image: `https://steamcommunity-a.akamaihd.net/economy/image/class/730/${i.classid}/300fx300f`,  // set null, when testing
                };
            });
        console.log(`[SKINSBACK SHOP] Loaded ${items_filtered.length} CS:GO items from the API for user ${user_id}.`);
        ShopItemsCSGO = items_filtered;
        return items_filtered;
    } catch (e) {
        console.error(`SkinsBack API error`, e.toString());
    }
};

const load_market_items_RUST = async user_id => {
    try {
        let res = await API.getMarketPriceList("rust");
        let items_filtered = res.items
            .filter(i => {
                return i.count > 0 && i.price > config.authentication.skinsback.withdrawMinItemPrice;
            })
            .map(i => {
                // commission for items in withdraw
                let better_price = WITHDRAW_COMMISSION;
                let price = parseFloat(parseFloat(i.price + i.price * (better_price / 100)).toFixed(2));

                return {
                    name: i.name,
                    price,
                    image: `https://steamcommunity-a.akamaihd.net/economy/image/class/252490/${i.classid}/300fx300f`,  // set null, when testing
                };
            });
        console.log(`[SKINSBACK SHOP] Loaded ${items_filtered.length} RUST items from the API for user ${user_id}.`);
        ShopItemsRUST = items_filtered;
        return items_filtered;
    } catch (e) {
        console.error(`SkinsBack API error`, e.toString());
    }
};

const load_market_items_DOTA2 = async user_id => {
    try {
        let res = await API.getMarketPriceList("dota2");
        let items_filtered = res.items
            .filter(i => {
                return i.count > 0 && i.price > config.authentication.skinsback.withdrawMinItemPrice;
            })
            .map(i => {
                // commission for items in withdraw
                let better_price = WITHDRAW_COMMISSION;
                let price = parseFloat(parseFloat(i.price + i.price * (better_price / 100)).toFixed(2));

                return {
                    name: i.name,
                    price,
                    image: `https://steamcommunity-a.akamaihd.net/economy/image/class/570/${i.classid}/300fx300f`,  // set null, when testing
                };
            });
        console.log(`[SKINSBACK SHOP] Loaded ${items_filtered.length} DOTA2 items from the API for user ${user_id}.`);
        ShopItemsDOTA2 = items_filtered;
        return items_filtered;
    } catch (e) {
        console.error(`SkinsBack API error`, e.toString());
    }
};

setInterval(() => {
    check_order_statues();
}, 40000);

module.exports = {
    main,
    create_order,
    result,
    load_market_items_CSGO,
    load_market_items_RUST,
    load_market_items_DOTA2,
    withdraw_itemsCSGO,
    withdraw_itemsRUST,
    withdraw_itemsDOTA2,
};