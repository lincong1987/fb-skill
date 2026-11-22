#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function digest(content) { return crypto.createHash('sha256').update(content).digest('hex') }
function clean(value) { return String(value === undefined || value === null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|') }

function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || /[\u0000-\u001f\u007f:]/.test(relative) || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.' || !part || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Artifact path must be a safe project-relative path')
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Artifact must be inside project root')
  let current = root
  for (const part of relative.split('/')) {
    current = path.join(current, part)
    if (!fs.existsSync(current)) continue
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error('Linked artifact path is not supported')
  }
  return file
}

function readCurrent(file) {
  if (!fs.existsSync(file)) return { content: null, hash: null }
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact destination is not a regular file')
  const content = fs.readFileSync(file, 'utf8')
  return { content, hash: digest(content) }
}

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(clean).join(' | ')} |`)].join('\n')
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || !input.title || !input.summary) throw new Error('Archive input requires title and summary')
  for (const field of ['files', 'interfaces', 'todos', 'verification']) {
    if (!Array.isArray(input[field])) throw new Error(`Archive input requires ${field} array`)
  }
  for (const item of input.verification) {
    if (!item || !['pass', 'fail', 'skipped', 'not-run'].includes(item.status) || !item.name) throw new Error('Verification requires name and pass|fail|skipped|not-run')
    if (item.status === 'pass' && !item.evidence) throw new Error('A passing claim needs evidence')
    if (item.status === 'pass' && item.exitCode !== undefined && item.exitCode !== 0) throw new Error('Non-zero exit code cannot be a pass')
    if (['skipped', 'not-run'].includes(item.status) && !item.detail) throw new Error('Skipped checks need a reason')
  }
}

function renderArchive(workflow, input, createdAt) {
  const approval = workflow.validApproval
  const status = input.verification.some(item => item.status === 'fail') ? '验证未通过' : input.verification.some(item => ['skipped', 'not-run'].includes(item.status)) ? '部分验证' : '已记录验证结果'
  return [
    `## 修订 ${workflow.revision} · ${createdAt}`,
    '',
    '### 需求摘要', clean(input.summary), '',
    '### 方案与批准',
    `- 方案：${clean(workflow.id)} / v${workflow.revision} / \`${workflow.plan.hash}\``,
    `- 方案摘要：${clean(workflow.plan.summary)}`,
    `- 批准人：${clean(approval.actor && (approval.actor.name || approval.actor.displayName) || approval.actor)}`,
    `- 批准证据：${clean(approval.evidenceKind)} · ${clean(approval.evidenceReference)}`,
    `- 批准时间：${clean(approval.atLocal || approval.at)}`,
    `- 审计：\`.agents/fb-feature/workflows/${workflow.id}/events.jsonl\` · ${workflow.chain.headHash}`,
    '',
    '### 产出文件',
    table(['文件', '变更', '说明'], input.files.map(item => [item.path, item.change, item.description])), '',
    '### 接口契约',
    input.interfaces.length ? table(['方法', '路径/能力', '参数', '响应/备注'], input.interfaces.map(item => [item.method, item.path, item.params, item.response])) : '本次未涉及接口变化。', '',
    '### 待办',
    input.todos.length ? input.todos.map(item => `- [ ] ${clean(item)}`).join('\n') : '- 无额外待办；以本节验证范围为准。', '',
    '### 验证', `状态：${status}。`,
    table(['检查', '结果', '命令/退出码', '证据/原因'], input.verification.map(item => [item.name, item.status, `${item.command || ''}${item.exitCode === undefined ? '' : ` (exit ${item.exitCode})`}`, item.evidence || item.detail])), '',
    '### 人 + 时间 + 事件',
    table(['时间', '事件', '执行主体', '事件哈希'], workflow.events.map(event => [event.atLocal || event.at, event.type, event.actor && (event.actor.name || event.actor.displayName) || event.actor || 'unknown', event.hash])), ''
  ].join('\n')
}

