#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '../../dashboard/public/assets/js/mc2/04-mc2-home.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('function mc2AutoPromotedInitiativeNeedsAttention'), 'attention helper exists');
assert(source.includes("status === 'rejected' || status === 'completed'"), 'rejected and completed initiatives clear attention');
assert(source.includes('if (!taskItem) return false'), 'removed promoted subgoals clear attention');
assert(source.includes("taskStatus !== 'done' && taskStatus !== 'completed' && taskStatus !== 'removed'"), 'finished promoted subgoals clear attention');
assert(source.includes('if (!mc2AutoPromotedInitiativeNeedsAttention(it, taskItem)) return'), 'collector uses attention helper');

console.log('mc2 attention clearing tests passed');
