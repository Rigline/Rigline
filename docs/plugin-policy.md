# Plugin policy

Rigline publishes a [compliance position](anthropic-compliance.md): no credentials, no network
calls, no rerouting of Claude usage, no deception. Your plugin runs inside the modification that
position is about, so it has to hold for your plugin too.

**Publishing has nothing to do with it.** A plugin you wrote for yourself, that lives in one
directory and will never reach anybody else, modifies Anthropic's extension exactly as much as a
published one does, and Anthropic's terms apply to it exactly as much. Everything below is about
what your plugin does on a machine, not about who else can install it.

Two different things hold it, and this page keeps them apart on purpose. Some of it the architecture
makes impossible. The rest is asked of you, and we are explicit below about the fact that nobody is
checking.

## What you cannot do, because the host does not permit it

Properties of where your plugin runs, not promises we are asking you to make. Obfuscation does not
help: there is no clever way to reach something that is not there.

- **No network, at all.** The webview's CSP is `default-src 'none'` with no `connect-src`. `fetch`,
  `XMLHttpRequest` and `WebSocket` do not work from a plugin any more than from the rest of the
  payload. There is no egress, so there is no telemetry you could add if you wanted to.
- **No filesystem.** Nothing in the webview can read or write a file.
- **No code in the extension host.** Nothing in the webview runs in the Node process, and a host
  patch is not code either. It is a declared byte substitution in `rigline.json` — `find`,
  `replace`, a mandatory `why`, the same byte length — applied by our installer against the pristine
  bundle.
- **No install-time execution.** `rigline add` never runs a lifecycle script. The tar reader writes
  regular files and refuses everything else by name.

Inside those walls your plugin has the panel's reach. It runs in the same page as Claude Code's own
interface, so it can do there what a person at the panel can — send a prompt, open a file or a link —
and ask the extension for anything the interface asks it for. `ctx` gives you less than that on
purpose: a rewrite replaces only fields named under `uses.rewrites`, only fields the app already
sends, and only with the same `typeof`, and nothing in it originates a message. `acquireVsCodeApi`
throws for a plugin, as VS Code's own does after the app's call. Going around `ctx` through the
app's own code is possible, and keeping to `ctx` is asked of you below rather than enforced.

This is containment, not safety. A plugin still renders whatever it likes in the panel, and a host
patch can still do harm inside its equal-length constraint. What the boundary buys is that the
worst case is bounded and local, not that there is no bad case.

## What we ask of you

- **Do not deceive the person using it.** The CSP does not stop a convincing lie. Never imitate
  Anthropic's interface, never present a prompt for credentials or payment, never ask anyone to paste
  a key or token anywhere, and never dress your plugin's output up as the model's or the app's.
- **Do not move conversation content off the machine.** The network is closed, but a link is not, and
  neither is the clipboard or a file a user is told to send. Do not build that path.
- **Do not reach for credentials.** Do not read, store, display, forward or prompt for API keys,
  OAuth tokens or session tokens, and do not interfere with sign-in.
- **Write to the bus through `ctx`.** What your manifest declares is what `ctx` lets you do, and it
  is what somebody deciding whether to install your plugin reads. Sending through the app's own code
  what `ctx` would not send is doing something your manifest does not say.
- **Do not route Claude usage.** No endpoint substitution, no proxying, no reselling, no billing
  anything to anyone but the user whose account it is.
- **Keep host patches to reaching what the extension already does.** The justified shape is a
  capability the extension already has, switched on. A patch that disables a check, suppresses a
  warning, alters authentication or changes what the extension sends is out of bounds whatever `why`
  claims about it. If you are unsure, open an issue before you publish.
- **Do not imply Anthropic built, endorses or is partnered with your plugin.** Say what it works
  with, in plain text, and no more.

**Anthropic's terms bind you as they bind us.** The
[Consumer](https://www.anthropic.com/legal/consumer-terms) and
[Commercial](https://www.anthropic.com/legal/commercial-terms) Terms of Service and the
[Usage Policy](https://www.anthropic.com/legal/aup) apply to your plugin's behaviour, and nothing in
Rigline's licence grants relief from them. If Anthropic asks Rigline to stop, plugins stop with it.

## What we do not police

We do not review plugin source, and we could not reliably detect a plugin built to hide what it
does. Any claim otherwise would be a promise we cannot keep, and the first person to disprove it
would be right to. Policing behaviour that the boundary permits is a game of whack-a-mole against
people who can obfuscate, and entering it would mean owning every round we lost.

So this page is a statement of obligations, not a filter. What we actually have:

- **A boundary that holds regardless.** Every wall in the first section is true of a hostile plugin
  and an honest one alike. That is why it is worth more than the second section.
- **Declarations that are cheap to check.** `uses` and `patches` say what a plugin reaches for,
  before anybody reads its code. They do not prove good behaviour; they make a mismatch something a
  reviewer can find and name.
- **The things we choose.** We decide what ships bundled, what the docs point at, and what we
  recommend. Nothing third-party arrives on a machine without the user installing it by name.
- **What we do when told.** Report a plugin that breaches this page and we will look, say publicly
  what we found, unlist or remove it where we can, and withdraw permission to call it a Rigline
  plugin. That is response, not prevention, and we would rather describe it accurately than dress it
  up as review.

Rigline is MIT and stays MIT. We have deliberately not added use restrictions to the licence: a
field-of-use condition would stop it being open source, would not deter anybody willing to write a
malicious plugin, and would burden every honest author to inconvenience no dishonest one.

If you think something here is wrong, or blocks a plugin that ought to exist, open an issue. This
page is meant to be argued with — it is not meant to be signed.
