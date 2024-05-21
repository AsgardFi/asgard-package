"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceBias = exports.parsePriceInfo = exports.getPriceWithConfidence = void 0;
const pyth_1 = require("../vendor/pyth");
const bignumber_js_1 = __importDefault(require("bignumber.js"));
const switchboard_1 = require("../vendor/switchboard");
const __1 = require("..");
const bank_1 = require("./bank");
var PriceBias;
(function (PriceBias) {
    PriceBias[PriceBias["Lowest"] = 0] = "Lowest";
    PriceBias[PriceBias["None"] = 1] = "None";
    PriceBias[PriceBias["Highest"] = 2] = "Highest";
})(PriceBias || (PriceBias = {}));
exports.PriceBias = PriceBias;
function parseOraclePriceData(oracleSetup, rawData) {
    const debug = require("debug")("mfi:oracle-loader");
    switch (oracleSetup) {
        case bank_1.OracleSetup.PythEma:
            const pythPriceData = (0, pyth_1.parsePriceData)(rawData);
            let priceData = pythPriceData.price;
            if (priceData === undefined) {
                priceData = pythPriceData.previousPrice;
            }
            let confidenceData = pythPriceData.confidence;
            if (confidenceData === undefined) {
                confidenceData = pythPriceData.previousConfidence;
            }
            const pythPriceRealtime = new bignumber_js_1.default(priceData);
            const pythConfidenceRealtime = new bignumber_js_1.default(confidenceData).times(__1.PYTH_PRICE_CONF_INTERVALS);
            const maxPythConfidenceRealtime = pythPriceRealtime.times(__1.MAX_CONFIDENCE_INTERVAL_RATIO);
            const pythConfidenceRealtimeCapped = bignumber_js_1.default.min(pythConfidenceRealtime, maxPythConfidenceRealtime);
            const pythLowestPriceRealtime = pythPriceRealtime.minus(pythConfidenceRealtimeCapped);
            const pythHighestPriceRealtime = pythPriceRealtime.plus(pythConfidenceRealtimeCapped);
            const pythPriceWeighted = new bignumber_js_1.default(pythPriceData.emaPrice.value);
            const pythConfIntervalWeighted = new bignumber_js_1.default(pythPriceData.emaConfidence.value).times(__1.PYTH_PRICE_CONF_INTERVALS);
            const maxPythConfidenceWeighted = pythPriceWeighted.times(__1.MAX_CONFIDENCE_INTERVAL_RATIO);
            const pythConfIntervalWeightedCapped = bignumber_js_1.default.min(pythConfIntervalWeighted, maxPythConfidenceWeighted);
            const pythLowestPrice = pythPriceWeighted.minus(pythConfIntervalWeightedCapped);
            const pythHighestPrice = pythPriceWeighted.plus(pythConfIntervalWeightedCapped);
            debug("Loaded pyth price rt=%s (+/- %s), w=%s (+/- %s)", pythPriceRealtime.toString(), pythConfidenceRealtimeCapped.toString(), pythPriceWeighted.toString(), pythConfIntervalWeightedCapped.toString());
            return {
                priceRealtime: {
                    price: pythPriceRealtime,
                    confidence: pythConfidenceRealtimeCapped,
                    lowestPrice: pythLowestPriceRealtime,
                    highestPrice: pythHighestPriceRealtime,
                },
                priceWeighted: {
                    price: pythPriceWeighted,
                    confidence: pythConfIntervalWeightedCapped,
                    lowestPrice: pythLowestPrice,
                    highestPrice: pythHighestPrice,
                },
            };
        case bank_1.OracleSetup.SwitchboardV2:
            const aggData = switchboard_1.AggregatorAccountData.decode(rawData);
            const swbPrice = new bignumber_js_1.default(switchboard_1.AggregatorAccount.decodeLatestValue(aggData).toString());
            const swbConfidence = new bignumber_js_1.default(aggData.latestConfirmedRound.stdDeviation.toBig().toString()).times(__1.SWB_PRICE_CONF_INTERVALS);
            const maxSwbConfidence = swbPrice.times(__1.MAX_CONFIDENCE_INTERVAL_RATIO);
            const swbConfidenceCapped = bignumber_js_1.default.min(swbConfidence, maxSwbConfidence);
            const swbLowestPrice = swbPrice.minus(swbConfidenceCapped);
            const swbHighestPrice = swbPrice.plus(swbConfidenceCapped);
            debug("Loaded swb price rt=%s (+/- %s), w=%s (+/- %s)", swbPrice.toString(), swbConfidenceCapped.toString(), swbPrice.toString(), swbConfidenceCapped.toString());
            return {
                priceRealtime: {
                    price: swbPrice,
                    confidence: swbConfidenceCapped,
                    lowestPrice: swbLowestPrice,
                    highestPrice: swbHighestPrice,
                },
                priceWeighted: {
                    price: swbPrice,
                    confidence: swbConfidenceCapped,
                    lowestPrice: swbLowestPrice,
                    highestPrice: swbHighestPrice,
                },
            };
        default:
            console.log("Invalid oracle setup", oracleSetup);
            throw new Error(`Invalid oracle setup "${oracleSetup}"`);
    }
}
exports.parsePriceInfo = parseOraclePriceData;
function getPriceWithConfidence(oraclePrice, weighted) {
    return weighted ? oraclePrice.priceWeighted : oraclePrice.priceRealtime;
}
exports.getPriceWithConfidence = getPriceWithConfidence;
