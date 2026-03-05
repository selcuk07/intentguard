import { PublicKey, SystemProgram } from '@solana/web3.js';
import chalk from 'chalk';
import ora from 'ora';
import { loadKeypair, getRpcUrl, getProgram, findConfigPda, PROGRAM_ID } from '../helpers';

interface InitOptions {
  keypair?: string;
  cluster?: string;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const spinner = ora('Loading keypair...').start();

  try {
    const keypair = loadKeypair(opts.keypair);
    const rpcUrl = getRpcUrl(opts.cluster);
    const program = getProgram(keypair, rpcUrl);
    const [configPda] = findConfigPda();

    spinner.text = 'Checking if already initialized...';

    // Check if config already exists
    const existing = await program.provider.connection.getAccountInfo(configPda);
    if (existing) {
      spinner.warn(chalk.yellow('IntentGuard is already initialized on this cluster'));
      console.log(`  Config PDA: ${chalk.cyan(configPda.toBase58())}`);
      return;
    }

    spinner.text = 'Initializing IntentGuard protocol...';

    const tx = await program.methods
      .initialize()
      .accounts({
        config: configPda,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([keypair])
      .rpc();

    spinner.succeed(chalk.green('IntentGuard initialized!'));
    console.log();
    console.log(`  Program:    ${chalk.cyan(PROGRAM_ID.toBase58())}`);
    console.log(`  Config PDA: ${chalk.cyan(configPda.toBase58())}`);
    console.log(`  Admin:      ${chalk.cyan(keypair.publicKey.toBase58())}`);
    console.log(`  TX:         ${chalk.dim(tx)}`);
    console.log(`  Cluster:    ${chalk.dim(rpcUrl)}`);
  } catch (err: unknown) {
    spinner.fail(chalk.red('Failed to initialize'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
