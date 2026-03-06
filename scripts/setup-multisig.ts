/**
 * IntentGuard — Squads Multisig Setup
 *
 * Creates a Squads v4 multisig and transfers:
 * 1. Program upgrade authority -> multisig vault
 * 2. IntentGuard config admin -> multisig vault
 *
 * Usage:
 *   npx tsx scripts/setup-multisig.ts [--execute]
 *
 * Without --execute: dry run (shows what will happen)
 * With --execute: actually creates multisig and transfers authority
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const { Permission, Permissions } = multisig.types;

// ─── Config ───────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7");
const RPC_URL = "https://api.devnet.solana.com"; // Change to mainnet-beta for production
const TIME_LOCK = 0; // seconds — set to 86400 (24h) for mainnet
const THRESHOLD = 1; // signatures required — increase when adding team members

// ─── Helpers ──────────────────────────────────────────────────
function loadKeypair(): Keypair {
  const keyPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function findConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
}

async function main() {
  const dryRun = !process.argv.includes("--execute");
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair();

  console.log("\n=== IntentGuard Squads Multisig Setup ===\n");
  console.log("Mode:          ", dryRun ? "DRY RUN (add --execute to apply)" : "LIVE");
  console.log("Cluster:       ", RPC_URL);
  console.log("Admin:         ", admin.publicKey.toBase58());
  console.log("Program:       ", PROGRAM_ID.toBase58());
  console.log("Threshold:     ", THRESHOLD);
  console.log("Time lock:     ", TIME_LOCK, "seconds");

  // ─── Step 1: Create Multisig ──────────────────────────────
  console.log("\n[Step 1] Creating Squads multisig...");

  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  // Vault PDA (index 0) — this will be the new authority
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });

  console.log("  Multisig PDA:", multisigPda.toBase58());
  console.log("  Vault PDA:   ", vaultPda.toBase58());
  console.log("  Create key:  ", createKey.publicKey.toBase58());

  if (!dryRun) {
    try {
      const programConfigPda = multisig.getProgramConfigPda({})[0];
      const programConfig =
        await multisig.accounts.ProgramConfig.fromAccountAddress(
          connection,
          programConfigPda
        );

      const sig = await multisig.rpc.multisigCreateV2({
        connection,
        createKey,
        creator: admin,
        multisigPda,
        configAuthority: null,
        timeLock: TIME_LOCK,
        members: [
          {
            key: admin.publicKey,
            permissions: Permissions.all(),
          },
        ],
        threshold: THRESHOLD,
        rentCollector: null,
        treasury: programConfig.treasury,
        sendOptions: { skipPreflight: true },
      });
      await connection.confirmTransaction(sig);
      console.log("  TX:", sig);
      console.log("  Multisig created!");
    } catch (err: any) {
      console.error("  Failed:", err.message);
      process.exit(1);
    }
  }

  // ─── Step 2: Transfer program upgrade authority ───────────
  console.log("\n[Step 2] Transfer program upgrade authority -> multisig vault");
  console.log("  From:", admin.publicKey.toBase58());
  console.log("  To:  ", vaultPda.toBase58());

  if (!dryRun) {
    try {
      const { execSync } = require("child_process");
      const cmd = `solana program set-upgrade-authority ${PROGRAM_ID.toBase58()} --new-upgrade-authority ${vaultPda.toBase58()} --skip-new-upgrade-authority-signer-check --url ${RPC_URL} --keypair ${path.join(os.homedir(), ".config", "solana", "id.json")}`;
      console.log("  Running:", cmd);
      const output = execSync(cmd, { encoding: "utf-8" });
      console.log("  ", output.trim());
    } catch (err: any) {
      console.error("  Failed:", err.message);
      process.exit(1);
    }
  }

  // ─── Step 3: Transfer IntentGuard admin -> multisig vault ─
  console.log("\n[Step 3] Transfer IntentGuard config admin -> multisig vault");
  console.log("  From:", admin.publicKey.toBase58());
  console.log("  To:  ", vaultPda.toBase58());

  if (!dryRun) {
    try {
      const [configPda] = findConfigPda();

      // transfer_admin discriminator: sha256("global:transfer_admin")[0..8]
      const disc = crypto
        .createHash("sha256")
        .update("global:transfer_admin")
        .digest()
        .slice(0, 8);

      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        ],
        data: Buffer.concat([disc, vaultPda.toBuffer()]),
      });

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
      console.log("  TX:", sig);
      console.log("  Admin transferred!");
    } catch (err: any) {
      console.error("  Failed:", err.message);
      process.exit(1);
    }
  }

  // ─── Summary ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(55));
  console.log("  SUMMARY");
  console.log("=".repeat(55));
  console.log("  Multisig PDA:      ", multisigPda.toBase58());
  console.log("  Vault PDA:         ", vaultPda.toBase58());
  console.log("  Threshold:         ", THRESHOLD, "of 1 members");
  console.log("  Time lock:         ", TIME_LOCK, "seconds");
  console.log("  Program authority:  ->", vaultPda.toBase58());
  console.log("  Config admin:       ->", vaultPda.toBase58());
  console.log("=".repeat(55));

  if (dryRun) {
    console.log("\n  This was a DRY RUN. Run with --execute to apply.\n");
  } else {
    console.log("\n  All done! Save these addresses.");
    console.log("  Manage at: https://v4.squads.so\n");

    // Save multisig info
    const info = {
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      createKey: createKey.publicKey.toBase58(),
      threshold: THRESHOLD,
      timeLock: TIME_LOCK,
      programId: PROGRAM_ID.toBase58(),
      cluster: RPC_URL,
      createdAt: new Date().toISOString(),
    };
    const infoPath = path.join(__dirname, "multisig-info.json");
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
    console.log("  Saved to:", infoPath);
  }
}

main().catch(console.error);
