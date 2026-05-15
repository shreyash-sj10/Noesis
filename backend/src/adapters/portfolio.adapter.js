const { calculatePct } = require("../utils/paise");

const adaptPortfolio = (portfolio) => {
  if (!portfolio) return null;

  const totalValuePaise = Math.round(Number(portfolio.netEquity || portfolio.totalValuePaise || 0));
  const balancePaise = Math.round(
    Number(portfolio.balance !== undefined ? portfolio.balance : (portfolio.balancePaise || 0)),
  );

  const investedPaise = Math.round(Number(portfolio.totalInvested || 0));
  let totalPnlPct = portfolio.totalPnlPct;

  if (totalPnlPct === undefined || totalPnlPct === null) {
      const unrealizedPaise = Math.round(Number(portfolio.unrealizedPnL || 0));
      const realizedPaise = Math.round(Number(portfolio.realizedPnL || 0));
      const investedRounded = Math.round(Number(investedPaise || 0));

      // PROTOCOL: Single Percentage Utility Enforcement (integer paise aggregates)
      totalPnlPct = calculatePct(unrealizedPaise + realizedPaise, investedRounded);
  }

  return {
    totalValuePaise,
    totalPnlPct,
    balancePaise,
    unrealizedPnLPaise: Math.round(Number(portfolio.unrealizedPnL || 0)),
    realizedPnLPaise: Math.round(Number(portfolio.realizedPnL || 0)),
    totalInvestedPaise: investedPaise,
    winRate:            portfolio.winRate        || 0,
    pendingOrders: Array.isArray(portfolio.pendingOrders) ? portfolio.pendingOrders : [],
  };
};

const adaptPositions = (positions) => {
  if (!Array.isArray(positions)) return [];
  return positions.map((p) => ({
    symbol: p.symbol || p.fullSymbol || null,
    fullSymbol: p.fullSymbol || p.symbol || null,
    quantity: p.quantity || 0,
    avgPricePaise: p.avgPricePaise || 0,
    currentPricePaise: p.currentPricePaise || 0,
    investedValuePaise: p.investedValuePaise || 0,
    unrealizedPnLPaise: p.unrealizedPnL ?? p.unrealizedPnLPaise ?? 0,
    pnlPct: p.pnlPct || 0,
    dayChangePct: p.dayChangePct ?? null,
    isFallback: Boolean(p.isFallback),
    source: p.source || null,
  }));
};

module.exports = { adaptPortfolio, adaptPositions };
