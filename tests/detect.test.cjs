const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { detectProject } = require('../skills/create-fb-feature/scripts/lib/detect.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-detect-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return {
    root,
    write(relative, content) {
      const file = path.join(root, relative)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
    }
  }
}

test('reports installed and locked versions separately; never executes config', t => {
  const f = fixture(t)
  f.write('package.json', { name: 'pc', dependencies: { vue: '^2.6.12', 'fb-ui': '^1.1.0', '@topinfo/admin-base': '^2.2.0' } })
  f.write('node_modules/vue/package.json', { name: 'vue', version: '2.7.16' })
  f.write('node_modules/fb-ui/package.json', { name: 'fb-ui', version: '1.1.840' })
  f.write('package-lock.json', { packages: { 'node_modules/fb-ui': { version: '1.1.839' } } })
  f.write('project.config.js', 'throw new Error("CONFIG MUST NOT RUN")\nmodule.exports = { entry: "screen-v5/main.js" }')
  const result = detectProject({ projectRoot: f.root })
  const unit = result.units[0]
  assert.equal(result.units.length, 1)
  assert.equal(unit.vueLine, 'vue2.7')
  assert.equal(unit.dependencies['fb-ui'].effectiveVersion, '1.1.840')
  assert.equal(unit.dependencies['fb-ui'].locked.version, '1.1.839')
  assert.ok(result.notes.some(note => note.reason.includes('differs from lock')))
  assert.ok(unit.screenEntryCandidates.some(item => item.entry === 'screen-v5/main.js'))
  assert.equal(result.readOnly, true)
})

test('does not force legacy uni-app into TA-UI', t => {
  const f = fixture(t)
  f.write('pages.json', {})
  f.write('manifest.json', {})
  f.write('package.json', { name: 'legacy-tx', dependencies: { vue: '^2.6.0' } })
  assert.deepEqual(detectProject({ projectRoot: f.root }).units[0].profiles, ['mobile-uni-unclassified'])
})

test('TA declaration without installed library stays unverified; router declaration is not activation', t => {
  const f = fixture(t)
  f.write('src/pages.json', {})
  f.write('src/manifest.json', {})
  f.write('package.json', { name: 'ta-app', dependencies: { vue: '2.7.16', '@topinfoapp/ta-ui': '^0.1.170', 'uni-simple-router': '^2.0.0' } })
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.deepEqual(unit.profiles, ['mobile-ta-uni'])
  assert.equal(unit.dependencies['@topinfoapp/ta-ui'].effectiveVersion, null)
  assert.ok(unit.requiresReview.some(item => item.includes('not installed')))
  assert.ok(unit.requiresReview.some(item => item.includes('assuming it is enabled')))
})

test('Vue 3 installed evidence cannot borrow Vue 2 contract', t => {
  const f = fixture(t)
  f.write('package.json', { dependencies: { vue: '^3.0.0', 'fb-ui': '^1.0.0' } })
  f.write('node_modules/vue/package.json', { name: 'vue', version: '3.4.14' })
  assert.deepEqual(detectProject({ projectRoot: f.root }).units[0].profiles, ['fb-vue3-unverified'])
})

test('discovers Maven modules and DDL below supplied parent; reports coverage', t => {
  const f = fixture(t)
  f.write('code/trunk/server/pom.xml', '<project><module>api</module><artifactId>spring-boot</artifactId></project>')
  f.write('code/trunk/server/api/pom.xml', '<project><artifactId>mybatis-plus</artifactId><artifactId>DmJdbcDriver18</artifactId></project>')
  f.write('code/trunk/sql/schema.sql', 'CREATE TABLE sample(id VARCHAR(32));')
  const result = detectProject({ projectRoot: f.root })
  assert.equal(result.units.filter(unit => unit.kind === 'backend').length, 2)
  assert.equal(result.sqlCandidates.length, 1)
  assert.equal(result.units.find(unit => unit.root.endsWith('api')).databaseDriverCandidates[0], 'dameng')
  assert.equal(result.coverage.truncated, false)
})

test('hoisted workspace installed dependency is reported with its actual path', t => {
  const f = fixture(t)
  f.write('packages/client/package.json', { name: 'client', dependencies: { 'fb-ui': '^1.1.0' } })
  f.write('node_modules/fb-ui/package.json', { name: 'fb-ui', version: '1.1.840' })
  const unit = detectProject({ projectRoot: path.join(f.root, 'packages/client') }).units[0]
  assert.equal(unit.dependencies['fb-ui'].installed.source, 'installed-hoisted')
})

test('skips linked project trees and never claims absence beyond depth budget', t => {
  const f = fixture(t)
  f.write('deep/one/two/three/pom.xml', '<project/>')
  const result = detectProject({ projectRoot: f.root, maxDepth: 1 })
  assert.equal(result.units.length, 0)
  assert.equal(result.coverage.truncated, true)
  assert.ok(result.notes.some(item => item.reason.includes('empty results do not establish absence')))
  const link = path.join(f.root, 'linked')
  try { fs.symlinkSync(path.join(f.root, 'deep'), link, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (error.code === 'EPERM') return
    throw error
  }
  assert.ok(detectProject({ projectRoot: f.root }).coverage.skippedLinks.includes(link))
})

test('rejects target outside root and malformed input without changing project', t => {
  const f = fixture(t)
  assert.throws(() => detectProject({ projectRoot: f.root, target: '../outside.vue' }), /inside/)
  assert.throws(() => detectProject({ projectRoot: f.root, maxDepth: 0 }), /maxDepth/)
  f.write('package.json', '{broken-json')
  const result = detectProject({ projectRoot: f.root })
  assert.ok(result.notes.some(item => item.reason.includes('Invalid JSON')))
  assert.equal(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'), '{broken-json')
})
