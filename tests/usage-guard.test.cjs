const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const guard = require('../skills/use-fbjs-vue2/scripts/check-fbjs-usage.cjs')
const catalog = require('../skills/use-fbjs-vue2/scripts/lib/catalog.cjs')
const CLI = path.join(__dirname, '../skills/use-fbjs-vue2/scripts/check-fbjs-usage.cjs')

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-usage-guard-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function parserAvailable() {
  try {
    for (const name of ['@babel/parser', '@babel/traverse', 'vue-template-compiler']) catalog.loadProjectDependency(name)
    return true
  } catch { return false }
}

const sourceOptions = { skip: !parserAvailable() && 'Parser dependencies unavailable; set FBJS_DEPS_ROOT to a verified Vue 2 application' }

test('raw upload alone is not a violation of a project-specific wrapper policy', () => {
  assert.equal(guard.RULES.some(rule => rule.id === 'raw-fb-upload'), false)
})

test('missing parser is reported as incomplete, never silent success', t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'page.vue'), '<template><div /></template><script>export default {}</script>')
  const env = { ...process.env }
  delete env.FBJS_DEPS_ROOT
  const result = spawnSync(process.execPath, [CLI, '--root', root], { cwd: root, env, encoding: 'utf8' })
  if (result.status === 0) {
    t.skip('Parser is also available by normal Node resolution; missing-dependency branch cannot be isolated here')
    return
  }
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /incomplete|unavailable|依赖|Cannot resolve/i)
  assert.doesNotMatch(result.stdout, /OK/)
})

test('invalid JavaScript does not become an empty passing AST check', sourceOptions, t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'broken.js'), 'const = ;')
  assert.throws(() => guard.findViolations(root), /incomplete|parse|Unexpected/i)
})

test('TypeScript is parsed and callback-confirm Promise misuse is still detected', sourceOptions, t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'typed.ts'), "const count: number = 1\n$confirm('confirm').then(() => count)\n")
  assert.ok(guard.findViolations(root).some(item => item.rule === 'confirm-promise'))
})

test('native click and deliberately integrated raw upload are not false violations', sourceOptions, t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'page.vue'), '<template><div><button @click="save">ok</button><fb-upload :action="url" /></div></template><script>export default { data: () => ({ url: "/mock" }), methods: { save() {} } }</script>')
  assert.deepEqual(guard.findViolations(root), [])
})

test('correct FbButton event passes while Element-style event is reported', sourceOptions, t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'page.vue'), '<template><div><fb-button @on-click="save">ok</fb-button><fb-button @click="save">wrong</fb-button></div></template><script>export default { methods: { save() {} } }</script>')
  const found = guard.findViolations(root)
  assert.equal(found.filter(item => item.rule === 'fb-button-click').length, 1)
})

test('Vue SFC TypeScript script keeps the declared language during AST checks', sourceOptions, t => {
  const root = temporary(t)
  fs.writeFileSync(path.join(root, 'page.vue'), '<template><div /></template><script lang="ts">const count: number = 1\n$confirm("confirm").then(() => count)</script>')
  assert.ok(guard.findViolations(root).some(item => item.rule === 'confirm-promise'))
})

test('linked source trees are explicitly incomplete instead of silently traversed', t => {
  const root = temporary(t)
  const outside = temporary(t)
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => guard.findViolations(root), /incomplete.*linked/i)
})
