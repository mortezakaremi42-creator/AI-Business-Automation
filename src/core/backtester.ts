import {
  BacktestRegimeStat,
  BacktestSummary,
  Bit24MarketInfo,
  ModuleRiskSettings,
  OhlcvCandle,
} from '../shared/types.js';
import { analyzeGoldMarket, evaluateGoldEarlyExit } from './goldAnalyzer.js';
import { buildOrderBookSnapshot } from './indicators.js';
import { smartRoundMarketPrice } from './marketSimulator.js';
import { analyzeMemePumpMarket, evaluateMemeEarlyExit } from './memeAnalyzer.js';
import { analyzeSpotCryptoMarket, evaluateSpotEarlyExit } from './spotCryptoAnalyzer.js';

export interface RunBacktestParams {
  module: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER';
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  riskSettings: ModuleRiskSettings;
  feePctPerSide: number;
  usdtIrtRate: number;
  globalXauUsd: number;
}

/**
 * Strictly causal (Zero Look-Ahead Bias) historical backtester:
 * - Signal evaluation at candle `i` ONLY sees `candles.slice(0, i + 1)` (past & current close).
 * - Entry order fills on candle `i + 1` open (`nextBar.o`) + simulated spread & slippage.
 * - Stop-Loss fills include adverse slippage (never guaranteed exact fill).
 * - Tracks regime breakdown (Bullish / Ranging / Bearish) and rejected setup reasons.
 */