function changelogEntry(existing, entry, marker) {
  if (existing && existing.includes(marker)) return existing
  const content = existing === null ? '# Changelog\n\n## [Unreleased]\n\n' : existing
  const match = /^## \[Unreleased\].*$/m.exec(content)
  if (!match) return `${content}${content.endsWith('\n') ? '\n' : '\n\n'}## [Unreleased]\n\n${entry}\n`
  const nextHeading = /^## /gm
  nextHeading.lastIndex = match.index + match[0].length
  const next = nextHeading.exec(content)
  const insertion = next ? next.index : content.length
  const prefix = content.slice(0, insertion)
  return `${prefix}${prefix.endsWith('\n\n') ? '' : prefix.endsWith('\n') ? '\n' : '\n\n'}${entry}\n\n${content.slice(insertion)}`
}

function prepareArchive({ projectRoot, id, input, archivePath, changelogPath = 'CHANGELOG.md', workflow: providedWorkflow, now }) {
  validateInput(input)
  const rootStat = fs.lstatSync(path.resolve(projectRoot))
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Project root must be a non-linked directory')
  const root = fs.realpathSync(projectRoot)
  const workflowApi = providedWorkflow ? null : require('./workflow.cjs')
  if (workflowApi) workflowApi.assertApproved({ projectRoot: root, id })
  const workflow = providedWorkflow || workflowApi.readWorkflow({ projectRoot: root, id })
  if (!workflow || !workflow.plan || !workflow.hashOk || !workflow.chain.ok || !workflow.validApproval) throw new Error('A verified current plan and approval are required to archive implementation results')
  const document = archivePath || `docs/features/${workflow.id}.md`
  if (!document.startsWith('docs/features/') || !document.endsWith('.md')) throw new Error('Feature archive must be a Markdown file under docs/features/')
  if (!['CHANGELOG.md', 'docs/CHANGELOG.md'].includes(changelogPath)) throw new Error('Use CHANGELOG.md or docs/CHANGELOG.md')
  const files = workflow.plan.files.map(item => typeof item === 'string' ? item : item.path)
  for (const relative of [document, changelogPath]) if (!files.includes(relative)) throw new Error(`Artifact not in approved file scope: ${relative}`)
  for (const item of input.files) {
    if (!item || !files.includes(item.path)) throw new Error(`Reported file is not in approved scope: ${item && item.path}`)
    safeFile(root, item.path)
  }
  const archiveFile = safeFile(root, document)
  const changelogFile = safeFile(root, changelogPath)
  const currentArchive = readCurrent(archiveFile)
  const currentChangelog = readCurrent(changelogFile)
  const createdAt = now || new Date().toISOString()
  const inputHash = digest(JSON.stringify(input))
  const marker = `<!-- fb-feature:${workflow.id}:v${workflow.revision}:${inputHash} -->`
  const section = `${marker}\n${renderArchive(workflow, input, createdAt)}`
  const archiveContent = currentArchive.content && currentArchive.content.includes(marker) ? currentArchive.content : `${currentArchive.content === null ? `# ${clean(input.title)}\n\n` : currentArchive.content + (currentArchive.content.endsWith('\n') ? '\n' : '\n\n')}${section}`
  const archiveLink = path.posix.relative(path.posix.dirname(changelogPath), document)
  const changelogContent = changelogEntry(currentChangelog.content, `${marker}\n- ${clean(input.summary)}（实现档案：[${workflow.id}](${archiveLink})）`, marker)
  return { root, id: workflow.id, revision: workflow.revision, planHash: workflow.plan.hash, inputHash, marker, createdAt, files: [
    { path: document, file: archiveFile, previousHash: currentArchive.hash, content: archiveContent, hash: digest(archiveContent) },
    { path: changelogPath, file: changelogFile, previousHash: currentChangelog.hash, content: changelogContent, hash: digest(changelogContent) }
  ] }
}

