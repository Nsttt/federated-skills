import { defineTool } from '@module-federation/mcp';
import * as z from 'zod';
import { unitPrice } from './lib/pricing';

// The file name is the tool name: this is "quote_price".
export default defineTool({
  description: 'Price a basket with the checkout pricing rules.',
  inputSchema: z.object({
    sku: z.string().describe('Product SKU, e.g. SKU-42'),
    quantity: z.int().min(1),
  }),
  outputSchema: z.object({ total: z.number(), currency: z.literal('EUR') }),
  annotations: { readOnlyHint: true },
  handler: ({ sku, quantity }) => {
    const price = unitPrice(sku);
    if (price === undefined) {
      throw new Error(`Unknown SKU "${sku}"; try SKU-42 or SKU-77`);
    }
    const total = price * quantity;
    return {
      content: [
        {
          type: 'text',
          text: `${quantity} x ${sku} = ${total.toFixed(2)} EUR`,
        },
      ],
      structuredContent: { total, currency: 'EUR' },
    };
  },
});
