// Maintainer script (ADR-0047, ADR-0115): builds data/passwords/common-passwords.txt from a downloaded
// common password list, keeping only the entries the policy would otherwise accept.
//   npm run passwords:build -- <downloaded list>
// The steps to download and record the source are in data/passwords/README.md.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COMMON_PASSWORDS_FILE,
  commonPasswordEntries,
} from '../modules/identity-access/index.js';

const [source] = process.argv.slice(2);
if (source === undefined) {
  process.stderr.write('Usage: npm run passwords:build -- <downloaded list>\n');
  process.exit(2);
}
const lines = readFileSync(source, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');
const entries = commonPasswordEntries(lines);
writeFileSync(COMMON_PASSWORDS_FILE, `${entries.join('\n')}\n`);
process.stdout.write(
  `${COMMON_PASSWORDS_FILE}: ${entries.length} of ${lines.length} passwords kept\n`,
);
