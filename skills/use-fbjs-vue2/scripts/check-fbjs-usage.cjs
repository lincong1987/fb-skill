#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { PROJECT_ROOT, loadProjectDependency, parseProgram, parseSourceFile, stripComments } = require('./lib/catalog.cjs')

const RULES = [
	{
		id: 'element-dependency',
		extensions: ['.json'],
		pattern: /["'](?:element-ui|element-plus)["']\s*:/g,
		message: 'Element UI/Plus dependency is forbidden in this Vue2 FBJS project.',
	},
	{
		id: 'element-import',
		extensions: ['.js', '.vue', '.ts'],
		pattern: /(?:from\s*|require\s*\(\s*|import\s*)["'](?:element-ui|element-plus)(?:\/[^"']*)?["']/g,
		message: 'Use FBJS runtime components; do not import Element UI/Plus.',
	},
	{
		id: 'element-tag',
		extensions: ['.vue'],
		pattern: /<\/?el-[a-z0-9-]+\b/gi,
		message: 'Element tags are not available.',
	},
	{
		id: 'element-style',
		extensions: ['.vue', '.less', '.css', '.scss'],
		pattern: /\.el-[a-z0-9_-]+/gi,
		message: 'Do not add Element CSS selectors; FbUI uses the jpx prefix.',
	},
	{
		id: 'vue3-source',
		extensions: ['.js', '.vue', '.ts', '.json'],
		pattern: /(?:packages-vue3|fb-ui-v3|element-plus)/gi,
		message: 'Vue3 and Element Plus sources are outside this Vue2 application.',
	},
	{
		id: 'fb-ui-named-import',
		extensions: ['.js', '.vue', '.ts'],
		pattern: /import\s*\{[^}]+\}\s*from\s*["']fb-ui(?:\/src\/index(?:\.js)?)?["']/gs,
		message: 'FbUI package entries do not expose reliable named component exports; use global tags or a verified deep source path.',
	},
	{
		id: 'message-warning',
		extensions: ['.js', '.vue', '.ts'],
		pattern: /\$message\.warning\s*\(/g,
		message: 'Use the installed `$message.warn(...)` API.',
	},
	{
		id: 'notify-service',
		extensions: ['.js', '.vue', '.ts'],
		pattern: /\$notify\s*\(/g,
		message: 'FbUI installs `$notification`, not Element `$notify`.',
	},
	{
		id: 'fb-button-click',
		extensions: ['.vue'],
		pattern: /<fb-button\b[^>]*(?:@click|v-on:click)(?:\.|\s*=)/gis,
		message: 'FbButton emits `on-click`; use `@on-click`.',
	},
	{
		id: 'fb-form-rules',
		extensions: ['.vue'],
		pattern: /<fb-(?:form|form-item)\b[^>]*\b(?::rules|rules\s*=)/gis,
		message: 'FbForm and FbFormItem use the singular `rule` prop.',
	},
	{
		id: 'fb-dialog-visible-sync',
		extensions: ['.vue'],
		pattern: /<fb-dialog\b[^>]*\b(?:v-bind:|:)?visible\.sync\b/gis,
		message: 'FbDialog is controlled through ref `show`/`hide`/`close` methods.',
	},
	{
		id: 'fb-datepicker-value-format',
		extensions: ['.vue'],
		pattern: /<fb-datepicker\b[^>]*\b(?:v-bind:|:)?value-format\s*=/gis,
		message: 'Raw FbDatepicker has no value-format prop; use TpDatepicker for conversion.',
	},
]

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.agents', 'dist', 'lib', 'coverage'])

function slash (value) {
	return value.replace(/\\/g, '/')
}

function parseArgs (args) {
	const options = { root: PROJECT_ROOT, baseline: null }
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg !== '--root' && arg !== '--baseline') throw new Error(`Unknown option: ${arg}`)
		const value = args[++index]
		if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
		if (arg === '--root') options.root = path.resolve(value)
		else options.baseline = path.resolve(value)
	}
	return options
}

function listFiles (root, output = []) {
	const entries = fs.readdirSync(root, { withFileTypes: true })
		.sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1)
	for (const entry of entries) {
		if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
		const file = path.join(root, entry.name)
		if (entry.isSymbolicLink()) throw new Error(`File check incomplete: linked path is not scanned: ${file}`)
		if (entry.isDirectory()) listFiles(file, output)
		else if (entry.isFile()) output.push(file)
	}
	return output
}

function normalizeSnippet (snippet) {
	return snippet.replace(/\s+/g, ' ').trim()
}

function fingerprint (ruleId, snippet) {
	return crypto.createHash('sha256').update(`${ruleId}\0${normalizeSnippet(snippet)}`).digest('hex').slice(0, 16)
}

function lineAt (content, index) {
	return content.slice(0, index).split('\n').length
}

function memberName (node) {
	if (!node || node.type !== 'MemberExpression') return null
	if (!node.computed && node.property.type === 'Identifier') return node.property.name
	if (node.property.type === 'StringLiteral') return node.property.value
	return null
}

function isConfirmCall (node) {
	if (!node || node.type !== 'CallExpression') return false
	const callee = node.callee
	if (callee.type === 'Identifier') return callee.name === '$confirm'
	return callee.type === 'MemberExpression' && memberName(callee) === '$confirm'
}

function sourceSlice (content, node) {
	if (Number.isInteger(node.start) && Number.isInteger(node.end)) {
		return normalizeSnippet(content.slice(node.start, node.end))
	}
	return '$confirm(...)'
}

function findConfirmViolations (file, relativePath) {
	const extension = path.extname(file).toLowerCase()
	if (!['.js', '.vue', '.ts'].includes(extension)) return []
	let parsed
	let ast
	try {
		parsed = parseSourceFile(file)
		if (!parsed.script.trim()) return []
		ast = parseProgram(parsed.script, file, { typescript: parsed.scriptLang === 'ts' })
	} catch (error) {
		throw new Error(`AST check incomplete for ${relativePath}: ${error.message}`)
	}
	const violations = []
	function add (rule, message, node) {
		const snippet = sourceSlice(parsed.script, node)
		violations.push({
			rule,
			message,
			path: relativePath,
			line: node.loc ? node.loc.start.line : 1,
			snippet,
			fingerprint: fingerprint(rule, snippet),
		})
	}
	const traverse = loadProjectDependency('@babel/traverse', path.dirname(file)).default
	traverse(ast, {
		AwaitExpression (astPath) {
			if (isConfirmCall(astPath.node.argument)) {
				add('confirm-await', '`$confirm` is callback-based and must not be awaited.', astPath.node)
			}
		},
		CallExpression (astPath) {
			const callee = astPath.node.callee
			if (callee.type !== 'MemberExpression' || memberName(callee) !== 'then') return
			if (isConfirmCall(callee.object)) {
				add('confirm-promise', '`$confirm` is callback-based and must not be chained as a Promise.', astPath.node)
			}
		},
	})
	return violations
}

function findViolations (root) {
	const violations = []
	for (const file of listFiles(root)) {
		const extension = path.extname(file).toLowerCase()
		const applicable = RULES.filter(rule => rule.extensions.includes(extension))
		if (!applicable.length) continue
		let content
		try {
			content = fs.readFileSync(file, 'utf8')
		} catch (error) {
			throw new Error(`File check incomplete for ${file}: ${error.message}`)
		}
		const scanContent = extension === '.json' ? content : stripComments(content)
		const relativePath = slash(path.relative(root, file))
		for (const rule of applicable) {
			rule.pattern.lastIndex = 0
			let match
			while ((match = rule.pattern.exec(scanContent))) {
				const snippet = normalizeSnippet(match[0])
				violations.push({
					rule: rule.id,
					message: rule.message,
					path: relativePath,
					line: lineAt(scanContent, match.index),
					snippet,
					fingerprint: fingerprint(rule.id, snippet),
				})
				if (match[0].length === 0) rule.pattern.lastIndex += 1
			}
		}
		violations.push(...findConfirmViolations(file, relativePath))
	}
	return violations
}

function loadLegacy (root, explicitFile) {
	const projectFile = path.join(root, '.agents', 'fbjs-vue2', 'known-legacy.json')
	const file = explicitFile || (fs.existsSync(projectFile) ? projectFile : path.join(__dirname, 'known-legacy.json'))
	if (!fs.existsSync(file)) return []
	const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
	if (!Array.isArray(parsed.allow)) throw new Error(`Legacy baseline must contain an allow array: ${file}`)
	return parsed.allow
}

function applyLegacy (violations, legacy) {
	const remaining = [...violations]
	const stale = []
	for (const allowance of legacy) {
		let count = Number(allowance.count || 1)
		for (let index = remaining.length - 1; index >= 0 && count > 0; index -= 1) {
			const item = remaining[index]
			if (item.path !== allowance.path || item.rule !== allowance.rule || item.fingerprint !== allowance.fingerprint) continue
			remaining.splice(index, 1)
			count -= 1
		}
		if (count > 0) stale.push({ ...allowance, missing: count })
	}
	return { remaining, stale }
}

function main () {
	let options
	try {
		options = parseArgs(process.argv.slice(2))
		if (!fs.statSync(options.root).isDirectory()) throw new Error(`Not a directory: ${options.root}`)
	} catch (error) {
		console.error(`[fbjs-guard] ${error.message}`)
		process.exitCode = 2
		return
	}
	let violations
	let legacy
	try {
		violations = findViolations(options.root)
		legacy = loadLegacy(options.root, options.baseline)
	} catch (error) {
		console.error(`[fbjs-guard] Scan failed: ${error.stack || error.message}`)
		process.exitCode = 2
		return
	}
	const result = applyLegacy(violations, legacy)
	for (const item of result.remaining) {
		console.error(`${item.path}:${item.line} [${item.rule}] ${item.message}`)
		console.error(`  ${item.snippet}`)
	}
	for (const item of result.stale) {
		console.error(`[stale-legacy] ${item.path} [${item.rule}] baseline no longer matches; remove or update the reviewed allowance.`)
	}
	if (result.remaining.length || result.stale.length) {
		console.error(`[fbjs-guard] FAIL: ${result.remaining.length} new violation(s), ${result.stale.length} stale legacy allowance(s)`)
		process.exitCode = 1
		return
	}
	const legacyCount = violations.length - result.remaining.length
	console.log(`[fbjs-guard] OK: no new violations${legacyCount ? `; ${legacyCount} reviewed legacy occurrence(s) allowed` : ''}`)
}

if (require.main === module) main()

module.exports = {
	RULES,
	applyLegacy,
	findViolations,
	fingerprint,
	normalizeSnippet,
}
