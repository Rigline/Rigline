import { type CapabilityContract, isStringArray } from "./types.ts";

/** Read taps on the bus, replayed from the startup exchange, handed frozen clones. */
export const messagesContract: CapabilityContract<"messages"> = {
  key: "messages",
  grants: ["onMessage"],
  shape(value) {
    return isStringArray(value) ? null : "must be an array of message types";
  },
  gaps(declared, tables) {
    return declared
      .filter((type) => !tables.messageTypes.includes(type))
      .map((type) => `unknown message type "${type}"`);
  },
  summary(declared) {
    return declared.length === 0 ? [] : [`reads messages: ${declared.join(", ")}`];
  },
};
