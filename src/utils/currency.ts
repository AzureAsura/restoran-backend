const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// All money fields (MenuItem.price, Order.subtotal/tax/serviceCharge/total, ...)
// are stored as integer USD cents, e.g. 2500 = $25.00.
export function formatUsd(cents: number): string {
  return usdFormatter.format(cents / 100)
}
