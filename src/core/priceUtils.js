// c:\Coding\tool\src\core\priceUtils.js

export function getPriceData(source) {
  if (!source) return { value: 0, currency: "BTC" };

  if (typeof source === "object") {
    // If source has 'paid', it's a total amount, not a rate.
    if (source.paid !== undefined) {
      return {
        value: parsePriceValue(source.paid),
        currency: (
          source.currency ??
          source.price_unit ??
          source.unit ??
          "BTC"
        ).toUpperCase(),
        isTotalCost: true,
      };
    }
    // Otherwise, assume it's a rate or a single value
    const val = parsePriceValue(
      source.BTC ?? source.value ?? source.amount ?? source.price,
    );
    const curr = (
      source.currency ??
      source.price_unit ??
      source.unit ??
      "BTC"
    ).toUpperCase();
    return { value: val, currency: curr, isTotalCost: false };
  }

  return { value: parsePriceValue(source), currency: "BTC" };
}

export function getBtcPriceData(source) {
  if (!source)
    return {
      value: 0,
      currency: "BTC",
      isTotalCost: false,
      isPerHashRate: true,
    };

  const data = getPriceData(source);

  // Detect if it's a rental total cost or a listing rate
  const isTotalCost = !!(
    typeof source === "object" &&
    (source.paid !== undefined || source.amount !== undefined)
  );
  const isPerHashRate = !isTotalCost;

  // Handle MRR-style nested price objects specifically for rates
  if (typeof source === "object" && !source.paid && source.BTC) {
    return {
      value: parsePriceValue(source.BTC),
      currency: "BTC",
      isTotalCost: false,
      isPerHashRate: true,
      unit: (source.price_unit || source.unit || "TH").toUpperCase(),
    };
  }

  return {
    ...data,
    isTotalCost,
    isPerHashRate,
    unit: (source?.unit || source?.price_unit || "TH").toUpperCase(),
  };
}

export function parsePriceValue(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
