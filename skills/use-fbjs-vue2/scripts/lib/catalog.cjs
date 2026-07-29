'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

const SKILL_ROOT = path.resolve(__dirname, '..', '..')
const PROJECT_ROOT = path.resolve(process.cwd())

const DEFAULT_EXTERNAL_ROOTS = {
	fbjs: null,
	admin: null,
	screen: null,
	ai: null,
	player: null,
}

const dependencyCache = new Map()

function loadProjectDependency (packageName, searchRoot = PROJECT_ROOT) {
	const key = `${packageName}|${path.resolve(searchRoot)}`
	if (dependencyCache.has(key)) return dependencyCache.get(key)
	let resolved
	try {
		resolved = require.resolve(packageName, { paths: [searchRoot, PROJECT_ROOT, SKILL_ROOT] })
	} catch (error) {
		throw new Error(`Missing ${packageName}. Install the target Vue 2 project's dependencies before running this skill.`)
	}
	const dependency = require(resolved)
	dependencyCache.set(key, dependency)
	return dependency
}

function projectScanDirs (projectRoot) {
	const names = new Set(['src', 'common-libs', 'plugin'])
	if (directoryExists(projectRoot)) {
		for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
			if (entry.isDirectory() && /^screen-[a-z0-9-]+$/i.test(entry.name)) names.add(entry.name)
		}
	}
	return [...names].sort()
}

function defaultOutputRoot (projectRoot) {
	return path.join(projectRoot, '.agents', 'fbjs-vue2')
}

const PACKAGES = [
	{ owner: 'fb-ui', packageName: 'fb-ui', kind: 'registry', registry: 'packages/components/components.js' },
	{ owner: 'fb-third', packageName: 'fb-third', kind: 'third', registry: 'src/index.js' },
	{ owner: '@topinfo/tp-components', packageName: '@topinfo/tp-components', kind: 'registry', registry: 'src/index.js' },
	{ owner: '@topinfo/screen-base', packageName: '@topinfo/screen-base', kind: 'registry', registry: 'src/components/index.js' },
	{ owner: '@topinfo/fb-player', packageName: '@topinfo/fb-player', kind: 'registry', registry: 'src/components/index.js' },
	{ owner: '@topinfo/fb-three', packageName: '@topinfo/fb-three', kind: 'registry', registry: 'src/components/index.js' },
]

const OPTIONAL_COMPONENTS = [
	{
		owner: '@topinfo/admin-base',
		packageName: '@topinfo/admin-base',
		file: 'src/components/tp-org-async-tree-select/TpOrgAsyncTreeSelect.vue',
		registered: false,
	},
]

function slash (value) {
	return value.replace(/\\/g, '/')
}

function kebabCase (value) {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.replace(/[_\s]+/g, '-')
		.toLowerCase()
}

function pascalCase (value) {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')
}

function readText (file) {
	return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

function stripComments (source) {
	return source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, match => match.replace(/[^\n]/g, ' '))
}

function readJson (file) {
	return JSON.parse(readText(file))
}

function fileExists (file) {
	try {
		return fs.statSync(file).isFile()
	} catch (error) {
		return false
	}
}

function directoryExists (directory) {
	try {
		return fs.statSync(directory).isDirectory()
	} catch (error) {
		return false
	}
}

function resolveInstalledPackage (packageName, projectRoot = PROJECT_ROOT) {
	const manifest = path.join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json')
	if (!fileExists(manifest)) return null
	return { root: path.dirname(manifest), manifest: readJson(manifest) }
}

function parseArgs (argv) {
	const options = {
		allowMissingUpstream: false,
		check: false,
		projectRoot: PROJECT_ROOT,
		outputRoot: null,
		externalRoots: { ...DEFAULT_EXTERNAL_ROOTS },
		adminRef: 'HEAD',
	}

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === '--check') {
			options.check = true
			continue
		}
		if (arg === '--allow-missing-upstream') {
			options.allowMissingUpstream = true
			continue
		}
		if (arg === '--admin-ref' || arg.startsWith('--admin-ref=')) {
			const inline = arg.includes('=')
			const value = inline ? arg.slice(arg.indexOf('=') + 1) : argv[++index]
			if (!value || (!inline && value.startsWith('--'))) throw new Error(`Missing value for ${arg}`)
			options.adminRef = value
			continue
		}
		const match = arg.match(/^--(project|output|fbjs|admin|screen|ai|player)-root(?:=(.*))?$/)
		if (!match) throw new Error(`Unknown option: ${arg}`)
		const inline = match[2] !== undefined
		const value = inline ? match[2] : argv[++index]
		if (!value || (!inline && value.startsWith('--'))) throw new Error(`Missing value for ${arg}`)
		const resolved = path.resolve(value)
		if (match[1] === 'project') options.projectRoot = resolved
		else if (match[1] === 'output') options.outputRoot = resolved
		else options.externalRoots[match[1]] = resolved
	}
	if (!options.outputRoot) options.outputRoot = defaultOutputRoot(options.projectRoot)

	for (const [key, value] of Object.entries(options.externalRoots)) {
		if (!value) continue
		const normalized = slash(value).toLowerCase()
		if (normalized.includes('/packages-vue3') || normalized.includes('/fb-ui-v3')) {
			throw new Error(`Refusing Vue3 source for ${key}: ${value}`)
		}
	}

	return options
}

