/**
 * The capability registry's runtime half. The kernel walks `MODULES` to build each plugin's ctx
 * and names none of them itself.
 */
import type { CapabilityModule } from "../kernel/types.ts";
import { anchorsModule } from "./anchors.ts";
import { classesModule } from "./classes.ts";
import { messagesModule } from "./messages.ts";
import { mountModule } from "./mount.ts";
import { rewritesModule } from "./rewrites.ts";
import { sessionModule } from "./session.ts";
import { styleModule } from "./style.ts";
import { toolsModule } from "./tools.ts";
import { transcriptModule } from "./transcript.ts";

export const MODULES: readonly CapabilityModule[] = [
  anchorsModule,
  classesModule,
  messagesModule,
  rewritesModule,
  mountModule,
  styleModule,
  toolsModule,
  sessionModule,
  transcriptModule,
] as unknown as readonly CapabilityModule[];
