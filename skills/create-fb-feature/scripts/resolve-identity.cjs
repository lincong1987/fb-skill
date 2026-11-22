#!/usr/bin/env node
'use strict'

// resolve-identity.cjs — 识别/确认当前操作人（本地门禁与审计用）。
//
// 读取模式（只读，不写任何文件）：
//   node resolve-identity.cjs --project-root <dir> [--profile-root <dir>]
//     → {"ok":true,"operator":…|null,"candidates":[…],"notes":[…],"resolvedAt":…}
//     operator 仅在存在「已确认档案」（真实确认语句 + 来源引用）时非空，
//     直接复用，不重复登记；只有无有效档案时才自动收集 git/svn/os 候选。
//     git 作者邮箱按策略永不读取、不输出。
//
// 确认模式（--save）：
//   node resolve-identity.cjs --project-root <dir> [--scope project|global]
//     --name "姓名" [--email "a@b"] --confirmation-text "<用户确认原话>"
//     --source-ref "<human message id 或 terminal:引用>"
//     [--method user-message|terminal] [--expect-hash <当前档案hash>] [--reconfirm]
//   规则：
//     * --scope 显式指定；缺省 project，绝不默认 global；
//     * 缺 --confirmation-text / --source-ref、语句为空/否定/示例/模拟措辞 → 拒绝（exit 2）；
//     * 已有档案必须带 --expect-hash（先查看再更新）；invalidated 档案需 --reconfirm；
//     * --host-approval 与 --confirmation-text/--source-ref/--method 混用 → 拒绝（BAD_ARGS）；
//     * fixture / 合成姓名拒绝写入。
//
// 失效模式（--invalidate）：把档案标记为 invalidated（需 --expect-hash）。
//
// 退出码：0 正常；2 参数/校验/IO 错误。
// 限制：本工具记录「谁在何时引用哪条来源确认了身份」，无法鉴别宿主之外
// 伪造的同文本消息；档案为本地 JSON，可被本地篡改。这是本地防误操作与
// 审计基线，不冒充企业 IAM 或数字签名。

const fs = require('fs')
const F = require('./lib/files.cjs')
const I = require('./lib/identity.cjs')

const USAGE = [
  '用法：',
  '  读取： node resolve-identity.cjs --project-root <dir> [--profile-root <dir>]',
  '  确认： node resolve-identity.cjs --project-root <dir> [--scope project|global] --save',
  '         --name "<姓名>" [--email "<a@b>"]',
  '         --confirmation-text "<用户确认原话>" --source-ref "<消息ID或terminal:引用>"',
  '         [--method user-message|terminal] [--expect-hash <当前hash>] [--reconfirm]',
  '  宿主： --save --name "<已展示日志标签>" --host-approval <根内真实批准记录.json>',
  '        （不与 --confirmation-text/--source-ref/--method 混用）',
  '  失效： node resolve-identity.cjs --project-root <dir> --invalidate --expect-hash <当前hash> [--reason R]',
  '',
  '退出码：0 正常；2 参数/校验/IO 错误。',
  '说明：有有效档案就复用显示名，不重复 --save；无档案时才收集候选并首次确认。',
  '      身份登记不批准当前方案；候选（git/svn/os）不会自动成为操作人。',
  '      --profile-root 只指 profiles 目录（其下 profile.json），不指 HOME。',
  ''
].join('\n')

// 严格解析：未知参数/重复参数/缺值即抛 FbError；支持 --flag value 与 --flag=value。
function parseArgs (argv) {
  const known = {
    '--project-root': 1,
    '--profile-root': 1,
    '--save': 0,
    '--invalidate': 0,
    '--reconfirm': 0,
    '--scope': 1,
    '--name': 1,
    '--email': 1,
    '--confirmation-text': 1,
    '--source-ref': 1,
    '--method': 1,
    '--host-approval': 1,
    '--expect-hash': 1,
    '--reason': 1,
    '--help': 0
  }
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    let name = raw
    let inlineValue
    const eq = raw.indexOf('=')
    if (eq > 2) {
      name = raw.slice(0, eq)
      inlineValue = raw.slice(eq + 1)
    }
    if (!(name in known)) throw new F.FbError('UNKNOWN_ARG', '未知参数：' + raw)
    if (name in out) throw new F.FbError('DUP_ARG', '重复参数：' + name)
    if (known[name] === 0) {
      if (inlineValue !== undefined) throw new F.FbError('BAD_ARG', name + ' 不接受取值')
      out[name] = true
      continue
    }
    const value = inlineValue !== undefined ? inlineValue : argv[++i]
    if (value === undefined || value === '' || value.startsWith('--')) throw new F.FbError('MISSING_VALUE', name + ' 缺少取值')
    out[name] = value
  }
  return out
}

