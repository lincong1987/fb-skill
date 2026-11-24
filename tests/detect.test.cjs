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

test('TA app reports UI line, team rules, local wrappers and an existing CRUD module to copy from', t => {
  const f = fixture(t)
  f.write('src/pages.json', {})
  f.write('src/manifest.json', {})
  f.write('package.json', { name: 'ta-app', dependencies: { vue: '2.6.11', '@topinfoapp/ta-ui': '^0.1.200' } })
  f.write('.agents/rules/project_rules.md', '# team rules')
  f.write('src/components/cu-page-frame/cu-page-frame.vue', '<template><view/></template>')
  f.write('src/components/ta-list/ta-list.vue', '<template><view/></template>')
  f.write('src/pages/notice/notice-list.vue', '')
  f.write('src/pages/notice/notice-add.vue', '')
  f.write('src/pages/notice/notice-view.vue', '')
  f.write('src/pages/index/index.vue', '')
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.deepEqual(unit.profiles, ['mobile-ta-uni'])
  assert.equal(unit.taApp.uiLine, '0.1')
  assert.equal(unit.taApp.uiLineSource, 'declared')
  assert.equal(unit.taApp.teamRules, path.join(fs.realpathSync(f.root), '.agents', 'rules', 'project_rules.md'))
  assert.deepEqual(unit.taApp.localComponents, ['cu-page-frame', 'ta-list'])
  assert.deepEqual(unit.taApp.referenceModules, [{ module: 'notice', pages: ['notice-add.vue', 'notice-list.vue', 'notice-view.vue'] }])
  assert.ok(unit.requiresReview.some(item => item.includes('project_rules.md')))
  assert.ok(!unit.requiresReview.some(item => item.includes('customResultMapp')))
})

test('TA 1.x line is taken from the lock and warns that 0.1-only template props are silently ignored', t => {
  const f = fixture(t)
  f.write('src/pages.json', {})
  f.write('src/manifest.json', {})
  f.write('package.json', { name: 'ta-app', dependencies: { '@topinfoapp/ta-ui': '^0.1.0' } })
  f.write('package-lock.json', { packages: { 'node_modules/@topinfoapp/ta-ui': { version: '1.0.37' } } })
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.equal(unit.taApp.uiLine, '1.x')
  assert.equal(unit.taApp.uiLineSource, 'effective')
  assert.equal(unit.taApp.teamRules, null)
  assert.deepEqual(unit.taApp.localComponents, [])
  assert.deepEqual(unit.taApp.referenceModules, [])
  assert.ok(unit.requiresReview.some(item => item.includes('customResultMapp')))
})

test('TA UI line stays unknown for an unparseable declaration instead of guessing', t => {
  const f = fixture(t)
  f.write('pages.json', {})
  f.write('manifest.json', {})
  f.write('package.json', { name: 'ta-app', dependencies: { '@topinfoapp/ta-ui': 'latest' } })
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.equal(unit.taApp.uiLine, 'unknown')
  assert.equal(unit.taApp.uiLineSource, null)
  assert.ok(unit.requiresReview.some(item => /UI line/.test(item)))
})

test('non-TA units carry no TA app section', t => {
  const f = fixture(t)
  f.write('pages.json', {})
  f.write('manifest.json', {})
  f.write('package.json', { name: 'legacy-tx', dependencies: { vue: '^2.6.0' } })
  assert.equal(detectProject({ projectRoot: f.root }).units[0].taApp, undefined)
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

test('TopInfo platform version is read from a declared dependency and routes to a 2.x profile', t => {
  const f = fixture(t)
  f.write('pom.xml', `<project>
  <parent><groupId>com.topinfo.basic.platform</groupId><artifactId>topinfo-platform</artifactId><version>2.2.3-SNAPSHOT</version></parent>
  <dependencies><dependency>
    <groupId>com.topinfo.basic.platform</groupId>
    <artifactId>topinfo-platform-admin</artifactId>
    <version>2.2.0-SNAPSHOT</version>
  </dependency></dependencies>
</project>`)
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.ok(unit.profiles.includes('java-topinfo-2x-candidate'))
  assert.ok(!unit.profiles.includes('java-topinfo-3x-candidate'))
  assert.deepEqual(unit.platform, {
    name: 'topinfo-platform', version: '2.2.0-SNAPSHOT', versionExpression: null,
    declaredIn: 'pom.xml', artifactId: 'topinfo-platform-admin', parentVersion: '2.2.3-SNAPSHOT',
    declaredAs: 'dependency'
  })
})

test('TopInfo 3.x dependency routes to the 3.x profile, not 2.x', t => {
  const f = fixture(t)
  f.write('pom.xml', `<project><dependencies><dependency>
    <groupId>com.topinfo.basic.platform</groupId>
    <artifactId>topinfo-platform-admin</artifactId>
    <version>3.1.0</version>
  </dependency></dependencies></project>`)
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.ok(unit.profiles.includes('java-topinfo-3x-candidate'))
  assert.ok(!unit.profiles.includes('java-topinfo-2x-candidate'))
  assert.equal(unit.platform.version, '3.1.0')
  assert.equal(unit.platform.declaredAs, 'dependency')
  assert.equal(unit.platform.parentVersion, null)
})

test('a pom that only inherits TopInfo through its parent is still routed by the parent version', t => {
  const f = fixture(t)
  f.write('pom.xml', `<project>
  <parent><groupId>com.topinfo.basic.platform</groupId><artifactId>topinfo-platform</artifactId><version>2.2.3-SNAPSHOT</version></parent>
  <artifactId>mew-manage</artifactId>
</project>`)
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.ok(unit.profiles.includes('java-topinfo-2x-candidate'))
  assert.equal(unit.platform.declaredAs, 'parent')
  assert.equal(unit.platform.version, null)
  assert.equal(unit.platform.parentVersion, '2.2.3-SNAPSHOT')
})

test('TopInfo version left as a property expression is reported, never guessed into a profile', t => {
  const f = fixture(t)
  f.write('pom.xml', `<project><properties><topinfo.version>2.2.3-SNAPSHOT</topinfo.version></properties><dependencies><dependency>
    <groupId>com.topinfo.basic.platform</groupId>
    <artifactId>topinfo-platform-admin</artifactId>
    <version>\${topinfo.version}</version>
  </dependency></dependencies></project>`)
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.ok(!unit.profiles.includes('java-topinfo-2x-candidate'))
  assert.ok(!unit.profiles.includes('java-topinfo-3x-candidate'))
  assert.equal(unit.platform.version, null)
  assert.equal(unit.platform.versionExpression, '${topinfo.version}')
  assert.ok(unit.requiresReview.some(item => /property/i.test(item)))
})

test('a pom without TopInfo coordinates has no platform field and no TopInfo profile', t => {
  const f = fixture(t)
  f.write('pom.xml', '<project><artifactId>spring-boot</artifactId></project>')
  const unit = detectProject({ projectRoot: f.root }).units[0]
  assert.equal(unit.platform, undefined)
  assert.ok(!unit.profiles.some(item => item.startsWith('java-topinfo-')))
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
