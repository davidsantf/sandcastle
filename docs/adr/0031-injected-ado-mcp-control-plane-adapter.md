# ADR-0031: ADO MCP transport is an injected host boundary

## Status

Proposed

## Context

Sandcastle cannot safely import or discover a host MCP runtime, credentials, or
provider-specific deployment topology. Existing ADO orchestration code already
depends on a typed `AdoControlPlane`; slice 19 needs a live-host integration
shape without moving provider access into sandboxes or core workflow logic.

## Decision

Provide an adapter over one explicitly injected MCP invocation function. The
adapter:

1. permits only a fixed set of ADO MCP tool names;
2. maps stable work-item/comment/PR operations itself;
3. accepts host-defined CI/review selector builders for installation-specific
   topology while fixing the read tool/action and protected provider scope;
4. requires host decoders and independently validates decoded domain values;
5. requires explicit access and offers distinct read-only and write-capable
   surfaces;
6. bounds and snapshots requests/responses, races every call against timeout,
   propagates cancellation, never retries, and sanitizes failures.

The adapter does not authenticate users, obtain credentials, discover tools,
decide workflow transitions, finalize work, approve or merge PRs, or grant
runtime authority. Those remain host responsibilities governed by slices 16-18.

## Consequences

- Hosts can connect their MCP runtime without coupling Sandcastle to an MCP SDK.
- Tests remain deterministic and make no live call.
- Provider schema changes are isolated in host decoders.
- Uncertain writes require read-based recovery rather than automatic retry.
- A configured write adapter is powerful and must be created only after the host
  has independently authorized its use.

## Alternatives rejected

- **Import an MCP client/runtime:** couples core to host credentials and tool
  discovery.
- **Invoke Azure CLI from a sandbox:** violates the control-plane boundary.
- **Accept arbitrary tool names:** turns the adapter into an unbounded confused
  deputy.
- **Automatically retry writes:** can duplicate provider mutations.
