// Application Main Config
module.exports = {
  site: {
    // Site configurations on server startup
    enableMaintenanceOnStart: false,
    manualWithdrawsEnabled: true,
    enableLoginOnStart: true,
    // Site endpoints
    backend: {
      productionUrl: "http://localhost:5000", //localhost do http://localhost:5000 // else "https://api.adashuffle.com"
      developmentUrl: "http://localhost:5000",
    },
    frontend: {
      productionUrl: "http://localhost:3000", //localhost do http://localhost:3000 // else "https://adashuffle.com"
      developmentUrl: "http://localhost:3000",
    },
    adminFrontend: {
      productionUrl: "https://admin.adashuffle.com",
      developmentUrl: "",
    },
  },
  database: {
    developmentMongoURI: "", // MongoURI to use in development
    productionMongoURI: "mongodb://localhost/adashuffle-com", // MongoURI to use in production
  },
  // Each specific game configuration
  games: {
    exampleGame: {
      minBetAmount: 1, // Min bet amount (in coins)
      maxBetAmount: 100000, // Max bet amount (in coins)
      feePercentage: 0.1, // House fee percentage
    },
    race: {
      prizeDistribution: [40, 20, 14.5, 7, 5.5, 4.5, 3.5, 2.5, 1.5, 1], // How is the prize distributed (place = index + 1)
    },
    vip: {
      minDepositForWithdraw: 5, // You must have deposited atleast this amount before withdrawing
      minWithdrawAmount: 5, // Minimum Withdraw Amount
      levelToChat: 2, // The level amount you need to chat
      levelToTip: 15, // The level to use the tip feature in chat
      levelToRain: 10, // The level amount to start a rain
      wagerToJoinRain: 5, // The wager amount to join the rain in chat
      minRakebackClaim: 2, // The min rakeback amount you need to claim rakeback
      numLevels: 500, // Number of total levels
      minWager: 0, // minWager
      maxWager: 502007, // maxWager
      rakeback: 21.66, // Max rakeback
      vipLevelNAME: [
        "Beginner",
        "Amateur",
        "Professional",
        "Elite",
        "Master",
        "Expert",
        "Champion",
        "Veteran",
        "Ace",
        "Prodigy",
        "Legend",
        "Crown",
      ],
      vipLevelCOLORS: [
        "rgb(193, 172, 166)",
        "rgb(197, 140, 123)",
        "rgb(215, 117, 88)",
        "rgb(163, 172, 190)",
        "rgb(116, 168, 181)",
        "rgb(71, 190, 219)",
        "rgb(209, 182, 136)",
        "rgb(215, 169, 88)",
        "rgb(97, 71, 219)",
        "rgb(96, 183, 100)",
        "rgb(140, 48, 112)",
        "rgb(152, 38, 38)",
      ],
    },
    affiliates: {
      earningPercentage: 10, // How many percentage of house edge the affiliator will get
    },
    coinflip: {
      minBetAmount: 0.1, // Min bet amount (in coins)
      maxBetAmount: 100000, // Max bet amount (in coins)
      feePercentage: 0.05, // House fee percentage
    },
    jackpot: {
      minBetAmountLow: 0.1, // Min bet amount (in coins)
      maxBetAmountLow: 5, // Max bet amount (in coins)
      minBetAmountMid: 1, // Min bet amount (in coins)
      maxBetAmountMid: 25, // Max bet amount (in coins)
      minBetAmountHigh: 10, // Min bet amount (in coins)
      maxBetAmountHigh: 2500, // Max bet amount (in coins)
      feePercentage: 0.05, // House fee percentage
      waitingTime: 19000, // Waiting Time before spin starts
    },
    roulette: {
      minBetAmount: 0.1, // Min bet amount (in coins)
      maxBetAmount: 100, // Max bet amount (in coins)
      feePercentage: 0.03, // House fee percentage
      waitingTime: 15000, // Roulette waiting time in ms
    },
    crash: {
      minBetAmount: 0.1, // Min bet amount (in coins)
      maxBetAmount: 100, // Max bet amount (in coins)
      maxProfit: 1000, // Max profit on crash, forces auto cashout
      houseEdge: 0.07, // House edge percentage
    },
  },
  blochain: {
    // EOS Blockchain provider API root url
    // without following slashes
    httpProviderApi: "http://eos.greymass.com",
  },
  authentication: {
    jwtSecret: "vf4Boy2WT1bVgphxFqjEY2GjciChkXvf4Boy2WT1hkXv2", // Secret used to sign JWT's. KEEP THIS AS A SECRET 45, dont change this
    jwtExpirationTime: 360000, // JWT-token expiration time (in seconds)
    twilio: {
      accountSid: "ACaa235e5c0bee54ca5ee82ad619b3738c", //leave as it is, phone verification is deactivated
      authToken: "4218e42c3699eae27dd9fb2c0c0bb4b0", //leave as it is, phone verification is deactivated
      verifyServiceSid: "VAc727377e64f0c1b9174d1177c3743e74", //leave as it is, phone verification is deactivated
    },
    coinbase: {
      apiKey: "Um3Rr6jlVZDi2rEK",
      apiSecret: "WkprWczAukkZQs3r77IIcWVzC1UdmFaj",
      wallets: {
        btc: "44a3cc59-9123-5459-ba68-c7bd7def4734",
        eth: "ffd51d01-d398-5753-8618-421ebe1b8695",
        ltc: "03803a57-8693-59cf-9568-d8968b1b11d9",
      },
    },
    skinsback: {
      shop_id: "1524oqie1t-e4m8-b93m-v6rm-9os0hi5henge",
      secret_key: "1524-LPzQF3t1Sa0H2XTGsTV3laW7EB08d8",
      withdrawFee: 15, // withdraw fee, make items more expensive than they are
      withdrawMinItemPrice: 500, // minimum item price for withdraw items
    },
    reCaptcha: {
      secretKey: "6LcWZY8iAAAAADarIi3jAo-rjOxIJFNVBG-Ol0w1", //localhost do 6LcWZY8iAAAAADarIi3jAo-rjOxIJFNVBG-Ol0w1 //adashuffle do 6Lepd2UjAAAAAKMgTRyE7-AFOPkzvD6XhiA4d4VE
    },
    googleOauth: {
      clientId:
        "1050954520208-di3svepn2ier9blvb33urk62bg63easo.apps.googleusercontent.com", //if domain is adashuffle.com leave as it is
      clientSecret: "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", //if domain is adashuffle.com leave as it is
    },
    steam: {
      apiKey: "D133223AE8BC559B71F0EF7CFA01F2AB", // Your Steam API key //if domain is adashuffle.com leave as it is //for localhost need probably localhost apikey
    },
  },
};
