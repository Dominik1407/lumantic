# Templates for further industries / Vorlagen für weitere Branchen

## `saas.json`: software subscriptions (SaaS) / Software-Abo

A starting point for a team that sells software by subscription. It holds 9 key figures in
4 topics, with German words and English words (`en`). It is a template, not an example Kosmos:
no sample data comes with it, and Lumantic does not start with it. Copy it, change the tables
and columns to those of your gold layer, and point `metrics` of a Kosmos to it (see
«Defining key figures» in the README).

Ein Ausgangspunkt für Teams, die Software im Abo verkaufen: 9 Kennzahlen in 4 Themen, mit
deutschen und englischen Wörtern. Es ist eine Vorlage, kein Beispiel-Kosmos: Es gibt keine
Beispieldaten dazu. Kopieren, Tabellen und Spalten an die eigene Goldschicht anpassen und
`metrics` eines Kosmos darauf zeigen lassen.

### Tables it expects (schema `gold`) / erwartete Tabellen

| Table | Columns (besides the date) | Used by |
|---|---|---|
| `gold.mrr_monat` | `tarif` (the plan, splits the figure), `mrr_tsd` | MRR |
| `gold.kunden_monat` | `kunden_zahl`, `neukunden_zahl`, `churn_pct`, `nrr_pct`, `mrr_bestand_tsd`, `mrr_vorjahr_tsd` | customers, new customers, churn, NRR |
| `gold.kpi_monat` | `bruttomarge_pct`, `ltv_cac_faktor`, `rule_of_40_pct` | gross margin, LTV to CAC, Rule of 40 |
| `gold.betrieb_monat` | `verfuegbarkeit_pct` | availability |

One row per month (per plan in `mrr_monat`). Amounts are in thousands of CHF (`Tsd`).

### What is judged / was beurteilt wird

Lumantic judges a figure only against its own target or limit, so only four have one, and the
rest stay quiet until you add yours:

- **NRR** has a limit of 100 %: below it, existing customers pay less than a year ago.
- **LTV to CAC** has the target 3, and **Rule of 40** the target 40. Both are rules of thumb
  that are widely quoted in the industry, not rules; adjust them to your business.
- **Availability** has the limit 99.9 %, which stands for the promise in a contract. Replace it
  with the one you have made.

Each figure's `formula` says how it is meant to be calculated; your gold layer has to deliver
it that way.

### Languages / Sprachen

German and English were both written for this template. A review by someone who works in the
industry is welcome.
