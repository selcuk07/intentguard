/**
 * IntentGuard — Squads Multisig Admin Operations
 *
 * Once admin is transferred to a Squads vault, all admin operations
 * go through the multisig proposal flow:
 *   1. Create vault transaction + proposal
 *   2. Members approve (until threshold met)
 *   3. Execute after time lock passes
 *
 * Usage:
 *   npx tsx scripts/squads-admin.ts <command> [args]
 *
 * Commands:
 *   propose-pause                 Propose pausing the protocol
 *   propose-unpause               Propose unpausing the protocol
 *   propose-update-config <bal>   Propose updating min_balance (lamports)
 *   propose-transfer-admin <key>  Propose transferring admin to new pubkey
 *   approve <index>               Approve proposal by transaction index
 *   execute <index>               Execute approved proposal after time lock
 *   status [index]                Show multisig status or proposal details
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ─── Config ───────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

function loadKeypair(): Keypair {
  const keyPath = process.env.KEYPAIR_PATH ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadMultisigInfo(): {
  multisigPda: string;
  vaultPda: string;
} {
  const infoPath = path.join(__dirname, "multisig-info.json");
  if (!fs.existsSync(infoPath)) {
    console.error("multisig-info.json not found. Run setup-multisig.ts first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(infoPath, "utf-8"));
}

function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
}

// Anchor discriminators
function disc(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

// ─── Instruction Builders ─────────────────────────────────────

function buildPauseInstruction(vault: PublicKey): TransactionInstruction {
  const [configPda] = findConfigPda();
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(disc("pause_protocol")),
  });
}

function buildUnpauseInstruction(vault: PublicKey): TransactionInstruction {
  const [configPda] = findConfigPda();
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(disc("unpause_protocol")),
  });
}

function buildUpdateConfigInstruction(
  vault: PublicKey,
  newMinBalance: bigint
): TransactionInstruction {
  const [configPda] = findConfigPda();
  const data = Buffer.alloc(16);
  disc("update_config").copy(data, 0);
  data.writeBigUInt64LE(newMinBalance, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data,
  });
}

function buildTransferAdminInstruction(
  vault: PublicKey,
  newAdmin: PublicKey
): TransactionInstruction {
  const [configPda] = findConfigPda();
  const data = Buffer.alloc(40);
  disc("transfer_admin").copy(data, 0);
  newAdmin.toBuffer().copy(data, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: true, isWritable: true },
    ],
    data,
  });
}

// ─── Proposal Flow ────────────────────────────────────────────

async function createProposal(
  connection: Connection,
  signer: Keypair,
  multisigPda: PublicKey,
  vaultPda: PublicKey,
  instruction: TransactionInstruction,
  description: string
): Promise<bigint> {
  // Get current transaction index
  const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  const txIndex = BigInt(msAccount.transactionIndex.toString()) + 1n;

  console.log(`\nCreating proposal #${txIndex}: ${description}`);

  // Create vault transaction
  const vaultTxSig = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: signer,
    multisigPda,
    transactionIndex: txIndex,
    creator: signer.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [instruction],
    }),
  });
  await connection.confirmTransaction(vaultTxSig);
  console.log("  Vault transaction created:", vaultTxSig);

  // Create proposal
  const proposalSig = await multisig.rpc.proposalCreate({
    connection,
    feePayer: signer,
    multisigPda,
    transactionIndex: txIndex,
    creator: signer,
  });
  await connection.confirmTransaction(proposalSig);
  console.log("  Proposal created:", proposalSig);

  // Auto-approve by the creator
  const approveSig = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer,
    multisigPda,
    transactionIndex: txIndex,
    member: signer,
  });
  await connection.confirmTransaction(approveSig);
  console.log("  Auto-approved by creator");

  console.log(`\n  Proposal #${txIndex} awaiting ${msAccount.threshold} approvals.`);
  console.log(`  Time lock: ${msAccount.timeLock}s after threshold met.`);
  console.log(`  Share index ${txIndex} with other signers to approve.`);

  return txIndex;
}

async function approveProposal(
  connection: Connection,
  signer: Keypair,
  multisigPda: PublicKey,
  txIndex: bigint
): Promise<void> {
  console.log(`\nApproving proposal #${txIndex}...`);
  const sig = await multisig.rpc.proposalApprove({
    connection,
    feePayer: signer,
    multisigPda,
    transactionIndex: txIndex,
    member: signer,
  });
  await connection.confirmTransaction(sig);
  console.log("  Approved:", sig);
}

async function executeProposal(
  connection: Connection,
  signer: Keypair,
  multisigPda: PublicKey,
  txIndex: bigint
): Promise<void> {
  console.log(`\nExecuting proposal #${txIndex}...`);
  const sig = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: signer,
    multisigPda,
    transactionIndex: txIndex,
    member: signer.publicKey,
  });
  await connection.confirmTransaction(sig);
  console.log("  Executed:", sig);
}

async function showStatus(
  connection: Connection,
  multisigPda: PublicKey,
  txIndex?: bigint
): Promise<void> {
  const msAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  console.log("\n=== Multisig Status ===");
  console.log("  PDA:           ", multisigPda.toBase58());
  console.log("  Threshold:     ", msAccount.threshold.toString());
  console.log("  Members:       ", msAccount.members.length);
  console.log("  Time lock:     ", `${msAccount.timeLock}s`);
  console.log("  TX count:      ", msAccount.transactionIndex.toString());

  for (const m of msAccount.members) {
    console.log(`    - ${m.key.toBase58()} (permissions: ${m.permissions.mask})`);
  }

  if (txIndex !== undefined) {
    try {
      const [proposalPda] = multisig.getProposalPda({
        multisigPda,
        transactionIndex: txIndex,
      });
      const proposal = await multisig.accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
      console.log(`\n  Proposal #${txIndex}:`);
      console.log("    Status:", JSON.stringify(proposal.status));
      console.log("    Approved:", proposal.approved.map(k => k.toBase58()));
      console.log("    Rejected:", proposal.rejected.map(k => k.toBase58()));
    } catch {
      console.log(`\n  Proposal #${txIndex}: not found`);
    }
  }
}

// ─── CLI ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help") {
    console.log(`
IntentGuard Squads Admin — Manage protocol via multisig

Commands:
  propose-pause                 Propose pausing the protocol
  propose-unpause               Propose unpausing the protocol
  propose-update-config <bal>   Propose updating min_balance (lamports)
  propose-transfer-admin <key>  Propose admin transfer to new pubkey
  approve <index>               Approve proposal by transaction index
  execute <index>               Execute approved proposal after time lock
  status [index]                Show multisig or specific proposal status

Environment:
  RPC_URL       Solana RPC endpoint (default: mainnet-beta)
  KEYPAIR_PATH  Path to signer keypair (default: ~/.config/solana/id.json)
`);
    return;
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const signer = loadKeypair();
  const info = loadMultisigInfo();
  const multisigPda = new PublicKey(info.multisigPda);
  const vaultPda = new PublicKey(info.vaultPda);

  console.log("Signer: ", signer.publicKey.toBase58());
  console.log("Cluster:", RPC_URL);

  switch (command) {
    case "propose-pause": {
      const ix = buildPauseInstruction(vaultPda);
      await createProposal(
        connection, signer, multisigPda, vaultPda, ix,
        "Pause IntentGuard protocol"
      );
      break;
    }

    case "propose-unpause": {
      const ix = buildUnpauseInstruction(vaultPda);
      await createProposal(
        connection, signer, multisigPda, vaultPda, ix,
        "Unpause IntentGuard protocol"
      );
      break;
    }

    case "propose-update-config": {
      const bal = args[1];
      if (!bal) {
        console.error("Usage: propose-update-config <min_balance_lamports>");
        process.exit(1);
      }
      const lamports = BigInt(bal);
      if (lamports > 1_000_000_000n) {
        console.error("ERROR: min_balance cannot exceed 1 SOL (1000000000 lamports)");
        process.exit(1);
      }
      const ix = buildUpdateConfigInstruction(vaultPda, lamports);
      await createProposal(
        connection, signer, multisigPda, vaultPda, ix,
        `Update min_balance to ${lamports} lamports`
      );
      break;
    }

    case "propose-transfer-admin": {
      const newAdminStr = args[1];
      if (!newAdminStr) {
        console.error("Usage: propose-transfer-admin <new_admin_pubkey>");
        process.exit(1);
      }
      const newAdmin = new PublicKey(newAdminStr);
      if (newAdmin.equals(PublicKey.default)) {
        console.error("ERROR: Cannot transfer to zero address (permanent lockout)");
        process.exit(1);
      }
      console.warn("\n  WARNING: This will transfer admin control away from the multisig.");
      console.warn("  Make sure the new admin address is correct and accessible.\n");
      const ix = buildTransferAdminInstruction(vaultPda, newAdmin);
      await createProposal(
        connection, signer, multisigPda, vaultPda, ix,
        `Transfer admin to ${newAdminStr}`
      );
      break;
    }

    case "approve": {
      const idx = args[1];
      if (!idx) {
        console.error("Usage: approve <transaction_index>");
        process.exit(1);
      }
      await approveProposal(connection, signer, multisigPda, BigInt(idx));
      break;
    }

    case "execute": {
      const idx = args[1];
      if (!idx) {
        console.error("Usage: execute <transaction_index>");
        process.exit(1);
      }
      await executeProposal(connection, signer, multisigPda, BigInt(idx));
      break;
    }

    case "status": {
      const idx = args[1] ? BigInt(args[1]) : undefined;
      await showStatus(connection, multisigPda, idx);
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run with --help for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
