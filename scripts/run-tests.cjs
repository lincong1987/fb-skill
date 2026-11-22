const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join(root, 'tests', name))
if (!tests.length) {
  process.stderr.write('No test files found.\n')
  process.exitCode = 2
} else {
  const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`)
    process.exitCode = 2
  } else process.exitCode = result.status === null ? 2 : result.status
}
