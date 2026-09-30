import { createContext, useContext } from 'react'
import type { WalletSnapshot } from './wallet'

export interface WalletContextValue extends WalletSnapshot {
  /** Read the latest balance synchronously, including transactions before a rerender. */
  getSnapshot: () => WalletSnapshot
  /** Pay an amount in dollars; false leaves the balance unchanged. */
  pay_money: (amount: number) => boolean
  /** Earn an amount in dollars; false leaves the balance unchanged. */
  earn_money: (amount: number) => boolean
  /** Deduct a fine in dollars, even if the balance goes negative; false leaves it unchanged. */
  fine: (amount: number) => boolean
}

export const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet(): WalletContextValue {
  const wallet = useContext(WalletContext)

  if (!wallet) {
    throw new Error('useWallet must be used within WalletProvider.')
  }

  return wallet
}
