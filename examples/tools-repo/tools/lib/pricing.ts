// Shared code lives in subfolders: only tools/<name>.ts files are tools.
const PRICE_BOOK: Record<string, number> = {
  'SKU-42': 10,
  'SKU-77': 24.5,
};

export const unitPrice = (sku: string): number | undefined => PRICE_BOOK[sku];
