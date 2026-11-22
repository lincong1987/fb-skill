'use strict'

// Catalog/inspect unit tests. Fixtures are built under os.tmpdir(); no real project,
// no catalog output file, and no npm install is touched.
//
// Parse dependencies (@babel/parser, @babel/traverse, vue-template-compiler) are borrowed
// READ-ONLY, discovered in this order and nowhere else (no machine-specific hardcoded
// project paths):
//   1. env FBJS_DEPS_ROOT           — explicit, reproducible
//   2. repo-optional test deps      — <repo>/testdeps, <repo>/tests/testdeps,
//                                     <repo>/.testdeps, <repo>/node_modules
//   3. walk-up from the repo root   — plain Node resolution chain, nothing else
// Tests that need those deps skip with a clear message when nothing is available.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SKILL_ROOT = path.resolve(__dirname, '..', 'skills', 'use-fbjs-vue2')
const REPO_ROOT = path.resolve(__dirname, '..')
const catalog = require(path.join(SKILL_ROOT, 'scripts', 'lib', 'catalog.cjs'))
const inspect = require(path.join(SKILL_ROOT, 'scripts', 'inspect-component.cjs'))

const PARSE_DEPS = ['@babel/parser', '@babel/traverse', 'vue-template-compiler']

function depsResolvable (dir) {
	try {
		for (const dep of PARSE_DEPS) require.resolve(dep, { paths: [dir] })
		return true
	} catch (error) { return false }
}

function findDepsRoot () {
	const candidates = []
	if (process.env.FBJS_DEPS_ROOT) candidates.push(process.env.FBJS_DEPS_ROOT)
	for (const rel of ['testdeps', path.join('tests', 'testdeps'), '.testdeps', 'node_modules']) {
		candidates.push(path.join(REPO_ROOT, rel))
	}
	let dir = REPO_ROOT
	for (;;) {
		candidates.push(dir)
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	for (const candidate of candidates) {
		if (candidate && depsResolvable(candidate)) return candidate
	}
	return null
}

const DEPS_ROOT = findDepsRoot()
if (DEPS_ROOT) catalog.setDepsRoot(DEPS_ROOT)

const TMP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'fbjs-catalog-test-'))
test.after(() => { fs.rmSync(TMP_BASE, { recursive: true, force: true }) })

function write (file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, content, 'utf8')
}

function writeUiRegistry (packageDir, packageSpec, registryFile, component) {
	write(path.join(packageDir, 'package.json'), JSON.stringify(packageSpec))
	write(path.join(packageDir, registryFile), component.registry)
	write(path.join(packageDir, component.file), component.source)
}

