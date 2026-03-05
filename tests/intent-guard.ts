import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
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

function findIntentPda(
  user: PublicKey,
  appId: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), user.toBuffer(), appId.toBuffer()],
    programId,
  );
}

async function expectError(fn: () => Promise<unknown>, errorCode: string) {
  try {
    await fn();
    expect.fail('Expected error but succeeded');
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err);
    expect(msg).to.include(errorCode);
  }
}

describe('intent-guard', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IntentGuard as Program<IntentGuard>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const [configPda] = findConfigPda(program.programId);

  // Fake app ID for testing
  const appId = Keypair.generate().publicKey;

  it('initializes the protocol config', async () => {
    await program.methods
      .initialize()
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.guardConfig.fetch(configPda);
    expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(config.isPaused).to.equal(false);
    expect(config.totalCommits.toNumber()).to.equal(0);
    expect(config.totalVerifies.toNumber()).to.equal(0);
  });

  it('cannot initialize twice', async () => {
    await expectError(
      () =>
        program.methods
          .initialize()
          .accounts({
            config: configPda,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      'already in use',
    );
  });

  describe('commit-verify flow', () => {
    const user = Keypair.generate();
    let intentHash: number[];

    before(async () => {
      // Airdrop SOL to test user
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

      // Compute intent hash (simulating a swap: app + user + amount)
      intentHash = computeHash([
        appId.toBuffer(),
        user.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(1_000_000).toArray('le', 8)),
      ]);
    });

    it('commits an intent', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .commitIntent(appId, Buffer.from(intentHash), new anchor.BN(300))
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
      expect(Array.from(commit.intentHash)).to.deep.equal(intentHash);
      expect(commit.expiresAt.toNumber()).to.be.greaterThan(commit.committedAt.toNumber());
    });

    it('cannot commit duplicate (PDA already exists)', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(intentHash), new anchor.BN(300))
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

    it('verifies intent and closes PDA', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      const balanceBefore = await provider.connection.getBalance(user.publicKey);

      await program.methods
        .verifyIntent(Buffer.from(intentHash))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();

      // PDA should be closed
      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;

      // Rent should be refunded
      const balanceAfter = await provider.connection.getBalance(user.publicKey);
      expect(balanceAfter).to.be.greaterThan(balanceBefore - 10000); // minus tx fee

      // Counter should be updated
      const config = await program.account.guardConfig.fetch(configPda);
      expect(config.totalCommits.toNumber()).to.equal(1);
      expect(config.totalVerifies.toNumber()).to.equal(1);
    });

    it('cannot verify after PDA is closed', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(intentHash))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
            })
            .signers([user])
            .rpc(),
        'AccountNotInitialized',
      );
    });
  });

  describe('verify rejects wrong hash', () => {
    const user = Keypair.generate();
    const correctHash = computeHash([appId.toBuffer(), Buffer.from('correct')]);
    const wrongHash = computeHash([appId.toBuffer(), Buffer.from('wrong')]);

    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

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
    });

    it('rejects mismatched hash', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .verifyIntent(Buffer.from(wrongHash))
            .accounts({
              intentCommit: intentPda,
              config: configPda,
              user: user.publicKey,
            })
            .signers([user])
            .rpc(),
        'IntentMismatch',
      );
    });

    // Cleanup: revoke so PDA doesn't linger
    after(async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .revokeIntent(appId)
        .accounts({
          intentCommit: intentPda,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();
    });
  });

  describe('revoke intent', () => {
    const user = Keypair.generate();
    const hash = computeHash([appId.toBuffer(), Buffer.from('revoke-test')]);

    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);

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
    });

    it('revokes and closes PDA', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await program.methods
        .revokeIntent(appId)
        .accounts({
          intentCommit: intentPda,
          user: user.publicKey,
        })
        .signers([user])
        .rpc();

      const info = await provider.connection.getAccountInfo(intentPda);
      expect(info).to.be.null;
    });

    it('can re-commit after revoke', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      const newHash = computeHash([appId.toBuffer(), Buffer.from('new-intent')]);

      await program.methods
        .commitIntent(appId, Buffer.from(newHash), new anchor.BN(300))
        .accounts({
          intentCommit: intentPda,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const commit = await program.account.intentCommit.fetch(intentPda);
      expect(Array.from(commit.intentHash)).to.deep.equal(newHash);

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  describe('TTL validation', () => {
    const user = Keypair.generate();
    const hash = computeHash([Buffer.from('ttl-test')]);

    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);
    });

    it('rejects TTL above MAX_TTL', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .commitIntent(appId, Buffer.from(hash), new anchor.BN(7200)) // 2 hours > MAX_TTL
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

    it('accepts TTL=0 (uses default 300s)', async () => {
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
      const ttl = commit.expiresAt.toNumber() - commit.committedAt.toNumber();
      expect(ttl).to.equal(300);

      // Cleanup
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  describe('multi-app isolation', () => {
    const user = Keypair.generate();
    const app1 = Keypair.generate().publicKey;
    const app2 = Keypair.generate().publicKey;
    const hash1 = computeHash([app1.toBuffer(), Buffer.from('app1')]);
    const hash2 = computeHash([app2.toBuffer(), Buffer.from('app2')]);

    before(async () => {
      const sig = await provider.connection.requestAirdrop(
        user.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig);
    });

    it('can have separate intents for different apps', async () => {
      const [pda1] = findIntentPda(user.publicKey, app1, program.programId);
      const [pda2] = findIntentPda(user.publicKey, app2, program.programId);

      // Commit for app1
      await program.methods
        .commitIntent(app1, Buffer.from(hash1), new anchor.BN(300))
        .accounts({
          intentCommit: pda1,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Commit for app2
      await program.methods
        .commitIntent(app2, Buffer.from(hash2), new anchor.BN(300))
        .accounts({
          intentCommit: pda2,
          config: configPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Both exist independently
      const c1 = await program.account.intentCommit.fetch(pda1);
      const c2 = await program.account.intentCommit.fetch(pda2);
      expect(c1.appId.toBase58()).to.equal(app1.toBase58());
      expect(c2.appId.toBase58()).to.equal(app2.toBase58());

      // Verify app1 doesn't affect app2
      await program.methods
        .verifyIntent(Buffer.from(hash1))
        .accounts({ intentCommit: pda1, config: configPda, user: user.publicKey })
        .signers([user])
        .rpc();

      // app2 still exists
      const c2After = await program.account.intentCommit.fetch(pda2);
      expect(c2After.appId.toBase58()).to.equal(app2.toBase58());

      // Cleanup
      await program.methods
        .revokeIntent(app2)
        .accounts({ intentCommit: pda2, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  describe('access control', () => {
    const user = Keypair.generate();
    const attacker = Keypair.generate();
    const hash = computeHash([Buffer.from('access-test')]);

    before(async () => {
      for (const kp of [user, attacker]) {
        const sig = await provider.connection.requestAirdrop(
          kp.publicKey,
          10 * anchor.web3.LAMPORTS_PER_SOL,
        );
        await provider.connection.confirmTransaction(sig);
      }

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
    });

    it('attacker cannot verify another user intent', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

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
    });

    it('attacker cannot revoke another user intent', async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);

      await expectError(
        () =>
          program.methods
            .revokeIntent(appId)
            .accounts({
              intentCommit: intentPda,
              user: attacker.publicKey,
            })
            .signers([attacker])
            .rpc(),
        'ConstraintSeeds',
      );
    });

    after(async () => {
      const [intentPda] = findIntentPda(user.publicKey, appId, program.programId);
      await program.methods
        .revokeIntent(appId)
        .accounts({ intentCommit: intentPda, user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });
});
