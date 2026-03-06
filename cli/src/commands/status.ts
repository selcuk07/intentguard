import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadWallet,
  getRpcUrl,
  getProgramWithWallet,
  findIntentPda,
  findConfigPda,
  shortKey,
  formatTimestamp,
  PROGRAM_ID,
} from '../helpers';

interface StatusOptions {
  app?: string;
  user?: string;
  keypair?: string;
  ledger?: boolean;
  derivationPath?: string;
  cluster?: string;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const spinner = ora('Fetching status...').start();

  try {
    if (opts.ledger) spinner.text = 'Connecting to Ledger...';
    const wallet = await loadWallet(opts);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgramWithWallet(wallet, rpcUrl);

    const userPubkey = opts.user ? new PublicKey(opts.user) : wallet.publicKey;

    // If specific app is provided, check that single intent
    if (opts.app) {
      const appId = new PublicKey(opts.app);
      const [intentPda] = findIntentPda(userPubkey, appId);

      spinner.text = 'Fetching intent...';
      const account = await program.provider.connection.getAccountInfo(intentPda);

      if (!account) {
        spinner.info(chalk.yellow('No active intent found'));
        console.log(`  User: ${chalk.cyan(shortKey(userPubkey))}`);
        console.log(`  App:  ${chalk.cyan(shortKey(appId))}`);
        return;
      }

      const intent = await (program.account as any).intentCommit.fetch(intentPda);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = (intent.expiresAt as any).toNumber();
      const isExpired = now > expiresAt;
      const remaining = Math.max(0, expiresAt - now);

      spinner.stop();
      console.log();
      console.log(chalk.bold('  Active Intent'));
      console.log(`  ${'─'.repeat(50)}`);
      console.log(`  User:        ${chalk.cyan(intent.user.toBase58())}`);
      console.log(`  App:         ${chalk.cyan(intent.appId.toBase58())}`);
      console.log(`  Hash:        ${chalk.dim(Buffer.from(intent.intentHash as number[]).toString('hex').slice(0, 32))}...`);
      console.log(`  Committed:   ${chalk.dim(formatTimestamp((intent.committedAt as any).toNumber()))}`);
      console.log(`  Expires:     ${chalk.dim(formatTimestamp(expiresAt))}`);

      if (isExpired) {
        console.log(`  Status:      ${chalk.red.bold('EXPIRED')}`);
      } else {
        console.log(`  Status:      ${chalk.green.bold('ACTIVE')} (${remaining}s remaining)`);
      }

      console.log(`  PDA:         ${chalk.dim(intentPda.toBase58())}`);
      return;
    }

    // No app specified — show protocol stats + scan for intents
    const [configPda] = findConfigPda();
    spinner.text = 'Fetching protocol config...';

    try {
      const config = await (program.account as any).guardConfig.fetch(configPda);

      spinner.stop();
      console.log();
      console.log(chalk.bold('  IntentGuard Protocol'));
      console.log(`  ${'─'.repeat(50)}`);
      console.log(`  Program:         ${chalk.cyan(PROGRAM_ID.toBase58())}`);
      console.log(`  Admin:           ${chalk.cyan(config.admin.toBase58())}`);
      console.log(`  Paused:          ${config.isPaused ? chalk.red('YES') : chalk.green('NO')}`);
      console.log(`  Total commits:   ${chalk.yellow((config.totalCommits as any).toNumber().toLocaleString())}`);
      console.log(`  Total verifies:  ${chalk.yellow((config.totalVerifies as any).toNumber().toLocaleString())}`);
      console.log(`  Cluster:         ${chalk.dim(rpcUrl)}`);
      console.log(`  Wallet:          ${chalk.cyan(shortKey(userPubkey))}`);
      console.log();
      console.log(chalk.dim('  Tip: Use --app <pubkey> to check a specific intent'));
    } catch {
      spinner.warn(chalk.yellow('IntentGuard not initialized on this cluster'));
      console.log(chalk.dim(`  Run: intentguard init --cluster ${opts.cluster || 'devnet'}`));
    }
  } catch (err: unknown) {
    spinner.fail(chalk.red('Failed to fetch status'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
