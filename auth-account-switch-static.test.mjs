import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [firebase, account, accountHtml, readme] = await Promise.all([
    readFile('firebase.js', 'utf8'),
    readFile('account.js', 'utf8'),
    readFile('account.html', 'utf8'),
    readFile('README.md', 'utf8'),
]);
const authMenu = await readFile('auth-menu.js', 'utf8');

assert.doesNotMatch(account, /clearCredentialInputs/);
assert.match(account, /function applyLocalDevTestCredentials\(\)/);
assert.match(accountHtml, /id="pv-auth-email" name="email"[^>]*autocomplete="username"/);
assert.match(accountHtml, /id="pv-auth-password" name="password"[^>]*autocomplete="current-password"/);
assert.doesNotMatch(accountHtml, /pv-auth-test-fill/);
assert.match(authMenu, /'pv-auth-menu-email'/);
assert.match(authMenu, /'pv-auth-menu-password'/);
assert.doesNotMatch(authMenu, /'pv-auth-email'|'pv-auth-password'/);
assert.match(readme, /Local test login autofill/);

console.log('Account switching safeguards passed.');