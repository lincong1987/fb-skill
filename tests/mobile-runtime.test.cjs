const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const CHECK = path.join(__dirname, 'fixtures/mobile-h5/missing-deps-check.cjs')
const MOBILE = 'D:/projects/T20240246-GMRHCP/T20240246-GMRHCP-Code/trunk/app/mew-manage-app-ui'
const LOCK = path.join(MOBILE, 'package-lock.json')
const PINS = { vue: '2.7.16', 'vue-template-compiler': '2.7.16',
  '@topinfoapp/ta-ui': '0.1.170', '@topinfoapp/ta-js': '0.0.18',
  '@topinfoapp/ta-theme': '0.1.18', '@dcloudio/uni-h5': '2.0.1-alpha-36920221121001' }

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-mobile-check-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function check(root) {
  return spawnSync(process.execPath, [CHECK], { encoding: 'utf8',
    env: { ...process.env, FB_MOBILE_DEPS_ROOT: root || '' } })
}

test('mobile dependency check refuses an unspecified root', () => {
  const result = check()
  assert.equal(result.status, 2)
  assert.match(result.stderr, /FB_MOBILE_DEPS_ROOT/)
})

test('mobile dependency check lists missing packages and refuses to claim H5 execution', t => {
  const result = check(fixture(t))
  assert.equal(result.status, 1)
  for (const [name, version] of Object.entries(PINS)) assert.ok(result.stderr.includes(name + '@' + version))
  assert.match(result.stderr, /NOT-RUN/)
})

test('mobile dependency check accepts pinned package metadata but refuses a different TA version', t => {
  const root = fixture(t)
  for (const [name, version] of Object.entries(PINS)) {
    const file = path.join(root, 'node_modules', name, 'package.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ name, version }))
  }
  assert.equal(check(root).status, 0)
  fs.writeFileSync(path.join(root, 'node_modules/@topinfoapp/ta-ui/package.json'), JSON.stringify({ name: '@topinfoapp/ta-ui', version: '0.1.169' }))
  assert.equal(check(root).status, 1)
})

test('available mobile reference lock matches the target versions', {
  skip: !fs.existsSync(LOCK) && 'The exact mobile reference checkout is unavailable; fixture checks still run.'
}, () => {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  for (const [name, version] of Object.entries(PINS)) assert.equal(lock.packages['node_modules/' + name].version, version)
})

// 实际恢复失败证据在 release-validation/mobile，不以工具单测冒充H5/native验收。
test('TA/uni H5 build and browser execution', {
  skip: 'Exact TA/uni dependencies could not be restored: locked registry unavailable and no offline cache. No H5 page was built.'
}, () => assert.fail('H5 runtime is not implemented until exact dependencies are available'))

test('App native packaging', {
  skip: 'A usable HBuilderX/offline native toolchain was not found; H5 results cannot stand in for native execution.'
}, () => assert.fail('Native runtime is not available'))
