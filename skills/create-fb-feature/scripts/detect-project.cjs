#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { detectProject } = require('./lib/detect.cjs')

function main(argv) {
  const options = { projectRoot: process.cwd() }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--help') {
      process.stdout.write('Usage: node detect-project.cjs --project-root <directory> [--target <relative path>] [--max-depth <1..12>]\n')
      return
    }
    if (!['--project-root', '--target', '--max-depth'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--project-root') options.projectRoot = value
    if (flag === '--target') options.target = value
    if (flag === '--max-depth') {
      if (!/^(?:[1-9]|1[0-2])$/.test(value)) throw new Error('--max-depth must be an integer from 1 to 12')
      options.maxDepth = Number(value)
    }
  }
  if (!fs.existsSync(path.resolve(options.projectRoot))) throw new Error('Project root does not exist')
  process.stdout.write(`${JSON.stringify(detectProject(options), null, 2)}\n`)
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`[fb-detect] ${error.message}\n`)
    process.exitCode = 2
  }
}

module.exports = { main }