function applyArchiveLocked(preview) {
  const { appendEvent, assertApproved } = require('./workflow.cjs')
  const plan = assertApproved({ projectRoot: preview.root, id: preview.id, revision: preview.revision })
  const workflow = require('./workflow.cjs').readWorkflow({ projectRoot: preview.root, id: preview.id })
  const actor = workflow.validApproval.actor
  if (plan.hash !== preview.planHash) throw new Error('Plan changed before archive apply')
  if (!Array.isArray(preview.files) || preview.files.length !== 2) throw new Error('Archive preview must contain the feature file and changelog only')
  for (const item of preview.files) {
    if (!item || !plan.files.includes(item.path) || !(item.path.startsWith('docs/features/') && item.path.endsWith('.md') || ['CHANGELOG.md', 'docs/CHANGELOG.md'].includes(item.path))) throw new Error('Archive destination is outside the approved artifact scope')
    if (safeFile(preview.root, item.path) !== item.file || digest(item.content) !== item.hash) throw new Error('Archive preview content or destination was modified')
  }
  const guard = () => {
    const currentPlan = assertApproved({ projectRoot: preview.root, id: preview.id, revision: preview.revision })
    if (currentPlan.hash !== preview.planHash) throw new Error('Plan changed before archive write')
    for (const item of preview.files) {
      safeFile(preview.root, item.path)
      if (readCurrent(item.file).hash !== item.previousHash) throw new Error(`Artifact changed since preview: ${item.path}`)
    }
  }
  appendEvent({ projectRoot: preview.root, id: preview.id, type: 'note', actor, details: { action: 'archive-start', revision: preview.revision, files: preview.files.map(item => ({ path: item.path, hash: item.hash })) }, guard })
  const written = []
  try {
    for (const item of preview.files) {
      safeFile(preview.root, item.path)
      if (readCurrent(item.file).hash !== item.previousHash) throw new Error(`Artifact changed before write: ${item.path}`)
      if (item.previousHash === item.hash) continue
      fs.mkdirSync(path.dirname(item.file), { recursive: true })
      safeFile(preview.root, item.path)
      const temporary = `${item.file}.fb-${crypto.randomBytes(6).toString('hex')}.tmp`
      fs.writeFileSync(temporary, item.content, { flag: 'wx' })
      try {
        if (readCurrent(item.file).hash !== item.previousHash) throw new Error(`Artifact changed before replacement: ${item.path}`)
        fs.renameSync(temporary, item.file)
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      written.push(item.path)
    }
    appendEvent({ projectRoot: preview.root, id: preview.id, type: 'note', actor, details: { action: 'archive-complete', written, inputHash: preview.inputHash } })
    return { ok: true, id: preview.id, written, preservedExistingContent: true }
  } catch (error) {
    appendEvent({ projectRoot: preview.root, id: preview.id, type: 'blocked', actor, details: { action: 'archive-failed', written, error: error.message } })
    throw error
  }
}

function applyArchive(preview) {
  const { withLock, resolveRoot } = require('./lib/files.cjs')
  const { lockPath } = require('./lib/audit.cjs')
  const root = resolveRoot(preview.root)
  safeFile(root, `.agents/fb-feature/workflows/${preview.id}/.lock`)
  return withLock(lockPath(root, preview.id), () => applyArchiveLocked(preview))
}

function main(argv) {
  const options = { projectRoot: process.cwd() }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help') {
      process.stdout.write('Usage: node archive.cjs --project-root <dir> --id <workflow> --input <json-file> [--archive docs/features/<id>.md] [--changelog CHANGELOG.md|docs/CHANGELOG.md] [--apply]\nWithout --apply the command previews content without writing. Artifacts must be in the approved plan scope.\n')
      return
    }
    if (flag === '--apply') { options.apply = true; continue }
    if (!['--project-root', '--id', '--input', '--archive', '--changelog'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--project-root') options.projectRoot = value
    if (flag === '--id') options.id = value
    if (flag === '--input') options.inputFile = value
    if (flag === '--archive') options.archivePath = value
    if (flag === '--changelog') options.changelogPath = value
  }
  if (!options.id || !options.inputFile) throw new Error('--id and --input are required')
  options.input = JSON.parse(fs.readFileSync(path.resolve(options.inputFile), 'utf8'))
  const preview = prepareArchive(options)
  process.stdout.write(`${JSON.stringify(options.apply ? applyArchive(preview) : preview, null, 2)}\n`)
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`[fb-archive] ${error.message}\n`)
    process.exitCode = 2
  }
}

module.exports = { prepareArchive, applyArchive, validateInput, renderArchive, changelogEntry, safeFile, main }
