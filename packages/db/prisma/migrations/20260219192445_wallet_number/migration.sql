/*
  Warnings:

  - A unique constraint covering the columns `[walletNumber]` on the table `Wallet` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "walletNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_walletNumber_key" ON "Wallet"("walletNumber");
