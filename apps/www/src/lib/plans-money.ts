/** ₹ for a slip, without paise when whole: 49900 → "₹499", 49950 → "₹499.50". */
export const billMoneyWhole = (paise: number) => {
  const whole = paise % 100 === 0;
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(paise / 100)}`;
};
