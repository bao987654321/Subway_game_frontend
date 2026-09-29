import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { WalletContext } from './context'
import { createWallet } from './wallet'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet] = useState(() => createWallet())
  const [snapshot, setSnapshot] = useState(wallet.getSnapshot)

  // Apply changes synchronously so another transaction sees the latest balance,
  // even before React renders this one's snapshot.
  const publish = useCallback(
    (change: (amount: number) => boolean) =>
      (amount: number): boolean => {
        const success = change(amount)
        if (success) setSnapshot(wallet.getSnapshot())
        return success
      },
    [wallet],
  )

  const pay_money = useMemo(() => publish(wallet.pay_money), [publish, wallet])
  const earn_money = useMemo(() => publish(wallet.earn_money), [publish, wallet])
  const fine = useMemo(() => publish(wallet.fine), [publish, wallet])

  return (
    <WalletContext.Provider value={{ ...snapshot, pay_money, earn_money, fine }}>
      {children}
    </WalletContext.Provider>
  )
}
