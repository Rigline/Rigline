# Anthropic compliance

Rigline modifies files belonging to Anthropic's Claude Code VS Code extension on the machine of the
person who installed both. That is unusual enough to deserve a straight account of what it does,
what it does not do, and why we believe it is legitimate — rather than leaving anyone to work it
out from the source.

This page is written for Anthropic first. It is not legal advice and it is not a claim of
permission; it is our reasoning, stated plainly so it can be checked or corrected.

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

**It makes no network requests at runtime.** The injected code does not call `fetch`, open a socket,
or contact any server, Anthropic's or ours. There is no telemetry and no analytics; we collect
nothing, because there is no mechanism by which we could.

**It does not redistribute Claude Code.** Rigline ships no Anthropic code, no bundle, no fragment of
one. It is installed alongside an extension the user obtained from the Marketplace themselves, and
it is inert without it.

**It does not remove, disable or restrict any authentication method**, degrade any feature, alter
any model behaviour, or change what the extension sends or receives.

**It does not disguise itself.** Rigline announces what it has modified, reports drift after every
extension update, and ships a diagnostics panel whose entire purpose is to say out loud when
something of ours is broken. A user who forgets Rigline is installed is a user we have failed.

## The clauses, and how we read them

We have read the terms rather than assumed them. Three are relevant, and we would rather name the
awkward one ourselves than have it found.

**"The Claude Code binary must not be modified."**
([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).) This sits under
*Can customers offer Claude Code in their products?*, as a condition on preinstalling or hosting
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

## For users

Rigline modifies software you licensed from Anthropic, on your machine. We believe that is your
call to make and that the reasoning above holds, but you should know you are making it — which is
why this page is linked from the top of the README rather than buried.

If Anthropic asks us to stop, we will, and `rigline restore` will already be sitting on your machine
when they do.