function sourceAlias (file, context) {
	const absolute = path.resolve(file)
	const candidates = [
		['project', context.projectRoot],
		...Object.entries(context.externalRoots).map(([key, root]) => [`upstream:${key}`, root]),
	]
	const installedRoot = path.join(context.projectRoot, 'node_modules')
	if (absolute === installedRoot || absolute.startsWith(installedRoot + path.sep)) {
		return `installed:${slash(path.relative(installedRoot, absolute))}`
	}
	for (const [alias, root] of candidates) {
		if (!root) continue
		const resolvedRoot = path.resolve(root)
		if (absolute === resolvedRoot || absolute.startsWith(resolvedRoot + path.sep)) {
			return `${alias}:${slash(path.relative(resolvedRoot, absolute))}`
		}
	}
	return `external:${path.basename(absolute)}`
}

function listFiles (root, filter, output = []) {
	if (!directoryExists(root)) return output
	const ignored = new Set(['node_modules', '.git', '.svn', '.idea', '.agents', 'dist', 'lib', 'coverage'])
	const entries = fs.readdirSync(root, { withFileTypes: true })
		.sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1)
	for (const entry of entries) {
		if (entry.isDirectory() && ignored.has(entry.name)) continue
		const fullPath = path.join(root, entry.name)
		if (slash(fullPath).toLowerCase().includes('/packages-vue3/')) continue
		if (entry.isDirectory()) listFiles(fullPath, filter, output)
		else if (filter(fullPath)) output.push(fullPath)
	}
	return output
}

function parseProgram (source, file) {
	const parser = loadProjectDependency('@babel/parser', file ? path.dirname(file) : PROJECT_ROOT)
	return parser.parse(source, {
		sourceType: 'unambiguous',
		sourceFilename: file,
		plugins: [
			'dynamicImport',
			'exportDefaultFrom',
			'exportNamespaceFrom',
			'jsx',
			'objectRestSpread',
			'optionalChaining',
			'nullishCoalescingOperator',
			'classProperties',
			'decorators-legacy',
		],
	})
}

function parseSourceFile (file) {
	const source = readText(file)
	if (path.extname(file).toLowerCase() !== '.vue') return { source, script: source, template: '' }
	const vueCompiler = loadProjectDependency('vue-template-compiler', path.dirname(file))
	const descriptor = vueCompiler.parseComponent(source, { pad: 'space' })
	return {
		source,
		script: descriptor.script ? descriptor.script.content : '',
		template: descriptor.template ? descriptor.template.content : '',
	}
}

function staticKey (node) {
	if (!node) return null
	if (node.type === 'Identifier') return node.name
	if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value)
	return null
}

function stringValue (node) {
	if (!node) return null
	if (node.type === 'StringLiteral') return node.value
	if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
		return node.quasis.map(item => item.value.cooked).join('')
	}
	return null
}

function unwrapExpression (node) {
	if (!node) return null
	if (node.type === 'TSAsExpression' || node.type === 'TypeCastExpression') return unwrapExpression(node.expression)
	return node
}

function propertyMap (objectNode) {
	const map = new Map()
	if (!objectNode || objectNode.type !== 'ObjectExpression') return map
	for (const property of objectNode.properties) {
		if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') continue
		const key = staticKey(property.key)
		if (key) map.set(key, property)
	}
	return map
}

