import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Paper, Snackbar } from "@material-ui/core";
import Alert from "@material-ui/lab/Alert";
import { DefaultCandyGuardRouteSettings, Nft } from "@metaplex-foundation/js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import confetti from "canvas-confetti";
import Link from "next/link";
import Countdown from "react-countdown";
import styled from "styled-components";
import { GatewayProvider } from "@civic/solana-gateway-react";
import { defaultGuardGroup, network } from "./config";
import { MultiMintButton } from "./MultiMintButton";
import {
  Heading,
  Hero,
  MintCount,
  NftWrapper,
  NftWrapper2,
  Root,
  StyledContainer,
} from "./styles";
import { AlertState } from "./utils";
import NftsModal from "./NftsModal";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import useCandyMachineV3 from "./hooks/useCandyMachineV3";
import {
  CustomCandyGuardMintSettings,
  NftPaymentMintSettings,
  ParsedPricesForUI,
} from "./hooks/types";
import { guardToLimitUtil } from "./hooks/utils";
import Image from "next/image";

const Header = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
`;
const WalletContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: right;
  margin: 30px;
  z-index: 999;
  position: relative;

  .wallet-adapter-dropdown-list {
    background: #ffffff;
  }
  .wallet-adapter-dropdown-list-item {
    background: #000000;
  }
  .wallet-adapter-dropdown-list {
    grid-row-gap: 5px;
  }
`;

const WalletAmount = styled.div`
  color: black;
  width: auto;
  padding: 5px 5px 5px 16px;
  min-width: 48px;
  min-height: auto;
  border-radius: 5px;
  background-color: #85b1e2;
  box-shadow: 0px 3px 5px -1px rgb(0 0 0 / 20%),
    0px 6px 10px 0px rgb(0 0 0 / 14%), 0px 1px 18px 0px rgb(0 0 0 / 12%);
  box-sizing: border-box;
  transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,
    box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,
    border 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;
  font-weight: 500;
  line-height: 1.75;
  text-transform: uppercase;
  border: 0;
  margin: 0;
  display: inline-flex;
  outline: 0;
  position: relative;
  align-items: center;
  user-select: none;
  vertical-align: middle;
  justify-content: flex-start;
  gap: 10px;
`;

const Wallet = styled.ul`
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
`;

const ConnectButton = styled(WalletMultiButton)`
  border-radius: 5px !important;
  padding: 6px 16px;
  background-color: #fff;
  color: #000;
  margin: 0 auto;
`;

const Card = styled(Paper)`
  display: inline-block;
  background-color: var(--countdown-background-color) !important;
  margin: 5px;
  min-width: 40px;
  padding: 24px;
  h1 {
    margin: 0px;
  }
`;

