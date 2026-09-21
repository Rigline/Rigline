#!/usr/bin/env node
/**
 * `rigline`: the command a person installs.
 *
 * It calls the engine's command surface directly for now. What it becomes is the retrieval layer
 * (D69) — it installs the engine, owns `update` and the remote half of `add`, and forwards
 * everything else to a spawned `rigline-engine` — because a process cannot replace the package it
 * is running out of, so whatever performs an update has to sit above the thing being updated.
 */
import { runEngine } from "@rigline/core";

runEngine(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
