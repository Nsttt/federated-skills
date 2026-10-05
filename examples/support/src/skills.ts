import {
  defineSkill,
  defineSkillsProvider,
  defineTool,
} from '@module-federation/mcp';
import * as z from 'zod';
import { customers, refunds, type Refund } from './customers';
import policy from './refund-request/references/policy.md?raw';
import refundRequest from './refund-request/SKILL.md?raw';

const REFUND_LIMIT = 500;

const findCustomer = (id: string) => {
  const customer = customers.find((item) => item.id === id);
  if (!customer) throw new Error(`No customer ${id}`);
  return customer;
};

export default defineSkillsProvider({
  version: '3.1.0',
  skills: [
    defineSkill({
      markdown: refundRequest,
      // Namespaced, so other teams can ship their own "refund-request".
      namespace: 'acme/support',
      files: { 'references/policy.md': policy },
    }),
  ],
  tools: [
    defineTool({
      name: 'lookup_customer',
      title: 'Look up a customer',
      description:
        'Find a customer by email: plan, seats, billing period and last invoice.',
      inputSchema: z.object({ email: z.email() }),
      annotations: { readOnlyHint: true },
      handler: ({ email }) => {
        const customer = customers.find((item) => item.email === email);
        if (!customer) throw new Error(`No customer with email ${email}`);
        return { ...customer };
      },
    }),
    defineTool({
      name: 'issue_refund',
      title: 'Issue a refund',
      description: `Refund part of a customer's last invoice. Refunds over $${REFUND_LIMIT} need approvedBy.`,
      // The gateway checks arguments against this schema before the handler
      // runs, and returns what failed to the model so it can fix the call.
      inputSchema: z
        .object({
          customerId: z.string(),
          amount: z.number().positive(),
          reason: z.string().min(10),
          approvedBy: z.string().optional(),
        })
        .refine((input) => input.amount <= REFUND_LIMIT || input.approvedBy, {
          path: ['approvedBy'],
          message: `refunds over $${REFUND_LIMIT} need the name of the support manager who approved them`,
        }),
      outputSchema: z.object({
        refundId: z.string(),
        customerId: z.string(),
        invoiceId: z.string(),
        amount: z.number(),
        reason: z.string(),
        status: z.literal('issued'),
        approvedBy: z.string().optional(),
        requestedBy: z.string(),
      }),
      // Clients can ask the user to confirm before calling a destructive tool.
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: (input, { client }) => {
        const { lastInvoice } = findCustomer(input.customerId);
        if (input.amount > lastInvoice.total) {
          throw new Error(
            `Refund of $${input.amount} is more than invoice ${lastInvoice.id} ($${lastInvoice.total})`,
          );
        }
        const refund: Refund = {
          refundId: `re_${1000 + refunds.length + 1}`,
          customerId: input.customerId,
          invoiceId: lastInvoice.id,
          amount: input.amount,
          reason: input.reason,
          status: 'issued',
          approvedBy: input.approvedBy,
          // Every refund records which MCP client asked for it.
          requestedBy: client.info?.name ?? 'unknown client',
        };
        refunds.push(refund);
        return { ...refund };
      },
    }),
  ],
});