function extractDefaultObject (ast) {
	const bindings = new Map()
	for (const statement of ast.program.body) {
		if (statement.type !== 'VariableDeclaration') continue
		for (const declaration of statement.declarations) {
			if (declaration.id.type === 'Identifier' && declaration.init) bindings.set(declaration.id.name, declaration.init)
		}
	}
	for (const statement of ast.program.body) {
		if (statement.type !== 'ExportDefaultDeclaration') continue
		const declaration = unwrapExpression(statement.declaration)
		if (declaration.type === 'ObjectExpression') return declaration
		if (declaration.type === 'Identifier') return unwrapExpression(bindings.get(declaration.name))
	}
	return null
}

function extractComponentApi (file) {
	const parsed = parseSourceFile(file)
	if (!parsed.script.trim()) {
		return { name: null, props: [], methods: [], events: [], slots: [], mixins: [], unresolved: ['no-script'] }
	}
	let ast
	try {
		ast = parseProgram(parsed.script, file)
	} catch (error) {
		return {
			name: null,
			props: [],
			methods: [],
			events: [],
			slots: extractSlots(parsed.template, file),
			mixins: [],
			unresolved: [`parse-error:${error.message.split('\n')[0]}`],
		}
	}

	const component = extractDefaultObject(ast)
	const root = propertyMap(component)
	const unresolved = []
	let name = null
	const nameProperty = root.get('name')
	if (nameProperty && nameProperty.type === 'ObjectProperty') name = stringValue(nameProperty.value)

	const props = []
	const propsProperty = root.get('props')
	if (propsProperty && propsProperty.type === 'ObjectProperty') {
		const value = unwrapExpression(propsProperty.value)
		if (value.type === 'ObjectExpression') {
			for (const property of value.properties) {
				if (property.type === 'SpreadElement') {
					unresolved.push('spread-props')
					continue
				}
				const key = staticKey(property.key)
				if (key) props.push(key)
			}
		} else if (value.type === 'ArrayExpression') {
			for (const element of value.elements) {
				const key = stringValue(element)
				if (key) props.push(key)
			}
		} else unresolved.push('dynamic-props')
	}

	const methods = []
	const methodsProperty = root.get('methods')
	if (methodsProperty && methodsProperty.type === 'ObjectProperty') {
		const value = unwrapExpression(methodsProperty.value)
		if (value.type === 'ObjectExpression') {
			for (const property of value.properties) {
				if (property.type === 'SpreadElement') {
					unresolved.push('spread-methods')
					continue
				}
				const key = staticKey(property.key)
				if (key) methods.push(key)
			}
		} else unresolved.push('dynamic-methods')
	}

	const mixins = []
	const mixinsProperty = root.get('mixins')
	if (mixinsProperty && mixinsProperty.type === 'ObjectProperty' && mixinsProperty.value.type === 'ArrayExpression') {
		for (const item of mixinsProperty.value.elements) {
			if (item && item.type === 'Identifier') mixins.push(item.name)
			else if (item) unresolved.push('dynamic-mixin')
		}
	}
	if (mixins.length) unresolved.push('mixin-api-not-expanded')

	const events = new Set()
	const traverse = loadProjectDependency('@babel/traverse', path.dirname(file)).default
	traverse(ast, {
		CallExpression (astPath) {
			const callee = astPath.node.callee
			if (callee.type !== 'MemberExpression') return
			if (staticKey(callee.property) !== '$emit') return
			const event = stringValue(astPath.node.arguments[0])
			if (event) events.add(event)
			else unresolved.push('dynamic-event')
		},
	})

	if (!component) unresolved.push('unresolved-default-export')
	const fallbackName = path.extname(file).toLowerCase() === '.vue'
		? pascalCase(path.basename(file).replace(/\.vue$/i, ''))
		: null
	return {
		name: name || fallbackName,
		props: [...new Set(props)].sort(),
		methods: [...new Set(methods)].sort(),
		events: [...events].sort(),
		slots: extractSlots(parsed.template, file),
		mixins: [...new Set(mixins)].sort(),
		unresolved: [...new Set(unresolved)].sort(),
	}
}

function extractSlots (template, file) {
	const slots = new Set()
	if (!template) return []
	let ast
	try {
		const vueCompiler = loadProjectDependency('vue-template-compiler', file ? path.dirname(file) : PROJECT_ROOT)
		ast = vueCompiler.compile(template, { outputSourceRange: false }).ast
	} catch (error) {
		return []
	}
	function walk (node) {
		if (!node) return
		if (node.tag === 'slot') slots.add((node.attrsMap && node.attrsMap.name) || 'default')
		for (const child of node.children || []) walk(child)
		for (const scopedSlot of Object.values(node.scopedSlots || {})) walk(scopedSlot)
	}
	walk(ast)
	return [...slots].sort()
}

