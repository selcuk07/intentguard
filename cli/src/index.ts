#!/usr/bin/env node

import { Command } from 'commander';
import { commitCommand } from './commands/commit';
import { statusCommand } from './commands/status';
import { revokeCommand } from './commands/revoke';
import { initCommand } from './commands/init';

const program = new Command();

program
  .name('intentguard')
  .description('IntentGuard CLI — Solana 2FA from your terminal')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize IntentGuard protocol (one-time admin setup)')
  .option('-k, --keypair <path>', 'Path to keypair file')
  .option('-c, --cluster <cluster>', 'Solana cluster (devnet|mainnet|localnet|<url>)')
  .action(initCommand);

program
  .command('commit')
  .description('Commit an intent hash on-chain (TX1 from trusted device)')
  .requiredOption('-a, --app <pubkey>', 'Target app/program ID')
  .requiredOption('--action <label>', 'Action label (e.g., "swap", "transfer", "bid")')
  .requiredOption('-p, --params <json>', 'Intent parameters as JSON string')
  .option('-t, --ttl <seconds>', 'Time-to-live in seconds (default: 300)', '300')
  .option('-k, --keypair <path>', 'Path to keypair file')
  .option('-c, --cluster <cluster>', 'Solana cluster (devnet|mainnet|localnet|<url>)')
  .action(commitCommand);

program
  .command('status')
  .description('Check pending intents for a wallet')
  .option('-a, --app <pubkey>', 'Filter by app ID (checks specific intent)')
  .option('-u, --user <pubkey>', 'Check another wallet (default: your keypair)')
  .option('-k, --keypair <path>', 'Path to keypair file')
  .option('-c, --cluster <cluster>', 'Solana cluster')
  .action(statusCommand);

program
  .command('revoke')
  .description('Revoke a pending intent commit')
  .requiredOption('-a, --app <pubkey>', 'App ID of the intent to revoke')
  .option('-k, --keypair <path>', 'Path to keypair file')
  .option('-c, --cluster <cluster>', 'Solana cluster')
  .action(revokeCommand);

program.parse();
