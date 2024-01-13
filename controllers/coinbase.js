// Require Dependencies
const coinbase = require("coinbase");
const config = require("../config");

// Create Coinbase client
const client = new coinbase.Client({
  apiKey: config.authentication.coinbase.apiKey,
  apiSecret: config.authentication.coinbase.apiSecret,
  strictSSL: false,
});

// Get all accounts for this user
async function getWalletAccounts() {
  return new Promise((resolve, reject) => {
    client.getAccounts({}, (error, accounts) => {
      if (error) reject(error);
      resolve(accounts);
    });
  });
}

// Create deposit address
async function createDepositAddress(currency, userId) {
  return new Promise((resolve, reject) => {
    const accountId = config.authentication.coinbase.wallets[currency];

    // Get account from coinbase
    client.getAccount(accountId, (error, account) => {
      if (error) reject(error);
      // Create address for that account
      account.createAddress(userId, (error, address) => {
        if (error) reject(error);
        resolve(address);
      });
    });
  });
}

// Create withdraw request
async function createWithdrawTransaction(
  currency,
  address,
  amountInCurrency,
  transactionId
) {
  return new Promise(async (resolve, reject) => {
    const accountId = config.authentication.coinbase.wallets[currency];

    try {
      // Get exchange rates for this cryptocurrency
      const exchangeRate = await getExchangeRate(currency.toUpperCase(), "USD");

      // Calculate crypto amount
      const exchangedAmount = parseFloat(
        (amountInCurrency / exchangeRate).toFixed(8)
      );

      // Get account from coinbase
      client.getAccount(accountId, (error, account) => {
        if (error) reject(error);

        // Setup request options
        const options = {
          // A bitcoin address, bitcoin cash address, litecoin address, ethereum
          // address, or an email of the recipient
          to: address,

          // Amount to be sent (in cryptocurrency)
          amount: exchangedAmount,

          // Currency for the amount
          currency: currency.toUpperCase(),

          // A token to ensure idempotence. If a previous transaction with the
          // same idem parameter already exists for this sender, that previous
          // transaction will be returned and a new one will not be created.
          // Max length 100 characters
          idem: transactionId,
        };

        // Send money from that account
        account.sendMoney(options, (error, transaction) => {
          if (error) reject(error);
          resolve(transaction);
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Get exchange rate for two currencies
async function getExchangeRate(currency, toCurrency) {
  return new Promise((resolve, reject) => {
    // Get exchange rate from coinbase
    client.getExchangeRates({ currency }, (error, response) => {
      if (error) reject(error);
      resolve(parseFloat(response.data.rates[toCurrency]));
    });
  });
}

// Validate incoming IPN
async function checkNotificationAuthenticity(body, signature) {
  return new Promise(resolve => {
    try {
      if (client.verifyCallback(body, signature)) {
        // Process callback
        resolve(true);
      } else {
        // Decline callback
        resolve(false);
      }
    } catch (error) {
      resolve(false);
    }
  });
}

module.exports = {
  getWalletAccounts,
  createDepositAddress,
  createWithdrawTransaction,
  getExchangeRate,
  checkNotificationAuthenticity,
};
