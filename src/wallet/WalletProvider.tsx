import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { WalletContext } from './context'
import { createWallet } from './wallet'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet] = useState(() => createWallet())
  const [snapshot, setSnapshot] = useState(wallet.getSnapshot)

  const pay_money = useCallback(
    (amount: number): boolean => {
      // Deduct synchronously so another payment sees the latest balance,
      // even before React renders this payment's snapshot.
      const success = wallet.pay_money(amount)
      if (success) setSnapshot(wallet.getSnapshot())
      return success
    },
    [wallet],
  )

  return (
    <WalletContext.Provider value={{ ...snapshot, pay_money }}>
      {children}
    </WalletContext.Provider>
  )
}
