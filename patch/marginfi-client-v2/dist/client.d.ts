/// <reference types="node" />
import { Address, AnchorProvider } from "@coral-xyz/anchor";
import { AddressLookupTableAccount, Commitment, ConfirmOptions, Connection, PublicKey, Signer, Transaction, TransactionError, TransactionSignature, VersionedTransaction } from "@solana/web3.js";
import { AccountType, Environment, MarginfiConfig, MarginfiProgram } from "./types";
import { BankMetadataMap, InstructionsWrapper, TransactionOptions, Wallet } from "@mrgnlabs/mrgn-common";
import { MarginfiGroup } from "./models/group";
import { Bank, OraclePrice } from ".";
import { MarginfiAccountWrapper } from "./models/account/wrapper";
export type BankMap = Map<string, Bank>;
export type OraclePriceMap = Map<string, OraclePrice>;
export type MarginfiClientOptions = {
    confirmOpts?: ConfirmOptions;
    readOnly?: boolean;
    sendEndpoint?: string;
    spamSendTx?: boolean;
    skipPreflightInSpam?: boolean;
    preloadedBankAddresses?: PublicKey[];
};
/**
 * Entrypoint to interact with the marginfi contract.
 */
declare class MarginfiClient {
    readonly config: MarginfiConfig;
    readonly program: MarginfiProgram;
    readonly wallet: Wallet;
    readonly isReadOnly: boolean;
    readonly bankMetadataMap?: BankMetadataMap | undefined;
    group: MarginfiGroup;
    banks: BankMap;
    oraclePrices: OraclePriceMap;
    addressLookupTables: AddressLookupTableAccount[];
    private preloadedBankAddresses?;
    private sendEndpoint?;
    private spamSendTx;
    private skipPreflightInSpam;
    constructor(config: MarginfiConfig, program: MarginfiProgram, wallet: Wallet, isReadOnly: boolean, group: MarginfiGroup, banks: BankMap, priceInfos: OraclePriceMap, addressLookupTables?: AddressLookupTableAccount[], preloadedBankAddresses?: PublicKey[], bankMetadataMap?: BankMetadataMap | undefined, sendEndpoint?: string, spamSendTx?: boolean, skipPreflightInSpam?: boolean);
    /**
     * MarginfiClient factory
     *
     * Fetch account data according to the config and instantiate the corresponding MarginfiAccount.
     *
     * @param config marginfi config
     * @param wallet User wallet (used to pay fees and sign transactions)
     * @param connection Solana web.js Connection object
     * @returns MarginfiClient instance
     */
    static fetch(config: MarginfiConfig, wallet: Wallet, connection: Connection, clientOptions?: MarginfiClientOptions): Promise<MarginfiClient>;
    static fromEnv(overrides?: Partial<{
        env: Environment;
        connection: Connection;
        programId: Address;
        marginfiGroup: Address;
        wallet: Wallet;
    }>): Promise<MarginfiClient>;
    static fetchGroupData(program: MarginfiProgram, groupAddress: PublicKey, commitment?: Commitment, bankAddresses?: PublicKey[], bankMetadataMap?: BankMetadataMap): Promise<{
        marginfiGroup: MarginfiGroup;
        banks: Map<string, Bank>;
        priceInfos: Map<string, OraclePrice>;
    }>;
    reload(): Promise<void>;
    get groupAddress(): PublicKey;
    get provider(): AnchorProvider;
    get programId(): PublicKey;
    getAllMarginfiAccountPubkeys(): Promise<PublicKey[]>;
    /**
     * Fetches multiple marginfi accounts based on an array of public keys using the getMultipleAccounts RPC call.
     *
     * @param pubkeys - The public keys of the marginfi accounts to fetch.
     * @returns An array of MarginfiAccountWrapper instances.
     */
    getMultipleMarginfiAccounts(pubkeys: PublicKey[]): Promise<MarginfiAccountWrapper[]>;
    /**
     * Retrieves the addresses of all marginfi accounts in the underlying group.
     *
     * @returns Account addresses
     */
    getAllMarginfiAccountAddresses(): Promise<PublicKey[]>;
    /**
     * Retrieves all marginfi accounts under the specified authority.
     *
     * @returns MarginfiAccount instances
     */
    getMarginfiAccountsForAuthority(authority?: Address): Promise<MarginfiAccountWrapper[]>;
    getMarginfiPdaAccounts(address: Address): Promise<MarginfiAccountWrapper>;
    /**
     * Retrieves the addresses of all accounts owned by the marginfi program.
     *
     * @returns Account addresses
     */
    getAllProgramAccountAddresses(type: AccountType): Promise<PublicKey[]>;
    getBankByPk(bankAddress: Address): Bank | null;
    getBankByMint(mint: Address): Bank | null;
    getBankByTokenSymbol(tokenSymbol: string): Bank | null;
    getOraclePriceByBank(bankAddress: Address): OraclePrice | null;
    /**
     * Create transaction instruction to create a new marginfi account under the authority of the user.
     *
     * @returns transaction instruction
     */
    makeCreateMarginfiAccountIx(marginfiAccountPk: PublicKey): Promise<InstructionsWrapper>;
    /**
     * Create a new marginfi account under the authority of the user.
     *
     * @returns MarginfiAccount instance
     */
    createMarginfiAccount(opts?: TransactionOptions, createOpts?: {
        newAccountKey?: PublicKey | undefined;
    }): Promise<MarginfiAccountWrapper>;
    /**
     * Process a transaction, sign it and send it to the network.
     *
     * @throws ProcessTransactionError
     */
    processTransaction(transaction: Transaction | VersionedTransaction, signers?: Array<Signer>, opts?: TransactionOptions, connection_args?: Connection): Promise<TransactionSignature>;
    signTransaction(transaction: Transaction | VersionedTransaction, signers?: Array<Signer>, connectionArgs?: Connection): Promise<VersionedTransaction>;
    sendAndConfirmTransaction(versionedTransaction: VersionedTransaction, opts?: TransactionOptions, connectionArgs?: Connection): Promise<TransactionSignature>;
    signTranscationJito(jitoTip: number, // in ui
    tx: Transaction, luts?: AddressLookupTableAccount[], signers?: Array<Signer>, priorityFee?: number): Promise<false | VersionedTransaction>;
    sendAndConfirmTrancationJito(tx: VersionedTransaction): Promise<string>;
    simulateTransaction(transaction: Transaction | VersionedTransaction, accountsToInspect: PublicKey[]): Promise<(Buffer | null)[]>;
}
export type LogMessage = {
    text: string;
    prefix: string;
    style: 'muted' | 'info' | 'success' | 'warning';
};
export type InstructionLogs = {
    invokedProgram: string | null;
    logs: LogMessage[];
    computeUnits: number;
    truncated: boolean;
    failed: boolean;
};
export type ProgramInfo = {
    name: string;
    deployments: Cluster[];
};
export declare enum PROGRAM_NAMES {
    ADDRESS_LOOKUP_TABLE = "Address Lookup Table Program",
    COMPUTE_BUDGET = "Compute Budget Program",
    CONFIG = "Config Program",
    STAKE = "Stake Program",
    SYSTEM = "System Program",
    VOTE = "Vote Program",
    SECP256K1 = "Secp256k1 SigVerify Precompile",
    ED25519 = "Ed25519 SigVerify Precompile",
    ASSOCIATED_TOKEN = "Associated Token Program",
    ACCOUNT_COMPRESSION = "State Compression Program",
    FEATURE_PROPOSAL = "Feature Proposal Program",
    LENDING = "Lending Program",
    MEMO_1 = "Memo Program v1",
    MEMO = "Memo Program",
    NAME = "Name Service Program",
    STAKE_POOL = "Stake Pool Program",
    SWAP = "Swap Program",
    TOKEN = "Token Program",
    TOKEN_2022 = "Token-2022 Program",
    TOKEN_METADATA = "Token Metadata Program",
    TOKEN_VAULT = "Token Vault Program",
    ACUMEN = "Acumen Program",
    BREAK_SOLANA = "Break Solana Program",
    CHAINLINK_ORACLE = "Chainlink OCR2 Oracle Program",
    CHAINLINK_STORE = "Chainlink Store Program",
    CLOCKWORK_1 = "Clockwork Thread Program v1",
    CLOCKWORK_2 = "Clockwork Thread Program v2",
    MANGO_GOVERNANCE = "Mango Governance Program",
    MANGO_ICO = "Mango ICO Program",
    MANGO_1 = "Mango Program v1",
    MANGO_2 = "Mango Program v2",
    MANGO_3 = "Mango Program v3",
    MARINADE = "Marinade Staking Program",
    MERCURIAL = "Mercurial Stable Swap Program",
    METAPLEX = "Metaplex Program",
    NFT_AUCTION = "NFT Auction Program",
    NFT_CANDY_MACHINE = "NFT Candy Machine Program",
    NFT_CANDY_MACHINE_V2 = "NFT Candy Machine Program V2",
    ORCA_SWAP_1 = "Orca Swap Program v1",
    ORCA_SWAP_2 = "Orca Swap Program v2",
    ORCA_AQUAFARM = "Orca Aquafarm Program",
    PORT = "Port Finance Program",
    PYTH_DEVNET = "Pyth Oracle Program",
    PYTH_TESTNET = "Pyth Oracle Program",
    PYTH_MAINNET = "Pyth Oracle Program",
    QUARRY_MERGE_MINE = "Quarry Merge Mine",
    QUARRY_MINE = "Quarry Mine",
    QUARRY_MINT_WRAPPER = "Quarry Mint Wrapper",
    QUARRY_REDEEMER = "Quarry Redeemer",
    QUARRY_REGISTRY = "Quarry Registry",
    RAYDIUM_AMM = "Raydium AMM Program",
    RAYDIUM_IDO = "Raydium IDO Program",
    RAYDIUM_LP_1 = "Raydium Liquidity Pool Program v1",
    RAYDIUM_LP_2 = "Raydium Liquidity Pool Program v2",
    RAYDIUM_STAKING = "Raydium Staking Program",
    SABER_ROUTER = "Saber Router Program",
    SABER_SWAP = "Saber Stable Swap Program",
    SERUM_1 = "Serum Dex Program v1",
    SERUM_2 = "Serum Dex Program v2",
    SERUM_3 = "Serum Dex Program v3",
    SERUM_SWAP = "Serum Swap Program",
    SERUM_POOL = "Serum Pool",
    SOLEND = "Solend Program",
    SOLIDO = "Lido for Solana Program",
    STEP_SWAP = "Step Finance Swap Program",
    SWIM_SWAP = "Swim Swap Program",
    SWITCHBOARD = "Switchboard Oracle Program",
    WORMHOLE = "Wormhole",
    WORMHOLE_CORE = "Wormhole Core Bridge",
    WORMHOLE_TOKEN = "Wormhole Token Bridge",
    WORMHOLE_NFT = "Wormhole NFT Bridge",
    SOLANART = "Solanart",
    SOLANART_GO = "Solanart - Global offers",
    STEPN_DEX = "STEPN Dex",
    OPENBOOK_DEX = "OpenBook Dex"
}
declare enum Cluster {
    MainnetBeta = 0,
    Testnet = 1,
    Devnet = 2,
    Custom = 3
}
export declare const PROGRAM_INFO_BY_ID: {
    [address: string]: ProgramInfo;
};
export declare const LOADER_IDS: {
    [key: string]: string;
};
export declare function getProgramName(address: string, cluster: Cluster): string;
export type ProgramErrorx = {
    index: number;
    message: string;
};
export declare function getTransactionInstructionError(error?: TransactionError | null): ProgramErrorx | undefined;
export declare function parseProgramLogs(logs: string[], error: TransactionError | null, cluster: Cluster): InstructionLogs[];
export default MarginfiClient;
//# sourceMappingURL=client.d.ts.map