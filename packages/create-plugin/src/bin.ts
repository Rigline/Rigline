#!/usr/bin/env node
/**
 * The command. A file of its own so that importing `index.ts` scaffolds nothing, with no test of
 * whether this module is the one being run: pnpm and Unix npm reach it through a link, and a path
 * comparison then says no.
 */
import { main } from "./index.ts";

process.exitCode = main(process.argv.slice(2));
