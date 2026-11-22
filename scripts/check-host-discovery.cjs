#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const readline = require('readline')

// 本机已安装宿主的 stdio 协议；不修改其配置或认证，不启动模型任务。
async function discover(consumer, output) {
  const entry = 'C:/nvm4w/nodejs/node_modules/@openai/codex/bin/codex.js'
  const child = spawn(process.execPath, [entry, 'app-server', '--stdio'], {
    cwd: consumer, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  })
  let stderr = ''
  const pending = new Map()
  const lines = []
  child.stderr.on('data', bytes => { stderr += bytes.toString() })
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', line => {
    let value
    try { value = JSON.parse(line) } catch { return }
    lines.push(value)
    if (value.id !== undefined && pending.has(value.id)) {
      const settle = pending.get(value.id)
      pending.delete(value.id)
      if (value.error) settle.reject(new Error(JSON.stringify(value.error)))
      else settle.resolve(value.result)
    }
  })
  let sequence = 0
  function request(method, params) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out: ' + method)) }, 30000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }
  try {
    const initialized = await request('initialize', { clientInfo: { name: 'fb_skill_release_validation', version: '0.2.1' }, capabilities: { experimentalApi: false } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const listed = await request('skills/list', { cwds: [consumer], forceReload: true })
    const report = { nature: 'real-host-discovery-not-model-triggering', consumer, initialized, listed, recordedAt: new Date().toISOString() }
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    const errors = listed.data && listed.data.flatMap(item => item.errors || []) || []
    const skills = listed.data && listed.data.flatMap(item => item.skills || []) || []
    fs.writeSync(1, JSON.stringify({ output, errors, fbSkills: skills.filter(item => /(?:^|:)(?:create-fb-feature|use-fbjs-vue2|manage-fb-skill)$/.test(item.name) && item.scope === 'repo') }) + '\n')
  } finally {
    rl.close()
    child.stdin.end()
    child.kill()
    fs.writeFileSync(output + '.stderr.log', stderr, { flag: 'wx' })
  }
}

if (require.main === module) {
  discover(path.resolve(process.argv[2]), path.resolve(process.argv[3])).catch(error => {
    fs.writeSync(2, error.message + '\n')
    process.exitCode = 1
  })
}
module.exports = { discover }
