const fs = require('fs')
const path = require('path')

const NAMES = ['create-fb-feature', 'use-fbjs-vue2', 'manage-fb-skill']
const REQUIRED = new Set(['name', 'description'])
const OPTIONAL = new Set(['license', 'compatibility', 'disable-model-invocation'])

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0] !== '---') throw new Error('SKILL.md must start with frontmatter')
  const end = lines.indexOf('---', 1)
  if (end === -1) throw new Error('Frontmatter is not closed')
  const fields = {}
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue
    const match = line.match(/^([a-z][a-z-]*): (.+)$/)
    if (!match) throw new Error('This bundle uses one-line scalar frontmatter; folded YAML and nested metadata are not supported')
    const [, key, raw] = match
    if (!REQUIRED.has(key) && !OPTIONAL.has(key)) throw new Error(`Unsupported frontmatter field: ${key}`)
    if (Object.hasOwn(fields, key)) throw new Error(`Duplicate frontmatter field: ${key}`)
    let value = raw.trim()
    if (value.startsWith('"')) {
      try { value = JSON.parse(value) } catch { throw new Error(`Invalid quoted frontmatter field: ${key}`) }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`Unclosed quoted frontmatter field: ${key}`)
      value = value.slice(1, -1).replace(/''/g, "'")
    } else if (/[:][ \t]|^[\[\]{},&*!|>@`]|[ \t]#/.test(value)) {
      throw new Error(`Quote YAML-sensitive scalar: ${key}`)
    }
    if (key === 'disable-model-invocation') {
      if (!['true', 'false'].includes(String(value))) throw new Error('disable-model-invocation must be true or false')
      fields[key] = String(value) === 'true'
    } else {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`Empty frontmatter field: ${key}`)
      fields[key] = value
    }
  }
  for (const key of REQUIRED) if (!fields[key]) throw new Error(`Missing frontmatter field: ${key}`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name) || fields.name.length > 64) throw new Error('Invalid skill name')
  if (fields.description.length > 1024) throw new Error('Description exceeds 1024 characters')
  return { fields, body: lines.slice(end + 1).join('\n') }
}

function walk(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Skill bundle contains a link: ${file}`)
    if (entry.isDirectory()) files.push(...walk(file))
    else if (entry.isFile()) files.push(file)
    else throw new Error(`Skill bundle contains a non-regular file: ${file}`)
  }
  return files
}

function checkSkillDirectory(directory) {
  const skillFile = path.join(directory, 'SKILL.md')
  const text = fs.readFileSync(skillFile, 'utf8')
  const frontmatter = parseFrontmatter(text)
  if (frontmatter.fields.name !== path.basename(directory)) throw new Error(`Skill name does not match directory: ${directory}`)
  if (Buffer.byteLength(text, 'utf8') > 20000) throw new Error(`SKILL.md exceeds 20000 bytes: ${directory}`)
  if (text.split(/\r?\n/).length > 150) throw new Error(`Entry exceeds this bundle's 150-line budget: ${directory}`)
  const files = walk(directory)
  for (const file of files) {
    const relative = path.relative(directory, file)
    if (relative.split(path.sep).some(name => ['tests', 'fixtures', 'evals', '.validation-output', 'node_modules', '.git'].includes(name)) || /(?:\.test\.|\.spec\.|\.tgz$|\.zip$)/i.test(relative)) {
      throw new Error(`Development/test artifact inside published skill: ${relative}`)
    }
    if (!file.endsWith('.md')) continue
    const markdown = fs.readFileSync(file, 'utf8')
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.includes('<')) continue
      const decoded = decodeURIComponent(target.split(' ')[0])
      const link = path.resolve(path.dirname(file), decoded)
      if (!fs.existsSync(link)) throw new Error(`Broken local link in ${relative}: ${target}`)
    }
  }
  return { name: frontmatter.fields.name, bytes: Buffer.byteLength(text, 'utf8'), lines: text.split(/\r?\n/).length, files: files.length }
}

module.exports = { NAMES, parseFrontmatter, checkSkillDirectory, walk }
