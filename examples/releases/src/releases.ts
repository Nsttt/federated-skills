export interface Release {
  version: string;
  date: string;
  status: 'live' | 'rolled-back' | 'staged';
  notes: string;
}

// Stand-in for a real release API.
export const releases: Release[] = [
  {
    version: '2.4.0',
    date: '2026-09-29',
    status: 'live',
    notes: 'Faster checkout and new invoice export.',
  },
  {
    version: '2.3.1',
    date: '2026-09-15',
    status: 'rolled-back',
    notes: 'Rolled back: invoice totals rounded wrong for JPY.',
  },
  {
    version: '2.5.0-rc.1',
    date: '2026-10-03',
    status: 'staged',
    notes: 'Saved carts.',
  },
];
