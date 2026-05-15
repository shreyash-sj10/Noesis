const adaptTrade = (trade) => {
  if (!trade) return null;
  const pricePaise = trade.pricePaise || 0;
  const totalValuePaise =
    trade.totalValuePaise != null
      ? trade.totalValuePaise
      : Math.round((trade.quantity || 0) * pricePaise);
  const side = trade.type || trade.side || null;
  const isSell = side === "SELL";
  const pnlFinite = typeof trade.pnlPaise === "number" && Number.isFinite(trade.pnlPaise);

  return {
    tradeId: trade.tradeId || trade.id || trade._id || null,
    symbol: trade.symbol || null,
    side,
    productType: trade.productType || "DELIVERY",
    pricePaise,
    /** Authoritative execution price (paise); same as pricePaise for executed rows. */
    executionPricePaise: pricePaise,
    totalValuePaise,
    stopLossPaise: trade.stopLossPaise || null,
    targetPricePaise: trade.targetPricePaise || null,
    quantity: trade.quantity || 0,
    preTradeEmotion: trade.preTradeEmotion || null,
    /**
     * SELL: always expose `pnlPaise` so clients/tests never see a missing key when the
     * domain value is null (e.g. not yet computed) or 0 (flat round-trip). BUY: omit unless numeric.
     */
    ...(isSell ? { pnlPaise: pnlFinite ? trade.pnlPaise : null } : pnlFinite ? { pnlPaise: trade.pnlPaise } : {}),
    pnlPct: trade.pnlPct || 0,
    status: trade.status || "UNKNOWN",
    reflectionStatus: trade.reflectionStatus ?? null,
    decisionSnapshot: trade.decisionSnapshot || trade.preTradeSnapshot || null,
    learningSurface: trade.learningOutcome || trade.reflection || null,
    trace: trade.trace || null,
    ai: trade.ai || null,
  };
};

module.exports = { adaptTrade };
