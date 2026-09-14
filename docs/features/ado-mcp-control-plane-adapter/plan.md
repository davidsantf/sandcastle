# Slice 19 implementation plan

## Boundary

`createAdoMcpControlPlaneAdapter` converts an injected
`AdoMcpTransport.invoke` function into the existing `AdoControlPlane` surface.
The package has no MCP SDK dependency and no ambient runtime lookup.

Fixed request mappings cover work-item get/update, work-item comments, and PR
creation. CI and review request builders are supplied by the host because their
pipeline and policy topology is installation-specific. Builders return selector
arguments only: the adapter fixes each read tool/action and overwrites protected
organization, project, repository, and pull-request scope.

Host decoders translate provider result envelopes. Sandcastle then validates
the decoded domain value, copies it through a prototype/accessor-safe bounded
plain-data boundary, and returns a canonical projection containing only public
domain fields. Decoder and transport diagnostics are never propagated.

## Safety

- one transport attempt per method call;
- default 30-second timeout, configurable from 1 to 120 seconds;
- abort signal passed to the transport and timeout raced independently;
- 256 KiB, 8,192-node, depth-16 request/response boundary;
- read-only adapter has no write methods;
- access is mandatory and write capability requires explicit `access: "write"`;
- no token, credential, environment, shell, CLI, or global MCP access;
- no merge, approve, complete, or workflow-finalization method.

An aborted or failed write is uncertain from Sandcastle's perspective and is
not retried. The host must recover through provider reads and the slice-18
control/audit workflow.

## Validation

Run adapter, factory, PR publisher, legacy feedback, and team-runner tests,
typecheck, tsup/DTS, public declaration guard, formatting, and diff checks.
Complete independent adversarial and security reviews before publication.
