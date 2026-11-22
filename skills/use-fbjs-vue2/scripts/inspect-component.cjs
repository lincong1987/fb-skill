#!/usr/bin/env node
'use strict'

const path = require('path')
const {
	buildCatalog,
	parseArgs: parseStandardArgs,
	kebabCase,
	pascalCase,
} = require('./lib/catalog.cjs')

const NARROW_OPTIONS = new Set([
	'--owner',
	'--file',
	'--deps-root',
])

function format (values) {
	return values && values.length ? values.join(', ') : '-'
}

function findQueryIndex (args) {
	const optionsWithSeparateValues = new Set([
		'--admin-ref',
		'--project-root',
		'--output-root',
		'--fbjs-root',
		'--admin-root',
		'--screen-root',
		'--ai-root',
		'--player-root',
		'--deps-root',
		'--stop-root',
		'--owner',
		'--file',
	])

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (optionsWithSeparateValues.has(arg)) {
			index += 1
			continue
		}
		if (!arg.startsWith('--')) return index
	}
	return -1
}

function isNarrowArg (arg) {
	return NARROW_OPTIONS.has(arg) || /^--(owner|file|deps-root)=/.test(arg)
}

// Strip narrow options (and their separate values) so catalog.parseArgs never sees them.
function removeNarrowArgs (args) {
	const remaining = []
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (!isNarrowArg(arg)) {
			remaining.push(arg)
			continue
		}
		if (!arg.includes('=')) index += 1
	}
	return remaining
}

function parseNarrowOptions (args) {
	const options = { owner: null, file: null, depsRoot: null }
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (!isNarrowArg(arg)) continue
		const inline = arg.includes('=')
		const key = inline ? arg.slice(2, arg.indexOf('=')) : arg.slice(2)
		const value = inline ? arg.slice(arg.indexOf('=') + 1) : args[++index]
		if (value === undefined || !value || (!inline && value.startsWith('--'))) {
			throw new Error(`Missing value for ${inline ? `--${key}=` : arg}`)
		}
		if (key === 'deps-root') options.depsRoot = value
		else options[key] = value
	}
	return options
}

function sameFile (left, right) {
	return path.resolve(left).replace(/\\/g, '/').toLowerCase()
		=== path.resolve(right).replace(/\\/g, '/').toLowerCase()
}

// Narrow multiple catalog matches for one query. Never auto-picks a winner: a higher
// usageCount says nothing about which owner the project actually registers, so when the
// narrowing cannot produce exactly one record we fail and list the candidates.
function narrowMatches (matches, options) {
	if (!options.owner && !options.file) {
		return { matches, ambiguous: matches.length > 1 }
	}
	let filtered = matches
	if (options.owner) {
		filtered = filtered.filter(component => component.owner === options.owner)
	}
	if (options.file) {
		filtered = filtered.filter(component => sameFile(component.absoluteSource, options.file))
	}
	if (!filtered.length) {
		return { matches: [], ambiguous: false, unmatchedNarrowing: true }
	}
	return { matches: filtered, ambiguous: filtered.length > 1 }
}

function formatCandidates (matches) {
	return matches.map(component => `- ${component.owner}: ${component.source} (${component.availability})`).join('\n')
}

function resolveComponentQuery (catalog, query, options = {}) {
	const tag = query.includes('-') ? query.toLowerCase() : kebabCase(query)
	const name = query.includes('-') ? pascalCase(query) : query
	const matches = catalog.components.filter(component => component.tag === tag || component.name.toLowerCase() === name.toLowerCase())
	if (!matches.length) {
		const unresolved = catalog.unresolvedUsage.filter(item => item.tag === tag)
		if (unresolved.length) {
			return { error: `${tag} is used by the project but its owner is unresolved. Examples: ${format(unresolved[0].examples)}` }
		}
		return { error: `Unknown component: ${query}` }
	}
	const narrowed = narrowMatches(matches, options)
	if (narrowed.unmatchedNarrowing) {
		const parts = []
		if (options.owner) parts.push(`owner "${options.owner}"`)
		if (options.file) parts.push(`file "${options.file}"`)
		return { error: `No match for ${query} narrowed by ${parts.join(' and ')}. Candidates:\n${formatCandidates(matches)}` }
	}
	if (narrowed.ambiguous) {
		const owners = [...new Set(narrowed.matches.map(component => component.owner))]
		return {
			error: `Ambiguous component: ${query}. Re-run with --owner <exact owner> (candidates: ${owners.join(', ')}) or --file <component path> to narrow.`,
			candidates: formatCandidates(narrowed.matches),
		}
	}
	return { component: narrowed.matches[0] }
}

function printComponent (component) {
	console.log(`Component: ${component.name} (<${component.tag}>)`)
	console.log(`Owner: ${component.owner}@${component.version || 'unknown'}`)
	console.log(`Availability: ${component.availability}`)
	console.log(`Globally registered: ${component.registered ? 'yes' : 'no/unknown'}`)
	console.log(`Source: ${component.source}`)
	console.log(`Props: ${format(component.props)}`)
	console.log(`Events: ${format(component.events)}`)
	console.log(`Methods: ${format(component.methods)}`)
	console.log(`Slots: ${format(component.slots)}`)
	console.log(`Mixins: ${format(component.mixins)}`)
	console.log(`Project uses: ${component.usageCount}`)
	console.log(`Examples: ${format(component.examples)}`)
	console.log(`Unresolved: ${format(component.unresolved)}`)
	if (component.availability === 'not-installed') {
		console.log('Warning: discovery-only source; this component cannot be used until a valid package is installed and integrated.')
	}
}

function runInspect (argv) {
	const args = [...argv]
	const queryIndex = findQueryIndex(args)
	if (queryIndex === -1) {
		console.error('Usage: inspect-component.cjs <tag-or-PascalCase> [--project-root <path>] [--fbjs-root <path>] [--owner <exact owner>] [--file <component path>] [--deps-root <path>] ...')
		process.exitCode = 2
		return
	}
	const query = args.splice(queryIndex, 1)[0]
	let narrow
	try {
		narrow = parseNarrowOptions(args)
	} catch (error) {
		console.error(`[fbjs-inspect] ${error.message}`)
		process.exitCode = 2
		return
	}
	let standard
	try {
		standard = parseStandardArgs(removeNarrowArgs(args))
	} catch (error) {
		console.error(`[fbjs-inspect] ${error.message}`)
		process.exitCode = 2
		return
	}
	let catalog
	try {
		catalog = buildCatalog({ ...standard, depsRoot: narrow.depsRoot })
	} catch (error) {
		console.error(`[fbjs-inspect] Failed to inspect project: ${error.message}`)
		process.exitCode = 2
		return
	}
	if (catalog.context.projectRootPromoted) {
		console.error(`[fbjs-inspect] Note: --project-root ${catalog.context.requestedProjectRoot} has no package.json; using nearest application root ${catalog.context.projectRoot}. Scans cover that whole application.`)
	}
	const result = resolveComponentQuery(catalog, query, narrow)
	if (result.error) {
		console.error(`[fbjs-inspect] ${result.error}`)
		if (result.candidates) console.error(result.candidates)
		process.exitCode = 1
		return
	}
	printComponent(result.component)
}

function main () {
	runInspect(process.argv.slice(2))
}

if (require.main === module) main()

module.exports = {
	findQueryIndex,
	parseNarrowOptions,
	removeNarrowArgs,
	narrowMatches,
	resolveComponentQuery,
	printComponent,
	runInspect,
}
