// Currency formatting utility for INR (₹) and Indian Numbering System
export function formatINR(val: number | null | undefined, showSign = false): string {
  if (val === null || val === undefined || isNaN(val)) return "₹0.00";
  const absVal = Math.abs(val);
  const formatted = absVal.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const sign = val < 0 ? "-" : showSign && val > 0 ? "+" : "";
  return `${sign}₹${formatted}`;
}

export function formatINRK(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "₹0";
  if (Math.abs(val) >= 10000000) {
    return `₹${(val / 10000000).toFixed(2)} Cr`;
  }
  if (Math.abs(val) >= 100000) {
    return `₹${(val / 100000).toFixed(2)} L`;
  }
  if (Math.abs(val) >= 1000) {
    return `₹${(val / 1000).toFixed(1)}k`;
  }
  return `₹${val.toFixed(0)}`;
}

export const CURRENCY_SYMBOL = "₹";
