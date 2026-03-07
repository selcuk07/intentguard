import { describe, it, expect } from 'vitest';

// Test the extractProgramIds logic from injected.js in isolation

function extractProgramIds(tx: any): string[] {
  try {
    if (tx && tx.instructions) {
      return tx.instructions
        .map((ix: any) => ix.programId?.toBase58?.() || ix.programId?.toString?.())
        .filter(Boolean);
    }
    if (tx && tx.message) {
      const keys = tx.message.staticAccountKeys || tx.message.accountKeys || [];
      const ixs = tx.message.compiledInstructions || tx.message.instructions || [];
      return ixs
        .map((ix: any) => {
          const idx = ix.programIdIndex;
          const key = keys[idx];
          return key?.toBase58?.() || key?.toString?.();
        })
        .filter(Boolean);
    }
  } catch {
    // Can't parse
  }
  return [];
}

describe('Extension — injected.js extractProgramIds', () => {
  it('extracts from legacy transaction with instructions', () => {
    const tx = {
      instructions: [
        { programId: { toBase58: () => 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' } },
        { programId: { toBase58: () => '11111111111111111111111111111111' } },
      ],
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual([
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      '11111111111111111111111111111111',
    ]);
  });

  it('extracts from versioned transaction with compiledInstructions', () => {
    const tx = {
      message: {
        staticAccountKeys: [
          { toBase58: () => 'user123' },
          { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { toBase58: () => '11111111111111111111111111111111' },
        ],
        compiledInstructions: [
          { programIdIndex: 1 },
          { programIdIndex: 2 },
        ],
      },
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      '11111111111111111111111111111111',
    ]);
  });

  it('returns empty array for null/undefined tx', () => {
    expect(extractProgramIds(null)).toEqual([]);
    expect(extractProgramIds(undefined)).toEqual([]);
  });

  it('returns empty array for empty transaction', () => {
    expect(extractProgramIds({})).toEqual([]);
  });

  it('handles instructions without programId', () => {
    const tx = {
      instructions: [{ data: 'something' }, { programId: { toBase58: () => 'ABC' } }],
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual(['ABC']);
  });

  it('handles programId with toString fallback', () => {
    const tx = {
      instructions: [{ programId: { toString: () => 'FallbackId' } }],
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual(['FallbackId']);
  });

  it('handles accountKeys (legacy versioned format)', () => {
    const tx = {
      message: {
        accountKeys: [
          { toBase58: () => 'KeyA' },
          { toBase58: () => 'KeyB' },
        ],
        instructions: [{ programIdIndex: 0 }, { programIdIndex: 1 }],
      },
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual(['KeyA', 'KeyB']);
  });

  it('deduplication is caller responsibility, returns all', () => {
    const tx = {
      instructions: [
        { programId: { toBase58: () => 'Same' } },
        { programId: { toBase58: () => 'Same' } },
      ],
    };
    const ids = extractProgramIds(tx);
    expect(ids).toEqual(['Same', 'Same']);
  });
});
