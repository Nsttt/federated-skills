---
name: quote-a-deal
description: Quote a deal with the current price book. Use when a customer asks for a price.
metadata:
  owner: billing
  contact: '#billing-eng'
---

# Quote a deal

1. Call `quote_price` with the SKU and quantity.
2. Apply the [discount rules](references/discounts.md) before you answer.
3. Always quote in EUR and say the price book can change.
