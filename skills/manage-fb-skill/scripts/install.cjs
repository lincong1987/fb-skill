#!/usr/bin/env node
'use strict'

// install.cjs — fb-skill 三件套安装 / 更新 / 旧 fb-rules 精确清理（CLI）。
//
// 用法：
//   node install.cjs scan|plan|apply --project-root <dir>
//        [--action install|clean-legacy|install-and-clean]
//        --id <slug>
//        [--skill-source <bundle-root>] [--location .agents/skills|.claude/skills]
//
//   * scan  纯只读预览：逐文件 create/adopt/update/conflict 与 legacy 清理候选/保留项，不写任何文件。
//   * plan  只经 workflow.cjs createPlan 写唯一 plan-vN.json（安装 payload 存 metadata.installation）；
//           scan 阶段尚未看过清单时不得直接拿旧批准执行。
//   * apply 必须先有真实 approval 事件（workflow.recordApproval，已确认操作人）；全程持
//           workflow 独占锁，先整份预验再执行；没有任何 --yes/--force/autoapprove 旁路。
//
// 退出码：0 成功；1 拒绝/失败；2 用法错误。
// 限制：本地门禁与审计链不冒充企业 IAM 或不可绕过安全边界；直接绕开工具写文件不受此层控制。

const fs = require('fs')
const F = require('../../create-fb-feature/scripts/lib/files.cjs')
const installer = require('./lib/installer.cjs')

const USAGE = [
  '用法：',
  '  node install.cjs scan|plan|apply --project-root <dir> --action install|clean-legacy|install-and-clean --id <slug>',
  '       [--skill-source <bundle-root>] [--location .agents/skills|.claude/skills]',
  '',
  '  scan   纯只读预览（不写任何文件）',
  '  plan   经 workflow.createPlan 写唯一 plan-vN.json（payload 在 metadata.installation）',
  '  apply  需先通过 workflow.recordApproval 录入真实批准；执行前整份预验，无旁路 flag',
  '',
  '退出码：0 成功；1 拒绝/失败；2 用法错误。'
].join('\n')

const USAGE_EXIT_CODES = new Set(['USAGE', 'UNKNOWN_ARG', 'DUP_ARG', 'BAD_ARG', 'MISSING_VALUE', 'DUP_COMMAND', 'BAD_ACTION', 'BAD_LOCATION', 'ROOT_REQUIRED', 'ID_REQUIRED', 'ACTION_REQUIRED'])

function emit (report) {
  fs.writeSync(1, JSON.stringify(report, null, 2) + '\n')
}

function fail (code, message) {
  emit({ ok: false, code: code, error: message })
  process.exit(USAGE_EXIT_CODES.has(code) ? 2 : 1)
}

function parseArgs (argv) {
  const known = {
    '--project-root': 1,
    '--action': 1,
    '--id': 1,
    '--skill-source': 1,
    '--location': 1,
    '--help': 0
  }
  const out = {}
  let command = null
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    let name = raw
    let inlineValue
    const eq = raw.indexOf('=')
    if (eq > 2) {
      name = raw.slice(0, eq)
      inlineValue = raw.slice(eq + 1)
    }
    if (name === 'scan' || name === 'plan' || name === 'apply') {
      if (inlineValue !== undefined) throw new F.FbError('BAD_ARG', '命令不接受取值：' + raw)
      if (command) throw new F.FbError('DUP_COMMAND', '重复命令：' + name)
      command = name
      continue
    }
    if (!(name in known)) {
      throw new F.FbError('UNKNOWN_ARG', '未知参数：' + raw + '（本工具没有任何 yes/force/autoapprove 旁路）')
    }
    if (name in out) throw new F.FbError('DUP_ARG', '重复参数：' + name)
    if (known[name] === 0) {
      if (inlineValue !== undefined) throw new F.FbError('BAD_ARG', name + ' 不接受取值')
      out[name] = true
      continue
    }
    const value = inlineValue !== undefined ? inlineValue : argv[++i]
    if (value === undefined || value === '' || value.startsWith('--')) throw new F.FbError('MISSING_VALUE', '参数缺值：' + name)
    out[name] = value
  }
  if (!command && !out['--help']) throw new F.FbError('USAGE', USAGE)
  return { command: command, args: out }
}

function main () {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (e) {
    fail(e.code || 'USAGE', e.code === 'USAGE' ? USAGE : e.message)
    return
  }
  const args = parsed.args
  if (args['--help']) {
    fs.writeSync(1, USAGE + '\n')
    return
  }
  if (!args['--project-root']) fail('ROOT_REQUIRED', '缺少 --project-root（目标项目根，绝不默认当前目录）')

  const options = {
    projectRoot: args['--project-root'],
    action: args['--action'],
    id: args['--id'],
    skillSource: args['--skill-source'],
    location: args['--location']
  }

  if (parsed.command === 'scan') {
    const report = installer.scan(options)
    emit(report)
    process.exit(report.ok === false ? 1 : 0)
  }

  if (!options.id) fail('ID_REQUIRED', parsed.command + ' 需要 --id <slug>（安全任务名，如 20261121-install-mine-gov）')
  if (parsed.command === 'plan' && !options.action) fail('ACTION_REQUIRED', 'plan 需要 --action install|clean-legacy|install-and-clean')

  if (parsed.command === 'plan') {
    const report = installer.createInstallPlan(options)
    emit(report)
    process.exit(report.ok === false ? 1 : 0)
  }

  if (parsed.command === 'apply') {
    const report = installer.applyPlan(options)
    emit(report)
    process.exit(report.ok === false ? 1 : 0)
  }

  fail('UNKNOWN_COMMAND', '未知命令：' + parsed.command)
}

try {
  main()
} catch (e) {
  fail(e && e.code ? e.code : 'ERROR', e && e.message ? e.message : String(e))
}
