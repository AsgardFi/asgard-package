"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProgramLogs = exports.getTransactionInstructionError = exports.getProgramName = exports.LOADER_IDS = exports.PROGRAM_INFO_BY_ID = exports.PROGRAM_NAMES = void 0;
const anchor_1 = require("@coral-xyz/anchor");
const bytes_1 = require("@coral-xyz/anchor/dist/cjs/utils/bytes");
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("./types");
const idl_1 = require("./idl");
const config_1 = require("./config");
const instructions_1 = __importDefault(require("./instructions"));
const account_1 = require("./models/account");
const mrgn_common_1 = require("@mrgnlabs/mrgn-common");
const group_1 = require("./models/group");
const _1 = require(".");
const wrapper_1 = require("./models/account/wrapper");
const errors_1 = require("./errors");
const axios_1 = __importDefault(require("axios"));
/**
 * Entrypoint to interact with the marginfi contract.
 */
class MarginfiClient {
    // --------------------------------------------------------------------------
    // Factories
    // --------------------------------------------------------------------------
    constructor(config, program, wallet, isReadOnly, group, banks, priceInfos, addressLookupTables, preloadedBankAddresses, bankMetadataMap, sendEndpoint, spamSendTx = true, skipPreflightInSpam = true) {
        this.config = config;
        this.program = program;
        this.wallet = wallet;
        this.isReadOnly = isReadOnly;
        this.bankMetadataMap = bankMetadataMap;
        this.group = group;
        this.banks = banks;
        this.oraclePrices = priceInfos;
        this.addressLookupTables = addressLookupTables ?? [];
        this.preloadedBankAddresses = preloadedBankAddresses;
        this.sendEndpoint = sendEndpoint;
        this.spamSendTx = spamSendTx;
        this.skipPreflightInSpam = skipPreflightInSpam;
    }
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
    static async fetch(config, wallet, connection, clientOptions) {
        const debug = require("debug")("mfi:client");
        debug("Loading Marginfi Client\n\tprogram: %s\n\tenv: %s\n\tgroup: %s\n\turl: %s", config.programId, config.environment, config.groupPk, connection.rpcEndpoint);
        const confirmOpts = clientOptions?.confirmOpts ?? {};
        const readOnly = clientOptions?.readOnly ?? false;
        const sendEndpoint = clientOptions?.sendEndpoint;
        const preloadedBankAddresses = clientOptions?.preloadedBankAddresses;
        const spamSendTx = clientOptions?.spamSendTx ?? false;
        const skipPreflightInSpam = clientOptions?.skipPreflightInSpam ?? false;
        const provider = new anchor_1.AnchorProvider(connection, wallet, {
            ...anchor_1.AnchorProvider.defaultOptions(),
            commitment: connection.commitment ?? anchor_1.AnchorProvider.defaultOptions().commitment,
            ...confirmOpts,
        });
        const program = new anchor_1.Program(idl_1.MARGINFI_IDL, config.programId, provider);
        let bankMetadataMap = undefined;
        try {
            bankMetadataMap = await (0, mrgn_common_1.loadBankMetadatas)();
        }
        catch (error) {
            console.error("Failed to load bank metadatas. Convenience getter by symbol will not be available", error);
        }
        const { marginfiGroup, banks, priceInfos } = await MarginfiClient.fetchGroupData(program, config.groupPk, connection.commitment, preloadedBankAddresses, bankMetadataMap);
        const addressLookupTableAddresses = _1.ADDRESS_LOOKUP_TABLE_FOR_GROUP[config.groupPk.toString()] ?? [];
        debug("Fetching address lookup tables for %s", addressLookupTableAddresses);
        const addressLookupTables = (await Promise.all(addressLookupTableAddresses.map((address) => connection.getAddressLookupTable(address))))
            .map((response) => response.value)
            .filter((table) => table !== null);
        return new MarginfiClient(config, program, wallet, readOnly, marginfiGroup, banks, priceInfos, addressLookupTables, preloadedBankAddresses, bankMetadataMap, sendEndpoint, spamSendTx, skipPreflightInSpam);
    }
    static async fromEnv(overrides) {
        const debug = require("debug")("mfi:client");
        const env = overrides?.env ?? process.env.MARGINFI_ENV;
        const connection = overrides?.connection ??
            new web3_js_1.Connection(process.env.MARGINFI_RPC_ENDPOINT, {
                commitment: mrgn_common_1.DEFAULT_COMMITMENT,
            });
        const programId = overrides?.programId ?? new web3_js_1.PublicKey(process.env.MARGINFI_PROGRAM);
        const groupPk = overrides?.marginfiGroup ??
            (process.env.MARGINFI_GROUP ? new web3_js_1.PublicKey(process.env.MARGINFI_GROUP) : web3_js_1.PublicKey.default);
        const wallet = overrides?.wallet ??
            new mrgn_common_1.NodeWallet(process.env.MARGINFI_WALLET_KEY
                ? web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.MARGINFI_WALLET_KEY)))
                : (0, mrgn_common_1.loadKeypair)(process.env.MARGINFI_WALLET));
        debug("Loading the marginfi client from env vars");
        debug("Env: %s\nProgram: %s\nGroup: %s\nSigner: %s", env, programId, groupPk, wallet.publicKey);
        const config = (0, config_1.getConfig)(env, {
            groupPk: (0, anchor_1.translateAddress)(groupPk),
            programId: (0, anchor_1.translateAddress)(programId),
        });
        return MarginfiClient.fetch(config, wallet, connection, {
            confirmOpts: {
                commitment: connection.commitment,
            },
        });
    }
    // NOTE: 2 RPC calls
    // Pass in bankAddresses to skip the gpa call
    static async fetchGroupData(program, groupAddress, commitment, bankAddresses, bankMetadataMap) {
        const debug = require("debug")("mfi:client");
        // Fetch & shape all accounts of Bank type (~ bank discovery)
        let bankDatasKeyed = [];
        if (bankAddresses && bankAddresses.length > 0) {
            debug("Using preloaded bank addresses, skipping gpa call", bankAddresses.length, "banks");
            let bankAccountsData = await program.account.bank.fetchMultiple(bankAddresses);
            for (let i = 0; i < bankAccountsData.length; i++) {
                if (bankAccountsData[i] !== null) {
                    bankDatasKeyed.push({
                        address: bankAddresses[i],
                        data: bankAccountsData[i],
                    });
                }
            }
        }
        else {
            let bankAccountsData = await program.account.bank.all([
                { memcmp: { offset: 8 + 32 + 1, bytes: groupAddress.toBase58() } },
            ]);
            bankDatasKeyed = bankAccountsData.map((account) => ({
                address: account.publicKey,
                data: account.account,
            }));
        }
        // Batch-fetch the group account and all the oracle accounts as per the banks retrieved above
        const [groupAi, ...priceFeedAis] = await program.provider.connection.getMultipleAccountsInfo([groupAddress, ...bankDatasKeyed.map((b) => b.data.config.oracleKeys[0])], commitment); // NOTE: This will break if/when we start having more than 1 oracle key per bank
        // Unpack raw data for group and oracles, and build the `Bank`s map
        if (!groupAi)
            throw new Error("Failed to fetch the on-chain group data");
        const marginfiGroup = group_1.MarginfiGroup.fromBuffer(groupAddress, groupAi.data);
        debug("Decoding bank data");
        const banks = new Map(bankDatasKeyed.map(({ address, data }) => {
            const bankMetadata = bankMetadataMap ? bankMetadataMap[address.toBase58()] : undefined;
            return [address.toBase58(), _1.Bank.fromAccountParsed(address, data, bankMetadata)];
        }));
        debug("Decoded banks");
        const priceInfos = new Map(bankDatasKeyed.map(({ address: bankAddress, data: bankData }, index) => {
            const priceDataRaw = priceFeedAis[index];
            if (!priceDataRaw)
                throw new Error(`Failed to fetch price oracle account for bank ${bankAddress.toBase58()}`);
            const oracleSetup = (0, _1.parseOracleSetup)(bankData.config.oracleSetup);
            return [bankAddress.toBase58(), (0, _1.parsePriceInfo)(oracleSetup, priceDataRaw.data)];
        }));
        debug("Fetched %s banks and %s price feeds", banks.size, priceInfos.size);
        return {
            marginfiGroup,
            banks,
            priceInfos,
        };
    }
    async reload() {
        const { marginfiGroup, banks, priceInfos } = await MarginfiClient.fetchGroupData(this.program, this.config.groupPk, this.program.provider.connection.commitment, this.preloadedBankAddresses);
        this.group = marginfiGroup;
        this.banks = banks;
        this.oraclePrices = priceInfos;
    }
    // --------------------------------------------------------------------------
    // Attributes
    // --------------------------------------------------------------------------
    get groupAddress() {
        return this.config.groupPk;
    }
    get provider() {
        return this.program.provider;
    }
    get programId() {
        return this.program.programId;
    }
    async getAllMarginfiAccountPubkeys() {
        return (await this.provider.connection.getProgramAccounts(this.programId, {
            filters: [
                {
                    memcmp: {
                        bytes: this.config.groupPk.toBase58(),
                        offset: 8, // marginfiGroup is the first field in the account, so only offset is the discriminant
                    },
                },
            ],
            dataSlice: { offset: 0, length: 0 },
        })).map((a) => a.pubkey);
    }
    /**
     * Fetches multiple marginfi accounts based on an array of public keys using the getMultipleAccounts RPC call.
     *
     * @param pubkeys - The public keys of the marginfi accounts to fetch.
     * @returns An array of MarginfiAccountWrapper instances.
     */
    async getMultipleMarginfiAccounts(pubkeys) {
        require("debug")("mfi:client")("Fetching %s marginfi accounts", pubkeys);
        const accounts = await this.program.account.marginfiAccount.fetchMultiple(pubkeys);
        return accounts.map((account, index) => {
            if (!account) {
                throw new Error(`Account not found for pubkey: ${pubkeys[index].toBase58()}`);
            }
            return wrapper_1.MarginfiAccountWrapper.fromAccountParsed(pubkeys[index], this, account);
        });
    }
    /**
     * Retrieves the addresses of all marginfi accounts in the underlying group.
     *
     * @returns Account addresses
     */
    async getAllMarginfiAccountAddresses() {
        return (await this.program.provider.connection.getProgramAccounts(this.programId, {
            commitment: this.program.provider.connection.commitment,
            dataSlice: {
                offset: 0,
                length: 0,
            },
            filters: [
                {
                    memcmp: {
                        bytes: this.groupAddress.toBase58(),
                        offset: 8, // marginfiGroup is the second field in the account after the authority, so offset by the discriminant and a pubkey
                    },
                },
                {
                    memcmp: {
                        offset: 0,
                        bytes: bytes_1.bs58.encode(anchor_1.BorshAccountsCoder.accountDiscriminator(types_1.AccountType.MarginfiAccount)),
                    },
                },
            ],
        })).map((a) => a.pubkey);
    }
    /**
     * Retrieves all marginfi accounts under the specified authority.
     *
     * @returns MarginfiAccount instances
     */
    async getMarginfiAccountsForAuthority(authority) {
        const _authority = authority ? (0, anchor_1.translateAddress)(authority) : this.provider.wallet.publicKey;
        const marginfiAccounts = (await this.program.account.marginfiAccount.all([
            {
                memcmp: {
                    bytes: this.groupAddress.toBase58(),
                    offset: 8, // marginfiGroup is the first field in the account, so only offset is the discriminant
                },
            },
            {
                memcmp: {
                    bytes: _authority.toBase58(),
                    offset: 8 + 32, // authority is the second field in the account after the authority, so offset by the discriminant and a pubkey
                },
            },
        ])).map((a) => wrapper_1.MarginfiAccountWrapper.fromAccountParsed(a.publicKey, this, a.account));
        marginfiAccounts.sort((accountA, accountB) => {
            const assetsValueA = accountA.computeHealthComponents(account_1.MarginRequirementType.Equity).assets;
            const assetsValueB = accountB.computeHealthComponents(account_1.MarginRequirementType.Equity).assets;
            if (assetsValueA.eq(assetsValueB))
                return 0;
            return assetsValueA.gt(assetsValueB) ? -1 : 1;
        });
        return marginfiAccounts;
    }
    async getMarginfiPdaAccounts(address) {
        // const _authority = authority ? translateAddress(authority) : this.provider.wallet.publicKey;
        const _address = (0, anchor_1.translateAddress)(address);
        const marginfiAccount = await wrapper_1.MarginfiAccountWrapper.fetch(_address, this, 'confirmed');
        return marginfiAccount;
    }
    /**
     * Retrieves the addresses of all accounts owned by the marginfi program.
     *
     * @returns Account addresses
     */
    async getAllProgramAccountAddresses(type) {
        return (await this.program.provider.connection.getProgramAccounts(this.programId, {
            commitment: this.program.provider.connection.commitment,
            dataSlice: {
                offset: 0,
                length: 0,
            },
            filters: [
                {
                    memcmp: {
                        offset: 0,
                        bytes: bytes_1.bs58.encode(anchor_1.BorshAccountsCoder.accountDiscriminator(type)),
                    },
                },
            ],
        })).map((a) => a.pubkey);
    }
    getBankByPk(bankAddress) {
        let _bankAddress = (0, anchor_1.translateAddress)(bankAddress);
        return this.banks.get(_bankAddress.toString()) ?? null;
    }
    getBankByMint(mint) {
        const _mint = (0, anchor_1.translateAddress)(mint);
        return [...this.banks.values()].find((bank) => bank.mint.equals(_mint)) ?? null;
    }
    getBankByTokenSymbol(tokenSymbol) {
        if (tokenSymbol === undefined)
            return null;
        return [...this.banks.values()].find((bank) => bank.tokenSymbol === tokenSymbol) ?? null;
    }
    getOraclePriceByBank(bankAddress) {
        let _bankAddress = (0, anchor_1.translateAddress)(bankAddress);
        return this.oraclePrices.get(_bankAddress.toString()) ?? null;
    }
    // --------------------------------------------------------------------------
    // User actions
    // --------------------------------------------------------------------------
    /**
     * Create transaction instruction to create a new marginfi account under the authority of the user.
     *
     * @returns transaction instruction
     */
    async makeCreateMarginfiAccountIx(marginfiAccountPk) {
        const dbg = require("debug")("mfi:client");
        dbg("Generating marginfi account ix for %s", marginfiAccountPk);
        const initMarginfiAccountIx = await instructions_1.default.makeInitMarginfiAccountIx(this.program, {
            marginfiGroupPk: this.groupAddress,
            marginfiAccountPk,
            authorityPk: this.provider.wallet.publicKey,
            feePayerPk: this.provider.wallet.publicKey,
        });
        const ixs = [initMarginfiAccountIx];
        return {
            instructions: ixs,
            keys: [],
        };
    }
    /**
     * Create a new marginfi account under the authority of the user.
     *
     * @returns MarginfiAccount instance
     */
    async createMarginfiAccount(opts, createOpts) {
        const dbg = require("debug")("mfi:client");
        const accountKeypair = web3_js_1.Keypair.generate();
        const newAccountKey = createOpts?.newAccountKey ?? accountKeypair.publicKey;
        const ixs = await this.makeCreateMarginfiAccountIx(newAccountKey);
        const signers = [...ixs.keys];
        // If there was no newAccountKey provided, we need to sign with the ephemeraKeypair we generated.
        if (!createOpts?.newAccountKey)
            signers.push(accountKeypair);
        const tx = new web3_js_1.Transaction().add(...ixs.instructions);
        const sig = await this.processTransaction(tx, signers, opts);
        dbg("Created Marginfi account %s", sig);
        return opts?.dryRun || createOpts?.newAccountKey
            ? Promise.resolve(undefined)
            : wrapper_1.MarginfiAccountWrapper.fetch(newAccountKey, this, opts?.commitment);
    }
    // --------------------------------------------------------------------------
    // Helpers
    // --------------------------------------------------------------------------
    /**
     * Process a transaction, sign it and send it to the network.
     *
     * @throws ProcessTransactionError
     */
    async processTransaction(transaction, signers, opts, connection_args) {
        let signature = "";
        let versionedTransaction;
        // const connection = new Connection(this.provider.connection.rpcEndpoint, this.provider.opts);
        const connection = connection_args ? connection_args : new web3_js_1.Connection(this.provider.connection.rpcEndpoint, this.provider.opts);
        const sendConnection = this.sendEndpoint ? new web3_js_1.Connection(this.sendEndpoint, this.provider.opts) : connection;
        let minContextSlot;
        let blockhash;
        let lastValidBlockHeight;
        try {
            const getLatestBlockhashAndContext = await connection.getLatestBlockhashAndContext();
            minContextSlot = getLatestBlockhashAndContext.context.slot - 4;
            blockhash = getLatestBlockhashAndContext.value.blockhash;
            lastValidBlockHeight = getLatestBlockhashAndContext.value.lastValidBlockHeight;
            if (transaction instanceof web3_js_1.Transaction) {
                const versionedMessage = new web3_js_1.TransactionMessage({
                    instructions: transaction.instructions,
                    payerKey: this.provider.publicKey,
                    recentBlockhash: blockhash,
                });
                versionedTransaction = new web3_js_1.VersionedTransaction(versionedMessage.compileToV0Message(this.addressLookupTables));
            }
            else {
                versionedTransaction = transaction;
            }
            if (signers)
                versionedTransaction.sign(signers);
        }
        catch (error) {
            console.log("Failed to build the transaction", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.TransactionBuildingError);
        }
        try {
            if (opts?.dryRun || this.isReadOnly) {
                const response = await connection.simulateTransaction(versionedTransaction, opts ?? { minContextSlot, sigVerify: false });
                console.log(response.value.err ? `❌ Error: ${response.value.err}` : `✅ Success - ${response.value.unitsConsumed} CU`);
                console.log("------ Logs 👇 ------");
                if (response.value.logs) {
                    for (const log of response.value.logs) {
                        console.log(log);
                    }
                }
                const signaturesEncoded = encodeURIComponent(JSON.stringify(versionedTransaction.signatures.map((s) => bytes_1.bs58.encode(s))));
                const messageEncoded = encodeURIComponent(Buffer.from(versionedTransaction.message.serialize()).toString("base64"));
                const urlEscaped = `https://explorer.solana.com/tx/inspector?cluster=${this.config.cluster}&signatures=${signaturesEncoded}&message=${messageEncoded}`;
                console.log("------ Inspect 👇 ------");
                console.log(urlEscaped);
                if (response.value.err)
                    throw new web3_js_1.SendTransactionError(JSON.stringify(response.value.err), response.value.logs ?? []);
                return versionedTransaction.signatures[0].toString();
            }
            else {
                versionedTransaction = await this.wallet.signTransaction(versionedTransaction);
                let mergedOpts = {
                    ...mrgn_common_1.DEFAULT_CONFIRM_OPTS,
                    commitment: connection.commitment ?? mrgn_common_1.DEFAULT_CONFIRM_OPTS.commitment,
                    preflightCommitment: connection.commitment ?? mrgn_common_1.DEFAULT_CONFIRM_OPTS.commitment,
                    minContextSlot,
                    ...opts,
                };
                if (this.spamSendTx) {
                    console.log("[in spamSendTx]");
                    let status = "pending";
                    if (this.skipPreflightInSpam) {
                        console.log("[in skipPreflightInSpam]");
                        const response = await connection.simulateTransaction(versionedTransaction, opts ?? { minContextSlot, sigVerify: false });
                        if (response.value.err)
                            throw new web3_js_1.SendTransactionError(JSON.stringify(response.value.err), response.value.logs ?? []);
                    }
                    while (true) {
                        signature = await sendConnection.sendTransaction(versionedTransaction, {
                            // skipPreflight: false,
                            // preflightCommitment: 'finalized',
                            maxRetries: 0
                        });
                        for (let i = 0; i < 5; i++) {
                            const signatureStatus = await connection.getSignatureStatus(signature, {
                                searchTransactionHistory: false,
                            });
                            if (signatureStatus.value?.confirmationStatus === 'finalized') {
                                status = "finalized";
                                break;
                            }
                            await (0, mrgn_common_1.sleep)(200);
                        }
                        let blockHeight = await connection.getBlockHeight();
                        if (blockHeight > lastValidBlockHeight) {
                            throw new errors_1.ProcessTransactionError("Transaction was not confirmed within †he alloted time", errors_1.ProcessTransactionErrorType.TimeoutError);
                        }
                        if (status === "finalized") {
                            break;
                        }
                    }
                }
                else {
                    signature = await connection.sendTransaction(versionedTransaction, {
                        // minContextSlot: mergedOpts.minContextSlot,
                        skipPreflight: mergedOpts.skipPreflight,
                        preflightCommitment: mergedOpts.preflightCommitment,
                        maxRetries: mergedOpts.maxRetries,
                    });
                    await connection.confirmTransaction({
                        blockhash,
                        lastValidBlockHeight,
                        signature,
                    }, 'finalized');
                }
                return signature;
            }
        }
        catch (error) {
            if (error instanceof web3_js_1.SendTransactionError) {
                if (error.logs) {
                    console.log("------ Logs 👇 ------");
                    console.log(error.logs.join("\n"));
                    const errorParsed = (0, errors_1.parseErrorFromLogs)(error.logs, this.config.programId);
                    console.log("Parsed:", errorParsed);
                    throw new errors_1.ProcessTransactionError(errorParsed?.description ?? error.message, errors_1.ProcessTransactionErrorType.SimulationError, error.logs);
                }
            }
            console.log("fallthrough error", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.FallthroughError);
        }
    }
    async signTransaction(transaction, signers, connectionArgs) {
        const connection = connectionArgs
            ? connectionArgs
            : new web3_js_1.Connection(this.provider.connection.rpcEndpoint, this.provider.opts);
        let versionedTransaction;
        let blockhash;
        try {
            const { value: { blockhash: latestBlockhash } } = await connection.getLatestBlockhashAndContext();
            blockhash = latestBlockhash;
            if (transaction instanceof web3_js_1.Transaction) {
                const versionedMessage = new web3_js_1.TransactionMessage({
                    instructions: transaction.instructions,
                    payerKey: this.provider.publicKey,
                    recentBlockhash: blockhash,
                });
                versionedTransaction = new web3_js_1.VersionedTransaction(versionedMessage.compileToV0Message(this.addressLookupTables));
            }
            else {
                versionedTransaction = transaction;
            }
            if (signers) {
                versionedTransaction.sign(signers);
            }
        }
        catch (error) {
            console.error("Failed to build the transaction", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.TransactionBuildingError);
        }
        try {
            versionedTransaction = await this.wallet.signTransaction(versionedTransaction);
            return versionedTransaction;
        }
        catch (error) {
            console.error("Failed to sign the transaction", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.FallthroughError);
        }
    }
    async sendAndConfirmTransaction(versionedTransaction, opts, connectionArgs) {
        const connection = connectionArgs ?? new web3_js_1.Connection(this.provider.connection.rpcEndpoint, this.provider.opts);
        const sendConnection = this.sendEndpoint ? new web3_js_1.Connection(this.sendEndpoint, this.provider.opts) : connection;
        let signature = "";
        let minContextSlot;
        let blockhash;
        let lastValidBlockHeight;
        try {
            const getLatestBlockhashAndContext = await connection.getLatestBlockhashAndContext();
            minContextSlot = getLatestBlockhashAndContext.context.slot - 4;
            blockhash = getLatestBlockhashAndContext.value.blockhash;
            lastValidBlockHeight = getLatestBlockhashAndContext.value.lastValidBlockHeight;
            let mergedOpts = {
                ...mrgn_common_1.DEFAULT_CONFIRM_OPTS,
                commitment: connection.commitment ?? mrgn_common_1.DEFAULT_CONFIRM_OPTS.commitment,
                preflightCommitment: connection.commitment ?? mrgn_common_1.DEFAULT_CONFIRM_OPTS.commitment,
                minContextSlot,
                ...opts,
            };
            console.log(`mergedOpts :: ${JSON.stringify(mergedOpts)}`);
            if (this.spamSendTx) {
                console.log("[in spamSendTx]");
                let status = "pending";
                if (this.skipPreflightInSpam) {
                    console.log("[in skipPreflightInSpam]");
                    const response = await connection.simulateTransaction(versionedTransaction, opts ?? { minContextSlot, sigVerify: false });
                    if (response.value.err) {
                        console.log("error while simulation");
                        throw new web3_js_1.SendTransactionError(JSON.stringify(response.value.err), response.value.logs ?? []);
                    }
                    else {
                        console.log(response.value.logs);
                    }
                    console.log("[DONE skipPreflightInSpam]");
                }
                while (true) {
                    signature = await sendConnection.sendTransaction(versionedTransaction, {
                        // minContextSlot: mergedOpts.minContextSlot,
                        // skipPreflight: this.skipPreflightInSpam || mergedOpts.skipPreflight,
                        skipPreflight: true,
                        // preflightCommitment: 'processed',
                        maxRetries: 0,
                    });
                    console.log("transcation sent.", signature);
                    for (let i = 0; i < 5; i++) {
                        const signatureStatus = await connection.getSignatureStatus(signature, {
                            searchTransactionHistory: false,
                        });
                        console.log("signatureStatus", signatureStatus.value);
                        if (signatureStatus.value?.confirmationStatus === 'processed' || signatureStatus.value?.confirmationStatus === 'confirmed' || signatureStatus.value?.confirmationStatus === 'finalized') {
                            status = "processed";
                            break;
                        }
                        await (0, mrgn_common_1.sleep)(400); // sleep for 400ms
                    } // 1 loop time is 400 * 4 = 800s
                    let blockHeight = await connection.getBlockHeight();
                    if (blockHeight > lastValidBlockHeight) {
                        throw new errors_1.ProcessTransactionError("Transaction was not confirmed within †he alloted time", errors_1.ProcessTransactionErrorType.TimeoutError);
                    }
                    if (status === "processed") {
                        break;
                    }
                }
            }
            else {
                console.log("[Standerd sendTransaction]");
                signature = await connection.sendTransaction(versionedTransaction, {
                    // skipPreflight: true,
                    preflightCommitment: 'processed',
                    // maxRetries: mergedOpts.maxRetries, // if none, RPC will keep re-trying
                });
                console.log("Confirming Transaction ... ");
                await connection.confirmTransaction({
                    blockhash,
                    lastValidBlockHeight,
                    signature,
                }, 'processed');
            }
            return signature;
        }
        catch (error) {
            if (error instanceof web3_js_1.SendTransactionError) {
                if (error.logs) {
                    console.log("------ Logs 👇 ------");
                    console.log(error.logs.join("\n"));
                    const errorParsed = (0, errors_1.parseErrorFromLogs)(error.logs, this.config.programId);
                    console.log("Parsed:", errorParsed);
                    throw new errors_1.ProcessTransactionError(errorParsed?.description ?? error.message, errors_1.ProcessTransactionErrorType.SimulationError, error.logs);
                }
            }
            console.log("fallthrough error", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.FallthroughError);
        }
    }
    async signTranscationJito(jitoTip, // in ui
    tx, luts, signers, priorityFee) {
        console.log(`this.provider.connection.commitment :: ${this.provider.connection.commitment}`);
        const jitoTipInLamport = jitoTip * web3_js_1.LAMPORTS_PER_SOL;
        console.log(`jitoTipInLamport :: ${jitoTipInLamport}`);
        if (jitoTip == 0) {
            throw Error("Jito bundle tip has not been set.");
        }
        if (priorityFee) {
            const priorityFeeMicroLamports = priorityFee * web3_js_1.LAMPORTS_PER_SOL * 1000000;
            console.log(`priorityFeeMicroLamports :: ${priorityFeeMicroLamports}`);
            tx.instructions.unshift(web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: Math.round(priorityFeeMicroLamports),
            }));
        }
        // https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses
        tx.instructions.push(web3_js_1.SystemProgram.transfer({
            fromPubkey: this.provider.publicKey,
            toPubkey: new web3_js_1.PublicKey("DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL" // Jito tip account
            ),
            lamports: jitoTipInLamport, // tip
        }));
        const getLatestBlockhashAndContext = await this.provider.connection.getLatestBlockhashAndContext();
        const minContextSlot = getLatestBlockhashAndContext.context.slot - 4;
        const recentBlockhash = getLatestBlockhashAndContext.value.blockhash;
        let vTx = new web3_js_1.VersionedTransaction(new web3_js_1.TransactionMessage({
            payerKey: this.provider.publicKey,
            recentBlockhash: recentBlockhash,
            instructions: tx.instructions,
        }).compileToV0Message([...(luts ?? [])]));
        if (signers) {
            console.log(`Signing the tx with external signer`);
            vTx.sign(signers);
        }
        // vTx = (await this.wallet.signTransaction(vTx)) as VersionedTransaction;
        // Verify txSize limits
        const totalSize = vTx.message.serialize().length;
        const totalKeys = vTx.message.getAccountKeys({ addressLookupTableAccounts: luts }).length;
        console.log(`tx totalSize :: ${totalSize}`);
        console.log(`tx totalKeys :: ${totalKeys}`);
        if (totalSize > 1232 || totalKeys >= 64) {
            console.log("tx size is too big");
            return false;
        }
        // Time to simulate the tx
        try {
            console.log(`[SIMULATING TRANSACTION]`);
            const messageEncoded = Buffer.from(vTx.message.serialize()).toString("base64");
            console.log(`------ messageEncoded 👇 ------ \n ${messageEncoded}`);
            const txSim = await this.provider.connection.simulateTransaction(vTx, { commitment: 'confirmed', replaceRecentBlockhash: true });
            if (txSim.value.logs === null) {
                throw new Error('Expected to receive logs from simulation');
            }
            if (txSim.value.logs.length === 0 && typeof txSim.value.err === 'string') {
                console.log(`simulation error 👇 /n ${txSim.value.err}`);
                console.log(txSim.value.err);
                throw new Error(`Error while simulating the transaction 👇 /n ${txSim.value.err}`);
            }
            else {
                // Prettify logs
                const logs = parseProgramLogs(txSim.value.logs, txSim.value.err, Cluster.MainnetBeta);
                console.log(`Simulation Logs 👇 \n`);
                logs.map((logMeta, metaKey) => {
                    // const logTexts = logMeta.logs.map(log => log.text);
                    console.log(`==== #${metaKey} Instruction ====`);
                    logMeta.logs.map((log) => {
                        console.log(log.text);
                        if (log.text.includes("Program returned error")) {
                            throw new Error("Error while simulating the transaction");
                        }
                    });
                });
            }
        }
        catch (error) {
            if (error instanceof web3_js_1.SendTransactionError) {
                if (error.logs) {
                    console.log("------ Logs 👇 ------");
                    console.log(error.logs.join("\n"));
                    const errorParsed = (0, errors_1.parseErrorFromLogs)(error.logs, this.config.programId);
                    console.log("Parsed:", errorParsed);
                    throw new errors_1.ProcessTransactionError(errorParsed?.description ?? error.message, errors_1.ProcessTransactionErrorType.SimulationError, error.logs);
                }
            }
            console.log("fallthrough error", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.FallthroughError);
        }
        try {
            vTx = (await this.wallet.signTransaction(vTx));
            return vTx;
        }
        catch (error) {
            console.error("Failed to sign the transaction", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.FallthroughError);
        }
    }
    async sendAndConfirmTrancationJito(tx) {
        let rawTx = tx.serialize();
        const recentBlockhash = await this.provider.connection.getLatestBlockhash();
        const encodedTx = bytes_1.bs58.encode(rawTx);
        const jitoURL = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [encodedTx, {
                    "maxRetries": 0,
                    "skipPreflight": true,
                    "preflightCommitment": "processed"
                }],
        };
        // let txOpts = commitmentConfig(provider.connection.commitment);
        let txSig;
        while (true) {
            try {
                const response = await axios_1.default.post(jitoURL, payload, {
                    headers: { "Content-Type": "application/json" },
                });
                console.log(`JitoResponse :: ${JSON.stringify(response.data)}`);
                txSig = response.data.result;
                console.log(`txSig :: ${txSig}`);
                break; // Exit loop if the request is successful
            }
            catch (error) {
                console.error(`Error: ${error}`);
                console.log("Retrying to send the transaction...");
            }
            console.log("Resending jitobundle");
            await (0, mrgn_common_1.sleep)(500); // Don't spam jito bundle RPC
        }
        // let sentJitoBundle = false
        // // send jito bunle untile it turn, trues
        // try {
        //   const response = await axios.post(jitoURL, payload, {
        //     headers: { "Content-Type": "application/json" },
        //   });
        //   console.log(`JitoResponse :: ${JSON.stringify(response.data)}`)
        //   txSig = response.data.result;
        //   // turn sentJitoBundle to true
        //   console.log(`txSig :: ${txSig}`)
        // } catch (error) {
        //   console.error("Error:", error);
        //   throw new Error("Jito Bundle Error: cannot send.");
        // }
        // // keep repeting
        let currentBlockHeight = await this.provider.connection.getBlockHeight(this.provider.connection.commitment);
        while (currentBlockHeight < recentBlockhash.lastValidBlockHeight) {
            // Keep resending to maximise the chance of confirmation
            const txSigHash = await this.provider.connection.sendRawTransaction(rawTx, {
                skipPreflight: true,
                preflightCommitment: this.provider.connection.commitment,
                maxRetries: 0,
            });
            console.log(txSigHash);
            let signatureStatus = await this.provider.connection.getSignatureStatus(txSig);
            console.log("signatureStatus", signatureStatus.value);
            currentBlockHeight = await this.provider.connection.getBlockHeight(this.provider.connection.commitment);
            if (signatureStatus.value != null) {
                if (signatureStatus.value?.confirmationStatus === 'processed' || signatureStatus.value?.confirmationStatus === 'confirmed' || signatureStatus.value?.confirmationStatus === 'finalized') {
                    return txSig;
                }
            }
            await (0, mrgn_common_1.sleep)(500); // Don't spam the RPC
        }
        throw Error(`Transaction ${txSig} was not confirmed`);
    }
    async simulateTransaction(transaction, accountsToInspect) {
        let versionedTransaction;
        const connection = new web3_js_1.Connection(this.provider.connection.rpcEndpoint, this.provider.opts);
        let blockhash;
        try {
            const getLatestBlockhashAndContext = await connection.getLatestBlockhashAndContext();
            blockhash = getLatestBlockhashAndContext.value.blockhash;
            if (transaction instanceof web3_js_1.Transaction) {
                const versionedMessage = new web3_js_1.TransactionMessage({
                    instructions: transaction.instructions,
                    payerKey: this.provider.publicKey,
                    recentBlockhash: blockhash,
                });
                versionedTransaction = new web3_js_1.VersionedTransaction(versionedMessage.compileToV0Message(this.addressLookupTables));
            }
            else {
                versionedTransaction = transaction;
            }
        }
        catch (error) {
            console.log("Failed to build the transaction", error);
            throw new errors_1.ProcessTransactionError(error.message, errors_1.ProcessTransactionErrorType.TransactionBuildingError);
        }
        try {
            const response = await connection.simulateTransaction(versionedTransaction, {
                sigVerify: false,
                accounts: { encoding: "base64", addresses: accountsToInspect.map((a) => a.toBase58()) },
            });
            if (response.value.err)
                throw new Error(JSON.stringify(response.value.err));
            return response.value.accounts?.map((a) => (a ? Buffer.from(a.data[0], "base64") : null)) ?? [];
        }
        catch (error) {
            console.log(error);
            throw new Error(error);
            throw new Error("Failed to simulate transaction");
        }
    }
}
var PROGRAM_NAMES;
(function (PROGRAM_NAMES) {
    // native built-ins
    PROGRAM_NAMES["ADDRESS_LOOKUP_TABLE"] = "Address Lookup Table Program";
    PROGRAM_NAMES["COMPUTE_BUDGET"] = "Compute Budget Program";
    PROGRAM_NAMES["CONFIG"] = "Config Program";
    PROGRAM_NAMES["STAKE"] = "Stake Program";
    PROGRAM_NAMES["SYSTEM"] = "System Program";
    PROGRAM_NAMES["VOTE"] = "Vote Program";
    // native precompiles
    PROGRAM_NAMES["SECP256K1"] = "Secp256k1 SigVerify Precompile";
    PROGRAM_NAMES["ED25519"] = "Ed25519 SigVerify Precompile";
    // spl
    PROGRAM_NAMES["ASSOCIATED_TOKEN"] = "Associated Token Program";
    PROGRAM_NAMES["ACCOUNT_COMPRESSION"] = "State Compression Program";
    PROGRAM_NAMES["FEATURE_PROPOSAL"] = "Feature Proposal Program";
    PROGRAM_NAMES["LENDING"] = "Lending Program";
    PROGRAM_NAMES["MEMO_1"] = "Memo Program v1";
    PROGRAM_NAMES["MEMO"] = "Memo Program";
    PROGRAM_NAMES["NAME"] = "Name Service Program";
    PROGRAM_NAMES["STAKE_POOL"] = "Stake Pool Program";
    PROGRAM_NAMES["SWAP"] = "Swap Program";
    PROGRAM_NAMES["TOKEN"] = "Token Program";
    PROGRAM_NAMES["TOKEN_2022"] = "Token-2022 Program";
    PROGRAM_NAMES["TOKEN_METADATA"] = "Token Metadata Program";
    PROGRAM_NAMES["TOKEN_VAULT"] = "Token Vault Program";
    // other
    PROGRAM_NAMES["ACUMEN"] = "Acumen Program";
    PROGRAM_NAMES["BREAK_SOLANA"] = "Break Solana Program";
    PROGRAM_NAMES["CHAINLINK_ORACLE"] = "Chainlink OCR2 Oracle Program";
    PROGRAM_NAMES["CHAINLINK_STORE"] = "Chainlink Store Program";
    PROGRAM_NAMES["CLOCKWORK_1"] = "Clockwork Thread Program v1";
    PROGRAM_NAMES["CLOCKWORK_2"] = "Clockwork Thread Program v2";
    PROGRAM_NAMES["MANGO_GOVERNANCE"] = "Mango Governance Program";
    PROGRAM_NAMES["MANGO_ICO"] = "Mango ICO Program";
    PROGRAM_NAMES["MANGO_1"] = "Mango Program v1";
    PROGRAM_NAMES["MANGO_2"] = "Mango Program v2";
    PROGRAM_NAMES["MANGO_3"] = "Mango Program v3";
    PROGRAM_NAMES["MARINADE"] = "Marinade Staking Program";
    PROGRAM_NAMES["MERCURIAL"] = "Mercurial Stable Swap Program";
    PROGRAM_NAMES["METAPLEX"] = "Metaplex Program";
    PROGRAM_NAMES["NFT_AUCTION"] = "NFT Auction Program";
    PROGRAM_NAMES["NFT_CANDY_MACHINE"] = "NFT Candy Machine Program";
    PROGRAM_NAMES["NFT_CANDY_MACHINE_V2"] = "NFT Candy Machine Program V2";
    PROGRAM_NAMES["ORCA_SWAP_1"] = "Orca Swap Program v1";
    PROGRAM_NAMES["ORCA_SWAP_2"] = "Orca Swap Program v2";
    PROGRAM_NAMES["ORCA_AQUAFARM"] = "Orca Aquafarm Program";
    PROGRAM_NAMES["PORT"] = "Port Finance Program";
    PROGRAM_NAMES["PYTH_DEVNET"] = "Pyth Oracle Program";
    PROGRAM_NAMES["PYTH_TESTNET"] = "Pyth Oracle Program";
    PROGRAM_NAMES["PYTH_MAINNET"] = "Pyth Oracle Program";
    PROGRAM_NAMES["QUARRY_MERGE_MINE"] = "Quarry Merge Mine";
    PROGRAM_NAMES["QUARRY_MINE"] = "Quarry Mine";
    PROGRAM_NAMES["QUARRY_MINT_WRAPPER"] = "Quarry Mint Wrapper";
    PROGRAM_NAMES["QUARRY_REDEEMER"] = "Quarry Redeemer";
    PROGRAM_NAMES["QUARRY_REGISTRY"] = "Quarry Registry";
    PROGRAM_NAMES["RAYDIUM_AMM"] = "Raydium AMM Program";
    PROGRAM_NAMES["RAYDIUM_IDO"] = "Raydium IDO Program";
    PROGRAM_NAMES["RAYDIUM_LP_1"] = "Raydium Liquidity Pool Program v1";
    PROGRAM_NAMES["RAYDIUM_LP_2"] = "Raydium Liquidity Pool Program v2";
    PROGRAM_NAMES["RAYDIUM_STAKING"] = "Raydium Staking Program";
    PROGRAM_NAMES["SABER_ROUTER"] = "Saber Router Program";
    PROGRAM_NAMES["SABER_SWAP"] = "Saber Stable Swap Program";
    PROGRAM_NAMES["SERUM_1"] = "Serum Dex Program v1";
    PROGRAM_NAMES["SERUM_2"] = "Serum Dex Program v2";
    PROGRAM_NAMES["SERUM_3"] = "Serum Dex Program v3";
    PROGRAM_NAMES["SERUM_SWAP"] = "Serum Swap Program";
    PROGRAM_NAMES["SERUM_POOL"] = "Serum Pool";
    PROGRAM_NAMES["SOLEND"] = "Solend Program";
    PROGRAM_NAMES["SOLIDO"] = "Lido for Solana Program";
    PROGRAM_NAMES["STEP_SWAP"] = "Step Finance Swap Program";
    PROGRAM_NAMES["SWIM_SWAP"] = "Swim Swap Program";
    PROGRAM_NAMES["SWITCHBOARD"] = "Switchboard Oracle Program";
    PROGRAM_NAMES["WORMHOLE"] = "Wormhole";
    PROGRAM_NAMES["WORMHOLE_CORE"] = "Wormhole Core Bridge";
    PROGRAM_NAMES["WORMHOLE_TOKEN"] = "Wormhole Token Bridge";
    PROGRAM_NAMES["WORMHOLE_NFT"] = "Wormhole NFT Bridge";
    PROGRAM_NAMES["SOLANART"] = "Solanart";
    PROGRAM_NAMES["SOLANART_GO"] = "Solanart - Global offers";
    PROGRAM_NAMES["STEPN_DEX"] = "STEPN Dex";
    PROGRAM_NAMES["OPENBOOK_DEX"] = "OpenBook Dex";
})(PROGRAM_NAMES = exports.PROGRAM_NAMES || (exports.PROGRAM_NAMES = {}));
var Cluster;
(function (Cluster) {
    Cluster[Cluster["MainnetBeta"] = 0] = "MainnetBeta";
    Cluster[Cluster["Testnet"] = 1] = "Testnet";
    Cluster[Cluster["Devnet"] = 2] = "Devnet";
    Cluster[Cluster["Custom"] = 3] = "Custom";
})(Cluster || (Cluster = {}));
const ALL_CLUSTERS = [Cluster.Custom, Cluster.Devnet, Cluster.Testnet, Cluster.MainnetBeta];
const LIVE_CLUSTERS = [Cluster.Devnet, Cluster.Testnet, Cluster.MainnetBeta];
exports.PROGRAM_INFO_BY_ID = {
    '11111111111111111111111111111111': {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.SYSTEM,
    },
    '22Y43yTVxuUkoRKdm9thyRhQ3SdgQS7c7kB6UNCiaczD': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SERUM_SWAP,
    },
    '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.RAYDIUM_LP_2,
    },
    '2rHhojZ7hpu1zA91nvZmT8TqWWvMcKmmNBCr2mKTtMq4': {
        deployments: [Cluster.Devnet],
        name: PROGRAM_NAMES.WORMHOLE_NFT,
    },
    '3XXuUFfweXBwFgFfYaejLvZE4cGZiHgKiGfMtdxNzYmv': {
        deployments: [Cluster.MainnetBeta, Cluster.Devnet],
        name: PROGRAM_NAMES.CLOCKWORK_1,
    },
    '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5': {
        deployments: [Cluster.Devnet],
        name: PROGRAM_NAMES.WORMHOLE_CORE,
    },
    '5ZfZAwP2m93waazg8DkrrVmsupeiPEvaEHowiUP7UAbJ': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SOLANART_GO,
    },
    '5fNfvyp5czQVX77yoACa3JJVEhdRaWjPuazuWgjhTqEH': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MANGO_2,
    },
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.RAYDIUM_AMM,
    },
    '7sPptkymzvayoSbLXzBsXEF8TSf3typNnAWkrKrDizNb': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MANGO_ICO,
    },
    '82yxjeMsvaURa4MbZZ7WZZHfobirZYkH1zF8fmeGtyaQ': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.ORCA_AQUAFARM,
    },
    '8tfDNiaEyrV6Q1U4DEXrEigs9DoDtkugzFbybENEbCDz': {
        deployments: [Cluster.Testnet],
        name: PROGRAM_NAMES.PYTH_TESTNET,
    },
    '9HzJyW1qZsEiSfMUf6L2jo3CcTKAyBmSyKdwQeYisHrC': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.RAYDIUM_IDO,
    },
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.ORCA_SWAP_2,
    },
    '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin': {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SERUM_3,
    },
    // spl
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.ASSOCIATED_TOKEN,
    },
    // native built-ins
    AddressLookupTab1e1111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.ADDRESS_LOOKUP_TABLE,
    },
    BJ3jrUzddfuSrZHXSCxMUUQsjKEyLmuuyZebkcaFp2fg: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SERUM_1,
    },
    BrEAK7zGZ6dM71zUDACDqJnekihmwF15noTddWTsknjC: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.BREAK_SOLANA,
    },
    // other
    C64kTdg1Hzv5KoQmZrQRcm2Qz7PkxtFBgw7EpFhvYn8W: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.ACUMEN,
    },
    CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SOLANART,
    },
    CLoCKyJ6DXBJqqu2VWx9RLbgnwwR6BMHHuyasVmfMzBh: {
        deployments: [Cluster.MainnetBeta, Cluster.Devnet],
        name: PROGRAM_NAMES.CLOCKWORK_2,
    },
    ComputeBudget111111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.COMPUTE_BUDGET,
    },
    Config1111111111111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.CONFIG,
    },
    CrX7kMhLC3cSsXJdT7JDgqrRVWGnUpX3gfEfxxU2NVLi: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SOLIDO,
    },
    Crt7UoUR6QgrFrN7j8rmSQpUTNWNSitSwWvsWGf1qZ5t: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SABER_ROUTER,
    },
    DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe: {
        deployments: [Cluster.Devnet],
        name: PROGRAM_NAMES.WORMHOLE_TOKEN,
    },
    DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.ORCA_SWAP_1,
    },
    Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.STEPN_DEX,
    },
    DtmE9D2CSB4L5D6A15mraeEjrGMm6auWVzgaD8hK2tZM: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SWITCHBOARD,
    },
    EUqojwWA2rd19FZrzeBncJsm38Jm1hEhE3zsmX3bRc2o: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SERUM_2,
    },
    Ed25519SigVerify111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.ED25519,
    },
    EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.RAYDIUM_STAKING,
    },
    Feat1YXHhH6t1juaWF74WLcfv4XoNocjXA6sPWHNgAse: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.FEATURE_PROPOSAL,
    },
    FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.PYTH_MAINNET,
    },
    GqTPL6qRf5aUuqscLh8Rg2HTxPUXfhhAXDptTLhp1t2J: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MANGO_GOVERNANCE,
    },
    HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.CHAINLINK_STORE,
    },
    JD3bq9hGdy38PuWQ4h2YJpELmHVGPPfFSuFkpzAd9zfu: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MANGO_1,
    },
    KeccakSecp256k11111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.SECP256K1,
    },
    LendZqTs7gn5CTSJU1jWKhKuVpjJGom45nnwPb2AMTi: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.LENDING,
    },
    MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MERCURIAL,
    },
    MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MARINADE,
    },
    Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.MEMO_1,
    },
    MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.MEMO,
    },
    Port7uDYB3wk6GJAw4KT1WpTeMtSu9bTcChBHkX2LfR: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.PORT,
    },
    QMMD16kjauP5knBwxNUJRZ1Z5o3deBuFrqVjBVmmqto: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.QUARRY_MERGE_MINE,
    },
    QMNeHCGYnLVDn1icRAfQZpjPLBNkfGbSKRB83G5d8KB: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.QUARRY_MINE,
    },
    QMWoBmAyJLAsA1Lh9ugMTw2gciTihncciphzdNzdZYV: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.QUARRY_MINT_WRAPPER,
    },
    QRDxhMw1P2NEfiw5mYXG79bwfgHTdasY2xNP76XSea9: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.QUARRY_REDEEMER,
    },
    QREGBnEj9Sa5uR91AV8u3FxThgP5ZCvdZUW2bHAkfNc: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.QUARRY_REGISTRY,
    },
    RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.RAYDIUM_LP_1,
    },
    SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.STAKE_POOL,
    },
    SSwpMgqNDsyV7mAgN9ady4bDVu5ySjmmXejXvy2vLt1: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.STEP_SWAP,
    },
    SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SABER_SWAP,
    },
    SWiMDJYFUGj6cPrQ6QYYYWZtvXQdRChSVAygDZDsCHC: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SWIM_SWAP,
    },
    So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SOLEND,
    },
    Stake11111111111111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.STAKE,
    },
    SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.SWAP,
    },
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.TOKEN,
    },
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.TOKEN_2022,
    },
    Vote111111111111111111111111111111111111111: {
        deployments: ALL_CLUSTERS,
        name: PROGRAM_NAMES.VOTE,
    },
    WnFt12ZrnzZrFZkt2xsNsaNWoQribnuQ5B5FrDbwDhD: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.WORMHOLE_NFT,
    },
    WormT3McKhFJ2RkiGpdw9GKvNCrB2aB54gb2uV9MfQC: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.WORMHOLE,
    },
    WvmTNLpGMVbwJVYztYL4Hnsy82cJhQorxjnnXcRm3b6: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.SERUM_POOL,
    },
    auctxRXPeJoc4817jDhf4HbjnhEcr1cCXenosMhK5R8: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.NFT_AUCTION,
    },
    cjg3oHmg9uuPsP8D6g29NWvhySJkdYdAo9D25PRbKXJ: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.CHAINLINK_ORACLE,
    },
    cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK: {
        deployments: [Cluster.Devnet, Cluster.MainnetBeta],
        name: PROGRAM_NAMES.ACCOUNT_COMPRESSION,
    },
    cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.NFT_CANDY_MACHINE_V2,
    },
    cndyAnrLdpjq1Ssp1z8xxDsB8dxe7u4HL5Nxi2K5WXZ: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.NFT_CANDY_MACHINE,
    },
    gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s: {
        deployments: [Cluster.Devnet],
        name: PROGRAM_NAMES.PYTH_DEVNET,
    },
    metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.TOKEN_METADATA,
    },
    mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.MANGO_3,
    },
    namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.NAME,
    },
    p1exdMJcjVao65QdewkaZRUnU6VPSXhus9n2GzWfh98: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.METAPLEX,
    },
    srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.OPENBOOK_DEX,
    },
    vau1zxA2LbssAUEF7Gpw91zMM1LvXrvpzJtmZ58rPsn: {
        deployments: LIVE_CLUSTERS,
        name: PROGRAM_NAMES.TOKEN_VAULT,
    },
    worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.WORMHOLE_CORE,
    },
    wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb: {
        deployments: [Cluster.MainnetBeta],
        name: PROGRAM_NAMES.WORMHOLE_TOKEN,
    },
};
exports.LOADER_IDS = {
    BPFLoader1111111111111111111111111111111111: 'BPF Loader',
    BPFLoader2111111111111111111111111111111111: 'BPF Loader 2',
    BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Upgradeable Loader',
    MoveLdr111111111111111111111111111111111111: 'Move Loader',
    NativeLoader1111111111111111111111111111111: 'Native Loader',
};
function getProgramName(address, cluster) {
    const label = programLabel(address, cluster);
    if (label)
        return label;
    return `Unknown Program (${address})`;
}
exports.getProgramName = getProgramName;
function programLabel(address, cluster) {
    const programInfo = exports.PROGRAM_INFO_BY_ID[address];
    if (programInfo && programInfo.deployments.includes(cluster)) {
        return programInfo.name;
    }
    return exports.LOADER_IDS[address];
}
const instructionErrorMessage = new Map([
    ['GenericError', 'generic instruction error'],
    ['InvalidArgument', 'invalid program argument'],
    ['InvalidInstructionData', 'invalid instruction data'],
    ['InvalidAccountData', 'invalid account data for instruction'],
    ['AccountDataTooSmall', 'account data too small for instruction'],
    ['InsufficientFunds', 'insufficient funds for instruction'],
    ['IncorrectProgramId', 'incorrect program id for instruction'],
    ['MissingRequiredSignature', 'missing required signature for instruction'],
    ['AccountAlreadyInitialized', 'instruction requires an uninitialized account'],
    ['UninitializedAccount', 'instruction requires an initialized account'],
    ['UnbalancedInstruction', 'sum of account balances before and after instruction do not match'],
    ['ModifiedProgramId', 'instruction modified the program id of an account'],
    ['ExternalAccountLamportSpend', 'instruction spent from the balance of an account it does not own'],
    ['ExternalAccountDataModified', 'instruction modified data of an account it does not own'],
    ['ReadonlyLamportChange', 'instruction changed the balance of a read-only account'],
    ['ReadonlyDataModified', 'instruction modified data of a read-only account'],
    ['DuplicateAccountIndex', 'instruction contains duplicate accounts'],
    ['ExecutableModified', 'instruction changed executable bit of an account'],
    ['RentEpochModified', 'instruction modified rent epoch of an account'],
    ['NotEnoughAccountKeys', 'insufficient account keys for instruction'],
    ['AccountDataSizeChanged', 'non-system instruction changed account size'],
    ['AccountNotExecutable', 'instruction expected an executable account'],
    ['AccountBorrowFailed', 'instruction tries to borrow reference for an account which is already borrowed'],
    ['AccountBorrowOutstanding', 'instruction left account with an outstanding borrowed reference'],
    ['DuplicateAccountOutOfSync', 'instruction modifications of multiply-passed account differ'],
    ['Custom', 'custom program error: {0}'],
    ['InvalidError', 'program returned invalid error code'],
    ['ExecutableDataModified', 'instruction changed executable accounts data'],
    ['ExecutableLamportChange', 'instruction changed the balance of a executable account'],
    ['ExecutableAccountNotRentExempt', 'executable accounts must be rent exempt'],
    ['UnsupportedProgramId', 'Unsupported program id'],
    ['CallDepth', 'Cross-program invocation call depth too deep'],
    ['MissingAccount', 'An account required by the instruction is missing'],
    ['ReentrancyNotAllowed', 'Cross-program invocation reentrancy not allowed for this instruction'],
    ['MaxSeedLengthExceeded', 'Length of the seed is too long for address generation'],
    ['InvalidSeeds', 'Provided seeds do not result in a valid address'],
    ['InvalidRealloc', 'Failed to reallocate account data'],
    ['ComputationalBudgetExceeded', 'Computational budget exceeded'],
    ['PrivilegeEscalation', 'Cross-program invocation with unauthorized signer or writable account'],
    ['ProgramEnvironmentSetupFailure', 'Failed to create program execution environment'],
    ['ProgramFailedToComplete', 'Program failed to complete'],
    ['ProgramFailedToCompile', 'Program failed to compile'],
    ['Immutable', 'Account is immutable'],
    ['IncorrectAuthority', 'Incorrect authority provided'],
    ['BorshIoError', 'Failed to serialize or deserialize account data: {0}'],
    ['AccountNotRentExempt', 'An account does not have enough lamports to be rent-exempt'],
    ['InvalidAccountOwner', 'Invalid account owner'],
    ['ArithmeticOverflow', 'Program arithmetic overflowed'],
    ['UnsupportedSysvar', 'Unsupported sysvar'],
    ['IllegalOwner', 'Provided owner is not allowed'],
]);
function getTransactionInstructionError(error) {
    if (!error) {
        return;
    }
    if (typeof error === 'object' && 'InstructionError' in error) {
        const innerError = error['InstructionError'];
        const index = innerError[0];
        const instructionError = innerError[1];
        return {
            index,
            message: getInstructionError(instructionError),
        };
    }
}
exports.getTransactionInstructionError = getTransactionInstructionError;
function getInstructionError(error) {
    let out;
    let value;
    if (typeof error === 'string') {
        const message = instructionErrorMessage.get(error);
        if (message) {
            return message;
        }
    }
    else if ('Custom' in error) {
        out = instructionErrorMessage.get('Custom');
        value = error['Custom'];
    }
    else if ('BorshIoError' in error) {
        out = instructionErrorMessage.get('BorshIoError');
        value = error['BorshIoError'];
    }
    if (out && value) {
        return out.replace('{0}', value);
    }
    return 'Unknown instruction error';
}
function parseProgramLogs(logs, error, cluster) {
    let depth = 0;
    const prettyLogs = [];
    function prefixBuilder(
    // Indent level starts at 1.
    indentLevel) {
        let prefix;
        if (indentLevel <= 0) {
            console.warn(`Tried to build a prefix for a program log at indent level \`${indentLevel}\`. ` +
                'Logs should only ever be built at indent level 1 or higher.');
            prefix = '';
        }
        else {
            prefix = new Array(indentLevel - 1).fill('\u00A0\u00A0').join('');
        }
        return prefix + '> ';
    }
    let prettyError;
    if (error) {
        prettyError = getTransactionInstructionError(error);
    }
    logs.forEach(log => {
        if (log.startsWith('Program log:')) {
            // Use passive tense
            log = log.replace(/Program log: (.*)/g, (match, p1) => {
                return `Program logged: "${p1}"`;
            });
            prettyLogs[prettyLogs.length - 1].logs.push({
                prefix: prefixBuilder(depth),
                style: 'muted',
                text: log,
            });
        }
        else if (log.startsWith('Log truncated')) {
            prettyLogs[prettyLogs.length - 1].truncated = true;
        }
        else {
            const regex = /Program (\w*) invoke \[(\d)\]/g;
            const matches = Array.from(log.matchAll(regex));
            if (matches.length > 0) {
                const programAddress = matches[0][1];
                const programName = getProgramName(programAddress, cluster);
                if (depth === 0) {
                    prettyLogs.push({
                        computeUnits: 0,
                        failed: false,
                        invokedProgram: programAddress,
                        logs: [],
                        truncated: false,
                    });
                }
                else {
                    prettyLogs[prettyLogs.length - 1].logs.push({
                        prefix: prefixBuilder(depth),
                        style: 'info',
                        text: `Program invoked: ${programName}`,
                    });
                }
                depth++;
            }
            else if (log.includes('success')) {
                prettyLogs[prettyLogs.length - 1].logs.push({
                    prefix: prefixBuilder(depth),
                    style: 'success',
                    text: `Program returned success`,
                });
                depth--;
            }
            else if (log.includes('failed')) {
                const instructionLog = prettyLogs[prettyLogs.length - 1];
                instructionLog.failed = true;
                let currText = `Program returned error: "${log.slice(log.indexOf(': ') + 2)}"`;
                // failed to verify log of previous program so reset depth and print full log
                if (log.startsWith('failed')) {
                    depth++;
                    currText = log.charAt(0).toUpperCase() + log.slice(1);
                }
                instructionLog.logs.push({
                    prefix: prefixBuilder(depth),
                    style: 'warning',
                    text: currText,
                });
                depth--;
            }
            else {
                if (depth === 0) {
                    prettyLogs.push({
                        computeUnits: 0,
                        failed: false,
                        invokedProgram: null,
                        logs: [],
                        truncated: false,
                    });
                    depth++;
                }
                // Remove redundant program address from logs
                log = log.replace(/Program \w* consumed (\d*) (.*)/g, (match, p1, p2) => {
                    // Only aggregate compute units consumed from top-level tx instructions
                    // because they include inner ix compute units as well.
                    if (depth === 1) {
                        prettyLogs[prettyLogs.length - 1].computeUnits += Number.parseInt(p1);
                    }
                    return `Program consumed: ${p1} ${p2}`;
                });
                // native program logs don't start with "Program log:"
                prettyLogs[prettyLogs.length - 1].logs.push({
                    prefix: prefixBuilder(depth),
                    style: 'muted',
                    text: log,
                });
            }
        }
    });
    // If the instruction's simulation returned an error without any logs then add an empty log entry for Runtime error
    // For example BpfUpgradableLoader fails without returning any logs for Upgrade instruction with buffer that doesn't exist
    if (prettyError && prettyLogs.length === 0) {
        prettyLogs.push({
            computeUnits: 0,
            failed: true,
            invokedProgram: null,
            logs: [],
            truncated: false,
        });
    }
    if (prettyError && prettyError.index === prettyLogs.length - 1) {
        const failedIx = prettyLogs[prettyError.index];
        if (!failedIx.failed) {
            failedIx.failed = true;
            failedIx.logs.push({
                prefix: prefixBuilder(1),
                style: 'warning',
                text: `Runtime error: ${prettyError.message}`,
            });
        }
    }
    return prettyLogs;
}
exports.parseProgramLogs = parseProgramLogs;
exports.default = MarginfiClient;
