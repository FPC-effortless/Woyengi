import { runWoyengiCli } from "./cli.ts";

process.exitCode = await runWoyengiCli(process.argv.slice(2));