function buildFixtureApp () {
	const root = path.join(TMP_BASE, 'app')
	write(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-app', version: '9.9.9', private: true }))

	// installed fb-ui with a source registry (variable array + default export)
	writeUiRegistry(path.join(root, 'node_modules', 'fb-ui'), { name: 'fb-ui', version: '0.0.1', main: 'lib/fb-ui.umd.min.js' },
		'packages/components/components.js',
		{
			registry: "import FbButton from './FbButton.vue'\nimport FbTag from './FbTag.vue'\nconst components = [FbButton, FbTag]\nexport default components\n",
			file: 'packages/components/FbButton.vue',
			source: "<template>\n  <button><slot></slot></button>\n</template>\n<script>\nexport default {\n  name: 'FbButton',\n  props: { size: { type: String, default: 'small' } },\n  methods: { handleClick () { this.$emit('on-click', {}) } },\n}\n</script>\n",
		})
	write(path.join(root, 'node_modules', 'fb-ui', 'packages', 'components', 'FbTag.vue'),
		"<template>\n  <span><slot></slot></span>\n</template>\n<script>\nexport default { name: 'FbTag' }\n</script>\n")

	// installed @topinfo/tp-components whose TpFooBar collides with the local kebab override
	write(path.join(root, 'node_modules', '@topinfo', 'tp-components', 'package.json'), JSON.stringify({ name: '@topinfo/tp-components', version: '0.0.2' }))
	write(path.join(root, 'node_modules', '@topinfo', 'tp-components', 'src', 'index.js'),
		"import TpFooBar from './tp-foo-bar/tp-foo-bar.vue'\nconst componentList = [TpFooBar]\nexport default componentList\n")
	write(path.join(root, 'node_modules', '@topinfo', 'tp-components', 'src', 'tp-foo-bar', 'tp-foo-bar.vue'),
		"<template>\n  <div><slot></slot></div>\n</template>\n<script>\nexport default {\n  name: 'TpFooBar',\n  props: { installedOnly: { type: Boolean, default: false } },\n}\n</script>\n")

	// installed @topinfo/fb-mars3d with a source registry at src/components/index.js
	write(path.join(root, 'node_modules', '@topinfo', 'fb-mars3d', 'package.json'), JSON.stringify({ name: '@topinfo/fb-mars3d', version: '0.0.3' }))
	write(path.join(root, 'node_modules', '@topinfo', 'fb-mars3d', 'src', 'components', 'index.js'),
		"import FbMarsMap from './FbMarsMap.vue'\nexport const componentList = [FbMarsMap]\nexport default { componentList }\n")
	write(path.join(root, 'node_modules', '@topinfo', 'fb-mars3d', 'src', 'components', 'FbMarsMap.vue'),
		"<template>\n  <div></div>\n</template>\n<script>\nexport default { name: 'FbMarsMap' }\n</script>\n")

	// installed fb-ai: package name is UNSCOPED (topinfo/fb-ai package.json declares name
	// "fb-ai"); registry is src/components/index.js holding `const components = [...]`
	write(path.join(root, 'node_modules', 'fb-ai', 'package.json'), JSON.stringify({ name: 'fb-ai', version: '0.0.4', main: 'src/index.js' }))
	write(path.join(root, 'node_modules', 'fb-ai', 'src', 'index.js'), "import FbAiLibrary from './components/index.js'\nexport const install = (Vue, opts) => FbAiLibrary.install(Vue, opts)\n")
	write(path.join(root, 'node_modules', 'fb-ai', 'src', 'components', 'index.js'),
		"import FbAiPlayer from './FbAiPlayer.vue'\nconst components = [FbAiPlayer]\nexport default components\n")
	write(path.join(root, 'node_modules', 'fb-ai', 'src', 'components', 'FbAiPlayer.vue'),
		"<template>\n  <div></div>\n</template>\n<script>\nexport default { name: 'FbAiPlayer' }\n</script>\n")

	// project-local kebab-named components, one of them shadowing the installed TpFooBar
	write(path.join(root, 'src', 'components', 'tp-foo-bar', 'tp-foo-bar.vue'),
		"<template>\n  <div><slot></slot></div>\n</template>\n<script>\nexport default {\n  name: 'tp-foo-bar',\n  props: { localOnly: { type: Boolean, default: false } },\n}\n</script>\n")
	write(path.join(root, 'src', 'components', 'tp-local-dialog', 'tp-local-dialog.vue'),
		"<template>\n  <div></div>\n</template>\n<script>\nexport default { name: 'tp-local-dialog' }\n</script>\n")

	write(path.join(root, 'src', 'views', 'list.vue'),
		"<template>\n  <div>\n    <fb-button size=\"small\">ok</fb-button>\n    <fb-tag>x</fb-tag>\n    <tp-foo-bar :local-only=\"false\"></tp-foo-bar>\n    <tp-local-dialog></tp-local-dialog>\n    <fb-ai-player></fb-ai-player>\n    <fb-mars-map></fb-mars-map>\n  </div>\n</template>\n<script>\nexport default { name: 'ListView' }\n</script>\n")

	// sub-entry without its own package.json (screen-v5/screensj shape)
	write(path.join(root, 'sub-entry', 'views', 'page.vue'),
		"<template>\n  <div>\n    <fb-button>deep</fb-button>\n  </div>\n</template>\n<script>\nexport default { name: 'DeepPage' }\n</script>\n")
	return root
}

// Two real checkouts of the same package must never be conflated: nearest install wins.
function buildTwoVersionsFixture () {
	const parent = path.join(TMP_BASE, 'two-versions')
	write(path.join(parent, 'package.json'), JSON.stringify({ name: 'two-versions-parent', version: '1.0.0' }))
	writeUiRegistry(path.join(parent, 'node_modules', 'fb-ui'), { name: 'fb-ui', version: '1.1.826' },
		'packages/components/components.js',
		{
			registry: "import FbButton from './FbButton.vue'\nconst components = [FbButton]\nexport default components\n",
			file: 'packages/components/FbButton.vue',
			source: "<template>\n  <button></button>\n</template>\n<script>\nexport default { name: 'FbButton' }\n</script>\n",
		})
	const child = path.join(parent, 'gov', 'trunk', 'app')
	write(path.join(child, 'package.json'), JSON.stringify({ name: 'two-versions-child', version: '2.0.0' }))
	writeUiRegistry(path.join(child, 'node_modules', 'fb-ui'), { name: 'fb-ui', version: '1.1.819' },
		'packages/components/components.js',
		{
			registry: "import FbButton from './FbButton.vue'\nconst components = [FbButton]\nexport default components\n",
			file: 'packages/components/FbButton.vue',
			source: "<template>\n  <button></button>\n</template>\n<script>\nexport default { name: 'FbButton' }\n</script>\n",
		})
	write(path.join(child, 'src', 'views', 'page.vue'),
		"<template>\n  <div>\n    <fb-button></fb-button>\n  </div>\n</template>\n<script>\nexport default { name: 'Page' }\n</script>\n")
	return { parent, child }
}

const FIXTURE_APP = buildFixtureApp()
const TWO_VERSIONS = buildTwoVersionsFixture()

function findByTag (cat, tag) {
	return cat.components.filter(component => component.tag === tag)
}

test('isLocalComponentName accepts Pascal, kebab and camel fb/tp/screen names', () => {
	assert.equal(catalog.isLocalComponentName('TpDialog'), true)
	assert.equal(catalog.isLocalComponentName('tp-dialog'), true)
	assert.equal(catalog.isLocalComponentName('tpDialog'), true)
	assert.equal(catalog.isLocalComponentName('ScreenPanelLeft'), true)
	assert.equal(catalog.isLocalComponentName('my-widget'), false)
	assert.equal(catalog.isLocalComponentName(undefined), false)
})

test('parseArgs refuses vue3 upstream roots', () => {
	assert.throws(() => catalog.parseArgs(['--fbjs-root', 'D:/repos/fb/packages-vue3/fb-ui']), /Refusing Vue3 source/)
})

test('parseArgs accepts --deps-root and --stop-root', () => {
	const options = catalog.parseArgs(['--deps-root', 'D:/deps', '--stop-root=D:/boundary'])
	assert.equal(options.depsRoot, path.resolve('D:/deps'))
	assert.equal(options.stopRoot, path.resolve('D:/boundary'))
})

test('parseNarrowOptions/removeNarrowArgs handle inline and separate forms', () => {
	const args = ['--project-root', '.', '--owner=fb-ui', '--file', 'D:/x/y.vue', 'rest']
	const options = inspect.parseNarrowOptions(args)
	assert.equal(options.owner, 'fb-ui')
	assert.equal(options.file, 'D:/x/y.vue')
	assert.deepEqual(inspect.removeNarrowArgs(args), ['--project-root', '.', 'rest'])
	assert.throws(() => inspect.parseNarrowOptions(['--owner']), /Missing value/)
})

test('findQueryIndex keeps treating narrow options as valued options', () => {
	assert.equal(inspect.findQueryIndex(['fb-button', '--project-root', '.']), 0)
	assert.equal(inspect.findQueryIndex(['--owner', 'fb-ui', 'fb-button']), 2)
	assert.equal(inspect.findQueryIndex(['--owner=fb-ui', 'fb-button']), 1)
	assert.equal(inspect.findQueryIndex(['--stop-root', '/tmp', 'fb-button']), 2)
})

test('findApplicationRoot honours the stop boundary deterministically', () => {
	// No package.json inside the bounded fixture tree -> null regardless of what the
	// real filesystem above the tmp dir contains (stray package.json cannot leak in).
	assert.equal(catalog.findApplicationRoot(path.join(TMP_BASE, 'no-root', 'deep', 'deeper'), TMP_BASE), null)
	assert.equal(catalog.findApplicationRoot(path.join(TMP_BASE, 'app', 'sub-entry'), TMP_BASE), FIXTURE_APP)
})

test('buildCatalog throws instead of returning a silent empty catalog when no package.json exists inside the boundary', () => {
	assert.throws(() => catalog.buildCatalog({ projectRoot: path.join(TMP_BASE, 'no-root', 'deep', 'deeper'), stopRoot: TMP_BASE }), /No package\.json found at or above/)
})

test('resolveInstalledPackage walks up to hoisted node_modules', () => {
	const found = catalog.resolveInstalledPackage('fb-ui', path.join(FIXTURE_APP, 'sub-entry'))
	assert.ok(found, 'hoisted fb-ui must be found from the sub-entry')
	assert.equal(found.manifest.version, '0.0.1')
	assert.equal(path.basename(found.resolvedFrom), 'app')
	assert.equal(catalog.resolveInstalledPackage('definitely-not-here', FIXTURE_APP), null)
})

test('two real checkouts keep separate versions: nearest install wins, none conflated', { skip: !DEPS_ROOT && 'no parse deps found (set FBJS_DEPS_ROOT)' }, () => {
	const fromChild = catalog.resolveInstalledPackage('fb-ui', TWO_VERSIONS.child)
	assert.equal(fromChild.manifest.version, '1.1.819')
	assert.equal(fromChild.resolvedFrom, TWO_VERSIONS.child)
	const fromParent = catalog.resolveInstalledPackage('fb-ui', TWO_VERSIONS.parent)
	assert.equal(fromParent.manifest.version, '1.1.826')
	assert.equal(fromParent.resolvedFrom, TWO_VERSIONS.parent)

	const cat = catalog.buildCatalog({ projectRoot: TWO_VERSIONS.child })
	const button = cat.components.filter(component => component.tag === 'fb-button')
	assert.equal(button.length, 1)
	assert.equal(button[0].version, '1.1.819', 'child catalog must read the child install, never the hoisted parent')
	assert.ok(button[0].source.startsWith('installed:fb-ui/'), `sourceAlias must point at the real install root, got ${button[0].source}`)

	const parentCat = catalog.buildCatalog({ projectRoot: TWO_VERSIONS.parent })
	const parentButton = parentCat.components.filter(component => component.tag === 'fb-button')
	assert.equal(parentButton[0].version, '1.1.826')
})

test('fixture catalog captures kebab locals, collisions, mars3d, unscoped fb-ai source', { skip: !DEPS_ROOT && 'no parse deps found (set FBJS_DEPS_ROOT)' }, () => {
	const cat = catalog.buildCatalog({ projectRoot: FIXTURE_APP })

	assert.equal(cat.context.projectRoot, FIXTURE_APP)
	assert.equal(cat.context.projectRootPromoted, false)

	// kebab local name is captured now
	const locals = findByTag(cat, 'tp-local-dialog')
	assert.equal(locals.length, 1)
	assert.equal(locals[0].owner, 'project-local')
	assert.equal(locals[0].availability, 'local')

	// installed vs local override collision is surfaced instead of silently merged
	const fooBar = findByTag(cat, 'tp-foo-bar')
	assert.deepEqual([...new Set(fooBar.map(item => item.owner))].sort(), ['@topinfo/tp-components', 'project-local'])
	assert.ok(cat.ambiguousUsage.some(item => item.tag === 'tp-foo-bar'))

	// added PACKAGES entry resolves fb-mars3d from source registry
	const marsMap = findByTag(cat, 'fb-mars-map')
	assert.equal(marsMap.length, 1)
	assert.equal(marsMap[0].owner, '@topinfo/fb-mars3d')
	assert.equal(marsMap[0].availability, 'installed')
	assert.equal(marsMap[0].registered, true)
	assert.equal(marsMap[0].version, '0.0.3')

	// fb-ui component parsed from SFC source
	const button = findByTag(cat, 'fb-button')
	assert.equal(button.length, 1)
	assert.equal(button[0].owner, 'fb-ui')
	assert.deepEqual(button[0].events, ['on-click'])
	assert.ok(button[0].usageCount >= 1)

	// unscoped fb-ai (package.json name "fb-ai") resolved from src/components/index.js
	const aiPlayer = findByTag(cat, 'fb-ai-player')
	assert.equal(aiPlayer.length, 1)
	assert.equal(aiPlayer[0].owner, 'fb-ai')
	assert.equal(aiPlayer[0].version, '0.0.4')
	assert.equal(aiPlayer[0].source, 'installed:fb-ai/src/components/FbAiPlayer.vue')
	assert.ok(!cat.unresolvedUsage.some(item => item.tag === 'fb-ai-player'))
})

test('installed package with no source registry stays honestly unresolved', { skip: !DEPS_ROOT && 'no parse deps found (set FBJS_DEPS_ROOT)' }, () => {
	const root = path.join(TMP_BASE, 'app-lib-only')
	write(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-lib-only', version: '1.0.0' }))
	write(path.join(root, 'node_modules', 'fb-ai', 'package.json'), JSON.stringify({ name: 'fb-ai', version: '0.9.0', main: 'lib/index.js' }))
	write(path.join(root, 'node_modules', 'fb-ai', 'lib', 'index.js'), 'module.exports = {}\n')
	write(path.join(root, 'src', 'views', 'chat.vue'),
		"<template>\n  <div>\n    <fb-ai-player></fb-ai-player>\n  </div>\n</template>\n<script>\nexport default { name: 'Chat' }\n</script>\n")

	const cat = catalog.buildCatalog({ projectRoot: root, stopRoot: TMP_BASE })
	assert.equal(findByTag(cat, 'fb-ai-player').length, 0, 'lib-only install must not fabricate component records')
	assert.ok(cat.unresolvedUsage.some(item => item.tag === 'fb-ai-player'), 'usage must stay unresolved, not guessed')
})

test('buildCatalog promotes a sub-entry to the nearest application root and keeps working', { skip: !DEPS_ROOT && 'no parse deps found (set FBJS_DEPS_ROOT)' }, () => {
	const subEntry = path.join(FIXTURE_APP, 'sub-entry')
	const cat = catalog.buildCatalog({ projectRoot: subEntry })
	assert.equal(cat.context.projectRoot, FIXTURE_APP)
	assert.equal(cat.context.requestedProjectRoot, subEntry)
	assert.equal(cat.context.projectRootPromoted, true)
	assert.ok(cat.components.length > 0, 'promoted root must not produce a silent empty catalog')
	const button = findByTag(cat, 'fb-button')
	assert.equal(button.length, 1)
})

test('resolveComponentQuery narrows ambiguity by exact owner or file, never auto-picks', { skip: !DEPS_ROOT && 'no parse deps found (set FBJS_DEPS_ROOT)' }, () => {
	const cat = catalog.buildCatalog({ projectRoot: FIXTURE_APP })
	const installedFile = path.join(FIXTURE_APP, 'node_modules', '@topinfo', 'tp-components', 'src', 'tp-foo-bar', 'tp-foo-bar.vue')
	const localFile = path.join(FIXTURE_APP, 'src', 'components', 'tp-foo-bar', 'tp-foo-bar.vue')

	// ambiguous without flags -> fail with candidates, no silent winner
	const ambiguous = inspect.resolveComponentQuery(cat, 'tp-foo-bar', {})
	assert.ok(ambiguous.error && /Ambiguous component/.test(ambiguous.error), ambiguous.error)
	assert.ok(/@topinfo\/tp-components/.test(ambiguous.candidates))
	assert.ok(/project-local/.test(ambiguous.candidates))

	// exact owner narrowing (both directions)
	const byInstalled = inspect.resolveComponentQuery(cat, 'tp-foo-bar', { owner: '@topinfo/tp-components' })
	assert.equal(byInstalled.component.owner, '@topinfo/tp-components')
	assert.equal(byInstalled.component.availability, 'installed')
	const byLocal = inspect.resolveComponentQuery(cat, 'tp-foo-bar', { owner: 'project-local' })
	assert.equal(byLocal.component.owner, 'project-local')
	assert.equal(byLocal.component.availability, 'local')

	// wrong owner -> fail loudly listing candidates
	const wrongOwner = inspect.resolveComponentQuery(cat, 'tp-foo-bar', { owner: 'fb-ui' })
	assert.ok(wrongOwner.error && /No match for tp-foo-bar narrowed/.test(wrongOwner.error))

	// file narrowing resolves to exactly one record
	const byFile = inspect.resolveComponentQuery(cat, 'tp-foo-bar', { file: installedFile })
	assert.equal(byFile.component.owner, '@topinfo/tp-components')
	const byLocalFile = inspect.resolveComponentQuery(cat, 'tp-foo-bar', { file: localFile })
	assert.equal(byLocalFile.component.owner, 'project-local')
})
