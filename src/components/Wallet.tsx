import { useWallet } from '../wallet/context'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function Wallet() {
  const { balance } = useWallet()

  return (
    <section className="wallet-card" aria-labelledby="wallet-title">
      <h2 id="wallet-title">Wallet</h2>
      <p className="wallet-balance" role="status" aria-label="Wallet balance">
        {currencyFormatter.format(balance)}
      </p>
    </section>
  )
}
