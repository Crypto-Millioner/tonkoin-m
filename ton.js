const TonWeb = require('tonweb');
const db = require('./database');
require('dotenv').config();

class TonHelper {
    constructor() {
        try {
            this.tonweb = new TonWeb(new TonWeb.HttpProvider(
                'https://toncenter.com/api/v2/jsonRPC',
                { apiKey: process.env.TON_API_KEY }
            ));
            this.wallet = null;
            this.initializeAttempts = 0;
        } catch (e) {
            console.error('TON Helper initialization error:', e);
            throw new Error('Failed to initialize TON provider');
        }
    }

    async initializeWallet() {
        try {
            if (!process.env.TON_MNEMONIC) {
                throw new Error('Mnemonic phrase not found in .env');
            }

            const words = process.env.TON_MNEMONIC.trim().split(/\s+/);
            if (![12, 18, 24].includes(words.length)) {
                throw new Error(`Invalid mnemonic length: ${words.length} words (expected 12, 18 or 24)`);
            }

            const seed = await TonWeb.utils.mnemonicToSeed(words);
            const keyPair = TonWeb.utils.nacl.sign.keyPair.fromSeed(seed);
            
            this.wallet = new TonWeb.wallet.all.v3R2(this.tonweb.provider, {
                publicKey: keyPair.publicKey,
                wc: 0
            });

            // Проверяем, что кошелек работает
            const seqno = await this.wallet.methods.seqno().call();
            if (seqno === null && this.initializeAttempts < 3) {
                this.initializeAttempts++;
                throw new Error('Wallet seqno is null');
            }

            console.log('TON Wallet initialized successfully');
            console.log('Wallet address:', await this.getAddress());
            return true;
        } catch (e) {
            console.error('Wallet initialization error:', e.message);
            
            if (this.initializeAttempts < 3) {
                this.initializeAttempts++;
                console.log(`Retrying initialization (attempt ${this.initializeAttempts})...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.initializeWallet();
            }
            
            throw new Error('Failed to initialize TON wallet after 3 attempts');
        }
    }

    async getAddress() {
        if (!this.wallet) await this.initializeWallet();
        const address = await this.wallet.getAddress();
        return address.toString(true, true, true);
    }

    async checkPayment(address, amount, comment) {
    try {
        // Нормализация параметров
        const checkAddress = address.toString().trim();
        const checkAmount = parseFloat(amount);
        const checkComment = comment.toString().trim();

        // Проверка баланса сначала
        const balance = await this.getBalance(checkAddress);
        if (parseFloat(balance) < checkAmount) {
            console.log(`Balance too low: ${balance} < ${checkAmount}`);
            return false;
        }

        // Получаем транзакции с обработкой ошибок
        let transactions;
        try {
            transactions = await this.tonweb.getTransactions(checkAddress, 15);
        } catch (e) {
            console.error('Error fetching transactions:', e.message);
            return false;
        }

        // Конвертируем сумму в нанотоны для сравнения
        const amountNano = TonWeb.utils.toNano(checkAmount.toString());
        const bnAmount = new TonWeb.utils.BN(amountNano);

        // Ищем подходящую транзакцию
        for (const tx of transactions) {
            try {
                if (!tx.in_msg) continue;

                const txValue = new TonWeb.utils.BN(tx.in_msg.value);
                const txComment = tx.in_msg.message || '';

                if (txComment.includes(checkComment) && txValue.gte(bnAmount)) {
                    console.log('Payment found:', {
                        hash: tx.transaction_id.hash,
                        amount: TonWeb.utils.fromNano(txValue.toString()),
                        comment: txComment
                    });
                    return true;
                }
            } catch (e) {
                console.error('Error processing transaction:', e.message);
                continue;
            }
        }

        console.log('No matching transaction found');
        return false;
    } catch (e) {
        console.error('Payment check critical error:', e.message);
        return false;
    }
}

   async sendTon(toAddress, amount, comment = '') {
    for (let i = 0; i < this.retryCount; i++) {
        try {
            const seqno = await this.wallet.methods.seqno().call();
            const amountNano = TonWeb.utils.toNano(amount.toString());
            
            const tx = await this.wallet.methods.transfer({
                secretKey: await this.wallet.getSecretKey(),
                toAddress: toAddress,
                amount: amountNano,
                seqno: seqno,
                payload: comment,
                sendMode: 3
            }).send();

            console.log('Transaction sent:', {
                hash: tx.hash,
                to: toAddress,
                amount: amount,
                comment: comment
            });

            return tx;
        } catch (e) {
            console.error(`Attempt ${i + 1} failed:`, e.message);
            if (i === this.retryCount - 1) throw e;
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        }
    }
}

    async getBalance(address) {
        try {
            const balance = await this.tonweb.getBalance(address);
            return TonWeb.utils.fromNano(balance);
        } catch (e) {
            console.error('Get balance error:', e.message);
            return '0';
        }
    }
}

module.exports = new TonHelper();