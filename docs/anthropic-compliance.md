# Anthropic compliance

Rigline modifies files belonging to Anthropic's Claude Code VS Code extension on the machine of the
person who installed both. That is unusual enough to deserve a straight account of what it does,
what it does not do, and why we believe it is legitimate — rather than leaving anyone to work it
out from the source.

This page is written for Anthropic first. It is not legal advice and it is not a claim of
permission; it is our reasoning, stated plainly so it can be checked or corrected.

## For users

Rigline modifies software you licensed from Anthropic, on your machine. We believe that is your
call to make and that the reasoning below holds, but you should know you are making it — which is
why this page is linked from the top of the README rather than buried.

If Anthropic asks us to stop, we will, and `rigline restore` will already be sitting on your machine
when they do.

## If you are from Anthropic, please get in touch

We would genuinely rather have this conversation than not have it.

Open an issue on [github.com/Rigline/Rigline](https://github.com/Rigline/Rigline/issues), or write to
the address on the maintainer's GitHub profile, and you will get a reply. There is no argument
waiting on the other end of it.

What we would most like to discuss is whether Rigline can become something you are comfortable
with — an approved extension, a supported extension point, an agreed set of boundaries, or a
smaller shape than the current one. If you would prefer a different model entirely, we are
interested in that too. Rigline exists because the extension had no plugin surface; a sanctioned
one would be a better outcome than this, and we would happily retire the injection in favour of it.

And if the answer is simply that you would like Rigline to stop, tell us and it will stop. We will
publish a final release that restores every modified install to Anthropic's own bytes, and say
plainly in the README why. We would rather be asked than blocked, but we are not going to argue
about whose product it is.

## What Rigline actually does

Rigline runs entirely on one person's machine, on an installation they made, and changes nothing
anywhere else.

It writes to exactly three files inside the installed extension directory: `webview/index.js`,
`webview/index.css`, and — only when a plugin asks for it — `extension.js`. It keeps a
byte-faithful backup of each bundle it touches, as `index.js.orig` and `extension.js.orig`, and
`rigline restore` puts every installed version back to the extension's own bytes using them. The
uninstall path is the same code as the recovery path, so it is exercised constantly rather than
being a promise.

The modification is an injected loader. It runs inside the extension's existing webview, hands
registered plugins a capability-scoped context, and lets them decorate the interface — a session-id
pill, timestamps on transcript rows, a worktree prefix on tab labels, a diagnostics badge. That is
the whole of the ambition: things you can see, in the panel, that were not there before.

## What Rigline does not do

These are checkable claims, and we would encourage anyone assessing this to check them.

**It does not touch credentials.** The injected payload contains no reference to API keys, OAuth
tokens, session tokens or any other credential. It does not read them, store them, forward them or
intermediate them. Sign-in happens through Anthropic's own flow, unchanged and untouched.

**It does not route, proxy or resell Claude usage.** There is no endpoint substitution, no request
interception on the way to Anthropic, no billing relationship of any kind. Every request a user
makes is theirs, authenticated with their own credentials, billed to them under their own agreement
with Anthropic. Rigline is not a harness and does not host one.

**It makes no network requests at runtime, and cannot.** The injected code does not call `fetch`,
open a socket, or contact any server, Anthropic's or ours. This one is stronger than a claim about
our own code: the webview's CSP is `default-src 'none'` with no `connect-src`, so nothing running in
the panel can make a request of its own — ours, a plugin's, or anybody's. There is no telemetry and no analytics,
because there is no mechanism by which there could be.

**It does not redistribute Claude Code.** Rigline ships no Anthropic code, no bundle, no fragment of
one. It is installed alongside an extension the user obtained from the Marketplace themselves, and
it is inert without it.

**It does not remove, disable or restrict any authentication method**, degrade any feature, alter
any model behaviour, or change what the extension sends or receives.

**It does not disguise itself.** Rigline announces what it has modified, reports drift after every
extension update, and ships a diagnostics panel whose entire purpose is to say out loud when
something of ours is broken. A user who forgets Rigline is installed is a user we have failed.

## Plugins, which are the obvious next question

Rigline is a plugin layer, so everything above invites the question of what a plugin could do that
Rigline promises not to. We would rather answer it than be asked.

**Four plugins ship with Rigline** — a session-id pill, timestamps on transcript rows, a worktree
prefix on tab labels, and the diagnostics badge. They are ours, they are what the claims above are
about, and they are all that an install puts on a machine. Anything third-party is installed by the
user, by name, one plugin at a time.

**The walls are architectural, and they hold for a hostile plugin as well as an honest one.** No
plugin can make a network request of its own, because the CSP has no `connect-src`. None can read a
file, because nothing in a webview can. None can execute code in the Node process: a host patch is
not code but a declared equal-length byte substitution in the plugin's manifest, with a mandatory
statement of why, applied by our installer against the pristine bundle. None runs at install time,
because the tarball reader writes regular files and refuses everything else.

**Inside the walls, a plugin has the panel's reach and no more.** What Rigline gives a plugin on the
internal message bus is outbound only, patch-shaped, and confined to fields it declared and the app
already sends. But a plugin runs in the same page as the extension's own interface, so one that goes
around what it is given can do what a person at the panel can — send a prompt, open a file or a
link — and ask the extension for anything the interface asks it for. For scale: a dependency in any
Node project runs with the user's files, network and processes on every machine with Node, where a
Rigline plugin reaches only people who installed Rigline and chose it.

That is containment rather than safety, and we would rather say so. A plugin still renders what it
likes in the panel, and the CSP does not stop a convincing lie. So
[plugin-policy.md](plugin-policy.md) states what we require of authors — no deception, no reaching
for credentials, no carrying conversation content off the machine by a path the network closure does
not cover, no host patch that disables a check or alters what the extension sends — and binds them
to Anthropic's terms explicitly.

**We do not review plugin source, and we do not claim to.** We could not reliably detect a plugin
built to hide what it does, and a promise to police that would be one we could not keep. What we
have instead is a boundary that does not depend on our vigilance, manifests that declare what a
plugin reaches for before anyone reads its code, control over what we bundle and recommend, and a
willingness to say publicly what we find and withdraw a plugin when told of a breach. If Anthropic
ever wants a plugin looked at, ask and we will look.

## The clauses, and how we read them

We have read the terms rather than assumed them. Three are relevant, and we would rather name the
awkward one ourselves than have it found.

**"The Claude Code binary must not be modified."**
([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).) This sits under
_Can customers offer Claude Code in their products?_, as a condition on preinstalling or hosting
Claude Code inside something you ship to others. Rigline ships nothing containing Claude Code and
offers Claude Code to nobody, so the clause is not on point by its own framing. We also do not
modify the Claude Code binary: the CLI is untouched, as is everything under `~/.claude`. What
Rigline modifies is the VS Code extension's bundles, on the user's own disk.

We take the sentence seriously as a statement of preference even so, which is a large part of why
this page exists and why the invitation above is a real one.

**"Decompile, reverse engineer, disassemble, or otherwise reduce our Services to human-readable
form."** ([Consumer Terms](https://www.anthropic.com/legal/consumer-terms) §3; the
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms) D.4 equivalent covers reverse
engineering and duplication.)

