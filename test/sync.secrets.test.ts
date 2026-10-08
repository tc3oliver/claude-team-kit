import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redact, scanFiles, scanText, shannon } from '../src/sync/secrets.ts'

// Fixtures are assembled at run time so this file itself never looks like a leaked credential.
const rnd = 'q7Zk3Vn9Xb2LmP4wR8tY1cHd5FgJ6sAe'
const positives: [string, string, string][] = [
  ['anthropic', `key = sk-ant-api03-${rnd}${rnd}`, 'anthropic-key'],
  ['openai', `OPENAI=sk-${rnd}9aB`, 'openai-key'],
  ['openai project', `sk-proj-${rnd}${rnd}`, 'openai-key'],
  ['github pat', `token ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6'}`, 'github-token'],
  ['github fine grained', `github_pat_${'11ABCDEFG0aBcDeFgHiJk'}_${'x'.repeat(30)}`, 'github-token'],
  ['aws access key', 'AKIA' + 'IOSFODNN7EXAMPLE', 'aws-access-key'],
  ['google', 'AIza' + 'SyA-1234567890abcdefghijklmnopqrstuv', 'google-api-key'],
  ['slack bot', 'xoxb-' + '123456789012-abcdefghijkl', 'slack-token'],
  ['slack webhook', 'https://hooks.slack.com/services/T0123ABCD/B0123ABCD/' + 'a1B2c3D4e5F6g7H8i9J0k1L2', 'slack-webhook'],
  ['stripe', 'sk_live_' + '51H8abcdEFGHijklMNOP', 'stripe-key'],
  ['private key', '-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
  ['private key (openssh)', '-----BEGIN OPENSSH PRIVATE KEY-----', 'private-key'],
  ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'jwt'],
  ['bearer', 'Authorization: Bearer abcDEF1234567890xyzQ', 'bearer-token'],
  ['url credentials', 'git clone https://deploy:hunter2hunter2@example.com/repo.git', 'url-credentials'],
  ['generic api key', 'api_key = "abcd1234efgh5678ijkl"', 'generic-secret'],
  ['generic password json', '"password": "Zx9Qw8Er7Ty6Ui5O"', 'generic-secret'],
  ['generic secret yaml', 'client-secret: Zx9Qw8Er7Ty6Ui5Op', 'generic-secret'],
  ['password with punctuation', 'password: "Tr0ub4dor&3-horse!battery#staple"', 'generic-secret'],
  ['env style DB_PASSWORD', 'DB_PASSWORD=hunter2hunter2!x', 'generic-secret'],
  ['export PASSWD', 'export PASSWD=c0rrecthorsebatterystaple99', 'generic-secret'],
  ['pwd keyword', 'PWD=Sup3rS3cretValue', 'generic-secret'],
  ['access_key hex', 'access_key = 9f86d081884c7d659a2feaa0c55ad015', 'generic-secret'],
  ['private_key value', 'private_key: MIIEvQIBADANBgkqhkiG9w0B', 'generic-secret'],
  ['auth header-ish value', 'auth: Zm9vOmJhcjEyMzQ1Ng==', 'generic-secret'],
  ['credential value', 'credential = a8f5f167f44f4964e6c998dee827110c', 'generic-secret'],
  ['url hex path token', 'https://api.example.com/hook/' + '9f86d081884c7d659a2feaa0c55ad015' + '3b3dc1f0a1b2c3d4e5f60718293a4b5c', 'url-token'],
  ['url hex query token', 'curl "https://api.example.com/v1/x?key=' + '9f86d081884c7d659a2feaa0c55ad015"', 'url-token'],
  ['url base32 token', 'https://api.example.com/t/' + 'mfrggzdfmztwq2lknnwg23tpobyxe43u', 'url-token'],
  ['mixed case api key with hyphen', 'api_key: "AbCdEfGh-IjKlMnOp"', 'generic-secret'],
  ['uppercase base32 secret', `seed ${'W4DKMIQT37ZZ5QZTUJYK2O7Q2M673NKG'}`, 'high-entropy'],
  ['high entropy value', `"note": "${'Zk3Vn9Xb2LmP4wR8tY1cHd5FgJ6sAe7Q'}"`, 'high-entropy'],
]

for (const [name, text, rule] of positives) {
  test(`secrets: flags ${name}`, () => {
    const found = scanText('f.txt', text)
    assert.ok(found.some(f => f.rule === rule), `expected ${rule}, got ${JSON.stringify(found)}`)
    assert.equal(found[0]?.line, 1)
  })
}

