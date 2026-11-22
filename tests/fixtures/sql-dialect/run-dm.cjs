// Independent DM8 runtime validation runner (R&D, isolated synthesis only).
// NOT wired into the main suite; run.cjs / sql-dialect.test.cjs stay untouched.
//
// Usage:
//   node run-dm.cjs --root <absolute project root> --dm-bin <absolute directory> --output-id <new slug>
//
// Hard boundaries encoded below:
//   - Only ever talks to 127.0.0.1:18736, and only after proving that port empty.
//   - Fresh synthetic datadir under the unique output directory; AUTO_OVERWRITE=0.
//     dminit rejects dot-leading MID-path components (observed quirk), so dminit runs
//     with cwd=<output dir> and the relative PATH=data; the datadir still lands
//     inside the approved output directory and control paths resolve relative to it.
//   - dm.ini explicitly edited before first start: LISTEN_IP=127.0.0.1, PORT_NUM=18736,
//     IPV6_LSNR=0 (DM8 system administrator manual p87/p115 semantics).
//   - Random synthetic credentials only; never defaults, never existing accounts.
//     dminit requires init passwords on argv (tool limitation, recorded; logs store
//     argv with the secret replaced by [EPHEMERAL]); disql gets the password via
//     stdin CONNECT composed in memory (never argv, never on disk). Input and
//     environment are never captured anywhere.
//   - The server writes its runtime log into the shared install log dir by default;
//     the runner copies it into the output directory as retained evidence and
//     removes only its own instance's log file afterwards to leave the install
//     tree unchanged.
//   - Stops ONLY its own child process; never sends shutdown to anything else.
//   - OS socket tables are known unreliable on this host and the DM8 server log
//     emits no listen lines at INFO level (both observed): binding proof is the
//     functional chain - exact dm.ini + runtime V$DM_INI readback + own ChildProcess
//     pid (also stamped in the server log as P<pid>) + TCP connect on 127.0.0.1:18736
//     + refusal on this machine's non-loopback IPs + identity (V$DATABASE.NAME and
//     datafile paths under the fresh datadir). osIndependent stays false.
//   - No service registration, no business DDL, no network downloads, no license bypass.

const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')
const F = require('../../../skills/create-fb-feature/scripts/lib/files.cjs')

const HERE = __dirname
const DEFAULT_ROOT = path.resolve(HERE, '../../..')
const HOST = '127.0.0.1'
const PORT = 18736
const DB_NAME = 'FBXVAL'
const INSTANCE_NAME = 'FBXVAL_18736'
const REQUIRED_CHECKS = [
  'port-precheck', 'dminit-version', 'dminit-initialize', 'dm-ini-explicit-config',
  'dmserver-start', 'credential-bootstrap', 'runtime-instance-identity', 'loopback-binding',
  'default-credential-rejected', 'ddl-synthetic-schema',
  'pk-auto-increment-first', 'pk-auto-increment-next', 'pk-duplicate-rejected',
  'unique-duplicate-rejected', 'not-null-rejected', 'nullable-null-roundtrip',
  'datetime-date-roundtrip', 'unique-allows-multiple-nulls', 'unique-duplicate-alt-rejected',
  'rollback-discards-insert', 'commit-persists-insert', 'pagination-windows',
  'pagination-beyond-end-empty', 'update-affected-rows', 'decimal-roundtrip',
  'composite-unique-rejected', 'shutdown-own-instance', 'port-released'
]

const GB = (() => { try { return new TextDecoder('gb18030') } catch (error) { return new TextDecoder('latin1') } })()
const decode = buffer => GB.decode(Buffer.from(buffer || Buffer.alloc(0)))
const ERROR_MARKER = /\[-\d+\]:/
const NOISE = /^[-=_—]+$|已用时间|执行号|elapsed time|used time|SQL>|影响了?\s*\d+\s*条|\d+\s+rows?\s+affected|DMSQL executed successfully|执行成功|COMMIT complete/i
// disql prints a row-number column then the row values; keep the values as tokens.
// NOTE: receives the already-decoded stdout string; do not decode again.
const rowsOf = text => String(text).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l && !NOISE.test(l))
  .map(l => { const m = l.match(/^(\d+)\s{2,}(.+)$/); return (m ? m[2] : l).split(/\s+/) })
const errorLines = text => String(text).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => ERROR_MARKER.test(l))
const scalarRows = rows => rows.filter(r => r.length === 1)

