import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadWallet,
  getRpcUrl,
  getProgramWithWallet,
  findIntentPda,
  shortKey,
} from '../helpers';

interface RevokeOptions {
  app: string;
  keypair?: string;
  ledger?: boolean;
  derivationPath?: string;
  cluster?: string;
}

export async function revokeCommand(opts: RevokeOptions): Promise<void> {
  const spinner = ora('Revoking intent...').start();

  try {
    if (opts.ledger) spinner.text = 'Connecting to Ledger...';
    const wallet = await loadWallet(opts);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgramWithWallet(wallet, rpcUrl);

    if (opts.ledger) {
      spinner.info(chalk.cyan(`Ledger connected: ${shortKey(wallet.publicKey)}`));
      spinner.start('Revoking intent...');
    }

    const appId = new PublicKey(opts.app);
    const [intentPda] = findIntentPda(wallet.publicKey, appId);

    // Check if intent exists
    spinner.text = 'Checking intent...';
    const existing = await program.provider.connection.getAccountInfo(intentPda);
    if (!existing) {
      spinner.info(chalk.yellow('No active intent found for this app'));
      console.log(`  App: ${chalk.cyan(shortKey(appId))}`);
      return;
    }

    spinner.text = opts.ledger
      ? 'Revoking intent on-chain (confirm on Ledger)...'
      : 'Revoking intent on-chain...';

    const tx = await program.methods
      .revokeIntent(appId)
      .accounts({
        intentCommit: intentPda,
        user: wallet.publicKey,
      })
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
