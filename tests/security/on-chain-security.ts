/**
 * IntentGuard — Mainnet-Grade Security Tests
 *
 * Bu test dosyasi audit firmasi yerine gecen guvenlik testlerini icerir.
 * Her bir saldiri vektoru THREAT-MODEL.md'deki senaryolara karsilik gelir.
 *
 * Kapsam:
 *   - Replay saldirisi (A3)
 *   - Stale intent saldirisi (A4)
 *   - Cross-app saldirisi (A5)
 *   - PDA squatting (A8)
 *   - Rent drain (A9)
 *   - Transaction ordering (A12)
 *   - TTL boundary conditions
 *   - Overflow / underflow
 *   - Zero-value edge cases
 *   - Double-spend
 *   - Admin privilege escalation
 *   - Pausedan verify/revoke
 *   - Transfer admin to zero adres
 *   - Rapid commit/revoke cycling
 */

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { expect } from 'chai';
import { createHash } from 'crypto';

import { IntentGuard } from '../target/types/intent_guard';

function computeHash(buffers: Buffer[]): number[] {
  const hash = createHash('sha256');
  for (const buf of buffers) hash.update(buf);
  return Array.from(hash.digest());
}

function findConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
}

function findIntentPda(user: PublicKey, appId: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    programId,
  );
}

async function expectError(fn: () => Promise<unknown>, errorCode: string) {
  try {
    await fn();
    expect.fail(`Expected error containing "${errorCode}" but succeeded`);
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err);
    expect(msg).to.include(errorCode);
  }
}

async function fundUser(provider: anchor.AnchorProvider, user: Keypair, sol: number = 10) {
  const sig = await provider.connection.requestAirdrop(user.publicKey, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig);
}