function resolveImportFile (fromFile, request, packageRoot) {
	if (!request) return null
	let base
	if (request.startsWith('.')) base = path.resolve(path.dirname(fromFile), request)
	else if (packageRoot && request.startsWith('@topinfo/')) {
		const marker = '/src/'
		const normalized = slash(request)
		const offset = normalized.indexOf(marker)
		if (offset !== -1) base = path.join(packageRoot, normalized.slice(offset + 1))
	}
	if (!base) return null
	const candidates = [base, `${base}.vue`, `${base}.js`, path.join(base, 'index.js'), path.join(base, 'index.vue')]
	return candidates.find(fileExists) || null
}

function resolveComponentImplementation (file, packageRoot, seen = new Set()) {
	const absolute = path.resolve(file)
	if (path.extname(absolute).toLowerCase() === '.vue' || seen.has(absolute)) return absolute
	seen.add(absolute)
	let ast
	try {
		ast = parseProgram(readText(absolute), absolute)
	} catch (error) {
		return absolute
	}
	const imports = new Map()
	for (const statement of ast.program.body) {
		if (statement.type !== 'ImportDeclaration') continue
		for (const specifier of statement.specifiers) {
			imports.set(specifier.local.name, resolveImportFile(absolute, statement.source.value, packageRoot))
		}
	}
	for (const statement of ast.program.body) {
		if (statement.type !== 'ExportDefaultDeclaration' || statement.declaration.type !== 'Identifier') continue
		const imported = imports.get(statement.declaration.name)
		if (imported) return resolveComponentImplementation(imported, packageRoot, seen)
	}
	return absolute
}

function parseRegistryImports (registryFile, packageRoot) {
	const source = readText(registryFile)
	const ast = parseProgram(source, registryFile)
	const imports = new Map()
	const arrays = new Map()
	for (const statement of ast.program.body) {
		if (statement.type === 'ImportDeclaration') {
			for (const specifier of statement.specifiers) {
				imports.set(specifier.local.name, resolveImportFile(registryFile, statement.source.value, packageRoot))
			}
		}
		if (statement.type === 'ExportNamedDeclaration' && statement.declaration && statement.declaration.type === 'VariableDeclaration') {
			for (const declaration of statement.declaration.declarations) {
				if (declaration.id.type === 'Identifier' && declaration.init && declaration.init.type === 'ArrayExpression') {
					arrays.set(declaration.id.name, declaration.init)
				}
			}
		}
		if (statement.type === 'VariableDeclaration') {
			for (const declaration of statement.declarations) {
				if (declaration.id.type === 'Identifier' && declaration.init && declaration.init.type === 'ArrayExpression') {
					arrays.set(declaration.id.name, declaration.init)
				}
			}
		}
		if (statement.type === 'ExportDefaultDeclaration' && statement.declaration.type === 'ArrayExpression') {
			arrays.set('__default__', statement.declaration)
		}
	}
	return { source, ast, imports, arrays }
}

function parseNamedDefaultReexports (registryFile, packageRoot) {
	const ast = parseProgram(readText(registryFile), registryFile)
	const exports = []
	for (const statement of ast.program.body) {
		if (statement.type !== 'ExportNamedDeclaration' || !statement.source) continue
		const file = resolveImportFile(registryFile, statement.source.value, packageRoot)
		if (!file) continue
		for (const specifier of statement.specifiers) {
			if (specifier.type !== 'ExportSpecifier' || staticKey(specifier.local) !== 'default') continue
			const name = staticKey(specifier.exported)
			if (name) exports.push({ name, file })
		}
	}
	return exports
}

function identifiersFromArray (arrayNode) {
	const names = []
	for (const element of (arrayNode && arrayNode.elements) || []) {
		if (!element) continue
		if (element.type === 'Identifier') names.push(element.name)
	}
	return names
}

function componentFromFile (owner, version, file, registered, context, availability = 'installed', packageRoot = null, nameHint = null) {
	const implementation = resolveComponentImplementation(file, packageRoot || path.dirname(file))
	const api = extractComponentApi(implementation)
	const name = api.name || nameHint || pascalCase(path.basename(implementation).replace(/\.(vue|js)$/i, ''))
	return {
		...api,
		owner,
		version,
		availability,
		name,
		tag: kebabCase(name),
		registered,
		source: sourceAlias(implementation, context),
		absoluteSource: implementation,
		usageCount: 0,
		examples: [],
	}
}