const negatives: [string, string][] = [
  ['git sha', 'commit 3f786850e387550fdab836ed7e6dc881de23001b'],
  ['sha256 hex', 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'],
  ['uuid', 'id: 123e4567-e89b-12d3-a456-426614174000'],
  ['npm integrity', '"integrity": "sha512-' + 'Zk3Vn9Xb2LmP4wR8tY1cHd5FgJ6sAe7QpW0oIuYtRe3Mnb5Vcx7Zl9KjHg2FdSa4Pq6Ow8Er1Ty3Ui5Op7AsDfGhJk9Lz==' + '"'],
  ['go.sum', 'golang.org/x/text v0.3.0 h1:' + 'g17k0bR5s4h2qJ9x8Ay3mN1pVwZc7LdTfEoYuIiKj2o='],
  ['yarn integrity', '  integrity sha1-' + 'Zk3Vn9Xb2LmP4wR8tY1cHd5FgJ6sAe7Q='],
  ['long path', 'see plugins/ctk/skills/team/references/spawn-confirmation-protocol.md'],
  ['alphabet run', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['env var name', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'],
  ['camel identifier', 'getUserProfileDataFromServer2Async'],
  ['prose token', 'token: use-the-keychain-instead'],
  ['placeholder bearer', 'Authorization: Bearer <your-token-here>'],
  ['env bearer', 'curl -H "Authorization: Bearer $ANTHROPIC_TOKEN"'],
  ['url with user only', 'git clone ssh://git@github.com/org/repo.git'],
  ['url placeholder password', 'https://user:${PASSWORD}@example.com'],
  ['maxTokens key', '"maxTokens": 4096'],
  ['short secret', 'password: hunter2'],
  ['git sha in prose', 'fixed in 3f786850e387550fdab836ed7e6dc881de23001b, see the log'],
  ['git sha in a commit url', 'https://github.com/org/repo/commit/3f786850e387550fdab836ed7e6dc881de23001b'],
  ['sha256 in a blob url', 'https://github.com/org/repo/blob/' + '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' + '/README.md'],
  ['lockfile resolved url with fragment', '"resolved": "https://registry.npmjs.org/x/-/x-1.0.0.tgz#3f786850e387550fdab836ed7e6dc881de23001b"'],
  ['uuid in url', 'https://example.com/items/123e4567-e89b-12d3-a456-426614174000'],
  ['long slug in url', 'https://example.com/docs/how-to-configure-the-team-kit-for-large-projects'],
  ['kebab words after keyword', 'password: correct-horse-battery-staple'],
  ['snake words after keyword', 'secret = use_the_system_keychain'],
  ['env var names without values', 'export GITHUB_TOKEN\nexport DB_PASSWORD=\nAPI_KEY=$API_KEY\npassword: ${PASSWORD}'],
  ['placeholder keyword values', 'token: required\npassword: redacted\napi_key: <your-api-key>'],
  ['path after a keyword', 'credentials: ~/.aws/credentials-file\npwd: /Users/someone/project'],
  ['author is not auth', 'author: Someone Else'],
  ['plain sentence', 'Use the api key from the keychain, never paste it here.'],
]

for (const [name, text] of negatives) {
  test(`secrets: does not flag ${name}`, () => {
    assert.deepEqual(scanText('f.md', text), [])
  })
}

test('secrets: JSON deny-listed keys are flagged anywhere, case and separator insensitive', () => {
  for (const key of ['apiKey', 'api_key', 'token', 'secret', 'password', 'oauthAccount', 'OAUTH_TOKEN', 'credentials', 'authorization', 'refreshToken', 'apiKeyHelper', 'env', 'accessToken', 'client-secret']) {
    const found = scanText('s.json', `{\n  "outer": {\n    "${key}": "x"\n  }\n}`)
    assert.ok(found.some(f => f.rule === `denied-key:${key}` && f.line === 3), `${key}: ${JSON.stringify(found)}`)
  }
  assert.deepEqual(scanText('s.json', '{"maxTokens": 5, "model": "haiku", "environment": "x"}'), [])
  assert.deepEqual(scanText('s.md', '"token": "x"'), [], 'the key deny-list is for JSON files only')
})

test('secrets: findings never contain the secret, only a redacted preview', () => {
  const secret = `sk-ant-api03-${rnd}${rnd}`
  const [f] = scanText('a/b.md', `\n\nkey ${secret}`)
  assert.equal(f?.line, 3)
  assert.equal(f?.file, 'a/b.md')
  assert.ok(!JSON.stringify(f).includes(secret.slice(4, 24)))
  assert.ok((f?.preview.length ?? 99) <= 5)
})

test('secrets: one value yields one finding even when several rules match', () => {
  const found = scanText('x.md', `api_key: sk-ant-api03-${rnd}${rnd}`)
  assert.equal(found.length, 1)
})

test('secrets: CRLF line numbers and multiple files', () => {
  const found = scanFiles([
    { path: 'a.md', content: 'ok\r\nok\r\n-----BEGIN PRIVATE KEY-----\r\n' },
    { path: 'b.md', content: 'clean' },
  ])
  assert.deepEqual(found.map(f => [f.file, f.line, f.rule]), [['a.md', 3, 'private-key']])
})

test('secrets: entropy helper and redact', () => {
  assert.equal(shannon('aaaa'), 0)
  assert.ok(shannon('abcdefghijklmnop') === 4)
  assert.equal(redact('abc'), '****')
  assert.equal(redact('abcdefghij'), 'ab…ij')
})
