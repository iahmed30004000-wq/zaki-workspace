# Ordered prompts for other repositories

When a step needs another system to change (the orders system, the media buyer, n8n, the replies system), the change is
written here as ONE ordered prompt per repository and step: `<repo>-<ID>.md` (for example `zaki-ai-OSM-Q1.0.md`).

It is executed THERE, by that system's own session — never from this repository. The rules are in
`docs/restructure/BUILD-PROMPTS.md` §9: the changes in order, each small and additive in that system's own style; the
contract (schema + one example) whose source is that repository; no secret, no private address, no customer value; and
what the Workspace does until the change lands.
