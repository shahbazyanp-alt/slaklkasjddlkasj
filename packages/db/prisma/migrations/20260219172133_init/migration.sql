-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'read_only');

-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('incoming', 'outgoing');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTag" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenWhitelist" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'ethereum',
    "contractAddress" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Erc20Transfer" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'ethereum',
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "tokenSymbol" TEXT,
    "tokenDecimals" INTEGER,
    "amountRaw" TEXT NOT NULL,
    "amountNormalized" DECIMAL(38,18),
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "confirmations" INTEGER,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Erc20Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSyncState" (
    "walletId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncedBlock" BIGINT,
    "backfillCompleted" BOOLEAN NOT NULL DEFAULT false,
    "cursorPage" INTEGER,
    "cursorOffset" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletSyncState_pkey" PRIMARY KEY ("walletId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "WalletTag_walletId_idx" ON "WalletTag"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTag_walletId_tag_key" ON "WalletTag"("walletId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "TokenWhitelist_contractAddress_key" ON "TokenWhitelist"("contractAddress");

-- CreateIndex
CREATE INDEX "Erc20Transfer_walletId_blockTimestamp_idx" ON "Erc20Transfer"("walletId", "blockTimestamp");

-- CreateIndex
CREATE INDEX "Erc20Transfer_tokenContract_blockTimestamp_idx" ON "Erc20Transfer"("tokenContract", "blockTimestamp");

-- CreateIndex
CREATE INDEX "Erc20Transfer_direction_blockTimestamp_idx" ON "Erc20Transfer"("direction", "blockTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Erc20Transfer_txHash_logIndex_key" ON "Erc20Transfer"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "WalletTag" ADD CONSTRAINT "WalletTag_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Erc20Transfer" ADD CONSTRAINT "Erc20Transfer_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSyncState" ADD CONSTRAINT "WalletSyncState_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
