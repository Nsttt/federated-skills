import { quote, type Plan } from './pricing';

/** The checkout widget other apps load from this remote. */
export const renderCheckout = (root: HTMLElement, plan: Plan = 'team') => {
  const { total, currency } = quote(plan, 5, 'monthly');
  root.textContent = `5 seats on ${plan}: ${total} ${currency} per month`;
};
