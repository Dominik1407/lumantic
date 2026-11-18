# Roadmap

Lumantic is young (version 0.12). This page says what is planned and what Lumantic deliberately does not do. It
changes as people use it; ideas are welcome as [issues](https://github.com/Dominik1407/lumantic/issues).

## Next, in no fixed order

- **Tried against real systems.** Snowflake, Databricks, Windmill, the logins and the AI models have so far only met
  rebuilt answers. Reports from real systems come first: [#7](https://github.com/Dominik1407/lumantic/issues/7).
- **More data sources:** PostgreSQL ([#8](https://github.com/Dominik1407/lumantic/issues/8)), SQL Server and Azure SQL
  ([#9](https://github.com/Dominik1407/lumantic/issues/9)), ClickHouse
  ([#10](https://github.com/Dominik1407/lumantic/issues/10)), BigQuery
  ([#11](https://github.com/Dominik1407/lumantic/issues/11)).
- **Money in other currencies than CHF** ([#12](https://github.com/Dominik1407/lumantic/issues/12)).
- **Public holidays** when targets are spread over working days, by canton
  ([#13](https://github.com/Dominik1407/lumantic/issues/13)).
- **Key figure templates** for more industries ([#14](https://github.com/Dominik1407/lumantic/issues/14)).
- **Suggesting the key figures of a new Kosmos** from its tables, so it does not start empty.
- **Rights on parts of a key figure** (region East sees only East), and rights like Windows folder rights.
- **A morning report** as a message in Teams or by mail.
- **Correcting for multiple comparisons** when Lumina checks very many series.

## Not planned

- **Writing into the database.** Lumantic only reads.
- **Needing the internet to run.** Everything works offline; only Lumina, when it is switched on, talks to the AI
  model you configure, and it sends evaluated figures, never rows of data.
- **A general BI tool.** No free chart builder, no dozens of chart types, no pixel layouts. Lumantic stays a few calm
  pages that say what matters.
- **Design by committee.** The surface (the Kosmos, its motion, colours and wording) stays with one hand; see
  [CONTRIBUTING](CONTRIBUTING.md). Critique and ideas for it are welcome as issues.
