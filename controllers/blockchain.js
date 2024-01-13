// Require Dependencies
const { JsonRpc } = require("eosjs");
const config = require("../config");
const fetch = require("node-fetch"); // node only; not needed in browsers
const rpc = new JsonRpc(config.blochain.httpProviderApi, { fetch });

// Grab EOS block with id
const getPublicSeed = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const info = await rpc.get_info();
      const blockNumber = info.last_irreversible_block_num + 1;
      const block = await rpc.get_block(blockNumber || 1);
      resolve(block.id);
    } catch (error) {
      reject(error);
    }
  });
};

// Export functions
module.exports = { getPublicSeed };