function portBusy () {
  return new Promise(resolve => {
    const socket = net.connect({ host: HOST, port: PORT })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(1500)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}
async function waitPort (expected, milliseconds) {
  const start = Date.now()
  while (Date.now() - start < milliseconds) {
    if (await portBusy() === expected) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}
// Hold the connection open briefly and classify the outcome. A real listener keeps
// the socket open (stillOpenAfterHold); a transparent TUN/fake-ip proxy accepts the
// handshake instantly and closes once its upstream dial fails (connected + closedEarly),
// while nothing listening shows refused/timeout. Baseline probes against a port the
// server never opens on the SAME IP separate interception artifacts from real reachability.
function probeDetailed (ip, port, holdMs = 3500) {
  return new Promise(resolve => {
    const socket = net.connect({ host: ip, port })
    const result = { ip, port, phase: '', closedEarly: false, stillOpenAfterHold: false }
    let done = false
    const finish = () => { if (!done) { done = true; socket.destroy(); resolve(result) } }
    socket.setTimeout(holdMs + 2000)
    socket.once('connect', () => {
      result.phase = 'connected'
      setTimeout(() => { if (!done) { result.stillOpenAfterHold = true; finish() } }, holdMs)
    })
    socket.once('end', () => { result.closedEarly = result.phase === 'connected' && !result.stillOpenAfterHold; result.phase = result.phase || 'closed-before-connect'; finish() })
    socket.once('error', error => { result.phase = result.phase === 'connected' ? 'connected-then-error:' + error.code : (error.code === 'ECONNREFUSED' ? 'refused' : 'error:' + error.code); finish() })
    socket.once('timeout', () => { result.phase = result.phase || 'timeout'; finish() })
  })
}

// Byte-safe dm.ini surgery (ASCII keys/values; latin1 round-trips any bytes).
function readIniText (file) { return fs.readFileSync(file).toString('latin1') }
function parseIniKeys (text, keys) {
  const found = {}
  for (const key of keys) {
    const matches = [...text.matchAll(new RegExp('^[ \\t]*' + key + '[ \\t]*=[ \\t]*(\\S+)[ \\t]*$', 'gmi'))]
    if (matches.length === 1) found[key] = matches[0][1]
    else found[key] = matches.length === 0 ? 'ABSENT' : 'MULTIPLE(' + matches.length + ')'
  }
  return found
}
function setIniKey (text, key, value) {
  const pattern = new RegExp('^[ \\t]*' + key + '[ \\t]*=[^\\r\\n]*$', 'm')
  if (pattern.test(text)) return text.replace(pattern, key + '=' + value)
  const tail = text.endsWith('\n') ? '' : '\r\n'
  return text + tail + key + '=' + value + '\r\n'
}

function makeSecret () {
  return 'Xx9' + crypto.randomBytes(15).toString('hex') // letters+digits only, 33 chars
}

// Public seam (mirrors run.cjs completeResult): a DM run passes only when nothing
// aborted, every recorded step succeeded, and every required check is present and ok.
function completeResult (result) {
  const body = result || {}
  return body.aborted !== true && Array.isArray(body.steps) && body.steps.every(step => step.ok === true) &&
    REQUIRED_CHECKS.every(name => body.steps.some(step => step.name === name && step.ok === true))
}

// Public seam (mirrors run.cjs startupBinding): pure classification of the functional
// loopback-only binding probes. Exact dm.ini and exact V$DM_INI readback are necessary
// but never sufficient - verified is true only when the loopback connection survives the
// hold AND every probed non-loopback address proves NOT really listening. A
// connected-then-closed probe counts as a transparent-proxy interception artifact only
// when the same IP's never-opened port shows the identical signature.
function loopbackBindingVerdict ({ configExact, readbackExact, loopbackProbe, externalResults, baselineResult, dbName, allPathsInside }) {
  const interceptedSignature = r => r.phase === 'connected' && r.closedEarly && !r.stillOpenAfterHold
  const notListeningSignature = r => !r.phase.startsWith('connected')
  const realExternalListening = externalResults.some(r => r.stillOpenAfterHold)
  const externalAllSafe = externalResults.every(r => notListeningSignature(r) || (interceptedSignature(r) && baselineResult && interceptedSignature(baselineResult)))
  const loopbackRealListening = loopbackProbe.stillOpenAfterHold
  return {
    verified: configExact && readbackExact && loopbackRealListening && !realExternalListening &&
      externalAllSafe && dbName === DB_NAME && allPathsInside,
    realExternalListening, loopbackRealListening, externalAllSafe
  }
}

async function run (options) {
  const o = options || {}
  F.assertSlug(o.outputId)
  if (!o.dmBin || !path.isAbsolute(o.dmBin)) throw new Error('FB_DM_BIN must be an explicit absolute directory')
  const rootReal = F.resolveRoot(o.root || DEFAULT_ROOT)
  if (path.resolve(rootReal).toLowerCase() !== path.resolve(F.resolveRoot(DEFAULT_ROOT)).toLowerCase()) {
    throw new Error('--root must point at this runner\'s own project root')
  }
  const tools = Object.fromEntries(['dminit', 'dmserver', 'disql'].map(name => [name, path.join(o.dmBin, name + '.exe')]))
  for (const tool of Object.values(tools)) {
    F.assertNoLinks(tool)
    if (!fs.statSync(tool).isFile()) throw new Error('Missing DM tool: ' + tool)
  }
  const output = F.assertRelativeFileInRoot(rootReal, '.validation-output/release-validation/sql/' + o.outputId + '/report.json').abs
  const directory = path.dirname(output)
  F.assertNoLinks(directory)
  F.ensureDir(path.dirname(directory))
  fs.mkdirSync(directory) // refuses an existing output dir: never overwrites an earlier run
  const datadir = path.join(directory, 'data', DB_NAME)
  const iniPath = path.join(datadir, 'dm.ini')
  const schemaPath = path.join(HERE, 'schema-dm.sql')
  const serverLogName = 'dm_' + INSTANCE_NAME + '_' + F.nowIso().atLocal.slice(0, 7).replace('-', '') + '.log'
  const serverLogInstallPath = path.join(path.dirname(o.dmBin), 'log', serverLogName)
  const startedAt = F.nowIso().atLocal
  const steps = []
  const sysdbaSecret = makeSecret()
  const sysauditorSecret = makeSecret()
  const scrub = value => String(value || '').split(sysdbaSecret).join('[EPHEMERAL]').split(sysauditorSecret).join('[EPHEMERAL]')
  let server = null
  let serverExit = null
  let serverConsole = null
  let aborted = false
  let autocommitOk = false
  let bindingEvidence = null
  let toolVersion = ''
  let licenseExpiry = ''
  let installLogCopied = false
  let installLogRemoved = false
  const record = (name, ok, detail, extra) => steps.push(Object.assign({ name, ok: !!ok, detail: scrub(detail), at: F.nowIso().atLocal }, extra || {}))
  let commandSeq = 0
  function execute (name, executable, args, input, timeout = 30000, cwd) {
    commandSeq += 1
    const result = spawnSync(executable, args, { input, shell: false, windowsHide: true, timeout, cwd,
      maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PATH: o.dmBin + path.delimiter + process.env.PATH } })
    const raw = { name, executable, args: args.map(scrub), cwd: cwd || null, exitCode: result.status,
      stdout: scrub(decode(result.stdout)), stderr: scrub(decode(result.stderr)),
      error: result.error ? scrub(result.error.message) : null }
    // Command logs keep argv with secret values replaced by [EPHEMERAL]; stdin input
    // and environment are never captured anywhere.
    F.writeTextExclusive(path.join(directory, String(commandSeq).padStart(2, '0') + '-' + name + '.log'), JSON.stringify(raw, null, 2) + '\n')
    return { code: result.status, stdout: raw.stdout, stderr: raw.stderr, error: raw.error, raw }
  }
  // One disql session: stdin CONNECT (password only in memory) + SETs + SQL statements.
  function disql (name, statements, opts = {}) {
    if (!server || server.exitCode !== null || serverExit) throw new Error('Own synthetic server has exited; no database request will be sent')
    // opts.factoryDefault connects with the PUBLIC factory literal SYSDBA/SYSDBA and is
    // used ONLY by the default-credential-rejected negative test against this run's own
    // fresh synthetic instance; every other session uses this run's random secret.
    const connectSecret = opts.factoryDefault === true ? 'SYSDBA' : sysdbaSecret
    const input = [
      'CONNECT SYSDBA/"' + connectSecret + '"@' + HOST + ':' + PORT,
      'SET HEADING OFF', 'SET PAGESIZE 0', opts.feedback ? 'SET FEEDBACK ON' : 'SET FEEDBACK OFF', 'SET LINESIZE 8000'
    ].concat(opts.autocommit ? ['SET AUTOCOMMIT ON'] : [])
      .concat(statements)
      .concat(opts.commit && !autocommitOk ? ['COMMIT;'] : [])
      .concat(['EXIT']).join('\n')
    const result = execute(name, tools.disql, ['-S', '/NOLOG'], input, opts.timeout || 30000)
    return Object.assign(result, { sql: statements.join('\n'), rows: rowsOf(result.stdout), errors: errorLines(result.stdout).concat(errorLines(result.stderr)) })
  }
  try {
    if (await portBusy()) {
      record('port-precheck', false, HOST + ':' + PORT + ' occupied; refusing to init, start, contact or stop anything on it')
      throw new Error('Approved port 127.0.0.1:18736 is occupied; no existing instance will be contacted or stopped')
    }
    record('port-precheck', true, HOST + ':' + PORT + ' empty (TCP connect refused)')

    const ver = execute('dminit-version', tools.dminit, ['help'], undefined, 20000)
    const verText = ver.stdout + '\n' + ver.stderr
    toolVersion = (verText.match(/version:\s*(\S+.*Pack\d+)/) || [])[1] || ''
    licenseExpiry = (verText.match(/License will expire on ([\d-]+)/) || [])[1] || ''
    record('dminit-version', ver.code === 0 && /initdb V8/.test(verText) && toolVersion === '03134284094-20231109-208042-20067 Pack10' && licenseExpiry === '2026-12-06',
      'exact local DM8 toolchain: version=' + toolVersion + ', licenseExpiry=' + licenseExpiry)
    if (!steps[steps.length - 1].ok) throw new Error('Exact locally installed DM8 toolchain/license not confirmed')

    // dminit rejects dot-leading mid-path components, so PATH=data (relative) with
    // cwd=<output dir>: the datadir still lands inside the approved output dir.
    const init = execute('dminit-initialize', tools.dminit, [
      'PATH=data', 'DB_NAME=' + DB_NAME, 'INSTANCE_NAME=' + INSTANCE_NAME,
      'PORT_NUM=' + PORT, 'SYSDBA_PWD=' + sysdbaSecret, 'SYSAUDITOR_PWD=' + sysauditorSecret,
      'PAGE_SIZE=8', 'EXTENT_SIZE=16', 'CHARSET=1', 'CASE_SENSITIVE=Y', 'AUTO_OVERWRITE=0'
    ], undefined, 300000, directory)
    record('dminit-initialize', init.code === 0 && fs.existsSync(iniPath) && fs.existsSync(path.join(datadir, 'SYSTEM.DBF')),
      'exit=' + init.code + '; fresh datadir=' + datadir + ' (created via relative PATH=data anchored to the output dir because dminit rejects dot-leading mid-path components); AUTO_OVERWRITE=0; init passwords only on dminit argv (tool limitation, no env/ini-file alternative), never stored, logs scrubbed')
    if (!steps[steps.length - 1].ok) throw new Error('Fresh synthetic datadir initialization failed')

    // Explicit loopback-only config before first start (manual p87/p115 semantics).
    let iniText = readIniText(iniPath)
    iniText = setIniKey(setIniKey(setIniKey(iniText, 'PORT_NUM', String(PORT)), 'LISTEN_IP', HOST), 'IPV6_LSNR', '0')
    fs.writeFileSync(iniPath, Buffer.from(iniText, 'latin1'))
    const iniKeys = parseIniKeys(readIniText(iniPath), ['PORT_NUM', 'LISTEN_IP', 'IPV6_LSNR'])
    const configExact = iniKeys.PORT_NUM === String(PORT) && iniKeys.LISTEN_IP === HOST && iniKeys.IPV6_LSNR === '0'
    record('dm-ini-explicit-config', configExact, 'dm.ini before first start: ' + JSON.stringify(iniKeys))
    if (!configExact) throw new Error('dm.ini does not carry exact LISTEN_IP/PORT_NUM/IPV6_LSNR; refusing to start')

    serverConsole = fs.createWriteStream(path.join(directory, 'server-console.log'), { flags: 'w' })
    server = spawn(tools.dmserver, ['path=' + iniPath], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: directory,
      env: { ...process.env, PATH: o.dmBin + path.delimiter + process.env.PATH } })
    let startError = null
    server.stdout.on('data', chunk => serverConsole.write(chunk))
    server.stderr.on('data', chunk => serverConsole.write(chunk))
    server.once('error', error => { startError = error.message })
    server.once('exit', (code, signal) => { serverExit = { code, signal } })
    const reachable = await waitPort(true, 120000)
    await new Promise(resolve => setTimeout(resolve, 1500))
    let consoleReady = false
    try { consoleReady = /SYSTEM IS READY/.test(fs.readFileSync(path.join(directory, 'server-console.log')).toString('latin1')) } catch (e) { consoleReady = false }
    record('dmserver-start', reachable && !!server.pid && !startError && !serverExit && consoleReady,
      'own pid=' + server.pid + '; datadir=' + datadir + '; ini=' + iniPath + '; console says SYSTEM IS READY=' + consoleReady + '; ' + (startError || (reachable ? 'TCP 127.0.0.1:18736 accepts; identity verified next' : 'port never opened')))
    if (!steps[steps.length - 1].ok) throw new Error('Own synthetic dmserver did not start')

    // Best-effort OS rows: known blind on this host, never a pass criterion.
    const addresses = execute('listen-addresses', 'C:/Windows/System32/netstat.exe', ['-a', '-n', '-o', '-p', 'tcp'], undefined, 15000)
    const ownRows = addresses.stdout.split('\n').map(l => l.trim().split(/\s+/))
      .filter(c => c[0] === 'TCP' && c[1] && c[1].endsWith(':' + PORT) && c[c.length - 1] === String(server.pid))
      .map(c => c[1])

    const login = disql('credential-bootstrap', ['SELECT 1 FROM DUAL;'])
    record('credential-bootstrap', login.code === 0 && !ERROR_MARKER.test(login.stdout) && login.rows.length === 1 && login.rows[0].length === 1 && login.rows[0][0] === '1',
      'random SYSDBA credential (created by dminit) accepted over stdin CONNECT; SELECT 1 -> ' + JSON.stringify(login.rows))
    if (!steps[steps.length - 1].ok) throw new Error('Random synthetic credential could not log in to own instance')
    const acProbe = disql('autocommit-probe', ['SET AUTOCOMMIT ON'])
    autocommitOk = !ERROR_MARKER.test(acProbe.stdout) && !ERROR_MARKER.test(acProbe.stderr)
    record('autocommit-probe', true, 'SET AUTOCOMMIT ON supported=' + autocommitOk + (autocommitOk ? '; sessions run autocommit' : '; insert sessions carry explicit COMMIT'))

    const identity = disql('runtime-instance-identity', [
      'SELECT NAME FROM V$DATABASE;',
      'SELECT PATH FROM V$DATAFILE;',
      "SELECT PARA_NAME, PARA_VALUE FROM V$DM_INI WHERE PARA_NAME IN ('PORT_NUM','LISTEN_IP','IPV6_LSNR');",
      'SELECT BANNER FROM V$VERSION;',
      'SELECT ID_CODE() FROM DUAL;'
    ])
    const absolutePrefix = datadir.replace(/\\/g, '/').toLowerCase() + '/'
    const relativePrefix = ('data/' + DB_NAME).toLowerCase() + '/'
    const dbName = identity.rows.length > 0 && identity.rows[0].length === 1 ? identity.rows[0][0] : ''
    const iniMap = {}
    const datafilePaths = []
    const bannerLines = []
    for (const row of identity.rows.slice(1)) {
      if (row.length === 2 && /^(PORT_NUM|LISTEN_IP|IPV6_LSNR)$/i.test(row[0])) iniMap[row[0].toUpperCase()] = row[1]
      else if (row.length === 1 && /\.dbf$/i.test(row[0])) datafilePaths.push(row[0])
      else bannerLines.push(row.join(' '))
    }
    const allPathsInside = datafilePaths.length > 0 && datafilePaths.every(p => {
      const normalized = p.replace(/\\/g, '/').toLowerCase()
      return normalized.startsWith(absolutePrefix) || normalized.startsWith(relativePrefix)
    })
    const readbackExact = iniMap.PORT_NUM === String(PORT) && iniMap.IPV6_LSNR === '0' &&
      (iniMap.LISTEN_IP === HOST || iniMap.LISTEN_IP === undefined)
    record('runtime-instance-identity', identity.code === 0 && !ERROR_MARKER.test(identity.stdout) && dbName === DB_NAME && allPathsInside && readbackExact,
      'V$DATABASE.NAME=' + dbName + '; datafiles under fresh datadir=' + allPathsInside + ' (' + datafilePaths.length + ' files, ctl stores cwd-relative paths resolved under the output dir); V$DM_INI readback=' + JSON.stringify(iniMap) + ' (config params alone are NOT treated as OS bind proof); banner=' + bannerLines.join(' | '))
    if (!steps[steps.length - 1].ok) throw new Error('Connected runtime is not the approved fresh synthetic instance')

    // Functional loopback-only proof: loopback connect must survive the hold (real
    // listener); every non-loopback IP must NOT survive it. A connected-then-closed
    // signature is only acceptable when a same-IP closed-port baseline shows the
    // identical signature (transparent proxy interception artifact, like the OS-table
    // anomaly); otherwise it counts as real external reachability and fails closed.
    const externalTargets = Object.values(os.networkInterfaces()).flat()
      .filter(item => item && !item.internal && String(item.family).replace(/^IPv?/, '') === '4')
      .map(item => item.address)
    const loopbackProbe = await probeDetailed(HOST, PORT)
    const externalResults = []
    for (const ip of [...new Set(externalTargets)]) externalResults.push(await probeDetailed(ip, PORT))
    const baselineIp = externalResults.length > 0 ? externalResults[0].ip : null
    const baselineResult = baselineIp ? Object.assign(await probeDetailed(baselineIp, 59999), { baseline: 'port 59999 is never opened by this server' }) : null
    const bindingVerdict = loopbackBindingVerdict({ configExact, readbackExact, loopbackProbe, externalResults, baselineResult, dbName, allPathsInside })
    const realExternalListening = bindingVerdict.realExternalListening
    const externalAllSafe = bindingVerdict.externalAllSafe
    const loopbackRealListening = bindingVerdict.loopbackRealListening
    // Server runtime log: parse, then copy into the output dir as retained evidence.
    let serverLogLines = []
    try {
      const serverLogText = decode(fs.readFileSync(serverLogInstallPath))
      const ownPidTag = 'P' + String(server.pid).padStart(10, '0')
      const seen = new Set()
      for (const line of serverLogText.replace(/\r/g, '').split('\n')) {
        if (line.includes(ownPidTag) && /version|License|READY|startup|listen|18736|127\.0\.0\.1|监听/i.test(line) && !seen.has(line.trim())) {
          seen.add(line.trim()); serverLogLines.push(line.trim().slice(0, 300))
        }
        if (serverLogLines.length >= 25) break
      }
      F.writeTextExclusive(path.join(directory, 'server-log-copy.log'), serverLogText)
      installLogCopied = true
    } catch (error) { serverLogLines = ['server log scan failed: ' + error.message] }
    bindingEvidence = {
      verified: bindingVerdict.verified,
      configExact, runtimeReadback: iniMap, ownPid: server.pid, ownPidStampedInServerLog: serverLogLines.length > 0,
      datadir, datadirPathForm: 'absolute; dminit/dmserver resolve ctl paths relative to the output dir (cwd)', port: PORT,
      loopbackProbe, externalProbe: externalResults, closedPortBaseline: baselineResult,
      realExternalListening, loopbackRealListening, externalAllSafe,
      serverLog: { installPath: serverLogInstallPath, copiedIntoOutput: installLogCopied, lines: serverLogLines,
        note: 'DM8 server log carries pid (P<pid>), version, license and SYSTEM IS READY but no explicit listen line at INFO level (observed on this build), so binding is confirmed functionally, not from log text' },
      osRows: ownRows,
      osIndependent: false,
      note: 'OS socket tables are known unreliable on this host (documented anomaly) and are retained as supplementary rows only, never a pass criterion. Binding is proven by: exact dm.ini before first start + runtime V$DM_INI readback + own ChildProcess pid stamped in the server log + a held TCP connection on 127.0.0.1:18736 that survives 3.5s + no surviving connection on any non-loopback IP (connected-then-closed is accepted only when a same-IP closed-port baseline shows the identical interception signature) + identity (V$DATABASE.NAME and datafile paths under the fresh datadir).'
    }
    record('loopback-binding', bindingEvidence.verified, JSON.stringify(bindingEvidence))
    if (!steps[steps.length - 1].ok) throw new Error('Loopback-only binding could not be confirmed; fail closed')

    const def = disql('default-credential-rejected', ['SELECT 1 FROM DUAL;'], { factoryDefault: true })
    const defRejected = def.errors.length > 0 && !def.rows.some(r => r.length === 1 && r[0] === '1')
    record('default-credential-rejected', defRejected,
      'factory default SYSDBA/SYSDBA attempted ONLY as negative test against this run\'s own fresh synthetic instance; rejected=' + defRejected + '; errors=' + (def.errors.join(' | ') || '(none)'))
    if (!steps[steps.length - 1].ok) throw new Error('Factory default credential still works; credential randomization failed')

    const schemaText = fs.readFileSync(schemaPath).toString('utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
    const ddl = disql('ddl-synthetic-schema', [schemaText, "SELECT COUNT(*) FROM USER_TABLES WHERE TABLE_NAME LIKE 'FBX_VALIDATION_%';"], { commit: false, timeout: 60000 })
    const tableCountRows = ddl.rows.filter(r => r.length === 1 && /^\d+$/.test(r[0]))
    record('ddl-synthetic-schema', ddl.code === 0 && !ERROR_MARKER.test(ddl.stdout) && tableCountRows.length === 1 && tableCountRows[0][0] === '2',
      'schema-dm.sql executed verbatim (comment lines stripped for disql); fbx_validation_* tables=' + (tableCountRows.length ? tableCountRows[0][0] : '(none)') + '; errors=' + ddl.errors.join(' | '))
    if (!steps[steps.length - 1].ok) throw new Error('Synthetic DDL failed')

    const ac = { autocommit: autocommitOk }
    const pk = disql('pk-auto-increment', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-A','synthetic a','2026-11-20 08:00:00');",
      "SELECT id FROM fbx_validation_device WHERE device_code='DEV-A';",
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-B','synthetic b','2026-11-20 09:00:00');",
      "SELECT id FROM fbx_validation_device WHERE device_code='DEV-B';"
    ], Object.assign({ commit: true }, ac))
    record('pk-auto-increment-first', pk.errors.length === 0 && pk.rows.length === 2 && pk.rows[0].length === 1 && pk.rows[0][0] === '1',
      'IDENTITY first generated id=' + JSON.stringify(pk.rows[0]) + '; exit=' + pk.code + '; stderrExpected=true(observed=' + JSON.stringify(pk.stderr) + ')')
    record('pk-auto-increment-next', pk.errors.length === 0 && pk.rows.length === 2 && pk.rows[1].length === 1 && pk.rows[1][0] === '2',
      'IDENTITY next generated id=' + JSON.stringify(pk.rows[1]))

    const dupPk = disql('pk-duplicate-rejected', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-C0','pk seed','2026-11-20 10:00:00');",
      "SELECT id FROM fbx_validation_device WHERE device_code='DEV-C0';",
      "INSERT INTO fbx_validation_device(id,device_code,device_name,created_at) SELECT id,'DEV-DUP','duplicate','2026-11-20 10:30:00' FROM fbx_validation_device WHERE device_code='DEV-C0';",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-DUP';"
    ], Object.assign({}, ac))
    record('pk-duplicate-rejected', dupPk.errors.length === 1 && dupPk.rows.length === 2 && dupPk.rows[1].length === 1 && dupPk.rows[1][0] === '0',
      'existing-id re-insert rejected (' + dupPk.errors.join(' | ') + '); dup row absent=' + JSON.stringify(dupPk.rows[1]))

    const dupCode = disql('unique-duplicate-rejected', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-UC','first','2026-11-20 11:00:00');",
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-UC','dupcode','2026-11-20 11:30:00');",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-UC';",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_name='dupcode';"
    ], Object.assign({}, ac))
    record('unique-duplicate-rejected', dupCode.errors.length === 1 && dupCode.rows.length === 2 && dupCode.rows[0][0] === '1' && dupCode.rows[1][0] === '0',
      'uq_fbx_device_code duplicate rejected (' + dupCode.errors.join(' | ') + '); persisted=' + JSON.stringify(dupCode.rows[0]) + ', dup rows=' + JSON.stringify(dupCode.rows[1]))

    const notNull = disql('not-null-rejected', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-NN',NULL,'2026-11-20 12:00:00');",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-NN';"
    ], Object.assign({}, ac))
    record('not-null-rejected', notNull.errors.length === 1 && notNull.rows.length === 1 && notNull.rows[0][0] === '0',
      'NOT NULL violation (' + notNull.errors.join(' | ') + '); row absent=' + JSON.stringify(notNull.rows[0]))

    const nullable = disql('nullable-null-roundtrip', [
      "INSERT INTO fbx_validation_device(device_code,device_name,score,created_at) VALUES('DEV-NULL','nullable',NULL,'2026-11-20 13:00:00');",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-NULL' AND score IS NULL;"
    ], Object.assign({ commit: true }, ac))
    record('nullable-null-roundtrip', nullable.errors.length === 0 && nullable.rows.length === 1 && nullable.rows[0][0] === '1',
      'NULL score stored and read back as NULL=' + JSON.stringify(nullable.rows[0]))

    const dates = disql('datetime-date-roundtrip', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at,updated_at,occurred_on) VALUES('DEV-DATE','dates','2026-11-22 09:30:45','2026-11-22 09:30:45.123','2026-11-22');",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-DATE' AND created_at=TIMESTAMP '2026-11-22 09:30:45' AND updated_at=TIMESTAMP '2026-11-22 09:30:45.123' AND occurred_on=DATE '2026-11-22';",
      "SELECT created_at, updated_at, occurred_on FROM fbx_validation_device WHERE device_code='DEV-DATE';"
    ], Object.assign({ commit: true }, ac))
    const dateCount = dates.rows.filter(r => r.length === 1 && r[0] === '1')
    record('datetime-date-roundtrip', dates.errors.length === 0 && dateCount.length >= 1,
      'DATETIME/TIMESTAMP(3)/DATE exact roundtrip count row=' + JSON.stringify(dateCount[0]) + '; displayed row=' + JSON.stringify(dates.rows[dates.rows.length - 1]))

    const nulls = disql('unique-allows-multiple-nulls', [
      'SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;',
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-U1','u1','2026-11-21 08:00:00'),('DEV-U2','u2','2026-11-21 09:00:00');",
      'SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;'
    ], Object.assign({ commit: true }, ac))
    const before = nulls.rows.length === 2 ? Number(nulls.rows[0][0]) : NaN
    record('unique-allows-multiple-nulls', nulls.errors.length === 0 && nulls.rows.length === 2 && Number(nulls.rows[1][0]) === before + 2,
      'uq_fbx_device_alt keeps multiple NULLs: before=' + JSON.stringify(nulls.rows[0]) + ', after=' + JSON.stringify(nulls.rows[1]))

    const alt = disql('unique-duplicate-alt-rejected', [
      "INSERT INTO fbx_validation_device(device_code,device_name,alt_code,created_at) VALUES('DEV-U3','u3','ALT-1','2026-11-21 10:00:00');",
      "INSERT INTO fbx_validation_device(device_code,device_name,alt_code,created_at) VALUES('DEV-U4','u4','ALT-1','2026-11-21 11:00:00');",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-U4';"
    ], Object.assign({}, ac))
    record('unique-duplicate-alt-rejected', alt.errors.length === 1 && alt.rows.length === 1 && alt.rows[0][0] === '0',
      'uq_fbx_device_alt duplicate rejected (' + alt.errors.join(' | ') + '); dup row absent=' + JSON.stringify(alt.rows[0]))

    const rollback = disql('rollback-discards-insert', [
      'SELECT COUNT(*) FROM fbx_validation_device;',
      'START TRANSACTION;',
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-RB','rollback','2026-11-21 12:00:00');",
      'SELECT COUNT(*) FROM fbx_validation_device;',
      'ROLLBACK;',
      'SELECT COUNT(*) FROM fbx_validation_device;'
    ], Object.assign({}, ac))
    const counts = rollback.rows.filter(r => r.length === 1 && /^\d+$/.test(r[0])).map(r => Number(r[0]))
    record('rollback-discards-insert', rollback.errors.length === 0 && counts.length === 3 && counts[0] === counts[2] && counts[1] === counts[0] + 1,
      'count before/inside/after: ' + JSON.stringify(rollback.rows.map(r => r.join(' '))))

    const commit = disql('commit-persists-insert', [
      'START TRANSACTION;',
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-CM','commit','2026-11-21 13:00:00');",
      'COMMIT;',
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-CM';"
    ], Object.assign({}, ac))
    record('commit-persists-insert', commit.errors.length === 0 && commit.rows.length === 1 && commit.rows[0][0] === '1',
      'explicit COMMIT persisted row; count=' + JSON.stringify(commit.rows[0]))

    const seedPages = disql('paging-seed', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-P0','p0','2026-11-20 15:00:00'),('DEV-P1','p1','2026-11-21 15:00:00'),('DEV-P2','p2','2026-11-22 15:00:00'),('DEV-P3','p3','2026-11-23 15:00:00');"
    ], Object.assign({ commit: true }, ac))
    const pageSql = 'SELECT device_code FROM fbx_validation_device ORDER BY created_at DESC,id DESC LIMIT 3 OFFSET '
    const page1 = disql('page1', [pageSql + '0;'])
    const page2 = disql('page2', [pageSql + '3;'])
    const page2Again = disql('page2-repeat', [pageSql + '3;'])
    const beyond = disql('page-beyond', [pageSql + '100;'])
    const firstRows = page1.rows.map(r => r[0])
    const secondRows = page2.rows.map(r => r[0])
    record('pagination-windows', seedPages.errors.length === 0 && page1.errors.length === 0 && page2.errors.length === 0 && page2Again.errors.length === 0 &&
      firstRows.length === 3 && secondRows.length === 3 && firstRows[0] === 'DEV-P3' && firstRows.includes('DEV-P2') &&
      !firstRows.some(r => secondRows.includes(r)) && page2.rows.map(r => r.join(' ')).join(',') === page2Again.rows.map(r => r.join(' ')).join(','),
      'first=' + firstRows.join(',') + '; second=' + secondRows.join(',') + '; stable=' + (page2.rows.map(r => r.join(' ')).join(',') === page2Again.rows.map(r => r.join(' ')).join(',')))
    record('pagination-beyond-end-empty', beyond.errors.length === 0 && beyond.rows.length === 0,
      'OFFSET 100 returned ' + beyond.rows.length + ' rows')

    const update = disql('update-affected-rows', [
      "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-UPD','upd','2026-11-21 14:00:00');",
      "UPDATE fbx_validation_device SET status='1' WHERE device_code='DEV-UPD';",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-UPD' AND status='1';",
      "UPDATE fbx_validation_device SET status='2' WHERE device_code='DEV-NOT-THERE';",
      "SELECT COUNT(*) FROM fbx_validation_device WHERE status='2';"
    ], Object.assign({ commit: true, feedback: true }, ac))
    const feedback = update.stdout.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => /影响了?\s*\d+\s*条|\d+\s+rows?\s+affected|影响行数/i.test(l))
    record('update-affected-rows', update.errors.length === 0 && update.rows.length === 2 && update.rows[0][0] === '1' && update.rows[1][0] === '0',
      'existing-row update changed 1 row, missing-row update changed 0 rows (counts=' + JSON.stringify(update.rows.map(r => r.join(' '))) + '); disql feedback: ' + (feedback.join(' | ') || '(no parseable feedback line; raw session log retained)'))

    const decimal = disql('decimal-roundtrip', [
      "INSERT INTO fbx_validation_event(device_id,amount,happened_at) VALUES(1,123456.78,'2026-11-22 10:00:00');",
      'SELECT COUNT(*) FROM fbx_validation_event WHERE amount=123456.78;',
      'SELECT amount FROM fbx_validation_event WHERE device_id=1;'
    ], Object.assign({ commit: true }, ac))
    record('decimal-roundtrip', decimal.errors.length === 0 && decimal.rows.length >= 2 && decimal.rows[0][0] === '1',
      'DECIMAL(12,2) exact roundtrip count=' + JSON.stringify(decimal.rows[0]) + '; displayed=' + JSON.stringify(decimal.rows[decimal.rows.length - 1]))

    const composite = disql('composite-unique-rejected', [
      "INSERT INTO fbx_validation_event(device_id,amount,happened_at) VALUES(1,1.00,'2026-11-22 10:00:00');",
      'SELECT COUNT(*) FROM fbx_validation_event;'
    ], Object.assign({}, ac))
    record('composite-unique-rejected', composite.errors.length === 1 && composite.rows.length === 1 && composite.rows[0][0] === '1',
      'uq_fbx_event (device_id,happened_at) duplicate rejected (' + composite.errors.join(' | ') + '); event rows=' + JSON.stringify(composite.rows[0]))
  } catch (error) {
    aborted = true
    record('run-aborted', false, error.message)
  } finally {
    if (server && server.pid) {
      if (serverConsole) { try { serverConsole.end() } catch (e) { /* keep going */ } }
      await new Promise(resolve => setTimeout(resolve, 800))
      let shutdownMethod = 'own ChildProcess.kill() only; no shutdown request was sent to any process'
      if (server.exitCode === null && !serverExit) {
        server.kill()
        shutdownMethod = 'own ChildProcess.kill() (SIGTERM/TerminateProcess); no shutdown request was sent to any process'
      }
      const exitDeadline = Date.now() + 10000
      while (server.exitCode === null && !serverExit && Date.now() < exitDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (server.exitCode === null && !serverExit) {
        server.kill()
        shutdownMethod += '; repeated own-pid kill fallback'
        const deadline2 = Date.now() + 8000
        while (server.exitCode === null && !serverExit && Date.now() < deadline2) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      const ownExited = server.exitCode !== null || !!serverExit
      const closed = await waitPort(false, 10000)
      record('shutdown-own-instance', ownExited, 'Only own pid=' + server.pid + '; ' + shutdownMethod + '; exit=' + JSON.stringify(serverExit) + '; all logs/datadir retained')
      record('port-released', ownExited && closed && !(await portBusy()), HOST + ':' + PORT + (closed ? ' released (connect refused)' : ' still busy'))
    } else {
      record('shutdown-own-instance', true, 'own child process already exited before finally; nothing to stop')
      record('port-released', !(await portBusy()), HOST + ':' + PORT)
    }
    // Footprint scrubbing: the only thing this run added to the shared install tree
    // is its own server log file; its content was copied into the output dir, so the
    // copy in the install tree is removed to leave the install tree unchanged.
    let removedNow = false
    try { if (fs.existsSync(serverLogInstallPath)) { fs.rmSync(serverLogInstallPath, { force: true }); removedNow = true } } catch (e) { removedNow = false }
    installLogRemoved = removedNow
  }
  const body = {
    nature: 'real-synthetic-dm8-isolated-runtime-not-business-or-other-instances',
    startedAt, finishedAt: F.nowIso().atLocal, toolVersion, licenseExpiry,
    host: HOST, port: PORT, outputId: o.outputId, aborted, steps,
    reportFile: output, dataRetained: true, credentialFilesWritten: false,
    secretsTransport: {
      dminit: 'init passwords only on dminit argv (tool offers no env/ini-file alternative for SYSDBA_PWD/SYSAUDITOR_PWD); transient process-listing exposure; never stored; command logs keep argv with secret values replaced by [EPHEMERAL]',
      disql: 'CONNECT composed in memory and fed via stdin; password never on argv or disk',
      stored: false, scrubbed: true
    },
    installLogFootprint: { path: serverLogInstallPath, copiedIntoOutputDir: installLogCopied, removedAfterStop: installLogRemoved, note: 'server runtime log copied into the output dir as retained evidence; the copy the run added to the shared install log dir is removed afterwards (removedAfterStop reports the actual removal outcome) so the install tree ends unchanged' },
    bindingEvidence,
    serverExit,
    dialectNotes: {
      autocommitSetSupported: autocommitOk,
      errorChannel: 'disql reports SQL errors on stdout as [-NNNNN]: text; exit code stays 0, so DB-level assertions use returned rows plus [-NNNNN] detection, never exit codes alone',
      outputDecoding: 'tool output is GB18030; captured as raw buffer and decoded with TextDecoder("gb18030"), then scrubbed; disql prints a row-number column that parsing strips',
      pathQuirk: 'dminit rejects dot-leading mid-path PATH components, so it runs with cwd=<output dir> and relative PATH=data'
    },
    compliance: {
      serviceRegistered: false, existingInstancesTouched: false, businessDdlExecuted: false,
      networkDownload: false, osSettingsChanged: false, licenseBypass: false,
      portPrecheckEmptyBeforeStart: true, onlyOwnChildStopped: true
    },
    sourceHash: F.sha256Hex(fs.readFileSync(__filename)),
    schemaHash: F.sha256Hex(fs.readFileSync(path.join(HERE, 'schema-dm.sql')))
  }
  body.status = completeResult(body) ? 'pass' : 'fail'
  body.hash = F.hashObject(body)
  F.writeJsonImmutable(output, body)
  return body
}

module.exports = { HERE, HOST, PORT, DB_NAME, REQUIRED_CHECKS, parseIniKeys, setIniKey, rowsOf, errorLines, completeResult, loopbackBindingVerdict, run }
if (require.main === module) {
  const args = process.argv.slice(2)
  const get = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
  if (args.length !== 6 || !get('--root') || !get('--dm-bin') || !get('--output-id')) {
    process.stderr.write('Usage: node run-dm.cjs --root <absolute project root> --dm-bin <absolute directory> --output-id <new slug>\n')
    process.exitCode = 2
  } else {
    run({ root: get('--root'), dmBin: get('--dm-bin'), outputId: get('--output-id') }).then(result => {
      process.stdout.write(JSON.stringify({ status: result.status, outputId: result.outputId, reportFile: result.reportFile, aborted: result.aborted, steps: result.steps.map(s => s.name + ':' + s.ok) }, null, 1) + '\n')
      process.exitCode = result.status === 'pass' ? 0 : 1
    }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 2 })
  }
}
