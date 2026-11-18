// Starts Electron with the given arguments:  node scripts/run-electron.mjs .
//
// Terminals opened from VS Code extensions can inherit ELECTRON_RUN_AS_NODE=1,
// which makes Electron behave like plain Node and the app fail to start.
// Clearing it here makes `npm start` work everywhere.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electronPath = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, process.argv.slice(2), { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
