// Stockage chiffré du token personnel. Sous Electron, `crypto` est safeStorage
// (DPAPI de Windows : seul l'utilisateur Windows courant peut le déchiffrer).
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export class SecretStore {
  /** @param {string} dir @param {{isEncryptionAvailable():boolean, encryptString(s:string):Buffer, decryptString(b:Buffer):string}} crypto */
  constructor(dir, crypto) {
    this.file = path.join(dir, 'token.bin');
    this.dir = dir;
    this.crypto = crypto;
  }

  get available() {
    return this.crypto.isEncryptionAvailable();
  }

  save(token) {
    if (!this.available) throw new Error('Chiffrement indisponible sur ce poste : token non enregistré');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, this.crypto.encryptString(token));
  }

  load() {
    if (!existsSync(this.file) || !this.available) return null;
    try {
      return this.crypto.decryptString(readFileSync(this.file));
    } catch {
      return null;
    }
  }

  clear() {
    if (existsSync(this.file)) unlinkSync(this.file);
  }
}
