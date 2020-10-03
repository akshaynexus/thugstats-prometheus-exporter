const ThugsInfoABI = require("./abi/thugsinfo.json");
const ThugsTokenABI = require("./abi/thugstoken.json");
//Import libs
var Contract = require("web3-eth-contract");
const EthVal = require("ethval");
const express = require("express");
const Prometheus = require("prom-client");
const axios = require("axios");
//Setup server
const app = express();
const port = process.env.PORT || 3001;
const metricsInterval = Prometheus.collectDefaultMetrics();

const Constants = {
  //Bscswap stuff
  //BscSwap api pair setting
  THUGS_BNB_PAIR:
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c_0xE10e9822A5de22F8761919310DDA35CD997d63c0",
  //To get current usd price of bnb
  BNB_BUSD_PAIR:
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c_0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  //API path to ticker
  TICKER_API_URL: "https://api.bscswap.com/tickers",
};

var BNB_USD_PRICE = 0;

// Obj containing various stats
var ThugsStatsWei = {
  BurnVaultBalanceWei: 0,
  ForeverBurntWei: 0,
  TotalSupplyWei: 0,
};

var ThugsStats = {
  // In eth balance/ thugs balance
  BurntVaultBalance: 0,
  ForeverBurnt: 0,
  TotalSupply: 0,
  TotalBurnt: 0,
  // Self explanatory
  BurnPercent: 0,
  LastUSDPrice: 0,
  LastThugsPerBNB: 0,
};

var Gauges = {
  BurntVaultBalance: undefined,
  ForeverBurnt: undefined,
  TotalSupply: undefined,
  TotalBurnt: undefined,
  // Self explanatory
  BurnPercent: undefined,
  LastUSDPrice: undefined,
  LastThugsPerBNB: undefined,
};
var ContractInterfaces;

const init = async () => {
  // set provider for all later instances to use
  Contract.setProvider("https://bsc-dataseed.binance.org/");
  ContractInterfaces = {
    // init contract with abi and contract address for thugsinfo contract
    ThugsInfoContract: new Contract(
      ThugsInfoABI,
      "0xde5618cfbBdc4319C42Bc585646b795F0f249A68"
    ),
    // init contract with abi and contract address for token
    ThugsTokenContract: new Contract(
      ThugsTokenABI,
      "0xE10e9822A5de22F8761919310DDA35CD997d63c0"
    ),
  };
  //Initalize gauges
  await InitGauges();
  //Then refresh data
  await refreshData();
};
const UpdateLastUSDPrice = async (url) => {
  try {
    const response = await axios.get(url);
    const data = response.data;
    //Get bnb price
    BNB_USD_PRICE = data[Constants.BNB_BUSD_PAIR].last_price;
    //fetch how much thugs one bnb buys
    ThugsStats.LastThugsPerBNB = parseFloat(data[Constants.THUGS_BNB_PAIR].last_price);
    ThugsStats.LastUSDPrice = parseFloat(
      ((1 / ThugsStats.LastThugsPerBNB) * BNB_USD_PRICE).toFixed(5)
    );
  } catch (error) {
    console.log(error);
  }
};