function scanStandardRegistry (definition, installed, context) {
	const registryFile = path.join(installed.root, definition.registry)
	if (!fileExists(registryFile)) return []
	const registry = parseRegistryImports(registryFile, installed.root)
	const registeredNames = new Set()
	for (const [name, array] of registry.arrays) {
		if (name === '__default__' || /components?|componentList/i.test(name)) identifiersFromArray(array).forEach(item => registeredNames.add(item))
	}
	const components = []
	for (const identifier of registeredNames) {
		const file = registry.imports.get(identifier)
		if (!file) continue
		components.push(componentFromFile(definition.owner, installed.manifest.version, file, true, context, 'installed', installed.root, identifier))
	}
	return components
}

function scanFbThird (definition, installed, context) {
	const indexFile = path.join(installed.root, definition.registry)
	const registry = parseRegistryImports(indexFile, installed.root)
	const directNames = ['FbTmap', 'FbEditor', 'FbEcharts', 'FbQrcode', 'FbLottie']
	const components = []
	for (const name of directNames) {
		const file = registry.imports.get(name)
		if (file) components.push(componentFromFile(definition.owner, installed.manifest.version, file, true, context, 'installed', installed.root, name))
	}
	const lmapIndex = path.join(installed.root, 'packages', 'components', 'lmap', 'index.js')
	if (fileExists(lmapIndex)) components.push(...scanRegistryFile(definition.owner, installed.manifest.version, lmapIndex, installed.root, context))
	const namedExportFiles = [
		path.join(installed.root, 'packages', 'components', 'echarts', 'components.js'),
		path.join(installed.root, 'packages', 'components', 'motions', 'components.js'),
	]
	for (const registryFile of namedExportFiles) {
		if (!fileExists(registryFile)) continue
		for (const item of parseNamedDefaultReexports(registryFile, installed.root)) {
			const implementation = resolveComponentImplementation(item.file, installed.root)
			if (path.extname(implementation).toLowerCase() !== '.vue') continue
			components.push(componentFromFile(
				definition.owner,
				installed.manifest.version,
				item.file,
				false,
				context,
				'installed-local-import',
				installed.root,
				item.name,
			))
		}
	}
	return components
}

function scanRegistryFile (owner, version, registryFile, packageRoot, context, availability = 'installed') {
	const registry = parseRegistryImports(registryFile, packageRoot)
	const registered = new Set()
	for (const [name, array] of registry.arrays) {
		if (name === '__default__' || /components?|componentList/i.test(name)) identifiersFromArray(array).forEach(item => registered.add(item))
	}
	return [...registered]
		.map(name => ({ name, file: registry.imports.get(name) }))
		.filter(item => Boolean(item.file))
		.map(item => componentFromFile(owner, version, item.file, true, context, availability, packageRoot, item.name))
}

function findAiRoot (root) {
	if (!directoryExists(root)) return null
	if (fileExists(path.join(root, 'package.json')) && directoryExists(path.join(root, 'src', 'components'))) return root
	return null
}

function scanAiUpstream (context) {
	const root = findAiRoot(context.externalRoots.ai)
	if (!root) return []
	const manifest = readJson(path.join(root, 'package.json'))
	const registryFile = path.join(root, 'src', 'components', 'index.js')
	if (!fileExists(registryFile)) return []
	return scanRegistryFile('fb-ai', manifest.version, registryFile, root, context, 'not-installed')
}

function scanLocalComponents (context) {
	const files = []
	for (const relative of projectScanDirs(context.projectRoot)) {
		listFiles(path.join(context.projectRoot, relative), file => /\.vue$/i.test(file), files)
	}
	const components = []
	for (const file of files) {
		const api = extractComponentApi(file)
		if (!api.name || !/^(Fb|Tp|Screen)/.test(api.name)) continue
		components.push({
			...api,
			owner: 'project-local',
			version: readJson(path.join(context.projectRoot, 'package.json')).version,
			availability: 'local',
			name: api.name,
			tag: kebabCase(api.name),
			registered: false,
			source: sourceAlias(file, context),
			absoluteSource: file,
			usageCount: 0,
			examples: [],
		})
	}
	return components
}