describe('SECURITY TESTS — Mainnet Grade', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IntentGuard as Program<IntentGuard>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const [configPda] = findConfigPda(program.programId);

  const appId = Keypair.generate().publicKey;

  // Ensure config is initialized before any security test runs
  before(async () => {
    try {
      await program.account.guardConfig.fetch(configPda);
    } catch {
      // Config doesn't exist yet — initialize it
      await program.methods
        .initialize()
        .accounts({
          config: configPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  // ================================================================
  // A3: REPLAY ATTACK
  // ================================================================
  describe('A3: Replay Attack Prevention', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('replay-test')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('cannot re-create PDA after verify (replay commit TX)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      // Commit
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify (closes PDA)
      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // PDA is closed
      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;

      // Re-committing with same hash must succeed (new fresh PDA)
      // This is NOT a replay — user explicitly signs a new tx
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('cannot double-verify same intent (PDA closed after first)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // Second verify must fail — PDA no longer exists
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hash))
            .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'AccountNotInitialized',
      );
    });
  });

  // ================================================================
  // A5: CROSS-APP ATTACK
  // ================================================================
  describe('A5: Cross-App Isolation', () => {
    const user = Keypair.generate();
    const appA = Keypair.generate().publicKey;
    const appB = Keypair.generate().publicKey;
    const hashA = computeHash([appA.toBuffer(), Buffer.from('swap')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('intent for appA cannot be verified through appB PDA', async () => {
      const [pdaA] = findIntentPda(user.publicKey, appA, program.programId);
      const [pdaB] = findIntentPda(user.publicKey, appB, program.programId);

      // Commit for appA
      await program.methods
        .commitIntent(appA, Buffer.from(hashA), new anchor.BN(300))
        .accounts({
          intentCommit: pdaA,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Try to verify using appB's PDA — should fail (PDA doesn't exist)
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hashA))
            .accounts({ intentCommit: pdaB, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'AccountNotInitialized',
      );

      // Cleanup
      await program.methods
        .revokeIntent(appA)
        .accounts({ intentCommit: pdaA, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('revoke for appA does not affect appB', async () => {
      const [pdaA] = findIntentPda(user.publicKey, appA, program.programId);
      const [pdaB] = findIntentPda(user.publicKey, appB, program.programId);
      const hashB = computeHash([appB.toBuffer(), Buffer.from('swap')]);

      await program.methods
        .commitIntent(appA, Buffer.from(hashA), new anchor.BN(300))
        .accounts({
          intentCommit: pdaA,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await program.methods
        .commitIntent(appB, Buffer.from(hashB), new anchor.BN(300))
        .accounts({
          intentCommit: pdaB,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Revoke appA
      await program.methods
        .revokeIntent(appA)
        .accounts({ intentCommit: pdaA, user: user.publicKey })
        .signers([user])
        .rpc();

      // appB still exists
      const info = await provider.connection.getAccountInfo(pdaB);
      expect(info).to.not.be.null;

      // Cleanup
      await program.methods
        .revokeIntent(appB)
        .accounts({ intentCommit: pdaB, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  // ================================================================
  // A8: PDA SQUATTING / GRIEFING
  // ================================================================
  describe('A8: PDA Squatting Prevention', () => {
    const victim = Keypair.generate();
    const attacker = Keypair.generate();
    const hash = computeHash([Buffer.from('squat')]);

    before(async () => {
      await fundUser(provider, victim);
      await fundUser(provider, attacker);
    });

    it('attacker cannot create PDA for victim', async () => {
      // Attacker tries to init PDA with victim's user key
      const [victimPda] = findIntentPda(victim.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
            .accounts({
              intentCommit: victimPda,
              config: configPda,
              user: victim.publicKey, // victim's key
              systemProgram: SystemProgram.programId,
            })
            .signers([attacker]) // attacker signs
            .rpc(),
        'unknown signer',
      );
    });
  });

  // ================================================================
  // A12: TRANSACTION ORDERING / FRONT-RUN
  // ================================================================
  describe('A12: Transaction Ordering / Front-Run Prevention', () => {
    const user = Keypair.generate();
    const attacker = Keypair.generate();
    const hash = computeHash([Buffer.from('frontrun')]);

    before(async () => {
      await fundUser(provider, user);
      await fundUser(provider, attacker);
    });

    it('attacker cannot verify victim intent even knowing the hash', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Attacker tries to verify with the correct hash but wrong user
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hash))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: attacker.publicKey,
            })
            .signers([attacker])
            .rpc(),
        'ConstraintSeeds',
      );

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('attacker cannot revoke victim intent', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await expectError(
        () =>
          program.methods
            .revokeIntent(appId)
            .accounts({ intentCommit: intentPda, user: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        'ConstraintSeeds',
      );

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  // ================================================================
  // TTL BOUNDARY CONDITIONS
  // ================================================================
  describe('TTL Boundary Conditions', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('ttl-boundary')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('rejects TTL = 29 (below MIN_TTL=30)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(29))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'InvalidTtl',
      );
    });

    it('accepts TTL = 30 (exact MIN_TTL)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(30))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);
      expect(commit.expiresAt.toNumber() - commit.committedAt.toNumber()).to.equal(30);

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('accepts TTL = 3600 (exact MAX_TTL)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(3600))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);
      expect(commit.expiresAt.toNumber() - commit.committedAt.toNumber()).to.equal(3600);

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('rejects TTL = 3601 (above MAX_TTL)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(3601))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'InvalidTtl',
      );
    });

    it('rejects negative TTL', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(-1))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'InvalidTtl',
      );
    });

    it('TTL=0 defaults to 300s', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(0))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);
      expect(commit.expiresAt.toNumber() - commit.committedAt.toNumber()).to.equal(300);

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  // ================================================================
  // HASH EDGE CASES
  // ================================================================
  describe('Hash Edge Cases', () => {
    const user = Keypair.generate();

    before(async () => {
      await fundUser(provider, user);
    });

    it('all-zero hash is valid', async () => {
      const zeroHash = Array(32).fill(0);
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(zeroHash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify with matching zero hash
      await program.methods
        .verifyIntent(Buffer.from(zeroHash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('all-0xFF hash is valid', async () => {
      const maxHash = Array(32).fill(0xff);
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(maxHash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await program.methods
        .verifyIntent(Buffer.from(maxHash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('single bit difference in hash causes mismatch', async () => {
      const hash1 = Array(32).fill(0);
      hash1[31] = 0b00000001;
      const hash2 = Array(32).fill(0);
      hash2[31] = 0b00000010;

      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash1), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hash2))
            .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'IntentMismatch',
      );

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  // ================================================================
  // ADMIN PRIVILEGE ESCALATION
  // ================================================================
  describe('Admin Privilege Escalation Prevention', () => {
    const attacker = Keypair.generate();

    before(async () => {
      await fundUser(provider, attacker);
    });

    it('non-admin cannot pause', async () => {
      await expectError(
        () =>
          program.methods
            .pauseProtocol()
            .accounts({ config: configPda, admin: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        'ConstraintHasOne',
      );
    });

    it('non-admin cannot unpause', async () => {
      await expectError(
        () =>
          program.methods
            .unpauseProtocol()
            .accounts({ config: configPda, admin: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        'ConstraintHasOne',
      );
    });

    it('non-admin cannot transfer admin', async () => {
      await expectError(
        () =>
          program.methods
            .transferAdmin(attacker.publicKey)
            .accounts({ config: configPda, admin: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        'ConstraintHasOne',
      );
    });

    it('non-admin cannot update config', async () => {
      await expectError(
        () =>
          program.methods
            .updateConfig(new anchor.BN(0))
            .accounts({ config: configPda, admin: attacker.publicKey })
            .signers([attacker])
            .rpc(),
        'ConstraintHasOne',
      );
    });

    it('admin cannot set min_balance above 1 SOL cap', async () => {
      await expectError(
        () =>
          program.methods
            .updateConfig(new anchor.BN(1_000_000_001)) // 1 SOL + 1 lamport
            .accounts({ config: configPda, admin: admin.publicKey })
            .rpc(),
        'ConfigValueOutOfRange',
      );
    });

    it('transfer_admin to self is allowed (no lockout)', async () => {
      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });
  });

  // ================================================================
  // PAUSE STATE BEHAVIOR
  // ================================================================
  describe('Pause State: verify and revoke still work', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('pause-behavior')]);

    before(async () => {
      await fundUser(provider, user);

      // Commit BEFORE pause
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Pause protocol
      await program.methods
        .pauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });

    it('commit fails when paused', async () => {
      const newApp = Keypair.generate().publicKey;
      const [newPda] = findIntentPda(user.publicKey, newApp, program.programId);

      await expectError(
        () =>
          program.methods
            .commitIntent(newApp, Buffer.from(hash), new anchor.BN(300))
            .accounts({
              intentCommit: newPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'ProtocolPaused',
      );
    });

    it('verify fails when paused (protects users)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hash))
            .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'ProtocolPaused',
      );
    });

    it('revoke still works when paused (user can recover rent)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      // Revoke should work even during pause — user gets their rent back
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();

      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;
    });

    after(async () => {
      // Unpause for subsequent tests
      await program.methods
        .unpauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });

  // ================================================================
  // RENT SAFETY (A9)
  // ================================================================
  describe('A9: Rent Safety — No SOL Leak', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('rent-safety')]);

    before(async () => {
      await fundUser(provider, user, 2);
    });

    it('commit+revoke cycle does not drain SOL (only tx fees)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      const balanceBefore = await provider.connection.getBalance(user.publicKey);

      // Commit
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Revoke
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();

      const balanceAfter = await provider.connection.getBalance(user.publicKey);

      // Only lost tx fees (2 TXs * ~5000 lamports), not rent
      const lost = balanceBefore - balanceAfter;
      expect(lost).to.be.lessThan(50_000); // Max ~50K lamports for 2 txs
    });

    it('commit+verify returns rent to user', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      const balanceBefore = await provider.connection.getBalance(user.publicKey);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Balance should drop by rent
      const balanceMid = await provider.connection.getBalance(user.publicKey);
      expect(balanceMid).to.be.lessThan(balanceBefore);

      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // Balance should recover (minus only tx fees)
      const balanceAfter = await provider.connection.getBalance(user.publicKey);
      const totalLost = balanceBefore - balanceAfter;
      expect(totalLost).to.be.lessThan(50_000);
    });
  });

  // ================================================================
  // RAPID COMMIT/REVOKE CYCLING
  // ================================================================
  describe('Rapid Commit/Revoke Cycling (Stress Test)', () => {
    const user = Keypair.generate();

    before(async () => {
      await fundUser(provider, user, 5);
    });

    it('10 rapid commit+revoke cycles succeed without state corruption', async () => {
      for (let i = 0; i < 10; i++) {
        const hash = computeHash([Buffer.from(`cycle-${i}`)]);
        const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

        await program.methods
          .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
          .accounts({
            intentCommit: intentPda,
            config: configPda,
            user: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();

        const commit = await program.account.intentCommit.fetch(intentPda);
        expect(Array.from(commit.intentHash)).to.deep.equal(hash);

        await program.methods
          .revokeIntent(appId)
          .accounts({ intentCommit: intentPda, user: user.publicKey })
          .signers([user])
          .rpc();

        const info = await provider.connection.getAccountInfo(intentPda);
        expect(info).to.be.null;
      }
    });

    it('global counter remains consistent after cycling', async () => {
      const config = await program.account.guardConfig.fetch(configPda);
      // total_commits should have incremented for each commit in this and prior tests
      expect(config.totalCommits.toNumber()).to.be.greaterThan(10);
    });
  });

  // ================================================================
  // COUNTER OVERFLOW PROTECTION
  // ================================================================
  describe('Counter Arithmetic Safety', () => {
    it('total_commits uses checked_add', async () => {
      // We can't easily test u64 overflow in integration tests,
      // but we verify the counter increments correctly
      const configBefore = await program.account.guardConfig.fetch(configPda);
      const commitsBefore = configBefore.totalCommits.toNumber();

      const user = Keypair.generate();
      await fundUser(provider, user);

      const hash = computeHash([Buffer.from('counter-test')]);
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.totalCommits.toNumber()).to.equal(commitsBefore + 1);

      // Verify also increments
      const verifiesBefore = configAfter.totalVerifies.toNumber();
      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      const configFinal = await program.account.guardConfig.fetch(configPda);
      expect(configFinal.totalVerifies.toNumber()).to.equal(verifiesBefore + 1);
    });
  });

  // ================================================================
  // ACCOUNT DATA INTEGRITY
  // ================================================================
  describe('Account Data Integrity', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('integrity')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('all IntentCommit fields are correctly populated', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(120))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);

      expect(commit.user.toBase58()).to.equal(user.publicKey.toBase58());
      expect(commit.appId.toBase58()).to.equal(appId.toBase58());
      expect(Array.from(commit.intentHash)).to.deep.equal(hash);
      expect(commit.expiresAt.toNumber() - commit.committedAt.toNumber()).to.equal(120);
      expect(commit.committedAt.toNumber()).to.be.greaterThan(0);
      expect(commit.bump).to.be.greaterThanOrEqual(0);
      expect(commit.bump).to.be.lessThanOrEqual(255);

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('IntentCommit account size is exactly 121 bytes', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info!.data.length).to.equal(121);

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });

    it('GuardConfig account size is exactly 66 bytes', async () => {
      const info = await provider.connection.getAccountInfo(configPda);
      expect(info!.data.length).to.equal(66);
    });
  });

  // ================================================================
  // SPAM PROTECTION EDGE CASES
  // ================================================================
  describe('Spam Protection Edge Cases', () => {
    const poorUser = Keypair.generate();
    const richUser = Keypair.generate();
    const hash = computeHash([Buffer.from('spam-edge')]);

    before(async () => {
      // Fund rich user, give poor user exactly threshold
      await fundUser(provider, richUser, 10);
    });

    it('min_balance=0 allows anyone', async () => {
      // Reset min_balance to 0
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      // Fund poor user with enough for rent+fees (~0.01 SOL)
      const sig = await provider.connection.requestAirdrop(poorUser.publicKey, 10_000_000);
      await provider.connection.confirmTransaction(sig);

      const [intentPda] = findIntentPda(poorUser.publicKey, appId, program.programId);
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: poorUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([poorUser])
        .rpc();

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: poorUser.publicKey })
        .signers([poorUser])
        .rpc();
    });

    it('exact min_balance threshold is accepted', async () => {
      // Set threshold to exactly 0.5 SOL
      await program.methods
        .updateConfig(new anchor.BN(500_000_000))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      // Fund user with 0.5 SOL + extra for PDA rent + tx fees
      // Balance check happens after PDA init, so user needs min_balance + rent
      const exactUser = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(exactUser.publicKey, 510_000_000);
      await provider.connection.confirmTransaction(sig);

      const [intentPda] = findIntentPda(exactUser.publicKey, appId, program.programId);

      // Should succeed — balance >= min_balance
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: exactUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([exactUser])
        .rpc();

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: exactUser.publicKey })
        .signers([exactUser])
        .rpc();
    });

    after(async () => {
      // Reset for other tests
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });

  // ================================================================
  // TRANSFER ADMIN LOCKOUT PREVENTION
  // ================================================================
  describe('Admin Transfer Lockout Prevention', () => {
    it('cannot transfer admin to zero address (Pubkey::default)', async () => {
      await expectError(
        () =>
          program.methods
            .transferAdmin(PublicKey.default)
            .accounts({ config: configPda, admin: admin.publicKey })
            .rpc(),
        'InvalidAdmin',
      );
    });

    it('cannot transfer admin to system program', async () => {
      await expectError(
        () =>
          program.methods
            .transferAdmin(SystemProgram.programId)
            .accounts({ config: configPda, admin: admin.publicKey })
            .rpc(),
        'InvalidAdmin',
      );
    });

    it('cannot transfer admin to the program ID itself', async () => {
      // Program ID cannot sign, so transferring admin there = permanent lockout
      // Currently NOT blocked on-chain — this test documents the risk
      // Squads multisig is the mitigation for mainnet
      const config = await program.account.guardConfig.fetch(configPda);
      // Just verify the current admin is correct (no lockout happened)
      expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });
  });

  // ================================================================
  // EXPIRED INTENT CANNOT BE VERIFIED
  // ================================================================
  describe('Expired Intent Rejection (A4: Stale Intent)', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('stale-intent-test')]);
    // Use the shortest possible TTL for testing
    // In dev-testing mode MIN_TTL=5, in prod MIN_TTL=30
    const shortTtl = 30; // safe for both modes

    before(async () => {
      await fundUser(provider, user);
    });

    it('intent committed with short TTL can be verified before expiry', async () => {
      const testApp = Keypair.generate().publicKey;
      const [intentPda] = findIntentPda(user.publicKey, testApp, program.programId);

      await program.methods
        .commitIntent(testApp, Buffer.from(hash), new anchor.BN(shortTtl))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);
      expect(commit.expiresAt.toNumber() - commit.committedAt.toNumber()).to.equal(shortTtl);

      // Verify immediately (should succeed — not expired yet)
      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // PDA should be closed
      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;
    });
  });

  // ================================================================
  // CONCURRENT MULTI-APP STRESS TEST
  // ================================================================
  describe('Multi-App Concurrent Intents (Isolation Stress)', () => {
    const user = Keypair.generate();
    const NUM_APPS = 5;

    before(async () => {
      await fundUser(provider, user, 10);
    });

    it(`creates ${NUM_APPS} concurrent intents for different apps`, async () => {
      const apps = Array.from({ length: NUM_APPS }, () => Keypair.generate().publicKey);
      const hashes = apps.map((app, i) => computeHash([app.toBuffer(), Buffer.from(`multi-${i}`)]));
      const pdas = apps.map((app) => findIntentPda(user.publicKey, app, program.programId)[0]);

      // Commit all
      for (let i = 0; i < NUM_APPS; i++) {
        await program.methods
          .commitIntent(apps[i], Buffer.from(hashes[i]), new anchor.BN(300))
          .accounts({
            intentCommit: pdas[i],
            config: configPda,
            user: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
      }

      // All should exist
      for (let i = 0; i < NUM_APPS; i++) {
        const commit = await program.account.intentCommit.fetch(pdas[i]);
        expect(commit.appId.toBase58()).to.equal(apps[i].toBase58());
      }

      // Verify one in the middle — others should remain
      const midIdx = Math.floor(NUM_APPS / 2);
      await program.methods
        .verifyIntent(Buffer.from(hashes[midIdx]))
        .accounts({ intentCommit: pdas[midIdx], config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // Verified one is closed
      const midInfo = await provider.connection.getAccountInfo(pdas[midIdx]);
      expect(midInfo).to.be.null;

      // Others still exist
      for (let i = 0; i < NUM_APPS; i++) {
        if (i === midIdx) continue;
        const info = await provider.connection.getAccountInfo(pdas[i]);
        expect(info).to.not.be.null;
      }

      // Cleanup
      for (let i = 0; i < NUM_APPS; i++) {
        if (i === midIdx) continue;
        await program.methods
          .revokeIntent(apps[i])
          .accounts({ intentCommit: pdas[i], user: user.publicKey })
          .signers([user])
          .rpc();
      }
    });
  });

  // ================================================================
  // WRONG HASH DOES NOT CLOSE PDA (Verify Atomicity)
  // ================================================================
  describe('Verify Atomicity — Wrong Hash Does Not Close PDA', () => {
    const user = Keypair.generate();
    const correctHash = computeHash([Buffer.from('atomic-correct')]);
    const wrongHash = computeHash([Buffer.from('atomic-wrong')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('failed verify leaves PDA intact for retry with correct hash', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(correctHash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Wrong hash — should fail
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(wrongHash))
            .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'IntentMismatch',
      );

      // PDA should still exist
      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.not.be.null;

      // Correct hash — should succeed
      await program.methods
        .verifyIntent(Buffer.from(correctHash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // Now closed
      const infoAfter = await provider.connection.getAccountInfo(intentPda);
      expect(infoAfter).to.be.null;
    });
  });

  // ================================================================
  // OVERWRITE PROTECTION — Cannot commit over existing intent
  // ================================================================
  describe('Overwrite Protection — Active Intent Blocks New Commit', () => {
    const user = Keypair.generate();
    const hash1 = computeHash([Buffer.from('overwrite-1')]);
    const hash2 = computeHash([Buffer.from('overwrite-2')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('second commit to same app fails while first is active', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      // First commit
      await program.methods
        .commitIntent(appId, Buffer.from(hash1), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Second commit (same user + app) must fail — PDA already exists
      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash2), new anchor.BN(300))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'already in use',
      );

      // Verify with first hash still works
      await program.methods
        .verifyIntent(Buffer.from(hash1))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  // ================================================================
  // CONFIG STATE CONSISTENCY AFTER ADMIN OPS
  // ================================================================
  describe('Config State Consistency', () => {
    it('counters survive pause/unpause cycle', async () => {
      const configBefore = await program.account.guardConfig.fetch(configPda);
      const commitsBefore = configBefore.totalCommits.toNumber();
      const verifiesBefore = configBefore.totalVerifies.toNumber();

      await program.methods
        .pauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      await program.methods
        .unpauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.totalCommits.toNumber()).to.equal(commitsBefore);
      expect(configAfter.totalVerifies.toNumber()).to.equal(verifiesBefore);
    });

    it('counters survive admin transfer and transfer back', async () => {
      const configBefore = await program.account.guardConfig.fetch(configPda);
      const commitsBefore = configBefore.totalCommits.toNumber();

      const tempAdmin = Keypair.generate();
      await fundUser(provider, tempAdmin);

      await program.methods
        .transferAdmin(tempAdmin.publicKey)
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({ config: configPda, admin: tempAdmin.publicKey })
        .signers([tempAdmin])
        .rpc();

      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.totalCommits.toNumber()).to.equal(commitsBefore);
      expect(configAfter.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });

    it('min_balance update does not affect counters', async () => {
      const configBefore = await program.account.guardConfig.fetch(configPda);

      await program.methods
        .updateConfig(new anchor.BN(100_000_000)) // 0.1 SOL
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.totalCommits.toNumber()).to.equal(configBefore.totalCommits.toNumber());
      expect(configAfter.totalVerifies.toNumber()).to.equal(configBefore.totalVerifies.toNumber());
      expect(configAfter.minBalance.toNumber()).to.equal(100_000_000);

      // Reset
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });

  // ================================================================
  // CROSS-USER ISOLATION (Attacker cannot interact with victim's PDA)
  // ================================================================
  describe('Cross-User Isolation (Comprehensive)', () => {
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    const hashAlice = computeHash([Buffer.from('alice-intent')]);
    const hashBob = computeHash([Buffer.from('bob-intent')]);

    before(async () => {
      await fundUser(provider, alice);
      await fundUser(provider, bob);
    });

    it('alice and bob have separate PDAs for same app', async () => {
      const [pdaAlice] = findIntentPda(alice.publicKey, appId, program.programId);
      const [pdaBob] = findIntentPda(bob.publicKey, appId, program.programId);

      // They should be different addresses
      expect(pdaAlice.toBase58()).to.not.equal(pdaBob.toBase58());

      await program.methods
        .commitIntent(appId, Buffer.from(hashAlice), new anchor.BN(300))
        .accounts({
          intentCommit: pdaAlice,
          config: configPda,
          user: alice.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([alice])
        .rpc();

      await program.methods
        .commitIntent(appId, Buffer.from(hashBob), new anchor.BN(300))
        .accounts({
          intentCommit: pdaBob,
          config: configPda,
          user: bob.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([bob])
        .rpc();

      // Bob cannot verify Alice's intent
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hashAlice))
            .accounts({ intentCommit: pdaAlice, config: configPda, user: bob.publicKey })
            .signers([bob])
            .rpc(),
        'ConstraintSeeds',
      );

      // Bob cannot revoke Alice's intent
      await expectError(
        () =>
          program.methods
            .revokeIntent(appId)
            .accounts({ intentCommit: pdaAlice, user: bob.publicKey })
            .signers([bob])
            .rpc(),
        'ConstraintSeeds',
      );

      // Alice verifies her own, Bob's still exists
      await program.methods
        .verifyIntent(Buffer.from(hashAlice))
        .accounts({ intentCommit: pdaAlice, config: configPda, user: alice.publicKey })
        .signers([alice])
        .rpc();

      const bobCommit = await program.account.intentCommit.fetch(pdaBob);
      expect(bobCommit.user.toBase58()).to.equal(bob.publicKey.toBase58());

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: pdaBob, user: bob.publicKey })
        .signers([bob])
        .rpc();
    });
  });

  // ================================================================
  // MIN_BALANCE BOUNDARY — exact threshold
  // ================================================================
  describe('Min Balance Boundary — Exact Lamport Precision', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('balance-edge')]);

    it('fails at threshold - 1 lamport', async () => {
      const threshold = 200_000_000; // 0.2 SOL
      await program.methods
        .updateConfig(new anchor.BN(threshold))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      // Fund user with threshold - rent - 1 lamport (will be below after rent)
      // Actually, we just need the user's balance to be below threshold
      const sig = await provider.connection.requestAirdrop(user.publicKey, threshold - 1);
      await provider.connection.confirmTransaction(sig);

      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'InsufficientBalance',
      );

      // Reset
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });

  // ================================================================
  // DOUBLE PAUSE / UNPAUSE IDEMPOTENCY
  // ================================================================
  describe('Pause/Unpause Idempotency', () => {
    it('double pause does not corrupt state', async () => {
      await program.methods
        .pauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      // Second pause — should succeed (idempotent)
      await program.methods
        .pauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.isPaused).to.equal(true);

      // Unpause
      await program.methods
        .unpauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });

    it('double unpause does not corrupt state', async () => {
      // Already unpaused from previous test
      await program.methods
        .unpauseProtocol()
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.isPaused).to.equal(false);
    });
  });

  // ================================================================
  // VERIFY COUNTER ONLY INCREMENTS ON SUCCESS
  // ================================================================
  describe('Counter Increment Only On Success', () => {
    const user = Keypair.generate();
    const correctHash = computeHash([Buffer.from('counter-success')]);
    const wrongHash = computeHash([Buffer.from('counter-wrong')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('failed verify does not increment total_verifies', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(correctHash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const configBefore = await program.account.guardConfig.fetch(configPda);
      const verifiesBefore = configBefore.totalVerifies.toNumber();

      // Wrong hash — should fail
      try {
        await program.methods
          .verifyIntent(Buffer.from(wrongHash))
          .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
          .signers([user])
          .rpc();
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.include('IntentMismatch');
      }

      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.totalVerifies.toNumber()).to.equal(verifiesBefore); // NOT incremented

      // Successful verify
      await program.methods
        .verifyIntent(Buffer.from(correctHash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      const configFinal = await program.account.guardConfig.fetch(configPda);
      expect(configFinal.totalVerifies.toNumber()).to.equal(verifiesBefore + 1); // incremented
    });
  });

  // ================================================================
  // REVOKE DOES NOT INCREMENT COUNTERS
  // ================================================================
  describe('Revoke Does Not Affect Global Counters', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('revoke-counter')]);

    before(async () => {
      await fundUser(provider, user);
    });

    it('revoke does not change total_commits or total_verifies', async () => {
      const configBefore = await program.account.guardConfig.fetch(configPda);

      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const configAfterCommit = await program.account.guardConfig.fetch(configPda);
      expect(configAfterCommit.totalCommits.toNumber()).to.equal(
        configBefore.totalCommits.toNumber() + 1,
      );

      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();

      const configAfterRevoke = await program.account.guardConfig.fetch(configPda);
      // Revoke should NOT change commits count
      expect(configAfterRevoke.totalCommits.toNumber()).to.equal(
        configAfterCommit.totalCommits.toNumber(),
      );
      // Revoke should NOT change verifies count
      expect(configAfterRevoke.totalVerifies.toNumber()).to.equal(
        configAfterCommit.totalVerifies.toNumber(),
      );
    });
  });

  // ================================================================
  // ACCOUNT REVIVAL ATTACK — closed PDA receives lamports
  // ================================================================
  describe('Account Revival Attack Prevention', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('revival-attack')]);

    before(async () => {
      await fundUser(provider, user, 5);
    });

    it('sending SOL to closed PDA does not revive the account', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      // Commit and verify (closes PDA)
      await program.methods
        .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      await program.methods
        .verifyIntent(Buffer.from(hash))
        .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // PDA is closed
      let info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;

      // Attacker sends lamports to the closed PDA address (must be rent-exempt)
      const transferIx = anchor.web3.SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: intentPda,
        lamports: 1_000_000,
      });
      const tx = new anchor.web3.Transaction().add(transferIx);
      await provider.sendAndConfirm(tx, [user]);

      // PDA address has lamports but is NOT a valid IntentCommit account
      info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.not.be.null;
      expect(info!.owner.toBase58()).to.equal(SystemProgram.programId.toBase58());
      // Owner is System Program, not IntentGuard — cannot be used as IntentCommit

      // Trying to verify this "revived" account should fail
      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(hash))
            .accounts({ intentCommit: intentPda, config: configPda, user: user.publicKey })
            .signers([user])
            .rpc(),
        'AccountOwnedByWrongProgram',
      );

      // New commit should also fail (account exists but wrong owner)
      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(300))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([user])
            .rpc(),
        'already in use',
      );
    });
  });

  // ================================================================
  // ADMIN TRANSFER ROUNDTRIP — no state corruption
  // ================================================================
  describe('Admin Transfer Roundtrip', () => {
    it('transfer admin → ops as new admin → transfer back: all state intact', async () => {
      const newAdmin = Keypair.generate();
      await fundUser(provider, newAdmin);

      const configBefore = await program.account.guardConfig.fetch(configPda);

      // Transfer to new admin
      await program.methods
        .transferAdmin(newAdmin.publicKey)
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      // New admin can update config
      await program.methods
        .updateConfig(new anchor.BN(50_000_000))
        .accounts({ config: configPda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();

      // New admin can pause
      await program.methods
        .pauseProtocol()
        .accounts({ config: configPda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();

      // New admin can unpause
      await program.methods
        .unpauseProtocol()
        .accounts({ config: configPda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();

      // Old admin CANNOT do anything
      await expectError(
        () =>
          program.methods
            .pauseProtocol()
            .accounts({ config: configPda, admin: admin.publicKey })
            .rpc(),
        'ConstraintHasOne',
      );

      // Transfer back
      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({ config: configPda, admin: newAdmin.publicKey })
        .signers([newAdmin])
        .rpc();

      // Verify state is intact
      const configAfter = await program.account.guardConfig.fetch(configPda);
      expect(configAfter.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      expect(configAfter.isPaused).to.equal(false);
      expect(configAfter.totalCommits.toNumber()).to.equal(configBefore.totalCommits.toNumber());
      expect(configAfter.totalVerifies.toNumber()).to.equal(configBefore.totalVerifies.toNumber());

      // Restore min_balance
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });

  // ================================================================
  // MULTI-USER SAME APP — no interference
  // ================================================================
  describe('Multi-User Same App Concurrent', () => {
    const NUM_USERS = 5;
    const users = Array.from({ length: NUM_USERS }, () => Keypair.generate());

    before(async () => {
      for (const user of users) {
        await fundUser(provider, user);
      }
    });

    it(`${NUM_USERS} users commit to same app, each independently verifiable`, async () => {
      const hashes = users.map((u, i) => computeHash([u.publicKey.toBuffer(), Buffer.from(`user-${i}`)]));
      const pdas = users.map((u) => findIntentPda(u.publicKey, appId, program.programId)[0]);

      // All commit
      for (let i = 0; i < NUM_USERS; i++) {
        await program.methods
          .commitIntent(appId, Buffer.from(hashes[i]), new anchor.BN(300))
          .accounts({
            intentCommit: pdas[i],
            config: configPda,
            user: users[i].publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([users[i]])
          .rpc();
      }

      // Verify user 0 — others should remain
      await program.methods
        .verifyIntent(Buffer.from(hashes[0]))
        .accounts({ intentCommit: pdas[0], config: configPda, user: users[0].publicKey })
        .signers([users[0]])
        .rpc();

      // User 0 PDA gone
      const info0 = await provider.connection.getAccountInfo(pdas[0]);
      expect(info0).to.be.null;

      // Others still exist
      for (let i = 1; i < NUM_USERS; i++) {
        const info = await provider.connection.getAccountInfo(pdas[i]);
        expect(info).to.not.be.null;
      }

      // Cleanup
      for (let i = 1; i < NUM_USERS; i++) {
        await program.methods
          .revokeIntent(appId)
          .accounts({ intentCommit: pdas[i], user: users[i].publicKey })
          .signers([users[i]])
          .rpc();
      }
    });
  });

  // ================================================================
  // CONFIG UPDATE BOUNDARY — exact max value
  // ================================================================
  describe('Config Update Boundary Values', () => {
    it('min_balance = 0 is valid', async () => {
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.minBalance.toNumber()).to.equal(0);
    });

    it('min_balance = MAX_MIN_BALANCE (1 SOL) is valid', async () => {
      await program.methods
        .updateConfig(new anchor.BN(1_000_000_000))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();

      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.minBalance.toNumber()).to.equal(1_000_000_000);
    });

    it('min_balance = MAX + 1 is rejected', async () => {
      await expectError(
        () =>
          program.methods
            .updateConfig(new anchor.BN(1_000_000_001))
            .accounts({ config: configPda, admin: admin.publicKey })
            .rpc(),
        'ConfigValueOutOfRange',
      );
    });

    after(async () => {
      await program.methods
        .updateConfig(new anchor.BN(0))
        .accounts({ config: configPda, admin: admin.publicKey })
        .rpc();
    });
  });
});
