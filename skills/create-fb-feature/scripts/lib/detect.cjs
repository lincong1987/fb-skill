const fs = require('fs')
const path = require('path')

const SKIP = new Set(['.git', '.svn', 'node_modules', 'dist', 'build', 'target', '.validation-output', '.agents', '.auto', 'coverage', 'generated-images', 'generated-videos'])
const PACKAGES = ['vue', 'fb-core', 'fb-ui', 'fb-third', '@topinfo/admin-base', '@topinfo/tp-components', '@topinfo/screen-base', '@topinfoapp/ta-ui', '@topinfoapp/ta-js', '@topinfoapp/ta-theme', 'uni-simple-router']
const CONFIGS = ['project.config.js', 'fb.config.js', 'vue.config.js', 'rsbuild.config.js', 'rsbuild.config.ts', 'vite.config.js', 'vite.config.ts']

function isInside(root, file) {
  const relative = path.relative(root, file)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function readText(file, notes) {
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    if (stat.size > 2 * 1024 * 1024) {
      notes.push({ file, reason: 'Skipped file larger than 2 MiB' })
      return null
    }
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') notes.push({ file, reason: error.message })
    return null
  }
}

function jsonEvidence(file, notes) {
  const text = readText(file, notes)
  if (text === null) return null
  try { return { data: JSON.parse(text.replace(/^\uFEFF/, '')), text } } catch (error) {
    notes.push({ file, reason: `Invalid JSON: ${error.message}` })
    return null
  }
}

function lineOf(text, needle) {
  const index = text.indexOf(needle)
  return index < 0 ? null : text.slice(0, index).split('\n').length
}

function existsFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() } catch { return false }
}

function existsDirectory(file) {
  try { const stat = fs.lstatSync(file); return stat.isDirectory() && !stat.isSymbolicLink() } catch { return false }
}

