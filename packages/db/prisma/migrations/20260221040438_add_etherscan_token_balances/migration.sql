-- CreateTable
CREATE TABLE "EtherscanTokenBalance" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "balance" DECIMAL(38,18) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtherscanTokenBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtherscanTokenBalance_tokenContract_idx" ON "EtherscanTokenBalance"("tokenContract");

-- CreateIndex
CREATE INDEX "EtherscanTokenBalance_fetchedAt_idx" ON "EtherscanTokenBalance"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EtherscanTokenBalance_walletId_tokenContract_key" ON "EtherscanTokenBalance"("walletId", "tokenContract");

-- AddForeignKey
ALTER TABLE "EtherscanTokenBalance" ADD CONSTRAINT "EtherscanTokenBalance_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
