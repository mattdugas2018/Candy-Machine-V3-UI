import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl, PublicKey } from "@solana/web3.js";

export const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ||
  WalletAdapterNetwork.Devnet) as WalletAdapterNetwork;

export const rpcHost =
  process.env.NEXT_PUBLIC_RPC_HOST || clusterApiUrl(network);

export const candyMachineId = new PublicKey(
  process.env.NEXT_PUBLIC_CANDY_MACHINE_ID ||
    "CrX78VjrTQBvKQU5nrhLqCXr6uptfTfYqbaHMM1iRp7b"
);

export const defaultGuardGroup = "default";

export const whitelistedWallets = [
  "53VVFtLzzi3nL2p1QF591PAB8rbcbsirYepwUphtHU9Q",
  "85gHs1pKkZcNCDEbcfxqhfFNPWCsNFqPTMMbTQARspWy",
  "FXoth7ba7LALmJGFaidCcMnhsxEagBDBDKCmkpr2QuDr",
  "232Z5QNvQ4wRyraGWFpC5i3HEbqozEWgBCV95eWASaG1",
  "D8ivzpXkG66VknRdVjEF1HjqS3T1tzcqraVR6FYaeLsV",
  "sTAKERL4U8fbn2nUte6rPVdcrz2z3fEh1adQEDrGULr",
];
