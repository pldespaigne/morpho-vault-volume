# Business Case: Morpho Net Flow Leaderboard

## Summary
While standard DeFi metrics like APY and TVL offer useful snapshots of a vault's current state, they are often heavily influenced by market volatility. This can make it difficult to distinguish between organic growth and simple asset price appreciation.

This application introduces a Net Flow Leaderboard for Morpho Vaults. By isolating actual capital movement (deposits and withdrawals valued at the time of transaction), the tool provides a clearer view of user behavior and capital allocation trends within the Morpho ecosystem.

## The Problem
Standard TVL tracking often leaves this question unanswered:

- If a vault's USD value grew by 10%, was that due to $10M in new deposits, or did the underlying asset simply increase in price?

## The Solution
By aggregating transactions at their historical USD value, this tool filters out the "market noise," allowing Morpho stakeholders to focus on the actual decisions other users are making with their money.

## Limits and Improvements
While the current MVP successfully isolates net USD flow, there are several areas for expansion to provide a more comprehensive view of the Morpho ecosystem:

1. Multi-Chain Expansion
  - Current State: Data is currently limited to Ethereum Mainnet.
  - Future: Extending support to other L2s where Morpho is deployed. This would allow for a "Total Net Flow" view across the entire protocol.

2. From Vaults to Markets
  - Current State: Focused specifically on Vaults.
  - Future: Applying similar "Net Flow" logic to individual Morpho Markets. This would help identify which specific collateral/loan pairs are attracting the most organic capital, regardless of the vault layer.

3. Advanced Data Visualization
  - Current State: Data is presented in a Fixed-Size Leaderboard.
  - Future: Moving beyond static tables to include:
    - Time-Series Charts: Visualizing flow trends over weeks or months.
    - Interactive Analytics: Dedicated pages for each vault to drill down into specific high-volume deposit/withdrawal events.