function scanProjectUsage (context) {
	const usage = new Map()
	const files = []
	for (const relative of projectScanDirs(context.projectRoot)) {
		listFiles(path.join(context.projectRoot, relative), file => /\.vue$/i.test(file), files)
	}
	for (const file of files) {
		const content = stripComments(parseSourceFile(file).template)
		const regex = /<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/g
		let match
		while ((match = regex.exec(content))) {
			const rawTag = match[1]
			const lowerTag = rawTag.toLowerCase()
			let tag
			if (/^(fb|tp|screen)-[a-z0-9-]+$/.test(lowerTag)) tag = lowerTag
			else if (/^(Fb|Tp|Screen)[A-Za-z0-9]+$/.test(rawTag)) tag = kebabCase(rawTag)
			else continue
			if (!usage.has(tag)) usage.set(tag, { count: 0, examples: new Set() })
			const entry = usage.get(tag)
			entry.count += 1
			if (entry.examples.size < 3) entry.examples.add(sourceAlias(file, context))
		}
	}
	return usage
}

function attachUsage (components, usage) {
	const byTag = new Map()
	for (const component of components) {
		if (!byTag.has(component.tag)) byTag.set(component.tag, [])
		byTag.get(component.tag).push(component)
	}
	const unresolved = []
	const ambiguous = []
	for (const [tag, entry] of usage) {
		const matches = byTag.get(tag) || []
		for (const component of matches) {
			component.usageCount = entry.count
			component.examples = [...entry.examples].sort()
		}
		if (!matches.length) {
			unresolved.push({ tag, count: entry.count, examples: [...entry.examples].sort() })
		} else if (matches.length > 1) {
			ambiguous.push({
				tag,
				count: entry.count,
				examples: [...entry.examples].sort(),
				candidates: matches.map(component => ({ owner: component.owner, source: component.source })),
			})
		}
	}
	return { unresolved, ambiguous }
}