function installedPackage(root, name, notes) {
  let directory = root
  while (true) {
    const file = path.join(directory, 'node_modules', ...name.split('/'), 'package.json')
    // Package-manager links are allowed for read-only version evidence, never for recursive project scanning.
    if (fs.existsSync(file)) {
      const result = jsonEvidence(file, notes)
      if (result && result.data.name === name) {
        return { version: result.data.version || null, file: fs.realpathSync(file), source: directory === root ? 'installed-local' : 'installed-hoisted' }
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

function lockedPackages(root, notes) {
  const locks = {}
  const file = path.join(root, 'package-lock.json')
  if (!existsFile(file)) return locks
  const result = jsonEvidence(file, notes)
  if (!result) return locks
  for (const name of PACKAGES) {
    const entry = result.data.packages && result.data.packages[`node_modules/${name}`]
    const legacy = result.data.dependencies && result.data.dependencies[name]
    const version = entry && entry.version || legacy && legacy.version
    if (version) locks[name] = { version, file, source: 'npm-lock', line: lineOf(result.text, `"node_modules/${name}"`) }
  }
  return locks
}

// TA-UI 有两条并行发布线：0.1.x 持续发布（ta-app-trae 团队模板按它写），1.x 停在 1.0.37。
// 实装/锁定版本优先，其次声明范围；读不出就是 unknown，不猜。
function taUiLine(dependency) {
  for (const [source, value] of [['effective', dependency.effectiveVersion], ['declared', dependency.declared]]) {
    const match = typeof value === 'string' && /(\d+)\.(\d+)/.exec(value)
    if (!match) continue
    const major = Number(match[1])
    return { uiLine: major === 0 ? `0.${match[2]}` : `${major}.x`, uiLineSource: source }
  }
  return { uiLine: 'unknown', uiLineSource: null }
}

function childDirectories(directory, notes) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter(child => child.isDirectory() && !child.isSymbolicLink()).map(child => child.name).sort()
  } catch (error) {
    if (error.code !== 'ENOENT') notes.push({ file: directory, reason: error.message })
    return []
  }
}

// 只读列出：团队规则、项目本地 ta-/cu- 包装组件、可照抄的现成增删改查模块（list + add/update/edit/view）。
function taAppInfo(root, dependency, notes) {
  const rules = path.join(root, '.agents', 'rules', 'project_rules.md')
  const localComponents = childDirectories(path.join(root, 'src', 'components'), notes).filter(name => /^(ta|cu)-/.test(name)).slice(0, 40)
  const referenceModules = []
  const pagesRoot = path.join(root, 'src', 'pages')
  for (const module of childDirectories(pagesRoot, notes)) {
    let files
    try { files = fs.readdirSync(path.join(pagesRoot, module)).sort() } catch (error) { notes.push({ file: path.join(pagesRoot, module), reason: error.message }); continue }
    const pages = files.filter(name => new RegExp(`^${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(list|add|update|edit|view)\\.vue$`).test(name))
    if (pages.includes(`${module}-list.vue`) && pages.length > 1) referenceModules.push({ module, pages })
    if (referenceModules.length === 5) break
  }
  return { ...taUiLine(dependency), teamRules: existsFile(rules) ? rules : null, localComponents, referenceModules }
}

function frontendUnit(root, notes) {
  const file = path.join(root, 'package.json')
  const pkg = jsonEvidence(file, notes)
  const pages = ['pages.json', 'src/pages.json'].map(item => path.join(root, item)).filter(existsFile)
  const manifests = ['manifest.json', 'src/manifest.json'].map(item => path.join(root, item)).filter(existsFile)
  if (!pkg && !pages.length) return null
  const declared = { ...(pkg && pkg.data.devDependencies), ...(pkg && pkg.data.dependencies) }
  const locks = lockedPackages(root, notes)
  const dependencies = {}
  for (const name of PACKAGES) {
    if (declared[name]) {
      const installed = installedPackage(root, name, notes)
      dependencies[name] = {
        declared: declared[name],
        declaration: { file, line: lineOf(pkg.text, `"${name}"`) },
        installed,
        locked: locks[name] || null,
        effectiveVersion: installed && installed.version || locks[name] && locks[name].version || null
      }
      if (installed && locks[name] && installed.version !== locks[name].version) notes.push({ file, reason: `${name}: installed ${installed.version} differs from lock ${locks[name].version}` })
    }
  }
  const has = name => Object.hasOwn(dependencies, name)
  const uni = pages.length > 0 && manifests.length > 0
  const profiles = []
  if (uni) profiles.push(has('@topinfoapp/ta-ui') ? 'mobile-ta-uni' : 'mobile-uni-unclassified')
  if (!uni && (has('fb-ui') || has('@topinfo/admin-base') || has('fb-core'))) profiles.push('pc-fb-vue2-candidate')
  const configurations = []
  const entries = []
  for (const name of CONFIGS) {
    const configFile = path.join(root, name)
    const text = readText(configFile, notes)
    if (text === null) continue
    configurations.push({ file: configFile, mode: 'static-text-only' })
    const matcher = /['"`]([^'"`\r\n]*screen[^'"`\r\n]*\.(?:js|ts|vue))['"`]/gi
    for (const match of text.matchAll(matcher)) entries.push({ file: configFile, line: lineOf(text, match[0]), entry: match[1] })
  }
  if (has('@topinfo/screen-base')) profiles.push('screen-fb-candidate')
  else if (entries.length && profiles.includes('pc-fb-vue2-candidate')) profiles.push('screen-entry-unclassified')
  const vue = dependencies.vue
  const vueVersion = vue && vue.effectiveVersion
  if (vueVersion && /^3\./.test(vueVersion)) {
    profiles.splice(0, profiles.length, uni ? 'mobile-uni-vue3-unverified' : 'fb-vue3-unverified')
  }
  if (!profiles.length) return null
  const evidence = [file, ...pages, ...manifests].filter(existsFile)
  const contextFiles = [
    'src/main.js', 'src/service/serviceConfig.js', 'src/util/serviceConfig.js', 'src/config/serviceConfig.js',
    'src/util/Page.js', 'src/service-util.js', 'src/util/service-util.js', 'src/global-blending.js',
    'src/mixin/global-blending.js', 'src/router.js', 'router.js', 'main.js'
  ].map(item => path.join(root, item)).filter(existsFile)
  const taApp = profiles.includes('mobile-ta-uni') ? taAppInfo(root, dependencies['@topinfoapp/ta-ui'], notes) : null
  return {
    root,
    kind: 'frontend',
    name: pkg && pkg.data.name || path.basename(root),
    profiles,
    vueLine: vueVersion ? (/^2\.7\./.test(vueVersion) ? 'vue2.7' : /^2\./.test(vueVersion) ? 'vue2' : 'unverified') : 'unknown',
    dependencies,
    evidence,
    configurations,
    screenEntryCandidates: entries,
    contextFiles,
    ...(taApp ? { taApp } : {}),
    requiresReview: [
      'Confirm actual component registration, local overrides and target entry; dependencies alone do not prove active UI.',
      'Read service interceptors and the matching backend before choosing response, date, paging or permission contracts.',
      ...(uni && has('uni-simple-router') ? ['uni-simple-router is declared; read actual bootstrap before assuming it is enabled.'] : []),
      ...(has('@topinfoapp/ta-ui') && !dependencies['@topinfoapp/ta-ui'].installed ? ['TA-UI dependency is not installed here; call sites are leads, not a complete API contract.'] : []),
      ...(profiles.includes('screen-fb-candidate') && !entries.length ? ['No static screen entry identified in recognized config files; locate the active entry before generating.'] : []),
      ...(taApp && taApp.teamRules ? ['Team rules exist at .agents/rules/project_rules.md; read them before generating and follow them where they match this project.'] : []),
      ...(taApp && taApp.uiLine === '1.x' ? ['TA-UI is on the 1.x line while ta-app-trae templates target 0.1.x: customResultMapp, fileSize, @fileExceedLimit and lgnoreDelIds do not exist in 1.0.37 and would be silently ignored; copy this project\'s existing usage instead.'] : []),
      ...(taApp && taApp.uiLine === 'unknown' ? ['TA-UI version (UI line 0.1 vs 1.x) could not be determined from installed, locked or declared versions; resolve it before choosing component props.'] : [])
    ]
  }
}

// 从 pom 文本读 TopInfo 平台坐标与版本。只认字面版本；${...} 占位保留表达式不猜值。
// parent 块单独解析，避免把 <parent> 里的聚合坐标当成业务依赖的坐标。
function topinfoPlatform(text) {
  const parent = /<parent>[\s\S]*?<\/parent>/.exec(text)
  const parentText = parent ? parent[0] : ''
  const body = parent ? text.replace(parent[0], '') : text
  const artifact = /<artifactId>\s*(topinfo-platform(?:-[a-z]+)*)\s*<\/artifactId>/i.exec(body)
  const parentArtifact = /<artifactId>\s*(topinfo-platform(?:-[a-z]+)*)\s*<\/artifactId>/i.exec(parentText)
  if (!artifact && !parentArtifact) return null
  const block = artifact ? body.slice(artifact.index, artifact.index + 400) : ''
  const version = /<version>\s*([^<]+?)\s*<\/version>/.exec(block)
  const parentVersion = /<version>\s*([^<]+?)\s*<\/version>/.exec(parentText)
  const raw = version ? version[1].trim() : null
  const isExpression = raw !== null && /^\$\{[^}]+\}$/.test(raw)
  return {
    name: 'topinfo-platform',
    version: raw !== null && !isExpression ? raw : null,
    versionExpression: isExpression ? raw : null,
    declaredIn: 'pom.xml',
    artifactId: artifact ? artifact[1] : parentArtifact[1],
    parentVersion: parentVersion ? parentVersion[1].trim() : null,
    declaredAs: artifact ? 'dependency' : 'parent'
  }
}

function topinfoProfile(platform) {
  const version = platform.version || platform.parentVersion
  if (!version) return null
  if (/^3\./.test(version)) return 'java-topinfo-3x-candidate'
  if (/^2\./.test(version)) return 'java-topinfo-2x-candidate'
  return 'java-topinfo-unversioned'
}

function javaUnit(root, notes) {
  const file = path.join(root, 'pom.xml')
  const text = readText(file, notes)
  if (text === null) return null
  const modules = Array.from(text.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)).map(match => match[1].trim())
  const drivers = []
  for (const [driver, matcher] of [['mysql', /mysql-connector|mysql:mysql/], ['dameng', /dmjdbc|DmJdbc|com\.dameng/i], ['postgresql', /org\.postgresql|<artifactId>postgresql/], ['oracle', /ojdbc|oracle\.jdbc/i]]) {
    if (matcher.test(text)) drivers.push(driver)
  }
  const profiles = []
  if (/mybatis-plus/i.test(text)) profiles.push('java-mybatis-plus-candidate')
  if (/spring-boot/i.test(text)) profiles.push('java-spring-boot-candidate')
  const platform = topinfoPlatform(text)
  const platformProfile = platform ? topinfoProfile(platform) : null
  if (platformProfile) profiles.push(platformProfile)
  if (!profiles.length) profiles.push('java-maven-unclassified')
  const requiresReview = ['Resolve parent POM and dependency versions; inspect actual controller, request model, mapper XML, identity resolver and database DDL.']
  if (platform && !platformProfile) requiresReview.push('TopInfo platform version is a property expression; resolve it from the effective POM before using version-specific framework references.')
  return {
    root, kind: 'backend', profiles, evidence: [{ file, line: 1 }],
    hasSourceRoot: existsDirectory(path.join(root, 'src', 'main', 'java')),
    modules, databaseDriverCandidates: drivers,
    ...(platform ? { platform } : {}),
    requiresReview
  }
}

