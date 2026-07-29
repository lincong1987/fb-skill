#!/usr/bin/env node
'use strict'

const {
	buildCatalog,
	kebabCase,
	parseArgs,
	pascalCase,
} = require('./lib/catalog.cjs')

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

function main () {
	const args = process.argv.slice(2)
	const queryIndex = findQueryIndex(args)
	if (queryIndex === -1) {
		console.error('Usage: inspect-component.cjs <tag-or-PascalCase> [--project-root <path>] [--fbjs-root <path>] ...')
		process.exitCode = 2
		return
	}
	const query = args.splice(queryIndex, 1)[0]
	let options
	try {
		options = parseArgs(args)
	} catch (error) {
		console.error(`[fbjs-inspect] ${error.message}`)
		process.exitCode = 2
		return
	}
	let catalog
	try {
		catalog = buildCatalog(options)
	} catch (error) {
		console.error(`[fbjs-inspect] Failed to inspect project: ${error.message}`)
		process.exitCode = 2
		return
	}
	const tag = query.includes('-') ? query.toLowerCase() : kebabCase(query)
	const name = query.includes('-') ? pascalCase(query) : query
	const matches = catalog.components.filter(component => component.tag === tag || component.name.toLowerCase() === name.toLowerCase())
	if (!matches.length) {
		const unresolved = catalog.unresolvedUsage.filter(item => item.tag === tag)
		if (unresolved.length) {
			console.error(`[fbjs-inspect] ${tag} is used by the project but its owner is unresolved. Examples: ${format(unresolved[0].examples)}`)
		} else console.error(`[fbjs-inspect] Unknown component: ${query}`)
		process.exitCode = 1
		return
	}
	if (matches.length > 1) {
		console.error(`[fbjs-inspect] Ambiguous component: ${query}`)
		for (const component of matches) console.error(`- ${component.owner}: ${component.source} (${component.availability})`)
		process.exitCode = 1
		return
	}
	const component = matches[0]
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

main()
