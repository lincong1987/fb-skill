#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const COMMANDS = {
  detect: 'skills/create-fb-feature/scripts/detect-project.cjs',
  identity: 'skills/create-fb-feature/scripts/resolve-identity.cjs',
  workflow: 'skills/create-fb-feature/scripts/workflow.cjs',
  archive: 'skills/create-fb-feature/scripts/archive.cjs',
  install: 'skills/manage-fb-skill/scripts/install.cjs'
}

function main(argv) {
  const [command, ...args] = argv
  if (command === '--version') {
    process.stdout.write(`${JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version}\n`)
    return
  }
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write('FB Skill\n\n  fb-skill detect --project-root <directory> [--target <relative path>]\n  fb-skill identity --project-root <directory>\n  fb-skill workflow <plan|approve|check|event|verify|report> --help\n  fb-skill archive --project-root <directory> --id <workflow-id> --input <JSON-file> [--apply]\n  fb-skill install <scan|plan|apply> --help\n\nDetection and scan are read-only. Installation and cleanup require a reviewed, approved plan. Archive previews by default.\n')
    return
  }
  const script = COMMANDS[command]
  if (!script) throw new Error(`Unknown command: ${command}`)
  const file = path.join(ROOT, script)
  if (!fs.existsSync(file)) throw new Error(`Bundle is incomplete: ${script}`)
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  process.exitCode = result.status === null ? 2 : result.status
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`[fb-skill] ${error.message}\n`)
    process.exitCode = 2
  }
}

module.exports = { main, COMMANDS }
