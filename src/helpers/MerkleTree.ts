// src/helpers/MerkleTree.ts
import { keccak_256 } from "js-sha3";

export class MerkleTree<T extends string = string> {
  data: T[];
  leafs: Buffer[];
  layers: Buffer[][];

  constructor(data: T[]) {
    this.data = data;
    this.leafs = MerkleTree.buildLeaves(data).slice();
    this.layers = [];

    let hashes = this.leafs.map(MerkleTree.nodeHash);
    while (hashes.length > 0) {
      this.layers.push(hashes.slice());
      if (hashes.length === 1) break;
      hashes = hashes.reduce((acc: Buffer[], cur: Buffer, idx: number, arr: Buffer[]) => {
        if (idx % 2 === 0) {
          const nxt = arr[idx + 1];
          acc.push(MerkleTree.internalHash(cur, nxt));
        }
        return acc;
      }, [] as Buffer[]);
    }
  }

  static buildLeaves(data: string[]): Buffer[] {
    const leaves: Buffer[] = [];
    for (let idx = 0; idx < data.length; ++idx) {
      leaves.push(Buffer.from(data[idx]));
    }
    return leaves;
  }

  static nodeHash(data: Buffer): Buffer {
    return Buffer.from(keccak_256.digest([0x00, ...data]));
  }

  static internalHash(first: Buffer, second: Buffer | undefined): Buffer {
    if (!second) return first;
    const [fst, snd] = [first, second].sort(Buffer.compare);
    return Buffer.from(keccak_256.digest([0x01, ...fst, ...snd]));
  }

  getRoot(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  getRootArray(): number[] {
    const arr: number[] = [];
    for (const v of this.getRoot().values()) {
      arr.push(v);
    }
    return arr;
  }

  getProof(idx: number): Buffer[] {
    return this.layers.reduce((proof: Buffer[], layer: Buffer[]) => {
      const sibling = idx ^ 1;
      if (sibling < layer.length) {
        proof.push(layer[sibling]);
      }
      idx = Math.floor(idx / 2);
      return proof;
    }, []);
  }

  getProofArray(index: number): number[][] {
    const res: number[][] = [];
    for (const e of this.getProof(index)) {
      const arr: number[] = [];
      for (const v of e.values()) {
        arr.push(v);
      }
      res.push(arr);
    }
    return res;
  }

  getHexRoot(): string {
    return this.getRoot().toString("hex");
  }

  getHexProof(idx: number): string[] {
    return this.getProof(idx).map((el) => el.toString("hex"));
  }

  verifyProof(idx: number, proof: Buffer[], root: Buffer): boolean {
    let pair = MerkleTree.nodeHash(this.leafs[idx]);
    for (const item of proof) {
      pair = MerkleTree.internalHash(pair, item);
    }
    return pair.equals(root);
  }

  verifyRoot(idx: number, proof: Buffer[], root: Buffer): boolean {
    let pair = MerkleTree.nodeHash(this.leafs[idx]);
    for (const item of proof) {
      pair = MerkleTree.internalHash(pair, item);
    }
    return pair.equals(root);
  }

  verifyClaim(item: T, proof: Buffer[]): boolean {
    let pair = MerkleTree.nodeHash(Buffer.from(item));
    for (const item of proof) {
      pair = MerkleTree.internalHash(pair, item);
    }
    return pair.equals(this.getRoot());
  }
}