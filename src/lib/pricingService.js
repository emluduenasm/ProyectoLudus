const roundMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

export const COMMISSION_TYPES = new Set(["percent", "fixed"]);

export function parseMoney(value, fallback = 0) {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return roundMoney(num);
}

export function parsePercent(value, fallback = 0) {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num < 0 || num > 1000) return null;
  return roundMoney(num);
}

export function normalizeCommissionType(value, fallback = "percent") {
  const clean = String(value || "").trim().toLowerCase();
  return COMMISSION_TYPES.has(clean) ? clean : fallback;
}

export function calculateProductPricing(input = {}) {
  const productCost = roundMoney(input.product_cost);
  const fixedCosts = roundMoney(input.fixed_costs);
  const siteProfitPercent = roundMoney(input.site_profit_percent);
  const commissionType = normalizeCommissionType(input.designer_commission_type);
  const commissionValue = roundMoney(input.designer_commission_value);

  const productionCost = roundMoney(productCost + fixedCosts);
  const siteProfitAmount = roundMoney(productionCost * (siteProfitPercent / 100));
  const designerBasePrice = roundMoney(productionCost + siteProfitAmount);
  const designerCommissionAmount =
    commissionType === "fixed"
      ? commissionValue
      : roundMoney(designerBasePrice * (commissionValue / 100));
  const salePrice = roundMoney(designerBasePrice + designerCommissionAmount);

  return {
    product_cost: productCost,
    fixed_costs: fixedCosts,
    production_cost: productionCost,
    site_profit_percent: siteProfitPercent,
    site_profit_amount: siteProfitAmount,
    designer_base_price: designerBasePrice,
    designer_commission_type: commissionType,
    designer_commission_value: commissionValue,
    designer_commission_amount: designerCommissionAmount,
    price: salePrice
  };
}

export function pricingSnapshot(input = {}) {
  const hasLegacyPrice =
    roundMoney(input.price) > 0 &&
    roundMoney(input.product_cost) === 0 &&
    roundMoney(input.fixed_costs) === 0 &&
    roundMoney(input.site_profit_percent) === 0 &&
    roundMoney(input.designer_commission_value) === 0;
  if (hasLegacyPrice) {
    const price = roundMoney(input.price);
    return {
      currency: "ARS",
      product_cost: price,
      fixed_costs: 0,
      production_cost: price,
      site_profit_percent: 0,
      site_profit_amount: 0,
      designer_base_price: price,
      designer_commission_type: normalizeCommissionType(input.designer_commission_type),
      designer_commission_value: 0,
      designer_commission_amount: 0,
      price
    };
  }
  const pricing = calculateProductPricing(input);
  return {
    currency: "ARS",
    ...pricing
  };
}
