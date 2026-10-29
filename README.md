# @pipeworx/eu-pesticides

EU approval status of pesticide (plant-protection) active substances: whether a substance is Approved, Not approved or Pending, from when to when, and under which Commission regulation, with the ADI / ARfD / AOEL reference values.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `eu_pesticide_substance({ name | cas | id })` — one substance's full approval record: status, an explicit `approval_state` (an "Approved" entry whose expiry date has passed is returned as `approved_but_expiry_date_passed`, never as current), first-approval date, expiry date, the governing regulations and directives with links (the answer to "was it renewed, under which implementing regulation"), rapporteur member state, candidate-for-substitution and low-risk flags, ADI / ARfD / AOEL, CLP classification, national authorisations and MRL residue definitions.
- `eu_pesticides_list({ status?, expiring_before?, expiring_after?, category?, candidate_for_substitution?, low_risk?, query?, limit?, offset? })` — filter the whole list, e.g. every approval expiring before a date.

Every response carries `source` and `data_as_of`.

## Auth

Keyless.

## Data sources

- European Commission (DG SANTE), EU Pesticides Database, active substances.

`approval_date_first` is the date of first approval, not of the latest renewal; renewals and extensions appear as additional entries in `governing_legislation`. Where the publisher lists different expiry dates for different uses of one entry (paraffin oil, famoxadone), `expiry_date` is the earliest and every value is in `expiry_date_variants`.

The publisher serves this list in many sequential pages with unreliable server-side filters, so the pack answers from a dated snapshot that is re-read monthly by a scheduled job; `data_as_of` is the snapshot date. For a legally binding answer confirm against EUR-Lex.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "eu-pesticides": {
      "url": "https://gateway.pipeworx.io/eu-pesticides/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/eu-pesticides/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/eu_pesticide_substance \
  -H 'Content-Type: application/json' \
  -d '{"name":"dimethachlor"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/eu_pesticide_substance`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-eu-pesticides` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/eu-pesticides/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "eu-pesticides": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-eu-pesticides"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Eu Pesticides data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
