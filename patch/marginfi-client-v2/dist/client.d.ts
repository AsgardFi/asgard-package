/// <reference types="node" />
import { Address, AnchorProvider } from "@coral-xyz/anchor";
import { AddressLookupTableAccount, Commitment, ConfirmOptions, Connection, PublicKey, Signer, Transaction, TransactionSignature, VersionedTransaction } from "@solana/web3.js";
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
    processTrancationJito(jitoTip: number, // in ui
    tx: Transaction, luts?: AddressLookupTableAccount[], priorityFee?: number): Promise<string | false>;
    simulateTransaction(transaction: Transaction | VersionedTransaction, accountsToInspect: PublicKey[]): Promise<(Buffer | null)[]>;
}
export default MarginfiClient;
//# sourceMappingURL=client.d.ts.map