export interface HomeProps {
  candyMachineId: PublicKey;
}
const candyMachinOps = {};
const Home = (props: HomeProps) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const candyMachineV3 = useCandyMachineV3(
    props.candyMachineId,
    candyMachinOps
  );

  const [balance, setBalance] = useState<number>();
  const [mintedItems, setMintedItems] = useState<Nft[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
    severity: undefined,
  });

  const { guardLabel, guards, guardStates, prices } = useMemo(() => {
    const guardLabel = defaultGuardGroup; // Should be "default"
    console.log("Selected guard label:", guardLabel); // Debug
    return {
      guardLabel,
      guards:
        candyMachineV3.guards[guardLabel] ||
        candyMachineV3.guards.default ||
        {},
      guardStates:
        candyMachineV3.guardStates[guardLabel] ||
        candyMachineV3.guardStates.default || {
          isStarted: true,
          isEnded: false,
          isLimitReached: false,
          canPayFor: 10,
          messages: [],
          isWalletWhitelisted: true,
          hasGatekeeper: false,
        },
      prices:
        candyMachineV3.prices[guardLabel] ||
        candyMachineV3.prices.default || {
          payment: [],
          burn: [],
          gate: [],
        },
    };
  }, [
    candyMachineV3.guards,
    candyMachineV3.guardStates,
    candyMachineV3.prices,
  ]);

  const throwConfetti = useCallback(() => {
    confetti({
      particleCount: 400,
      spread: 70,
      origin: { y: 0.6 },
    });
  }, []);

  useEffect(() => {
    if (mintedItems?.length > 0) throwConfetti();
  }, [mintedItems, throwConfetti]);

  const openOnSolscan = useCallback((mint: string) => {
    window.open(
      `https://solscan.io/address/${mint}${
        [WalletAdapterNetwork.Devnet, WalletAdapterNetwork.Testnet].includes(
          network
        )
          ? `?cluster=${network}`
          : ""
      }`
    );
  }, []);

  const startMint = useCallback(
    async (quantityString: number = 1) => {
      if (!wallet.publicKey || !candyMachineV3) {
        setAlertState({
          open: true,
          message: "Wallet or Candy Machine not ready!",
          severity: "error",
        });
        return;
      }

      if (!guardStates.isStarted) {
        setAlertState({
          open: true,
          message: "Mint has not started yet!",
          severity: "error",
        });
        return;
      }

      if (!guardStates.canPayFor) {
        setAlertState({
          open: true,
          message: "Cannot pay for the mint!",
          severity: "error",
        });
        return;
      }

      if (!candyMachineV3.items.remaining) {
        setAlertState({
          open: true,
          message: "Sold out!",
          severity: "error",
        });
        return;
      }

      if (retryCount < 3) {
        try {
          console.log("Mint Parameters:", { quantityString });
          console.log("Candy Machine State:", {
            items: candyMachineV3.items,
            status: candyMachineV3.status,
          });

          const items = await candyMachineV3.mint(quantityString, {});
          setMintedItems(items as any);
        } catch (e) {
          if (e.message.includes("429")) {
            setRetryCount(retryCount + 1);
            setAlertState({
              open: true,
              message: `RPC rate limit hit. Retrying (${retryCount + 1}/3)...`,
              severity: "warning",
            });
            setTimeout(() => startMint(quantityString), 2000);
          } else {
            setAlertState({
              open: true,
              message: e.message,
              severity: "error",
            });
          }
        }
      } else {
        setAlertState({
          open: true,
          message: "Max retries reached. Check RPC or try later.",
          severity: "error",
        });
      }
    },
    [candyMachineV3, wallet, retryCount, guardStates]
  );

  useEffect(() => {
    console.log("Guard Label:", guardLabel);
    console.log("Guard States:", { ...guardStates });
    console.log("Candy Machine:", {
      items: candyMachineV3.items,
      status: candyMachineV3.status,
    });
    console.log("Wallet Adapter:", {
      publicKey: wallet.publicKey?.toBase58(),
      signTransaction: wallet.signTransaction ? "Available" : "Unavailable",
    });
    console.log({ guards, guardStates, prices });
  }, [
    guardLabel,
    guards,
    guardStates,
    prices,
    wallet,
    candyMachineV3.items,
    candyMachineV3.status,
  ]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (wallet?.publicKey && mounted) {
        const balance = await connection.getBalance(wallet.publicKey);
        if (mounted) setBalance(balance / LAMPORTS_PER_SOL);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [wallet, connection]);

  useEffect(() => {
    console.log({ candyMachine: candyMachineV3.candyMachine });
  }, [candyMachineV3.candyMachine]);

  const MintButton = ({
    gatekeeperNetwork,
  }: {
    gatekeeperNetwork?: PublicKey;
  }) => (
    <MultiMintButton
      candyMachine={candyMachineV3.candyMachine}
      gatekeeperNetwork={gatekeeperNetwork}
      isMinting={candyMachineV3.status.minting}
      setIsMinting={() => {}}
      isActive={!!candyMachineV3.items.remaining}
      isEnded={guardStates.isEnded}
      isSoldOut={!candyMachineV3.items.remaining}
      guardStates={guardStates}
      onMint={startMint}
      prices={prices}
    />
  );

  return (
    <main>
      <>
        <Header>
          <WalletContainer>
            <Wallet>
              {wallet ? (
                <WalletAmount>
                  {(balance || 0).toLocaleString()} SOL
                  <ConnectButton />
                </WalletAmount>
              ) : (
                <ConnectButton>Connect Wallet</ConnectButton>
              )}
            </Wallet>
          </WalletContainer>
        </Header>
        <Root>
          <div className="cloud-content">
            {[...Array(7)].map((cloud, index) => (
              <div key={index} className={`cloud-${index + 1} cloud-block`}>
                <div className="cloud"></div>
              </div>
            ))}
          </div>
          <StyledContainer>
            <Hero>
              <Heading>
                <Link href="/">
                  <Image
                    style={{
                      maxWidth: "350px",
                    }}
                    src="/logo.png"
                    alt="logo"
                    width={350}
                    height={350}
                  />
                </Link>
              </Heading>

              <p>
                Welcome to The Anarchists Collection: the official NFT collection of Anarchy on Solana!
              </p>

              <p>
                Join our Telegram: AnarchySafeZone, and follow AnarchyOnSol on X!
              </p>

              <p>
                Total number of NFTs available - 500:<br />
                -15 Anarchist<br />
                -35 Exalted<br />
                -50 Cybernetic<br />
                -75 Rare<br />
                -125 Uncommon<br />
                -200 Common
              </p>

              <p>
                40% of mint proceeds (0.16 SOL per mint) split: 0.10 SOL burns Anarchy tokens, 0.06 SOL boosts the community fund for development and ads.
              </p>

              <p>
                40% of 5% royalties (2% of each sale) split: 1.5% burns Anarchy, 0.5% supports the community fund.
              </p>

              <p>
                This ensures that even long after the collection has been fully minted, the collection will perpetually burn Anarchy and contribute to the community fund, benefiting all Anarchy holders.
              </p>

              {guardStates.isStarted && (
                <MintCount>
                  Total Minted : {candyMachineV3.items.redeemed}/
                  {candyMachineV3.items.available}{" "}
                  {(guards?.mintLimit?.mintCounter?.count ||
                    guards?.mintLimit?.settings?.limit) && (
                    <>
                      ({guards?.mintLimit?.mintCounter?.count || "0"}
                      {guards?.mintLimit?.settings?.limit && (
                        <>/{guards?.mintLimit?.settings?.limit} </>
                      )}
                      by you)
                    </>
                  )}
                </MintCount>
              )}

              {!guardStates.isStarted ? (
                <Countdown
                  date={guards.startTime}
                  renderer={renderGoLiveDateCounter}
                  onComplete={() => {
                    if (candyMachineV3) candyMachineV3.refresh();
                  }}
                />
              ) : !wallet?.publicKey ? (
                <ConnectButton>Connect Wallet</ConnectButton>
              ) : !guardStates.isWalletWhitelisted ? (
                <h1>Mint is private.</h1>
              ) : (
                <>
                  {!!candyMachineV3.items.remaining &&
                  guardStates.hasGatekeeper &&
                  wallet.publicKey &&
                  wallet.signTransaction ? (
                    <GatewayProvider
                      wallet={{
                        publicKey: wallet.publicKey,
                        //@ts-ignore
                        signTransaction: wallet.signTransaction,
                      }}
                      gatekeeperNetwork={guards.gatekeeperNetwork}
                      connection={connection}
                      cluster={
                        process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet"
                      }
                      options={{ autoShowModal: false }}
                    >
                      <MintButton
                        gatekeeperNetwork={guards.gatekeeperNetwork}
                      />
                    </GatewayProvider>
                  ) : (
                    <MintButton />
                  )}
                </>
              )}
            </Hero>
            <NftsModal
              openOnSolscan={openOnSolscan}
              mintedItems={mintedItems || []}
              setMintedItems={setMintedItems}
            />
          </StyledContainer>
          <NftWrapper>
            <div className="marquee-wrapper">
              <div className="marquee">
                {[...Array(21)].map((item, index) => (
                  <Image
                    key={index}
                    src={`/nfts/${index + 1}.jpeg`}
                    height={200}
                    width={200}
                    alt=""
                  />
                ))}
              </div>
            </div>
          </NftWrapper>
          <NftWrapper2>
            <div className="marquee-wrapper second">
              <div className="marquee">
                {[...Array(21)].map((item, index) => (
                  <Image
                    key={index}
                    src={`/nfts/${index + 1}.jpeg`}
                    height={200}
                    width={200}
                    alt=""
                  />
                ))}
              </div>
            </div>
          </NftWrapper2>
        </Root>
      </>
      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </main>
  );
};

export default Home;

const renderGoLiveDateCounter = ({ days, hours, minutes, seconds }: any) => {
  return (
    <div>
      <Card elevation={1}>
        <h1>{days}</h1>Days
      </Card>
      <Card elevation={1}>
        <h1>{hours}</h1>
        Hours
      </Card>
      <Card elevation={1}>
        <h1>{minutes}</h1>Mins
      </Card>
      <Card elevation={1}>
        <h1>{seconds}</h1>Secs
      </Card>
    </div>
  );
};