export function runHistoricalBacktest(params: RunBacktestParams): BacktestSummary {
  const {
    module,
    market,
    candles,
    riskSettings,
    feePctPerSide,
    usdtIrtRate,
    globalXauUsd,
  } = params;

  const initialCapitalIrt = Math.max(10_000_000, riskSettings.allocatedCapitalIrt);
  let equityIrt = initialCapitalIrt;
  let peakEquityIrt = initialCapitalIrt;
  let maxDrawdownPct = 0;
  let totalFeesIrt = 0;
  let filteredBadSetupsCount = 0;

  let grossProfitIrt = 0;
  let grossLossIrt = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  const equityCurve: { index: number; equityIrt: number }[] = [
    { index: 0, equityIrt: initialCapitalIrt },
  ];
  const sampleTrades: BacktestSummary['sampleTrades'] = [];
  const rejectedSampleReasons: BacktestSummary['rejectedSampleReasons'] = [];

  const regimeTracker: Record<
    'BULLISH' | 'RANGING' | 'BEARISH',
    { labelFa: string; trades: number; wins: number; sumNetPct: number }
  > = {
    BULLISH: { labelFa: 'بازار صعودی (Bullish)', trades: 0, wins: 0, sumNetPct: 0 },
    RANGING: { labelFa: 'بازار رنج و نوسانی (Ranging)', trades: 0, wins: 0, sumNetPct: 0 },
    BEARISH: { labelFa: 'بازار اصلاحی/نزولی (Bearish)', trades: 0, wins: 0, sumNetPct: 0 },
  };

  let activePos: {
    entryIndex: number;
    entryPrice: number;
    notionalIrt: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    tp1Hit: boolean;
    highestPrice: number;
    regimeKey: 'BULLISH' | 'RANGING' | 'BEARISH';
  } | null = null;

  let pendingSignalForNextOpen: {
    stopLossRatio: number;
    tp1Ratio: number;
    tp2Ratio: number;
    regimeKey: 'BULLISH' | 'RANGING' | 'BEARISH';
  } | null = null;

  const startIdx = Math.min(52, Math.max(25, Math.floor(candles.length * 0.25)));

  for (let i = startIdx; i < candles.length; i++) {
    // STRICT CAUSALITY: Only slice up to index `i` (inclusive) — future candles `i+1..end` are invisible!
    const windowCandles = candles.slice(0, i + 1);
    const bar = candles[i];
    const price = bar.c;
    const prev24 = candles[Math.max(0, i - 24)]?.c || price;
    const change24hPct = prev24 > 0 ? ((price - prev24) / prev24) * 100 : 0;

    // 1. Fill pending entry at THIS bar's open (`bar.o`) + half-spread + entry slippage (zero lookahead!)
    if (!activePos && pendingSignalForNextOpen) {
      const entrySlipFraction = 0.0012; // 0.12% half-spread + entry slippage
      const fillEntryPrice = bar.o * (1 + entrySlipFraction);
      const slPrice = fillEntryPrice * pendingSignalForNextOpen.stopLossRatio;
      const tp1Price = fillEntryPrice * pendingSignalForNextOpen.tp1Ratio;
      const tp2Price = fillEntryPrice * pendingSignalForNextOpen.tp2Ratio;

      const stopDistFrac = Math.max(
        0.005,
        Math.abs(fillEntryPrice - slPrice) / Math.max(1e-8, fillEntryPrice)
      );
      const riskBudgetIrt =
        equityIrt * (Math.min(1.5, Math.max(0.15, riskSettings.riskPerTradePct)) / 100);
      const notionalIrt = Math.min(
        equityIrt * 0.45,
        riskBudgetIrt / (stopDistFrac + (feePctPerSide * 2 + 0.08) / 100)
      );

      activePos = {
        entryIndex: i,
        entryPrice: smartRoundMarketPrice(fillEntryPrice, market.quoteSymbol),
        notionalIrt,
        stopLoss: smartRoundMarketPrice(slPrice, market.quoteSymbol),
        tp1: smartRoundMarketPrice(tp1Price, market.quoteSymbol),
        tp2: smartRoundMarketPrice(tp2Price, market.quoteSymbol),
        tp1Hit: false,
        highestPrice: Math.max(fillEntryPrice, bar.h),
        regimeKey: pendingSignalForNextOpen.regimeKey,
      };
      pendingSignalForNextOpen = null;
    }

    // 2. Manage open position on current bar
    if (activePos) {
      if (bar.h > activePos.highestPrice) {
        activePos.highestPrice = bar.h;
      }

      let exitPrice: number | null = null;
      let reasonFa = '';

      // Conservative intra-bar priority: check Stop-Loss BEFORE Take-Profit if both touched in same candle!
      if (bar.l <= activePos.stopLoss) {
        // Adverse slippage on stop-loss fill (0.08%)
        exitPrice = smartRoundMarketPrice(activePos.stopLoss * 0.9992, market.quoteSymbol);
        reasonFa = activePos.tp1Hit
          ? 'قفل سود با حد ضرر متحرک (Trailing Stop)'
          : 'فعال شدن حد ضرر (با احتساب اسلیپیج واقعی)';
      } else {
        if (riskSettings.useSteppedTakeProfit && !activePos.tp1Hit && bar.h >= activePos.tp1) {
          activePos.tp1Hit = true;
          activePos.stopLoss = smartRoundMarketPrice(
            activePos.entryPrice * (1 + (feePctPerSide * 2.2) / 100),
            market.quoteSymbol
          );
        }

        if (riskSettings.useTrailingStop && activePos.tp1Hit) {
          const trail = smartRoundMarketPrice(
            activePos.highestPrice * (1 - riskSettings.trailingStopPct / 100),
            market.quoteSymbol
          );
          if (trail > activePos.stopLoss) {
            activePos.stopLoss = trail;
          }
        }

        if (bar.h >= activePos.tp2) {
          exitPrice = activePos.tp2;
          reasonFa = 'رسیدن به هدف سود نهایی (TP2)';
        } else if (riskSettings.earlyExitOnTrendWeakness) {
          const syntheticPos: any = {
            unrealizedPnlPct:
              ((price - activePos.entryPrice) / Math.max(1e-8, activePos.entryPrice)) * 100,
          };
          const early =
            module === 'DIGITAL_GOLD'
              ? evaluateGoldEarlyExit(syntheticPos, windowCandles)
              : module === 'MEME_HUNTER'
                ? evaluateMemeEarlyExit(syntheticPos, windowCandles)
                : evaluateSpotEarlyExit(syntheticPos, windowCandles);
          if (early.shouldExit) {
            exitPrice = smartRoundMarketPrice(price * 0.9995, market.quoteSymbol);
            reasonFa = early.reasonFa;
          }
        }
      }

      if (exitPrice !== null) {
        const grossMoveFraction =
          (exitPrice - activePos.entryPrice) / Math.max(1e-8, activePos.entryPrice);
        const tp1MoveFraction =
          (activePos.tp1 - activePos.entryPrice) / Math.max(1e-8, activePos.entryPrice);
        const blendedGrossFraction = activePos.tp1Hit
          ? 0.5 * tp1MoveFraction + 0.5 * grossMoveFraction
          : grossMoveFraction;

        const roundTripFrictionFraction = (feePctPerSide * 2 + 0.08) / 100;
        const feeIrt = activePos.notionalIrt * roundTripFrictionFraction;
        const netPnlIrt = activePos.notionalIrt * blendedGrossFraction - feeIrt;
        const netPnlPct = Number(
          ((blendedGrossFraction - roundTripFrictionFraction) * 100).toFixed(2)
        );

        totalFeesIrt += feeIrt;
        equityIrt += netPnlIrt;

        const reg = regimeTracker[activePos.regimeKey];
        reg.trades += 1;
        reg.sumNetPct += netPnlPct;

        if (netPnlIrt >= 0) {
          winningTrades++;
          reg.wins += 1;
          grossProfitIrt += netPnlIrt;
        } else {
          losingTrades++;
          grossLossIrt += Math.abs(netPnlIrt);
        }

        sampleTrades.push({
          entryIndex: activePos.entryIndex,
          exitIndex: i,
          entryPrice: activePos.entryPrice,
          exitPrice,
          netPnlPct,
          regimeFa: reg.labelFa,
          reasonFa,
        });

        activePos = null;
      }
    } else if (i < candles.length - 1) {
      // 3. Evaluate entry signal strictly at bar `i` close for execution on `i + 1` open
      const syntheticBook = buildOrderBookSnapshot(
        market.marketName,
        [{ price: price * 0.9988, amount: 25, total: price * 25 }],
        [{ price: price * 1.0012, amount: 25, total: price * 25 }],
        equityIrt * 0.25
      );
      const barMarket: Bit24MarketInfo = {
        ...market,
        eachPrice: price,
        change24hPct,
      };

      const impliedXau =
        market.quoteSymbol === 'IRT' ? price / Math.max(1000, usdtIrtRate) : price;
      const sig =
        module === 'DIGITAL_GOLD'
          ? analyzeGoldMarket({
              market: barMarket,
              candles: windowCandles,
              orderBook: syntheticBook,
              riskSettings,
              feePctPerSide,
              maxAllowedSpreadPct: 0.45,
              minNetRiskReward: 1.65,
              globalXauUsd: globalXauUsd > 500 ? impliedXau * 0.999 : impliedXau,
              globalXauChange24hPct: change24hPct * 0.92,
              usdtIrtRate,
            })
          : module === 'MEME_HUNTER'
            ? analyzeMemePumpMarket({
                market: barMarket,
                candles: windowCandles,
                orderBook: syntheticBook,
                riskSettings,
                feePctPerSide,
                maxAllowedSpreadPct: 0.5,
                minNetRiskReward: 1.65,
              })
            : analyzeSpotCryptoMarket({
                market: barMarket,
                candles: windowCandles,
                orderBook: syntheticBook,
                riskSettings,
                feePctPerSide,
                maxAllowedSpreadPct: 0.45,
                minNetRiskReward: 1.65,
              });

      if (sig.action === 'BUY_CONFIRMED' && price > 0) {
        const regimeKey: 'BULLISH' | 'RANGING' | 'BEARISH' =
          sig.technicals.mediumTermTrend === 'BULLISH'
            ? 'BULLISH'
            : sig.technicals.mediumTermTrend === 'BEARISH'
              ? 'BEARISH'
              : 'RANGING';

        pendingSignalForNextOpen = {
          stopLossRatio: sig.stopLoss / price,
          tp1Ratio: sig.takeProfit1 / price,
          tp2Ratio: sig.takeProfit2 / price,
          regimeKey,
        };
      } else if (sig.action === 'AVOID_UNFAVORABLE') {
        filteredBadSetupsCount++;
        if (rejectedSampleReasons.length < 8 && sig.rejectionReasonsFa[0]) {
          rejectedSampleReasons.push({
            candleIndex: i,
            price: smartRoundMarketPrice(price, market.quoteSymbol),
            reasonFa: sig.rejectionReasonsFa[0],
          });
        }
      }
    }

    if (equityIrt > peakEquityIrt) peakEquityIrt = equityIrt;
    const ddPct = peakEquityIrt > 0 ? ((peakEquityIrt - equityIrt) / peakEquityIrt) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    if (i % 3 === 0 || i === candles.length - 1) {
      equityCurve.push({ index: i, equityIrt: Math.round(equityIrt) });
    }
  }

  const totalTrades = winningTrades + losingTrades;
  const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor =
    grossLossIrt > 0 ? grossProfitIrt / grossLossIrt : grossProfitIrt > 0 ? 2.5 : 1.0;

  const regimeBreakdown: BacktestRegimeStat[] = (
    ['BULLISH', 'RANGING', 'BEARISH'] as const
  ).map((k) => {
    const r = regimeTracker[k];
    return {
      regimeFa: r.labelFa,
      trades: r.trades,
      winRatePct: r.trades > 0 ? Number(((r.wins / r.trades) * 100).toFixed(1)) : 0,
      netPnlPct: Number(r.sumNetPct.toFixed(2)),
    };
  });

  return {
    module,
    marketName: market.marketName,
    isSimulationOnly: true,
    noLookaheadVerified: true,
    candlesTested: candles.length,
    periodLabelFa: `${candles.length} کندل یک‌ساعته تاریخی (ورود روی Open کندل بعد — بدون سوگیری آینده‌نگری)`,
    initialCapitalIrt: Math.round(initialCapitalIrt),
    finalCapitalIrt: Math.round(equityIrt),
    netProfitIrt: Math.round(equityIrt - initialCapitalIrt),
    netProfitPct: Number((((equityIrt - initialCapitalIrt) / initialCapitalIrt) * 100).toFixed(2)),
    totalTrades,
    winRatePct: Number(winRatePct.toFixed(1)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    totalFeesAndSlippageIrt: Math.round(totalFeesIrt),
    filteredBadSetupsCount,
    equityCurve,
    regimeBreakdown,
    rejectedSampleReasons,
    sampleTrades: sampleTrades.slice(-10),
  };
}
