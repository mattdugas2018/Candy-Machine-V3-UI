import {
  callCandyGuardRouteBuilder,
  CandyMachine,
  getMerkleProof,
  getMerkleTree,
  IdentitySigner,
  Metadata,
  Metaplex,
  mintFromCandyMachineBuilder,
  Nft,
  NftWithToken,
  PublicKey,
  Sft,
  SftWithToken,
  TransactionBuilder,
  walletAdapterIdentity,
} from "@metaplex-foundation/js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import React from "react";
import { MerkleTree } from "merkletreejs";
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
  const { publicKey, wallet } = useWallet(); // Use publicKey directly
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

  const mx = React.useMemo(
    () => connection && Metaplex.make(connection),
    [connection]
  );

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
    const merkles: { [k: string]: { tree: MerkleTree; proof: Uint8Array[] } } =
      candyMachineOpts.allowLists.reduce(
        (prev, { groupLabel, list }) =>
          Object.assign(prev, {
            [groupLabel]: {
              tree: getMerkleTree(list),
              proof: getMerkleProof(list, publicKey.toString()),
            },
          }),
        {}
      );
    const verifyProof = (
      merkleRoot: Uint8Array | string,
      label = "default"
    ) => {
      let merkle = merkles[label];
      if (!merkle) return;
      const verifiedProof = !!merkle.proof.length;
      const compareRoot = merkle.tree.getRoot().equals(Buffer.from(merkleRoot));
      return verifiedProof && compareRoot;
    };
    return {
      merkles,
      verifyProof,
    };
  }, [publicKey, candyMachineOpts.allowLists?.length]);

  const fetchCandyMachine = React.useCallback(async () => {
    if (!publicKey) throw new Error("Wallet not loaded yet!");
    return await mx.candyMachines().findByAddress({
      address: new PublicKey(candyMachineId),
    });
  }, [candyMachineId, publicKey]);

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
      if (!guardsAndGroups[opts.groupLabel || "default"])
        throw new Error("Unknown guard group label");

      const allowList = opts.groupLabel &&
        proofMemo.merkles[opts.groupLabel] && {
          proof: proofMemo.merkles[opts.groupLabel].proof,
        };

      let nfts: (Sft | SftWithToken | Nft | NftWithToken)[] = [];
      try {
        if (!candyMachine) throw new Error("Candy Machine not loaded yet!");

        setStatus((x) => ({
          ...x,
          minting: true,
        }));

        const transactionBuilders: TransactionBuilder[] = [];
        if (allowList) {
          if (!proofMemo.merkles[opts.groupLabel || "default"].proof.length)
            throw new Error("User is not in allowed list");

          transactionBuilders.push(
            callCandyGuardRouteBuilder(mx, {
              candyMachine,
              guard: "allowList",
              group: opts.groupLabel,
              settings: {
                path: "proof",
                merkleProof:
                  proofMemo.merkles[opts.groupLabel || "default"].proof,
              },
            })
          );
        }
        for (let index = 0; index < quantityString; index++) {
          transactionBuilders.push(
            await mintFromCandyMachineBuilder(mx, {
              candyMachine,
              collectionUpdateAuthority: candyMachine.authorityAddress,
              group: opts.groupLabel,
              guards: {
                nftBurn: opts.nftGuards && opts.nftGuards[index]?.burn,
                nftPayment: opts.nftGuards && opts.nftGuards[index]?.payment,
                nftGate: opts.nftGuards && opts.nftGuards[index]?.gate,
                allowList,
              },
            })
          );
        }
        const blockhash = await mx.rpc().getLatestBlockhash();

        const transactions = transactionBuilders.map((t) =>
          t.toTransaction(blockhash)
        );
        const signers: { [k: string]: IdentitySigner } = {};
        transactions.forEach((tx, i) => {
          tx.feePayer = publicKey;
          tx.recentBlockhash = blockhash.blockhash;
          transactionBuilders[i].getSigners().forEach((s) => {
            if ("signAllTransactions" in s) signers[s.publicKey.toString()] = s;
            else if ("secretKey" in s) tx.partialSign(s);
            // @ts-ignore
            else if ("_signer" in s) tx.partialSign(s._signer);
          });
        });
        let signedTransactions = transactions;

        for (let signer in signers) {
          await signers[signer].signAllTransactions(transactions);
        }
        if (allowList) {
          const allowListCallGuardRouteTx = signedTransactions.shift();
          const allowListCallGuardRouteTxBuilder = transactionBuilders.shift();
          await mx.rpc().sendAndConfirmTransaction(allowListCallGuardRouteTx, {
            commitment: "processed",
          });
        }
        const output = await Promise.all(
          signedTransactions.map((tx, i) => {
            return mx
              .rpc()
              .sendAndConfirmTransaction(tx, { commitment: "finalized" })
              .then((tx) => ({
                ...tx,
                context: transactionBuilders[i].getContext() as any,
              }));
          })
        );
        nfts = await Promise.all(
          output.map(({ context }) =>
            mx
              .nfts()
              .findByMint({
                mintAddress: context.mintSigner.publicKey,
                tokenAddress: context.tokenAddress,
              })
              .catch((e) => null)
          )
        );
        Object.values(guardsAndGroups).forEach((guards) => {
          if (guards.mintLimit?.mintCounter)
            guards.mintLimit.mintCounter.count += nfts.length;
        });
      } catch (error: any) {
        let message = error.msg || "Minting failed! Please try again!";
        if (!error.msg) {
          if (!error.message) {
            message = "Transaction Timeout! Please try again.";
          } else if (error.message.indexOf("0x138")) {
          } else if (error.message.indexOf("0x137")) {
            message = `SOLD OUT!`;
          } else if (error.message.indexOf("0x135")) {
            message = `Insufficient funds to mint. Please fund your wallet.`;
          }
        } else {
          if (error.code === 311) {
            message = `SOLD OUT!`;
          } else if (error.code === 312) {
            message = `Minting period hasn't started yet.`;
          }
        }
        console.error(error);
        throw new Error(message);
      } finally {
        setStatus((x) => ({ ...x, minting: false }));
        refresh();
        return nfts.filter((a) => a);
      }
    },
    [candyMachine, guardsAndGroups, mx, publicKey, proofMemo, refresh]
  );

  React.useEffect(() => {
    if (!mx || !publicKey) return;
    console.log("useEffect([mx, publicKey])");
    mx.use(walletAdapterIdentity(wallet));

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
        setNftHoldings(x.filter((a) => a.model == "metadata") as any)
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
  }, [mx, publicKey]);

  React.useEffect(() => {
    if (!publicKey) return; // Wait for wallet
    console.log("Fetching Candy Machine...");
    refresh().catch((e) =>
      console.error("Error while fetching candy machine", e)
    );
  }, [refresh, publicKey]);

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
        setGuardsAndGroups(guards);
        setStatus((x) => ({ ...x, initialFetchGuardGroupsDone: true, guardGroups: false }));
      } catch (e) {
        console.error("Error fetching guard groups:", e);
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
  }, [guardsAndGroups, tokenHoldings, balance]);

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