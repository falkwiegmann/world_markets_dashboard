# Markets dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live page → [falkwiegmann.github.io/world_markets_dashboard](https://falkwiegmann.github.io/world_markets_dashboard/)**

A lightweight, self-updating markets dashboard: global indices, FX, central
bank policy rates, yields, commodities, crypto, and valuation ratios (CAPE,
P/E, S&P/Gold, …) on one static page. No frameworks, no build step, no
dependencies. A personal educational project — non-commercial, no ads.

## How it works

- `.github/workflows/update-data.yml` re-fetches and redeploys the page to
  GitHub Pages on a 30-minute schedule.

## Citation

If this dashboard or its code is useful in your work, cite it as:

```bibtex
@software{wiegmann_markets_dashboard,
  author = {Wiegmann, Falk},
  title  = {Markets dashboard},
  year   = {2026},
  url    = {https://github.com/falkwiegmann/world_markets_dashboard}
}
```

Please cite the underlying data providers directly for any data you use:
e.g. Robert Shiller's dataset (valuation series), ECB, BIS, FRED/Board of
Governors, FHFA. This project only aggregates their published data.

## License & data terms

Code is [MIT-licensed](LICENSE). **The license covers the code only** — market
data fetched or displayed remains the property of its providers and is subject
to their terms. Notably: the US home-price series is FHFA's public-domain index
(deliberately not Case-Shiller, which may not be republished); ECB and BIS
statistics are reused with attribution per their policies; Yahoo Finance data
comes from an unofficial API — end-of-day/delayed, informational purposes only,
not for trading. Full attribution and disclaimers are in the page footer. This
project is not affiliated with any data provider or index owner.
