import { createContext, useContext } from 'react'
import type { WalletSnapshot } from './wallet'

export interface WalletContextValue extends WalletSnapshot {
  /** Pay an amount in dollars; false leaves the balance unchanged. */
  pay_money: (amount: number) => boolean
}

export const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet(): WalletContextValue {
  const wallet = useContext(WalletContext)

  if (!wallet) {
    throw new Error('useWallet must be used within WalletProvider.')
  }

  return wallet
}
