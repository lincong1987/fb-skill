#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
	buildCatalog,
	parseArgs,
	renderComponentCatalog,
	renderSourceBaseline,
} = require('./lib/catalog.cjs')

function main () {
	let options
	try {
		options = parseArgs(process.argv.slice(2))
	} catch (error) {
		console.error(`[fbjs-catalog] ${error.message}`)
		process.exitCode = 2
		return
	}

	let catalog
	try {
		catalog = buildCatalog(options)
	} catch (error) {
		console.error(`[fbjs-catalog] Failed to build catalog: ${error.stack || error.message}`)
		process.exitCode = 2
		return
	}
	const missingUpstream = catalog.baselines.upstream.filter(item => item.configured && !item.exists).map(item => item.alias)
	if (missingUpstream.length && !options.allowMissingUpstream) {
		const action = options.check ? 'validate' : 'overwrite'
		console.error(`[fbjs-catalog] Refusing to ${action} full references while upstream evidence is unavailable: ${missingUpstream.join(', ')}`)
		console.error('[fbjs-catalog] Supply the corresponding --*-root options, or use --allow-missing-upstream only for an intentional reduced snapshot.')
		process.exitCode = 2
		return
	}
	if (!options.check) fs.mkdirSync(options.outputRoot, { recursive: true })

	const outputs = new Map([
		[path.join(options.outputRoot, 'component-catalog.md'), renderComponentCatalog(catalog)],
		[path.join(options.outputRoot, 'source-baseline.md'), renderSourceBaseline(catalog)],
	])
	const stale = []
	for (const [file, content] of outputs) {
		const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null
		if (current === content) continue
		if (options.check) stale.push(path.basename(file))
		else {
			fs.writeFileSync(file, content, 'utf8')
			console.log(`[fbjs-catalog] wrote ${file}`)
		}
	}

	if (stale.length) {
		console.error(`[fbjs-catalog] stale generated reference: ${stale.join(', ')}`)
		process.exitCode = 1
		return
	}
	console.log(`[fbjs-catalog] OK: ${catalog.components.length} component records, ${catalog.unresolvedUsage.length} unresolved project tags, ${catalog.ambiguousUsage.length} ambiguous project tags`)
}

main()
