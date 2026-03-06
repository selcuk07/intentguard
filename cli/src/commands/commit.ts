import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadWallet,
  getRpcUrl,
  getProgramWithWallet,
  findConfigPda,
  findIntentPda,
  computeActionHash,
  shortKey,
} from '../helpers';

interface CommitOptions {
  app: string;
  action: string;
  params: string;
  ttl: string;
  keypair?: string;
  ledger?: boolean;
  derivationPath?: string;
  cluster?: string;
}

export async function commitCommand(opts: CommitOptions): Promise<void> {
  const spinner = ora('Preparing intent...').start();

  try {
    if (opts.ledger) spinner.text = 'Connecting to Ledger...';
    const wallet = await loadWallet(opts);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgramWithWallet(wallet, rpcUrl);

    if (opts.ledger) {
      spinner.info(chalk.cyan(`Ledger connected: ${shortKey(wallet.publicKey)}`));
      spinner.start('Preparing intent...');
    }

    const appId = new PublicKey(opts.app);
    const ttl = parseInt(opts.ttl, 10);

    // Parse params
    let params: Record<string, string>;
    try {
      params = JSON.parse(opts.params);
    } catch {
      spinner.fail(chalk.red('Invalid JSON in --params'));
      console.error(chalk.dim('Example: --params \'{"amount":"1000000","mint":"So11..."}\''));
      process.exit(1);
    }

    // Compute hash
    const intentHash = computeActionHash(appId, wallet.publicKey, opts.action, params);

    const [configPda] = findConfigPda();
    const [intentPda] = findIntentPda(wallet.publicKey, appId);

    // Check if intent already exists
    spinner.text = 'Checking for existing intent...';
    const existing = await program.provider.connection.getAccountInfo(intentPda);
    if (existing) {
      spinner.fail(chalk.red('Active intent already exists for this app'));
      console.log(`  Revoke first: ${chalk.cyan(`intentguard revoke --app ${opts.app}`)}`);
      process.exit(1);
    }

    spinner.text = opts.ledger
      ? 'Committing intent on-chain (confirm on Ledger)...'
      : 'Committing intent on-chain...';

    const tx = await program.methods
      .commitIntent(appId, Buffer.from(intentHash), new anchor.BN(ttl))
      .accounts({
        intentCommit: intentPda,
        config: configPda,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    spinner.succeed(chalk.green('Intent committed!'));
    console.log();
    console.log(chalk.bold('  Intent Details:'));
    console.log(`  App:      ${chalk.cyan(shortKey(appId))} (${opts.app})`);
    console.log(`  Action:   ${chalk.yellow(opts.action)}`);
    console.log(`  Params:   ${chalk.dim(JSON.stringify(params))}`);
    console.log(`  TTL:      ${chalk.yellow(ttl + 's')}`);
    console.log(`  Hash:     ${chalk.dim(Buffer.from(intentHash).toString('hex').slice(0, 16))}...`);
    console.log();
    console.log(chalk.bold('  On-chain:'));
    console.log(`  PDA:      ${chalk.cyan(intentPda.toBase58())}`);
    console.log(`  TX:       ${chalk.dim(tx)}`);
    console.log(`  Wallet:   ${chalk.cyan(shortKey(wallet.publicKey))}${opts.ledger ? chalk.dim(' (Ledger)') : ''}`);
    console.log();
    console.log(chalk.green.bold('  Now proceed to execute the action in your dApp.'));
    console.log(chalk.dim(`  The intent will expire in ${ttl} seconds.`));
  } catch (err: unknown) {
    spinner.fail(chalk.red('Failed to commit intent'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