This is the clause that comes closest, and honesty is worth more here than advocacy. To survive
extension updates, Rigline reads the shipped bundle and derives the identifiers its plugins anchor
to. That is reading a published artefact to achieve interoperability with it. It produces no
decompiled source, reconstructs no algorithm, extracts no model, prompt, weight or technique, and
duplicates nothing — the output is a table of names, and it is thrown away and regenerated on every
version.

We think interoperability is what this is, and the consumer clause's own carve-out for restrictions
"prohibited by applicable law" points the same way: the maintainer is in Australia, whose Copyright
Act s47D permits reproduction for interoperability. We would rather have Anthropic's view than our
own reading of it, which is the third reason for the invitation above.

**Building a competing product.** Rigline competes with nothing. It has no model, no inference, no
agent, no chat surface; it cannot function unless Anthropic's extension is installed and working,
and every hour anyone spends on it is an hour spent making Claude Code nicer to sit in front of. It
drives usage toward Claude Code rather than away from it.

**Names and logos.** We follow the [Trademark
Guidelines](https://www.anthropic.com/legal/trademark-guidelines). "Rigline" is the product name.
Claude Code is named only in plain text, factually, to say what Rigline works with — never as part
of our name, never in a logo, and never in a way suggesting Anthropic built, endorses or is
partnered with this. If any wording of ours reads otherwise, tell us and we will change it.

## Why the modification exists at all

Not as a preference. The extension's interface is a webview with no extension point, so there is no
supported way for anything to add to it. The choice is injection or nothing.

Rigline is built to make that as small and as reversible as it can be: byte-faithful backups, a
restore path that needs neither VS Code nor the extension to be working, plugin failures isolated so
that one plugin's problem never takes the panel with it, and a diagnostics surface that reports our
own breakage by name. None of that makes the modification unnecessary. It makes it recoverable,
which is the most we can offer while the only door is this one.

A supported extension point would make all of it unnecessary, and we would take that trade
immediately.