function dedupeComponents (components) {
	const seen = new Set()
	return components.filter(component => {
		const key = `${component.owner}|${component.name}|${component.source}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

function commandOutput (command, args, cwd) {
	try {
		return childProcess.execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
	} catch (error) {
		return null
	}
}

function gitJsonAt (root, ref, file) {
	if (!root) return null
	const value = commandOutput('git', ['show', `${ref}:${slash(file)}`], root)
	if (!value) return null
	try {
		return JSON.parse(value)
	} catch (error) {
		return null
	}
}

function gitSnapshot (root) {
	if (!root) return { commit: null, branch: null, dirty: null }
	if (!directoryExists(path.join(root, '.git'))) return { commit: null, branch: null, dirty: null }
	return {
		commit: commandOutput('git', ['rev-parse', '--short=12', 'HEAD'], root),
		branch: commandOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root),
		dirty: Boolean(commandOutput('git', ['status', '--porcelain'], root)),
	}
}

function packageVersionAt (manifest) {
	return fileExists(manifest) ? readJson(manifest).version || null : null
}

function pathAt (root, ...parts) {
	return root ? path.join(root, ...parts) : null
}

function buildBaselines (context) {
	const installedNames = [
		'vue', 'fb-core', 'fb-ui', 'fb-third', 'fb-assets',
		'@topinfo/admin-base', '@topinfo/screen-base', '@topinfo/tp-components',
		'@topinfo/fb-player', '@topinfo/fb-three', 'fb-ai',
	]
	const installed = installedNames.map(packageName => {
		const found = resolveInstalledPackage(packageName, context.projectRoot)
		return { packageName, version: found ? found.manifest.version : null }
	})
	const upstream = [
		{
			alias: 'upstream:fbjs',
			root: context.externalRoots.fbjs,
			versions: {
				'fb-core': packageVersionAt(pathAt(context.externalRoots.fbjs, 'packages', 'fb-core', 'package.json')),
				'fb-ui': packageVersionAt(pathAt(context.externalRoots.fbjs, 'packages', 'fb-ui', 'package.json')),
				'fb-third': packageVersionAt(pathAt(context.externalRoots.fbjs, 'packages', 'fb-third', 'package.json')),
				'fb-assets': packageVersionAt(pathAt(context.externalRoots.fbjs, 'packages', 'fb-assets', 'package.json')),
			},
		},
		{
			alias: 'upstream:admin',
			root: context.externalRoots.admin,
			ref: context.adminRef,
			versions: (() => {
				const admin = gitJsonAt(context.externalRoots.admin, context.adminRef, 'packages/@topinfo/admin-base/package.json')
				const components = gitJsonAt(context.externalRoots.admin, context.adminRef, 'packages/@topinfo/tp-components/package.json')
				return {
					'@topinfo/admin-base': admin && admin.version,
					'@topinfo/tp-components': components && components.version,
				}
			})(),
		},
		{ alias: 'upstream:screen', root: context.externalRoots.screen, versions: { '@topinfo/screen-base': packageVersionAt(pathAt(context.externalRoots.screen, 'packages', '@topinfo', 'screen-base', 'package.json')) } },
		{ alias: 'upstream:ai', root: context.externalRoots.ai, versions: { 'fb-ai': packageVersionAt(pathAt(context.externalRoots.ai, 'package.json')) } },
		{ alias: 'upstream:player', root: context.externalRoots.player, versions: { '@topinfo/fb-player': packageVersionAt(pathAt(context.externalRoots.player, 'packages', 'fb-player', 'package.json')) } },
	].map(item => ({ ...item, configured: Boolean(item.root), exists: Boolean(item.root) && directoryExists(item.root), git: gitSnapshot(item.root) }))
	return { installed, upstream }
}

function buildCatalog (options = {}) {
	const context = {
		projectRoot: path.resolve(options.projectRoot || PROJECT_ROOT),
		externalRoots: { ...DEFAULT_EXTERNAL_ROOTS, ...(options.externalRoots || {}) },
		adminRef: options.adminRef || 'HEAD',
	}
	const components = []
	for (const definition of PACKAGES) {
		const installed = resolveInstalledPackage(definition.packageName, context.projectRoot)
		if (!installed) continue
		components.push(...(definition.kind === 'third'
			? scanFbThird(definition, installed, context)
			: scanStandardRegistry(definition, installed, context)))
	}
	for (const definition of OPTIONAL_COMPONENTS) {
		const installed = resolveInstalledPackage(definition.packageName, context.projectRoot)
		if (!installed) continue
		const file = path.join(installed.root, definition.file)
		if (!fileExists(file)) continue
		components.push(componentFromFile(
			definition.owner,
			installed.manifest.version,
			file,
			definition.registered,
			context,
			'installed-local-import',
			installed.root,
		))
	}
	components.push(...scanAiUpstream(context))
	components.push(...scanLocalComponents(context))
	const uniqueComponents = dedupeComponents(components)
	const usage = scanProjectUsage(context)
	const usageResult = attachUsage(uniqueComponents, usage)
	const unresolvedUsage = usageResult.unresolved
	const ambiguousUsage = usageResult.ambiguous
	uniqueComponents.sort((a, b) => a.tag.localeCompare(b.tag) || a.owner.localeCompare(b.owner) || a.source.localeCompare(b.source))
	unresolvedUsage.sort((a, b) => a.tag.localeCompare(b.tag))
	ambiguousUsage.sort((a, b) => a.tag.localeCompare(b.tag))
	return {
		context,
		components: uniqueComponents,
		unresolvedUsage,
		ambiguousUsage,
		baselines: buildBaselines(context),
	}
}

function formatList (values, empty = '-') {
	return values && values.length ? values.map(value => `\`${value}\``).join(', ') : empty
}

function renderComponentCatalog (catalog) {
	const lines = [
		'# Generated Component Catalog',
		'',
		'> Generated by `scripts/refresh-catalog.cjs`. Do not edit manually.',
		'> API fields come from statically resolved installed/upstream Vue2 source. `unresolved` or a non-empty mixin list means inspect the cited file; never guess.',
		'',
		'## Catalog summary',
		'',
		`- Component records: ${catalog.components.length}`,
		`- Tags used by the project but unresolved to a catalog owner: ${catalog.unresolvedUsage.length}`,
		`- Tags used by the project with multiple catalog candidates: ${catalog.ambiguousUsage.length}`,
		'- Availability: `installed` is usable through an installed plugin, `installed-local-import` requires an explicit verified import, `local` requires project registration/import evidence, and `not-installed` is discovery-only.',
		'',
		'## Component index',
		'',
		'| Tag | Owner | Version | Availability | Global | Uses | Source |',
		'| --- | --- | ---: | --- | --- | ---: | --- |',
	]

	for (const component of catalog.components) {
		lines.push(`| \`${component.tag}\` | \`${component.owner}\` | ${component.version || '-'} | ${component.availability} | ${component.registered ? 'yes' : 'no/unknown'} | ${component.usageCount} | \`${component.source}\` |`)
	}

	lines.push('', '## API details', '')
	for (const component of catalog.components) {
		lines.push(
			`### ${component.tag}`,
			'',
			`- Component: \`${component.name}\`; owner: \`${component.owner}\`; availability: \`${component.availability}\`; globally registered: ${component.registered ? 'yes' : 'no/unknown'}.`,
			`- Source: \`${component.source}\`.`,
			`- Props: ${formatList(component.props)}.`,
			`- Events: ${formatList(component.events)}.`,
			`- Public ref methods declared in \`methods\`: ${formatList(component.methods)}.`,
			`- Slots: ${formatList(component.slots)}; mixins: ${formatList(component.mixins)}.`,
			`- Project usage: ${component.usageCount}; examples: ${formatList(component.examples)}.`,
			`- Unresolved static API: ${formatList(component.unresolved)}.`,
			'',
		)
	}

	lines.push('## Unresolved project tags', '')
	if (!catalog.unresolvedUsage.length) lines.push('None.', '')
	for (const item of catalog.unresolvedUsage) {
		lines.push(`- \`${item.tag}\`: ${item.count} uses; examples: ${formatList(item.examples)}.`)
	}
	lines.push('', '## Ambiguous project tags', '')
	if (!catalog.ambiguousUsage.length) lines.push('None.', '')
	for (const item of catalog.ambiguousUsage) {
		const candidates = item.candidates.map(candidate => `\`${candidate.owner}\` at \`${candidate.source}\``).join('; ')
		lines.push(`- \`${item.tag}\`: ${item.count} uses; candidates: ${candidates}; examples: ${formatList(item.examples)}.`)
	}
	lines.push('')
	return `${lines.join('\n').replace(/[ \t]+$/gm, '')}\n`
}

function renderSourceBaseline (catalog) {
	const lines = [
		'# Generated Source Baseline',
		'',
		'> Generated by `scripts/refresh-catalog.cjs`. Do not edit manually.',
		'> Paths are stable aliases. No timestamps, absolute paths, secrets, or source contents are recorded.',
		'',
		'## Installed runtime',
		'',
		'| Package | Version/status |',
		'| --- | --- |',
	]
	for (const item of catalog.baselines.installed) {
		lines.push(`| \`${item.packageName}\` | ${item.version || 'not installed'} |`)
	}
	lines.push('', '## Read-only upstream snapshots', '')
	for (const item of catalog.baselines.upstream) {
		lines.push(`### ${item.alias}`, '')
		if (!item.configured) {
			lines.push('- Status: not configured; pass the corresponding `--*-root` option to include this evidence.', '')
			continue
		}
		if (!item.exists) {
			lines.push('- Status: unavailable.', '')
			continue
		}
		lines.push(
			`- Git: branch \`${item.git.branch || 'unknown'}\`, commit \`${item.git.commit || 'unknown'}\`, dirty: ${item.git.dirty === null ? 'unknown' : item.git.dirty ? 'yes' : 'no'}.`,
			...(item.ref ? [`- Version inspection ref: \`${item.ref}\` (read with \`git show\`; the external worktree is not switched).`] : []),
			`- Package versions: ${Object.entries(item.versions).length ? Object.entries(item.versions).map(([name, version]) => `\`${name}@${version || 'unknown'}\``).join(', ') : 'not recorded from the checked-out tree'}.`,
			'',
		)
	}
	lines.push(
		'## Interpretation',
		'',
		'- The installed runtime is authoritative for application API decisions.',
		'- Newer or differently branched upstream code is drift evidence only.',
		'- `upstream:fbjs` is restricted to its `packages/` Vue2 tree. `packages-vue3` is permanently excluded.',
		'- `fb-ai` remains unavailable until an installed package with a valid consumer entry can be resolved and parsed.',
		'',
	)
	return `${lines.join('\n').replace(/[ \t]+$/gm, '')}\n`
}

function publicCatalog (catalog) {
	return {
		components: catalog.components.map(({ absoluteSource, ...component }) => component),
		unresolvedUsage: catalog.unresolvedUsage,
		ambiguousUsage: catalog.ambiguousUsage,
		baselines: catalog.baselines,
	}
}

module.exports = {
	DEFAULT_EXTERNAL_ROOTS,
	PROJECT_ROOT,
	SKILL_ROOT,
	buildCatalog,
	defaultOutputRoot,
	kebabCase,
	loadProjectDependency,
	parseArgs,
	parseProgram,
	parseSourceFile,
	pascalCase,
	publicCatalog,
	readText,
	stripComments,
	renderComponentCatalog,
	renderSourceBaseline,
}
