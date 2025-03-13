import {
  CandyMachine,
  IdentitySigner,
  Metadata,
  Metaplex,
  Nft,
  NftWithToken,
  PublicKey,
  Sft,
  SftWithToken,
  walletAdapterIdentity,
  sol,
} from "@metaplex-foundation/js";
import { Keypair, Transaction, Connection } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import React from "react";
import { MerkleTree } from "../helpers/MerkleTree";
import {
  AllowLists,
  CustomCandyGuardMintSettings,
  GuardGroup,
  GuardGroupStates,
  NftPaymentMintSettings,
  ParsedPricesForUI,
  Token,
} from "./types";
import {
  fetchMintLimit,
  guardToPaymentUtil,
  mergeGuards,
  parseGuardGroup,
  parseGuardStates,
} from "./utils";

export default function useCandyMachineV3(
  candyMachineId: PublicKey | string,
  candyMachineOpts: {
    allowLists?: AllowLists;
  } = {}
) {
  const { connection } = useConnection();
  const { publicKey, wallet, signTransaction } = useWallet();
  const [guardsAndGroups, setGuardsAndGroups] = React.useState<{
    default?: GuardGroup;
    [k: string]: GuardGroup;
  }>({});

  const [status, setStatus] = React.useState({
    candyMachine: false,
    guardGroups: false,
    minting: false,
    initialFetchGuardGroupsDone: false,
  });

  const [balance, setBalance] = React.useState(0);
  const [allTokens, setAllTokens] = React.useState<Token[]>([]);
  const [nftHoldings, setNftHoldings] = React.useState<Metadata[]>([]);

  const tokenHoldings = React.useMemo<Token[]>(() => {
    if (!nftHoldings?.length || !allTokens?.length) return [];
    return allTokens.filter(
      (x) => !nftHoldings.find((y) => x.mint.equals(y.address))
    );
  }, [nftHoldings, allTokens]);

  const [candyMachine, setCandyMachine] = React.useState<CandyMachine>(null);
  const [items, setItems] = React.useState({
    available: 0,
    remaining: 0,
    redeemed: 0,
  });

  const mx = React.useMemo(() => {
    const metaplex = connection && Metaplex.make(connection);
    return metaplex;
  }, [connection]);

  const proofMemo = React.useMemo(() => {
    if (!candyMachineOpts.allowLists?.length) {
      return {
        merkles: {},
        verifyProof() {
          return true;
        },
      };
    }
    if (!publicKey) {
      return {
        merkles: {},
        verifyProof() {
          return false;
        },
      };
    }

    const merkles: { [k: string]: { tree: MerkleTree<string>; proof: Buffer[] } } =
      candyMachineOpts.allowLists.reduce(
        (prev, { groupLabel, list }) => {
          // Convert list elements to strings
          const stringList = list.map((item) =>
            typeof item === "string" ? item : Buffer.from(item).toString("hex")
          );
          const tree = new MerkleTree<string>(stringList);
          const leaf = publicKey.toString();
          const leafIndex = stringList.indexOf(leaf);
          const proof = leafIndex !== -1 ? tree.getProof(leafIndex) : [];
          return Object.assign(prev, {
            [groupLabel]: {
              tree,
              proof,
            },
          });
        },
        {}
      );

    const verifyProof = (merkleRoot: Uint8Array | string, label = "default") => {
      const merkle = merkles[label];
      if (!merkle) return false;
      const root = Buffer.from(merkleRoot);
      const stringList = candyMachineOpts.allowLists
        .find((al) => al.groupLabel === label)
        ?.list.map((item) =>
          typeof item === "string" ? item : Buffer.from(item).toString("hex")
        ) || [];
      const leafIndex = stringList.indexOf(publicKey.toString());
      if (leafIndex === -1) return false;
      return merkle.tree.verifyProof(leafIndex, merkle.proof, root);
    };

    return {
      merkles,
      verifyProof,
    };
  }, [publicKey, candyMachineOpts.allowLists]);

  const fetchCandyMachine = React.useCallback(async () => {
    if (!publicKey) throw new Error("Wallet not loaded yet!");
    return await mx.candyMachines().findByAddress({
      address: new PublicKey(candyMachineId),
    });
  }, [candyMachineId, publicKey, mx]);

  const refresh = React.useCallback(async () => {
    if (!publicKey) {
      console.log("Skipping refresh: Wallet not loaded yet");
      return;
    }

    setStatus((x) => ({ ...x, candyMachine: true }));
    await fetchCandyMachine()
      .then((cndy) => {
        setCandyMachine(cndy);
        setItems({
          available: cndy.itemsAvailable.toNumber(),
          remaining: cndy.itemsRemaining.toNumber(),
          redeemed: cndy.itemsMinted.toNumber(),
        });
      })
      .catch((e) => console.error("Error while fetching candy machine", e))
      .finally(() => setStatus((x) => ({ ...x, candyMachine: false })));
  }, [fetchCandyMachine, publicKey]);

  const mint = React.useCallback(
    async (
      quantityString: number = 1,
      opts: {
        groupLabel?: string;
        nftGuards?: NftPaymentMintSettings[];
      } = {}
    ) => {
      const groupLabel = opts.groupLabel || "default";
      if (!guardsAndGroups[groupLabel]) {
        console.error("Guard group not found:", groupLabel);
        throw new Error(`Unknown guard group label: ${groupLabel}`);
      }

      let nfts: (Sft | SftWithToken | Nft | NftWithToken)[] = [];
      try {
        if (!candyMachine) throw new Error("Candy Machine not loaded yet!");
        if (!signTransaction) throw new Error("Wallet signing not available!");
        if (!publicKey) throw new Error("Wallet public key not available!");

        setStatus((x) => ({ ...x, minting: true }));

        const treasury = new PublicKey("94FEw5KdMSSuqENzUTUnM1sNXJXQgnArWz9SevJTBmkA");
        const mintArgs = {
          candyMachine,
          collectionUpdateAuthority: candyMachine.authorityAddress,
          group: groupLabel === "default" ? null : groupLabel,
          guards: {
            solPayment: {
              amount: sol(0.4),
              destination: treasury,
            },
          },
        };

        console.log("Mint args:", JSON.stringify(mintArgs, null, 2));
        console.log("Wallet publicKey:", publicKey.toString());
        console.log("Connection RPC:", connection.rpcEndpoint);

        const { nft, response } = await mx
          .candyMachines()
          .mint(mintArgs, {
            payer: mx.identity(),
            commitment: "finalized",
          });
        const signature = response.signature;

        console.log("Transaction signature:", signature);
        console.log("Minted NFT:", JSON.stringify(nft, null, 2));

        nfts = [nft];
        Object.values(guardsAndGroups).forEach((guards) => {
          if (guards.mintLimit?.mintCounter)
            guards.mintLimit.mintCounter.count += nfts.length;
        });
      } catch (error: any) {
        console.error("Minting failed:", error);
        let message = error.message || "Minting failed! Please try again!";
        if (error instanceof Error && error.name === "WalletSignTransactionError") {
          message = `Wallet signing error: ${error.message}`;
        } else if (error.code === 429) {
          message = "RPC rate limit exceeded. Retrying...";
        } else if (error.message?.includes("0x135")) {
          message = "Insufficient funds to mint. Please fund your wallet.";
        } else if (error.message?.includes("0x137")) {
          message = "SOLD OUT!";
        }
        throw new Error(message);
      } finally {
        setStatus((x) => ({ ...x, minting: false }));
        refresh();
      }
      return nfts.filter((a) => a);
    },
    [candyMachine, guardsAndGroups, mx, publicKey, refresh, signTransaction, connection]
  );

  React.useEffect(() => {
    if (!mx || !publicKey || !wallet?.adapter) return;
    console.log("useEffect([mx, publicKey])");
    mx.use(walletAdapterIdentity(wallet.adapter));

    mx.rpc()
      .getBalance(publicKey)
      .then((x) => x.basisPoints.toNumber())
      .then(setBalance)
      .catch((e) => console.error("Error to fetch wallet balance", e));

    mx.nfts()
      .findAllByOwner({
        owner: publicKey,
      })
      .then((x) =>
        setNftHoldings(x.filter((a) => a.model === "metadata") as any)
      )
      .catch((e) => console.error("Failed to fetch wallet nft holdings", e));

    (async (walletAddress: PublicKey): Promise<Token[]> => {
      const tokenAccounts = (
        await connection.getParsedTokenAccountsByOwner(walletAddress, {
          programId: TOKEN_PROGRAM_ID,
        })
      ).value.filter(
        (x) => parseInt(x.account.data.parsed.info.tokenAmount.amount) > 1
      );

      return tokenAccounts.map((x) => ({
        mint: new PublicKey(x.account.data.parsed.info.mint),
        balance: parseInt(x.account.data.parsed.info.tokenAmount.amount),
        decimals: x.account.data.parsed.info.tokenAmount.decimals,
      }));
    })(publicKey).then(setAllTokens);
  }, [mx, publicKey, wallet, connection]);

  React.useEffect(() => {
    if (!publicKey) return;
    console.log("Fetching Candy Machine...");
    refresh().catch((e) =>
      console.error("Error while fetching candy machine", e)
    );
  }, [refresh, publicKey, mx]); // Fixed: Added mx

  React.useEffect(() => {
    if (!publicKey || !candyMachine) return;
    console.log("Fetching guard groups...");

    (async () => {
      setStatus((x) => ({ ...x, guardGroups: true }));
      try {
        const guards = {
          default: await parseGuardGroup(
            {
              guards: candyMachine.candyGuard.guards,
              candyMachine,
              nftHoldings,
              verifyProof: proofMemo.verifyProof,
              walletAddress: publicKey,
            },
            mx
          ),
        };
        await Promise.all(
          candyMachine.candyGuard.groups.map(async (x) => {
            guards[x.label] = await parseGuardGroup(
              {
                guards: mergeGuards([candyMachine.candyGuard.guards, x.guards]),
                label: x.label,
                candyMachine,
                nftHoldings,
                verifyProof: proofMemo.verifyProof,
                walletAddress: publicKey,
              },
              mx
            );
          })
        );
        console.log("Guard groups fetched:", guards);
        setGuardsAndGroups(guards || { default: {} }); // Fallback to empty default
        setStatus((x) => ({
          ...x,
          initialFetchGuardGroupsDone: true,
          guardGroups: false,
        }));
      } catch (e) {
        console.error("Error fetching guard groups: ", e);
        setGuardsAndGroups({ default: {} }); // Fallback on error
        setStatus((x) => ({ ...x, guardGroups: false }));
      }
    })();
  }, [publicKey, nftHoldings, proofMemo, candyMachine]);

  const prices = React.useMemo((): {
    default?: ParsedPricesForUI;
    [k: string]: ParsedPricesForUI;
  } => {
    return Object.entries(guardsAndGroups).reduce(
      (groupPayments, [label, guards]) => {
        return Object.assign(groupPayments, {
          [label]: guardToPaymentUtil(guards),
        });
      },
      {}
    );
  }, [guardsAndGroups]);

  const guardStates = React.useMemo((): {
    default?: GuardGroupStates;
    [k: string]: GuardGroupStates;
  } => {
    return Object.entries(guardsAndGroups).reduce(
      (groupPayments, [label, guards]) =>
        Object.assign(groupPayments, {
          [label]: parseGuardStates({
            guards: guards,
            candyMachine,
            walletAddress: publicKey,
            tokenHoldings,
            balance,
          }),
        }),
      {}
    );
  }, [guardsAndGroups, tokenHoldings, balance, candyMachine, publicKey]);

  React.useEffect(() => {
    console.log({ guardsAndGroups, guardStates, prices });
  }, [guardsAndGroups, guardStates, prices]);

  return {
    candyMachine,
    guards: guardsAndGroups,
    guardStates,
    status,
    items,
    merkles: proofMemo.merkles,
    prices,
    mint,
    refresh,
  };
}