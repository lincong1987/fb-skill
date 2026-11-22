#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { NAMES, checkSkillDirectory } = require('../skills/create-fb-feature/scripts/lib/skill-format.cjs')

function check(root = path.resolve(__dirname, '..')) {
  const result = NAMES.map(name => checkSkillDirectory(path.join(root, 'skills', name)))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'))
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'manage-fb-skill', 'bundle.json'), 'utf8'))
  if (pkg.version !== plugin.version || pkg.version !== bundle.version) throw new Error('Package, plugin and bundle versions differ')
  if (bundle.name !== 'fb-skill' || JSON.stringify(bundle.skills) !== JSON.stringify(NAMES)) throw new Error('Bundle skill list is inconsistent')
  if (plugin.skills !== './skills/') throw new Error('Plugin does not expose the bundled skill directory')
  for (const entry of ['bin/fb-skill.cjs', 'skills/create-fb-feature/scripts/detect-project.cjs', 'skills/create-fb-feature/scripts/resolve-identity.cjs', 'skills/create-fb-feature/scripts/workflow.cjs', 'skills/create-fb-feature/scripts/archive.cjs', 'skills/manage-fb-skill/scripts/install.cjs', 'skills/manage-fb-skill/legacy/catalog.json']) {
    if (!fs.existsSync(path.join(root, entry))) throw new Error(`Required bundle file missing: ${entry}`)
  }
  return { version: pkg.version, skills: result }
}

if (require.main === module) {
  try {
    const result = check()
    process.stdout.write(`[fb-skills] OK ${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`[fb-skills] FAIL ${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { check }
