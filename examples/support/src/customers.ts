export interface Customer {
  id: string;
  email: string;
  company: string;
  plan: 'starter' | 'team' | 'enterprise';
  seats: number;
  billing: 'monthly' | 'yearly';
  lastInvoice: { id: string; date: string; total: number; currency: 'USD' };
}

export interface Refund {
  refundId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  reason: string;
  status: 'issued';
  approvedBy?: string;
  requestedBy: string;
}

// Stand-ins for the support team's customer and payments APIs.
export const customers: Customer[] = [
  {
    id: 'cus_1042',
    email: 'ops@globex.example',
    company: 'Globex',
    plan: 'team',
    seats: 8,
    billing: 'yearly',
    // Billed for 9 seats instead of 8.
    lastInvoice: {
      id: 'in_2026_0931',
      date: '2026-09-01',
      total: 1080,
      currency: 'USD',
    },
  },
];

export const refunds: Refund[] = [];
