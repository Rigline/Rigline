# Security

## Reporting a vulnerability

Report it privately, through GitHub:
**[Report a vulnerability](https://github.com/Rigline/Rigline/security/advisories/new)**, on the
repository's Security tab. Please don't open a public issue for it. A person reads every report and
replies.

## What counts

A vulnerability is a way through something Rigline says cannot happen. The walls a plugin runs inside
are listed in [plugin-policy.md](docs/plugin-policy.md), and each is a property we claim, not a
request we make of authors. So any of these is one:

- a plugin making a network request, reading or writing a file, or running code in the extension
  host;
- anything running while `rigline add` or `rigline update` installs a plugin, or a plugin's archive
  writing anything but regular files inside its own directory;
- a host patch applied as anything other than the equal-length substitution its manifest declares;
- a plugin installed from npm whose bytes are not the ones the registry's integrity hash names;
- a layout save accepted from a link that did not come from a panel on the same machine.

So is anything in Rigline's own packages, the companion extension or the four bundled plugins that
exposes a person's credentials, conversations or files.

A plugin doing what a person at the panel can do — sending a prompt, opening a file or a link — is
the reach plugin-policy.md describes, not a way through a wall. If one does it to deceive somebody,
report it as the next section says.

## A plugin that breaks the policy

A third-party plugin that deceives, reaches for credentials or carries conversation content off the
machine breaches [plugin-policy.md](docs/plugin-policy.md). Report it the same private way, with the
plugin's npm name and version. What happens then is in that page: we look, say publicly what we
found, unlist or remove it where we can, and withdraw permission to call it a Rigline plugin.

## Claude Code itself

A vulnerability in Claude Code, rather than in what Rigline adds to it, is Anthropic's to fix, and
goes to them. If Rigline's injection is what makes it reachable, it is ours as well, and we want to
hear about it.

## Which versions get fixes

The newest release. All four packages release together, and `rigline update` moves to a fix in one
command; where the companion is installed, it moves the engine by itself once the release is a day
old. Older versions do not get fixes of their own.
