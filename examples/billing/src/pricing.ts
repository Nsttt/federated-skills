export type Plan = 'starter' | 'team' | 'enterprise';

const MONTHLY_PRICE: Record<Plan, number> = {
  starter: 0,
  team: 12,
  enterprise: 40,
};

export interface Quote {
  plan: Plan;
  seats: number;
  billing: 'monthly' | 'yearly';
  total: number;
  currency: 'USD';
}

/** Price per seat; yearly billing gets two months free. */
export const quote = (
  plan: Plan,
  seats: number,
  billing: Quote['billing'],
): Quote => {
  const months = billing === 'yearly' ? 10 : 1;
  return {
    plan,
    seats,
    billing,
    total: MONTHLY_PRICE[plan] * seats * months,
    currency: 'USD',
  };
};