// stdout 只允许最终一条 JSON；统一走 writeSync(1)，避免 Windows 管道下
// process.exit 截断异步缓冲。
function emit (obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n')
}

function fail (e) {
  emit({ ok: false, code: e.code || 'ERROR', error: e.message, details: e.details })
  process.exit(2)
}

function main () {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    fail(e)
    return
  }
  if (args['--help']) {
    fs.writeSync(1, USAGE)
    return
  }
  try {
    if (!args['--project-root']) throw new F.FbError('MISSING_ARG', '缺少 --project-root')
    const projectRoot = args['--project-root']
    const profileRoot = args['--profile-root']
    if (args['--save'] && args['--invalidate']) {
      throw new F.FbError('BAD_ARGS', '--save 与 --invalidate 互斥')
    }
    const saveOnly = ['--name', '--email', '--confirmation-text', '--source-ref', '--method', '--host-approval', '--reconfirm']
    if (!args['--save'] && saveOnly.some(flag => args[flag] !== undefined)) {
      throw new F.FbError('BAD_ARGS', '身份确认参数必须与 --save 一起使用；只读模式不接受或忽略批准材料')
    }
    if (args['--host-approval'] && (args['--confirmation-text'] !== undefined || args['--source-ref'] !== undefined || args['--method'] !== undefined)) {
      throw new F.FbError('BAD_ARGS', '--host-approval 与 --confirmation-text/--source-ref/--method 不能混用（宿主模式来源固定为该批准记录）')
    }
    if (args['--save']) {
      const receipt = args['--host-approval']
        ? F.readJson(F.assertRelativeFileInRoot(F.resolveRoot(projectRoot), args['--host-approval']).abs).value
        : undefined
      const saved = I.saveProfile({
        projectRoot: projectRoot,
        profileRoot: profileRoot,
        scope: args['--scope'],
        name: args['--name'],
        email: args['--email'],
        confirmationText: receipt ? receipt.resultText : args['--confirmation-text'],
        sourceRef: receipt ? receipt.reference : args['--source-ref'],
        method: receipt ? 'host-plan' : args['--method'],
        hostApproval: receipt,
        expectHash: args['--expect-hash'],
        reconfirm: args['--reconfirm'] === true
      })
      const ident = I.loadIdentity({ projectRoot: projectRoot, profileRoot: profileRoot })
      emit({
        ok: true,
        saved: { scope: saved.scope, file: saved.file, revision: saved.profile.revision, hash: saved.hash },
        operator: ident.operator,
        candidates: ident.candidates,
        notes: ident.notes
      })
      return
    }
    if (args['--invalidate']) {
      const inv = I.invalidateProfile({
        projectRoot: projectRoot,
        profileRoot: profileRoot,
        scope: args['--scope'],
        expectHash: args['--expect-hash'],
        reason: args['--reason']
      })
      const ident = I.loadIdentity({ projectRoot: projectRoot, profileRoot: profileRoot })
      emit({
        ok: true,
        invalidated: { file: inv.file, status: inv.profile.status, hash: inv.hash },
        operator: ident.operator,
        notes: ident.notes
      })
      return
    }
    const ident = I.loadIdentity({ projectRoot: projectRoot, profileRoot: profileRoot })
    emit({
      ok: true,
      operator: ident.operator,
      candidates: ident.candidates,
      notes: ident.notes,
      resolvedAt: ident.resolvedAt
    })
  } catch (e) {
    fail(e)
  }
}

if (require.main === module) main()

module.exports = {
  parseArgs: parseArgs,
  main: main,
  readIdentity: I.readIdentity,
  saveProfile: I.saveProfile,
  invalidateProfile: I.invalidateProfile,
  validateConfirmationText: I.validateConfirmationText,
  validateOperatorSchema: I.validateOperatorSchema,
  isFixtureName: I.isFixtureName,
  IDENTITY_SCHEMA: I.IDENTITY_SCHEMA
}
