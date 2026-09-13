import { CONTRACTS, type Payload, patchViolation } from "@prototype/plugin-api";
import type { RewriteRecord } from "../kernel/bridge.ts";
import type { CapabilityModule } from "../kernel/types.ts";

/**
 * `ctx.rewrite(type, transform)` and `ctx.resend(type)`.
 *
 * The pre hook owns the order patches apply in and the guarantee that the app's message goes
 * either way; this module owns entirely whether a given patch is allowed: the declaration, the
 * validation and the attribution. What reaches the pre hook is a function that returns a
 * validated patch or null and never throws, so a plugin bug becomes a disabled plugin and an
 * unmodified message, never a message the app did not choose to send.
 */
export const rewritesModule: CapabilityModule<"rewrites"> = {
  contract: CONTRACTS.find((c) => c.key === "rewrites") as CapabilityModule<"rewrites">["contract"],
  grant({ plugin, kernel, own, disable }) {
    const fieldsFor = (type: string): readonly string[] | undefined => plugin.uses.rewrites[type];
    return {
      rewrite(type, transform) {
        const fields = fieldsFor(type);
        if (!fields) {
          throw new Error(
            `rewrite("${type}") was never declared under uses.rewrites in this plugin's prototype.json`,
          );
        }
        const record: RewriteRecord = {
          plugin: plugin.name,
          type,
          fields: [...fields],
          applied: 0,
          ran: 0,
          // Snapshotted now: this is the instant the chain stops being empty for this plugin, so
          // every send counted so far is one it could not have patched.
          missed: kernel.bus.rewriters.outboundSeen(type),
        };
        kernel.diagnostics.rewrites.push(record);
        const off = kernel.bus.rewriters.add(type, (payload) => {
          record.ran++;
          let patch: unknown;
          try {
            patch = transform(payload as Payload);
          } catch (e) {
            disable(`rewrite("${type}") threw: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          }
          if (patch === null || patch === undefined) return null;
          const violation = patchViolation(patch, fields, payload);
          if (violation) {
            disable(`rewrite("${type}") ${violation}`);
            return null;
          }
          record.applied++;
          return patch as Record<string, unknown>;
        });
        return own(off);
      },
      resend(type) {
        if (!fieldsFor(type)) {
          throw new Error(
            `resend("${type}") needs a declared rewrite of it under uses.rewrites in this plugin's prototype.json`,
          );
        }
        return kernel.bus.rewriters.resend(type);
      },
    };
  },
};
