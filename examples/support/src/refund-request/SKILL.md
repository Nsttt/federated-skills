---
name: refund-request
description: Use when a customer asks for a refund or disputes a charge. Checks the customer, the charge and the refund policy before refunding anything.
allowed-tools: lookup_customer quote_price issue_refund
metadata:
  owner: support-tools
  contact: '#support-tools'
---

# Refund request

1. Call `lookup_customer` with the customer's email.
2. Call `quote_price` with the customer's plan, seats and billing period. It
   belongs to the Billing team and is the source of truth for prices.
3. Compare the quote with the customer's last invoice. If the invoice is
   higher, the difference is a billing error: refund the difference.
4. For any other reason, read `references/policy.md` and check that the
   refund is allowed.
5. Refunds over $500 need a support manager's approval. Ask the user who
   approved it and pass their name as `approvedBy`. Never make one up.
6. Call `issue_refund`, then give the user the refund ID.
