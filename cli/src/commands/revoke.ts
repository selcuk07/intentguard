import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadKeypair,
  getRpcUrl,
  getProgram,
  findIntentPda,
  shortKey,
} from '../helpers';

interface RevokeOptions {
  app: string;
  keypair?: string;
  cluster?: string;
}

export async function revokeCommand(opts: RevokeOptions): Promise<void> {
  const spinner = ora('Revoking intent...').start();

  try {
    const keypair = loadKeypair(opts.keypair);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgram(keypair, rpcUrl);

    const appId = new PublicKey(opts.app);
    const [intentPda] = findIntentPda(keypair.publicKey, appId);

    // Check if intent exists
    spinner.text = 'Checking intent...';
    const existing = await program.provider.connection.getAccountInfo(intentPda);
    if (!existing) {
      spinner.info(chalk.yellow('No active intent found for this app'));
      console.log(`  App: ${chalk.cyan(shortKey(appId))}`);
      return;
    }

    spinner.text = 'Revoking intent on-chain...';

    const tx = await program.methods
      .revokeIntent(appId)
      .accounts({
        intentCommit: intentPda,
        user: keypair.publicKey,
      })
      .signers([keypair])
      .rpc();

    spinner.succeed(chalk.green('Intent revoked!'));
    console.log();
    console.log(`  App:    ${chalk.cyan(shortKey(appId))}`);
    console.log(`  PDA:    ${chalk.dim(intentPda.toBase58())} (closed)`);
    console.log(`  TX:     ${chalk.dim(tx)}`);
    console.log(`  Rent:   ${chalk.green('refunded to your wallet')}`);
  } catch (err: unknown) {
    spinner.fail(chalk.red('Failed to revoke intent'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
