import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import Solana from '@ledgerhq/hw-app-solana';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import chalk from 'chalk';

const DEFAULT_DERIVATION_PATH = "44'/501'/0'/0'";

/**
 * Ledger hardware wallet adapter implementing Anchor's Wallet interface.
 * Signs transactions via USB HID — user confirms on the Ledger device.
 */
export class LedgerWallet {
  private app: Solana;
  private path: string;
  publicKey: PublicKey;

  private constructor(app: Solana, publicKey: PublicKey, path: string) {
    this.app = app;
    this.publicKey = publicKey;
    this.path = path;
  }

  static async connect(derivationPath?: string): Promise<LedgerWallet> {
    const path = derivationPath || DEFAULT_DERIVATION_PATH;

    let transport;
    try {
      transport = await TransportNodeHid.create();
    } catch (err: unknown) {
      const msg = (err as Error).message || '';
      if (msg.includes('cannot open device') || msg.includes('No device found')) {
        throw new Error(
          'Ledger device not found. Make sure it is:\n' +
          '  1. Connected via USB\n' +
          '  2. Unlocked (enter PIN)\n' +
          '  3. Solana app is open on the device'
        );
      }
      throw err;
    }

    const app = new Solana(transport);

    let address: Buffer;
    try {
      const result = await app.getAddress(path);
      address = result.address;
    } catch (err: unknown) {
      const msg = (err as Error).message || '';
      if (msg.includes('0x6e01') || msg.includes('CLA_NOT_SUPPORTED')) {
        throw new Error(
          'Solana app not open on Ledger.\n' +
          '  Open the Solana app on your device and try again.'
        );
      }
      if (msg.includes('0x6511') || msg.includes('APP_NOT_INSTALLED')) {
        throw new Error(
          'Solana app not installed on Ledger.\n' +
          '  Install it via Ledger Live > Manager.'
        );
      }
      throw err;
    }

    const publicKey = new PublicKey(address);
    return new LedgerWallet(app, publicKey, path);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      console.log(chalk.yellow('  Please confirm the transaction on your Ledger device...'));
      const message = tx.serializeMessage();
      const { signature } = await this.app.signTransaction(this.path, message);
      tx.addSignature(this.publicKey, Buffer.from(signature));
      return tx;
    }
    throw new Error('VersionedTransaction signing via Ledger is not yet supported');
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    const signed: T[] = [];
    for (const tx of txs) {
      signed.push(await this.signTransaction(tx));
    }
    return signed;
  }
}
