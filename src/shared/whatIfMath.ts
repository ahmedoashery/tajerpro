import type {
  EquityPartnerDistributionRow,
  ProfitLossReport,
  WhatIfInputs,
  WhatIfPartnerImpactRow,
  WhatIfSimulationSummary,
} from './types';

function round2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}

function round1(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(1));
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function getBaselineGrossMarginPct(pl: ProfitLossReport): number {
  if (pl.netSalesRevenue <= 0) return 0;
  return round2((pl.grossProfit / pl.netSalesRevenue) * 100);
}

export function createDefaultWhatIfInputs(pl: ProfitLossReport): WhatIfInputs {
  return {
    targetGrossMarginPct: getBaselineGrossMarginPct(pl),
    salesVolumeDeltaPct: 0,
    opExDeltaPct: 0,
    fixedOpExDeltaEgp: 0,
  };
}

export function computeWhatIfProjection(
  pl: ProfitLossReport,
  rawInputs: WhatIfInputs,
  equityRows: EquityPartnerDistributionRow[] = []
): WhatIfSimulationSummary {
  const targetGrossMarginPct = round2(clamp(rawInputs.targetGrossMarginPct, -50, 95));
  const salesVolumeDeltaPct = round2(clamp(rawInputs.salesVolumeDeltaPct, -90, 300));
  const opExDeltaPct = round2(clamp(rawInputs.opExDeltaPct, -95, 300));
  const fixedOpExDeltaEgp = round2(
    Number.isFinite(rawInputs.fixedOpExDeltaEgp) ? rawInputs.fixedOpExDeltaEgp : 0
  );

  const baseRevenue = round2(pl.netSalesRevenue);
  const baseCogs = round2(pl.historicalCogs);
  const baseGrossProfit = round2(pl.grossProfit);
  const baseExactGrossMarginPct = getBaselineGrossMarginPct(pl);
  const baseGrossMarginPct = round1(pl.grossMarginPercent);
  const baseCardFees = round2(pl.cardFeesTotal);
  const baseOpEx = round2(pl.operatingExpensesTotal);
  const baseNetProfit = round2(pl.netOperatingProfit);
  const baseNetMarginPct = round1(pl.netOperatingMarginPercent);

  const cardFeeRate = baseRevenue > 0 ? baseCardFees / baseRevenue : 0;
  const baseContributionRatio =
    baseRevenue > 0 ? (baseGrossProfit - baseCardFees) / baseRevenue : 0;
  const baseBreakEvenRevenue =
    baseContributionRatio > 0.0001 ? round2(baseOpEx / baseContributionRatio) : null;

  const volumeFactor = Math.max(0, 1 + salesVolumeDeltaPct / 100);
  const simRevenue = round2(baseRevenue * volumeFactor);

  // Preserve exact historical gross profit when margin input stays at baseline precision
  const isMarginAtBaseline = Math.abs(targetGrossMarginPct - baseExactGrossMarginPct) < 0.005;
  const simGrossProfit = isMarginAtBaseline
    ? round2(baseGrossProfit * volumeFactor)
    : round2(simRevenue * (targetGrossMarginPct / 100));
  const simCogs = round2(simRevenue - simGrossProfit);
  const simGrossMarginPct = simRevenue > 0 ? round1((simGrossProfit / simRevenue) * 100) : round1(targetGrossMarginPct);

  const simCardFees = round2(baseCardFees * volumeFactor);
  const opExFactor = Math.max(0, 1 + opExDeltaPct / 100);
  const simOpEx = Math.max(0, round2(baseOpEx * opExFactor + fixedOpExDeltaEgp));

  const simNetProfit = round2(simGrossProfit - simCardFees - simOpEx);
  const simNetMarginPct = simRevenue > 0 ? round1((simNetProfit / simRevenue) * 100) : 0;

  const simContributionRatio = targetGrossMarginPct / 100 - cardFeeRate;
  const simBreakEvenRevenue =
    simContributionRatio > 0.0001 ? round2(simOpEx / simContributionRatio) : null;

  const revenueDelta = round2(simRevenue - baseRevenue);
  const grossProfitDelta = round2(simGrossProfit - baseGrossProfit);
  const operatingExpensesDelta = round2(simOpEx - baseOpEx);
  const netProfitDelta = round2(simNetProfit - baseNetProfit);
  const netProfitDeltaPct =
    Math.abs(baseNetProfit) > 0.001
      ? round1((netProfitDelta / Math.abs(baseNetProfit)) * 100)
      : null;

  const margin1PctImpactEgp = round2(simRevenue * 0.01);
  const breakEvenMarginPct =
    simRevenue > 0 ? round1(((simOpEx + simCardFees) / simRevenue) * 100) : null;

  // Penny-exact projected partner shares matching reportService equity reconciliation
  const activeRows = equityRows.filter((r) => r.partner.active && r.partner.profitSharePercent > 0);
  const totalActiveSharePct = round2(
    activeRows.reduce((sum, r) => sum + Number(r.partner.profitSharePercent || 0), 0)
  );
  const targetPool = round2((simNetProfit * totalActiveSharePct) / 100);
  const lastActiveId = activeRows.length > 0 ? activeRows[activeRows.length - 1].partner.id : null;
  let allocated = 0;

  const partnerImpacts: WhatIfPartnerImpactRow[] = equityRows
    .filter((r) => r.partner.active)
    .map((row) => {
      const sharePct = Number(row.partner.profitSharePercent || 0);
      let simulatedShare = 0;
      if (sharePct > 0) {
        if (row.partner.id === lastActiveId) {
          simulatedShare = round2(targetPool - allocated);
        } else {
          simulatedShare = round2((simNetProfit * sharePct) / 100);
          allocated = round2(allocated + simulatedShare);
        }
      }
      const baselineShare = round2(row.periodProfitShare);
      return {
        partnerId: row.partner.id,
        partnerName: row.partner.name,
        roleTitle: row.partner.roleTitle,
        sharePercent: sharePct,
        baselineShare,
        simulatedShare,
        deltaShare: round2(simulatedShare - baselineShare),
      };
    });

  return {
    inputs: {
      targetGrossMarginPct,
      salesVolumeDeltaPct,
      opExDeltaPct,
      fixedOpExDeltaEgp,
    },
    baseline: {
      revenue: baseRevenue,
      cogs: baseCogs,
      grossProfit: baseGrossProfit,
      grossMarginPct: baseGrossMarginPct,
      cardFees: baseCardFees,
      operatingExpenses: baseOpEx,
      netOperatingProfit: baseNetProfit,
      netMarginPct: baseNetMarginPct,
      breakEvenRevenue: baseBreakEvenRevenue,
    },
    simulated: {
      revenue: simRevenue,
      cogs: simCogs,
      grossProfit: simGrossProfit,
      grossMarginPct: simGrossMarginPct,
      cardFees: simCardFees,
      operatingExpenses: simOpEx,
      netOperatingProfit: simNetProfit,
      netMarginPct: simNetMarginPct,
      breakEvenRevenue: simBreakEvenRevenue,
    },
    deltas: {
      revenueDelta,
      grossProfitDelta,
      operatingExpensesDelta,
      netProfitDelta,
      netProfitDeltaPct,
      margin1PctImpactEgp,
      breakEvenMarginPct,
    },
    partnerImpacts,
  };
}