function detectProject(options = {}) {
  const suppliedRoot = path.resolve(options.projectRoot || process.cwd())
  if (!existsDirectory(suppliedRoot)) throw new Error('Project root must be an existing directory, not a symbolic link')
  const root = fs.realpathSync(suppliedRoot)
  const target = options.target ? path.resolve(root, options.target) : null
  if (target && !isInside(root, target)) throw new Error('Target must be inside the project root')
  const maxDepth = options.maxDepth === undefined ? 8 : options.maxDepth
  const maxDirectories = options.maxDirectories === undefined ? 6000 : options.maxDirectories
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 12) throw new Error('maxDepth must be from 1 to 12')
  if (!Number.isInteger(maxDirectories) || maxDirectories < 1) throw new Error('maxDirectories must be positive')
  const notes = []
  const units = []
  const sqlFiles = []
  const skippedLinks = []
  const queue = [{ directory: root, depth: 0 }]
  let visited = 0
  let depthLimited = false
  while (queue.length && visited < maxDirectories) {
    const { directory, depth } = queue.shift()
    visited++
    let children
    try { children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) } catch (error) {
      notes.push({ file: directory, reason: error.message })
      continue
    }
    const names = new Set(children.map(child => child.name))
    if (names.has('package.json') || names.has('pages.json') || (names.has('src') && existsFile(path.join(directory, 'src', 'pages.json')))) {
      const unit = frontendUnit(directory, notes)
      if (unit) units.push(unit)
    }
    if (names.has('pom.xml')) {
      const unit = javaUnit(directory, notes)
      if (unit) units.push(unit)
    }
    for (const child of children) {
      const full = path.join(directory, child.name)
      if (child.isSymbolicLink()) { skippedLinks.push(full); continue }
      if (child.isFile() && /\.(sql|ddl)$/i.test(child.name) && sqlFiles.length < 80) sqlFiles.push(full)
      if (child.isDirectory() && !SKIP.has(child.name)) {
        // Within a detected application, nested source trees do not hold a second package root.
        const frontendHere = units.some(unit => unit.root === directory && unit.kind === 'frontend')
        if (frontendHere && ['src', 'public', 'common-libs', 'components', 'static', 'mock', 'screensj'].includes(child.name)) continue
        if (frontendHere && /^screen(?:-|\d|$)/i.test(child.name)) continue
        if (depth < maxDepth) queue.push({ directory: full, depth: depth + 1 })
        else depthLimited = true
      }
    }
  }
  const selectedUnits = target ? units.filter(unit => isInside(unit.root, target)).sort((a, b) => b.root.length - a.root.length) : units
  const truncated = queue.length > 0 || depthLimited
  if (truncated) notes.push({ file: root, reason: 'Discovery budget/depth was reached; empty results do not establish absence. Re-run on a narrower root.' })
  if (sqlFiles.length === 80) notes.push({ file: root, reason: 'Only the first 80 SQL/DDL candidates are listed, not the entire schema.' })
  return {
    schemaVersion: 1,
    projectRoot: root,
    target: target && path.relative(root, target).split(path.sep).join('/') || null,
    detectedAt: new Date().toISOString(),
    readOnly: true,
    coverage: { maxDepth, maxDirectories, visitedDirectories: visited, truncated, skippedLinks },
    units, selectedUnits: selectedUnits.map(unit => ({ root: unit.root, kind: unit.kind, profiles: unit.profiles })), sqlCandidates: sqlFiles,
    notes,
    next: units.length ? 'Choose the target unit/entry and verify its actual contracts before implementation.' : 'No recognized unit found within the stated coverage. Use a narrower application root or inspect project-specific tooling.'
  }
}

module.exports = { detectProject, isInside }
