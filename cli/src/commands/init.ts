import { PublicKey, SystemProgram } from '@solana/web3.js';
import chalk from 'chalk';
import ora from 'ora';
import { loadWallet, getRpcUrl, getProgramWithWallet, findConfigPda, PROGRAM_ID } from '../helpers';

interface InitOptions {
  keypair?: string;
  ledger?: boolean;
  derivationPath?: string;
  cluster?: string;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const spinner = ora('Loading wallet...').start();

  try {
    if (opts.ledger) spinner.text = 'Connecting to Ledger...';
    const wallet = await loadWallet(opts);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgramWithWallet(wallet, rpcUrl);
    const [configPda] = findConfigPda();

    if (opts.ledger) {
      spinner.info(chalk.cyan(`Ledger connected: ${wallet.publicKey.toBase58()}`));
      spinner.start('Checking if already initialized...');
    }

    spinner.text = 'Checking if already initialized...';

    // Check if config already exists
    const existing = await program.provider.connection.getAccountInfo(configPda);
    if (existing) {
      spinner.warn(chalk.yellow('IntentGuard is already initialized on this cluster'));
      console.log(`  Config PDA: ${chalk.cyan(configPda.toBase58())}`);
      return;
    }

    spinner.text = opts.ledger
      ? 'Initializing IntentGuard protocol (confirm on Ledger)...'
      : 'Initializing IntentGuard protocol...';

    const tx = await program.methods
      .initialize()
      .accounts({
        config: configPda,
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    spinner.succeed(chalk.green('IntentGuard initialized!'));
    console.log();
    console.log(`  Program:    ${chalk.cyan(PROGRAM_ID.toBase58())}`);
    console.log(`  Config PDA: ${chalk.cyan(configPda.toBase58())}`);
    console.log(`  Admin:      ${chalk.cyan(wallet.publicKey.toBase58())}${opts.ledger ? chalk.dim(' (Ledger)') : ''}`);
    console.log(`  TX:         ${chalk.dim(tx)}`);
    console.log(`  Cluster:    ${chalk.dim(rpcUrl)}`);
  } catch (err: unknown) {
    spinner.fail(chalk.red('Failed to initialize'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