const getTokenstats = async () => {
  // Get stats of burns in wei
  ThugsStatsWei.BurnVaultBalanceWei = await ContractInterfaces.ThugsInfoContract.methods
    .BurnVaultBalance()
    .call();
  ThugsStatsWei.ForeverBurntWei = await ContractInterfaces.ThugsInfoContract.methods
    .totalBurnt()
    .call();
  // Get burn percent
  ThugsStats.BurnPercent = await ContractInterfaces.ThugsInfoContract.methods
    .currentBurnPercent()
    .call();
  //Set burn percent as float
  ThugsStats.BurnPercent = parseFloat(ThugsStats.BurnPercent);

  // Get total supply from token contract
  ThugsStatsWei.TotalSupplyWei = await ContractInterfaces.ThugsTokenContract.methods
    .totalSupply()
    .call();
  //Now convert the amounts to eth for data retrival
  ThugsStats.BurntVaultBalance = parseFloat(
    new EthVal(ThugsStatsWei.BurnVaultBalanceWei).toEth().toFixed(2)
  );
  ThugsStats.ForeverBurnt = parseFloat(
    new EthVal(ThugsStatsWei.ForeverBurntWei).toEth().toFixed(2)
  );
  ThugsStats.TotalSupply = parseFloat(
    new EthVal(ThugsStatsWei.TotalSupplyWei).toEth().toFixed(2)
  );
  //Set total burnt amount
  ThugsStats.TotalBurnt =
    ThugsStats.ForeverBurnt + ThugsStats.BurntVaultBalance;
  //Set it to 2 decimals max
  ThugsStats.TotalBurnt = parseFloat(ThugsStats.TotalBurnt.toFixed(8));

  //Update usd price
  await UpdateLastUSDPrice(Constants.TICKER_API_URL);
  //Log stats for debug
  // console.log(ThugsStats);
};

const InitGauges = async () => {
  //Initialize various gauges
  Gauges.BurntVaultBalance = new Prometheus.Gauge({
    name: "burn_vault_balance",
    help: "Return burnvault thugs balance",
  });

  Gauges.BurnPercent = new Prometheus.Gauge({
    name: "burn_percent",
    help: "Return current burn percentage",
  });

  Gauges.ForeverBurnt = new Prometheus.Gauge({
    name: "forever_burnt",
    help: "Return forever burnt supply",
  });

  Gauges.TotalSupply = new Prometheus.Gauge({
    name: "total_supply",
    help: "Return total supply",
  });

  Gauges.TotalBurnt = new Prometheus.Gauge({
    name: "total_burnt",
    help:
      "Return total supply burnt,this includes the burnvault and tokens sent to 0x0 address",
  });

  Gauges.LastUSDPrice = new Prometheus.Gauge({
    name: "last_usd_price",
    help: "Return last usd price from bscswap for 1 thugs",
  });
  Gauges.LastThugsPerBNB = new Prometheus.Gauge({
    name: "last_thugs_per_bnb",
    help: "Return how much thugs 1 bnb buys",
  });
};

const refreshData = async () => {
  //Get data from contracts
  await getTokenstats();
  //Update gauges
  await SetData();
};

const SetData = async () => {
  //Set data from thugstats obj
  Gauges.BurntVaultBalance.set(ThugsStats.BurntVaultBalance);
  Gauges.BurnPercent.set(ThugsStats.BurnPercent);
  Gauges.ForeverBurnt.set(ThugsStats.ForeverBurnt);
  Gauges.TotalSupply.set(ThugsStats.TotalSupply);
  Gauges.TotalBurnt.set(ThugsStats.TotalBurnt);
  Gauges.LastUSDPrice.set(ThugsStats.LastUSDPrice);
  Gauges.LastThugsPerBNB.set(ThugsStats.LastThugsPerBNB);
};

//---- Server code start ----
// Runs before each requests
app.use((req, res, next) => {
  res.locals.startEpoch = Date.now();
  next();
});

app.get("/metrics", (req, res) => {
  res.set("Content-Type", Prometheus.register.contentType);
  res.end(Prometheus.register.metrics());
});

// Error handler
app.use((err, req, res, next) => {
  res.statusCode = 500;
  // Do not expose your error in production
  res.json({ error: err.message });
  next();
});

// Runs after each requests
app.use((req, res, next) => {
  const responseTimeInMs = Date.now() - res.locals.startEpoch;
  console.log(responseTimeInMs);
  next();
});

const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  clearInterval(metricsInterval);

  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    process.exit(0);
  });
});

//---- Server code ends ----

//Run init
init();

setInterval(async function () {
  //Refresh each 10 seconds
  await refreshData();
}, 10000);
