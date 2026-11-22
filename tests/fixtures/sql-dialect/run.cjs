const fs = require('fs')
const path = require('path')
const net = require('net')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')
const F = require('../../../skills/create-fb-feature/scripts/lib/files.cjs')

const HERE = __dirname
const ROOT = path.resolve(HERE, '../../..')
const HOST = '127.0.0.1'
const PORT = 18735
const DB = 'fbxvalidate'
const REQUIRED_CHECKS = [
  'port-precheck', 'mysqld-version', 'mysqld-initialize', 'mysqld-start', 'loopback-binding',
  'credential-bootstrap', 'runtime-instance-identity', 'ddl-under-app-user', 'pk-auto-increment-first', 'pk-auto-increment-next',
  'pk-duplicate-rejected', 'unique-duplicate-rejected', 'not-null-rejected', 'nullable-null-roundtrip',
  'datetime-date-roundtrip', 'unique-allows-multiple-nulls', 'unique-duplicate-alt-rejected',
  'rollback-discards-insert', 'commit-persists-insert', 'pagination-windows', 'pagination-beyond-end-empty',
  'update-affected-rows', 'decimal-roundtrip', 'composite-unique-rejected', 'shutdown-own-instance', 'port-released'
]

function startupBinding(value, pid) {
  const log = String(value || '')
  const sockets = [...log.matchAll(/Server socket created on IP: '([^']+)'/g)].map(match => match[1])
  return {
    verified: Number.isSafeInteger(pid) && pid > 0 &&
      log.includes('starting as process ' + pid + ' ...') &&
      log.includes("Server hostname (bind-address): '" + HOST + "'; port: " + PORT) &&
      sockets.length > 0 && sockets.every(address => address === HOST) &&
      log.includes('ready for connections.'),
    osIndependent: false,
    sockets
  }
}

function batchText(value) { return String(value || '').replace(/\r\n/g, '\n').trim() }
function completeResult(result) {
  return !!(result && result.aborted !== true && Array.isArray(result.steps) &&
    result.steps.every(step => step.ok === true) &&
    REQUIRED_CHECKS.every(name => result.steps.some(step => step.name === name && step.ok === true)))
}
function portBusy() {
  return new Promise(resolve => {
    const socket = net.connect({ host: HOST, port: PORT })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.setTimeout(1000)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}
async function waitPort(expected, milliseconds) {
  const start = Date.now()
  while (Date.now() - start < milliseconds) {
    if (await portBusy() === expected) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

async function run(options) {
  const o = options || {}
  F.assertSlug(o.outputId)
  if (!o.mysqlBin || !path.isAbsolute(o.mysqlBin)) throw new Error('FB_MYSQL_BIN must be an explicit absolute directory')
  const tools = Object.fromEntries(['mysqld', 'mysql', 'mysqladmin'].map(name => [name, path.join(o.mysqlBin, name + (process.platform === 'win32' ? '.exe' : ''))]))
  for (const tool of Object.values(tools)) {
    F.assertNoLinks(tool)
    if (!fs.statSync(tool).isFile()) throw new Error('Missing MySQL tool: ' + tool)
  }
  const output = F.assertRelativeFileInRoot(F.resolveRoot(ROOT), '.validation-output/release-validation/sql/' + o.outputId + '/report.json').abs
  const directory = path.dirname(output)
  F.assertNoLinks(directory)
  F.ensureDir(path.dirname(directory))
  fs.mkdirSync(directory)
  const loginFile = path.join(directory, 'absent-login.cnf')
  const startedAt = F.nowIso().atLocal
  const steps = []
  const commands = []
  const rootSecret = crypto.randomBytes(18).toString('hex')
  const appSecret = crypto.randomBytes(18).toString('hex')
  const scrub = value => String(value || '').split(rootSecret).join('[EPHEMERAL]').split(appSecret).join('[EPHEMERAL]')
  let server = null
  let serverExit = null
  let bindingEvidence = null
  let randomized = false
  let aborted = false
  let version = ''
  const record = (name, ok, detail) => steps.push({ name, ok: !!ok, detail: scrub(detail), at: F.nowIso().atLocal })
  function execute(name, executable, args, input, secret, timeout = 30000) {
    F.assertNoLinks(loginFile)
    if (fs.existsSync(loginFile)) throw new Error('Isolated login-file path must remain absent')
    const result = spawnSync(executable, args, { input, encoding: 'utf8', shell: false, windowsHide: true,
      timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: secret || '', MYSQL_TEST_LOGIN_FILE: loginFile } })
    const raw = { name, executable, args, exitCode: result.status,
      stdout: scrub(result.stdout), stderr: scrub(result.stderr), error: result.error ? scrub(result.error.message) : null }
    commands.push(raw)
    F.writeTextExclusive(path.join(directory, String(commands.length).padStart(2, '0') + '-' + name + '.log'), JSON.stringify(raw, null, 2) + '\n')
    return { code: result.status, stdout: batchText(raw.stdout), stderr: batchText(raw.stderr), error: raw.error }
  }
  const query = (name, sql) => {
    if (!server || server.exitCode !== null || serverExit) throw new Error('Own synthetic server has exited; no database request will be sent')
    return execute(name, tools.mysql,
      ['--no-defaults', '--protocol=TCP', '--host=' + HOST, '--port=' + PORT, '--user=fbx_validate', '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4', '--database=' + DB], sql, appSecret)
  }
  try {
    if (await portBusy()) throw new Error('Approved port is occupied; no existing instance will be contacted or stopped')
    record('port-precheck', true, HOST + ':' + PORT + ' free')
    const ver = execute('version', tools.mysqld, ['--no-defaults', '--version'])
    version = ver.stdout || ver.stderr
    record('mysqld-version', ver.code === 0 && /\b5\.7\.26\b/.test(version), version)
    if (!steps[steps.length - 1].ok) throw new Error('Exact locally verified MySQL 5.7.26 is required')
    const data = path.join(directory, 'data')
    const init = execute('initialize', tools.mysqld, ['--no-defaults', '--initialize-insecure', '--datadir=' + data, '--log-error=' + path.join(directory, 'initialize-server.log')], undefined, undefined, 180000)
    record('mysqld-initialize', init.code === 0 && fs.existsSync(path.join(data, 'mysql')), 'exit=' + init.code)
    if (!steps[steps.length - 1].ok) throw new Error('Fresh datadir initialization failed')
    server = spawn(tools.mysqld, ['--no-defaults', '--datadir=' + data, '--port=' + PORT,
      '--bind-address=' + HOST, '--log-error=' + path.join(directory, 'server.log')], { shell: false, stdio: 'ignore', windowsHide: true })
    let startError = null
    server.once('error', error => { startError = error.message })
    server.once('exit', (code, signal) => { serverExit = { code, signal } })
    const started = await waitPort(true, 60000)
    record('mysqld-start', started && !!server.pid && !startError && !serverExit, 'own pid=' + server.pid + ', ' + (startError || 'TCP accepts connections; identity verified below'))
    if (!steps[steps.length - 1].ok) throw new Error('Own synthetic instance did not start')
    const addresses = execute('listen-addresses', 'C:/Windows/System32/netstat.exe', ['-a', '-n', '-o', '-p', 'tcp'])
    const own = addresses.stdout.split('\n').map(line => line.trim().split(/\s+/))
      .filter(columns => columns[0] === 'TCP' && columns[1] && columns[1].endsWith(':' + PORT) && columns[columns.length - 1] === String(server.pid))
    const serverLog = path.join(directory, 'server.log')
    F.assertNoLinks(serverLog)
    bindingEvidence = startupBinding(fs.readFileSync(serverLog, 'utf8'), server.pid)
    bindingEvidence.osRows = own.map(columns => columns[1])
    bindingEvidence.osIndependent = addresses.code === 0 && own.length > 0 && own.every(columns => columns[1] === HOST + ':' + PORT)
    bindingEvidence.note = 'Binding is checked against the exact mysqld startup log and own ChildProcess PID; this host does not expose active test listeners consistently through netstat/Get-NetTCPConnection. OS enumeration is retained separately, not claimed as independent verification.'
    record('loopback-binding', bindingEvidence.verified && (own.length === 0 || bindingEvidence.osIndependent) && !serverExit,
      JSON.stringify(bindingEvidence))
    if (!steps[steps.length - 1].ok) throw new Error('Explicit own-process IPv4 loopback binding could not be verified')
    const bootstrap = execute('bootstrap', tools.mysql, ['--no-defaults', '--protocol=TCP', '--host=' + HOST, '--port=' + PORT, '--user=root', '--batch', '--skip-column-names'],
      `ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootSecret}'; CREATE DATABASE ${DB} CHARACTER SET utf8mb4; CREATE USER 'fbx_validate'@'localhost' IDENTIFIED BY '${appSecret}'; CREATE USER 'fbx_validate'@'127.0.0.1' IDENTIFIED BY '${appSecret}'; GRANT ALL ON ${DB}.* TO 'fbx_validate'@'localhost'; GRANT ALL ON ${DB}.* TO 'fbx_validate'@'127.0.0.1';`)
    randomized = bootstrap.code === 0
    record('credential-bootstrap', randomized, 'exit=' + bootstrap.code + '; random secrets only in child-process input/environment; no credential file')
    if (!randomized) throw new Error('Ephemeral accounts could not be initialized')
    const identity = query('instance-identity', 'SELECT @@version,@@port,@@bind_address,@@datadir;')
    const values = identity.stdout.split('\t')
    const sameData = values.length === 4 && path.resolve(values[3]).toLowerCase() === path.resolve(data).toLowerCase()
    record('runtime-instance-identity', identity.code === 0 && values[0] === '5.7.26' && values[1] === String(PORT) && values[2] === HOST && sameData,
      'Runtime version, port, bind_address and fresh datadir: ' + identity.stdout)
    if (!steps[steps.length - 1].ok) throw new Error('Connected runtime is not the approved fresh synthetic instance')
    const schema = fs.readFileSync(path.join(HERE, 'schema-mysql.sql'), 'utf8')
    const ddl = query('ddl', schema)
    const tables = query('table-count', `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}' AND table_name LIKE 'fbx_validation_%';`)
    record('ddl-under-app-user', ddl.code === 0 && tables.code === 0 && tables.stdout === '2', 'DDL exit=' + ddl.code + ', tables=' + tables.stdout)
    if (!steps[steps.length - 1].ok) throw new Error('Synthetic DDL failed')
    const pk1 = query('pk1', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-A','synthetic a','2026-11-20 08:00:00'); SELECT LAST_INSERT_ID();")
    record('pk-auto-increment-first', pk1.code === 0 && pk1.stdout === '1', pk1.stdout)
    const pk2 = query('pk2', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-B','synthetic b','2026-11-20 09:00:00'); SELECT LAST_INSERT_ID();")
    record('pk-auto-increment-next', pk2.code === 0 && pk2.stdout === '2', pk2.stdout)
    const duplicatePk = query('duplicate-pk', "INSERT INTO fbx_validation_device(id,device_code,device_name,created_at) VALUES(1,'DEV-DUP','duplicate','2026-11-20 10:00:00');")
    record('pk-duplicate-rejected', duplicatePk.code !== 0 && /Duplicate entry/.test(duplicatePk.stderr), duplicatePk.stderr)
    const duplicateCode = query('duplicate-code', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-A','duplicate','2026-11-20 10:00:00');")
    record('unique-duplicate-rejected', duplicateCode.code !== 0 && /Duplicate entry/.test(duplicateCode.stderr), duplicateCode.stderr)
    const notNull = query('not-null', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-NN',NULL,'2026-11-20 10:00:00');")
    record('not-null-rejected', notNull.code !== 0 && /cannot be null/.test(notNull.stderr), notNull.stderr)
    const nullable = query('nullable', "INSERT INTO fbx_validation_device(device_code,device_name,score,created_at) VALUES('DEV-NULL','nullable',NULL,'2026-11-20 13:00:00'); SELECT score FROM fbx_validation_device WHERE device_code='DEV-NULL';")
    record('nullable-null-roundtrip', nullable.code === 0 && nullable.stdout === 'NULL', nullable.stdout)
    const dates = query('date-roundtrip', "INSERT INTO fbx_validation_device(device_code,device_name,created_at,updated_at,occurred_on) VALUES('DEV-DATE','dates','2026-11-22 09:30:45','2026-11-22 09:30:45.123','2026-11-22'); SELECT created_at,updated_at,occurred_on FROM fbx_validation_device WHERE device_code='DEV-DATE';")
    record('datetime-date-roundtrip', dates.code === 0 && dates.stdout === '2026-11-22 09:30:45\t2026-11-22 09:30:45.123\t2026-11-22', dates.stdout)
    const before = query('nulls-before', 'SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;')
    const nulls = query('multiple-nulls', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-U1','u1','2026-11-21 08:00:00'),('DEV-U2','u2','2026-11-21 09:00:00'); SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;")
    record('unique-allows-multiple-nulls', before.code === 0 && nulls.code === 0 && Number(nulls.stdout) === Number(before.stdout) + 2, 'before=' + before.stdout + ', after=' + nulls.stdout)
    const alt = query('duplicate-alt', "INSERT INTO fbx_validation_device(device_code,device_name,alt_code,created_at) VALUES('DEV-U3','u3','ALT-1','2026-11-21 10:00:00'); INSERT INTO fbx_validation_device(device_code,device_name,alt_code,created_at) VALUES('DEV-U4','u4','ALT-1','2026-11-21 11:00:00');")
    record('unique-duplicate-alt-rejected', alt.code !== 0 && /Duplicate entry/.test(alt.stderr), alt.stderr)
    const rollback = query('rollback', "SELECT COUNT(*) FROM fbx_validation_device; START TRANSACTION; INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-RB','rollback','2026-11-21 12:00:00'); SELECT COUNT(*) FROM fbx_validation_device; ROLLBACK; SELECT COUNT(*) FROM fbx_validation_device;")
    const counts = rollback.stdout.split('\n')
    record('rollback-discards-insert', rollback.code === 0 && counts.length === 3 && counts[0] === counts[2] && Number(counts[1]) === Number(counts[0]) + 1, rollback.stdout)
    const commit = query('commit', "START TRANSACTION; INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-CM','commit','2026-11-21 13:00:00'); COMMIT; SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-CM';")
    record('commit-persists-insert', commit.code === 0 && commit.stdout === '1', commit.stdout)
    const seedPages = query('paging-seed', "INSERT INTO fbx_validation_device(device_code,device_name,created_at) VALUES('DEV-P0','p0','2026-11-20 15:00:00'),('DEV-P1','p1','2026-11-21 15:00:00'),('DEV-P2','p2','2026-11-22 15:00:00'),('DEV-P3','p3','2026-11-23 15:00:00');")
    const pageSql = 'SELECT device_code FROM fbx_validation_device ORDER BY created_at DESC,id DESC LIMIT 3 OFFSET '
    const page1 = query('page1', pageSql + '0;')
    const page2 = query('page2', pageSql + '3;')
    const page2Again = query('page2-repeat', pageSql + '3;')
    const firstRows = page1.stdout.split('\n')
    const secondRows = page2.stdout.split('\n')
    record('pagination-windows', seedPages.code === 0 && page1.code === 0 && page2.code === 0 && page2Again.code === 0 && firstRows.length === 3 && secondRows.length === 3 && firstRows[0] === 'DEV-P3' && !firstRows.some(row => secondRows.includes(row)) && page2.stdout === page2Again.stdout, 'first=' + page1.stdout + ', second=' + page2.stdout)
    const empty = query('page-beyond', pageSql + '100;')
    record('pagination-beyond-end-empty', empty.code === 0 && empty.stdout === '', empty.stdout)
    const update = query('update-count', "UPDATE fbx_validation_device SET status='1' WHERE device_code='DEV-A'; SELECT ROW_COUNT(); UPDATE fbx_validation_device SET status='1' WHERE device_code='DEV-NOT-THERE'; SELECT ROW_COUNT();")
    record('update-affected-rows', update.code === 0 && update.stdout === '1\n0', update.stdout)
    const decimal = query('decimal', "INSERT INTO fbx_validation_event(device_id,amount,happened_at) VALUES(1,123456.78,'2026-11-22 10:00:00'); SELECT amount FROM fbx_validation_event WHERE device_id=1;")
    record('decimal-roundtrip', decimal.code === 0 && decimal.stdout === '123456.78', decimal.stdout)
    const composite = query('duplicate-composite', "INSERT INTO fbx_validation_event(device_id,amount,happened_at) VALUES(1,1.00,'2026-11-22 10:00:00');")
    record('composite-unique-rejected', composite.code !== 0 && /Duplicate entry/.test(composite.stderr), composite.stderr)
  } catch (error) {
    aborted = true
    record('run-aborted', false, error.message)
  } finally {
    if (server && server.pid) {
      let shutdownMethod = 'own child process already exited; no shutdown request sent'
      if (server.exitCode === null && !serverExit) {
        if (randomized && bindingEvidence && bindingEvidence.verified) {
          execute('shutdown', tools.mysqladmin, ['--no-defaults', '--protocol=TCP', '--host=' + HOST, '--port=' + PORT, '--user=root', 'shutdown'], undefined, rootSecret, 20000)
          shutdownMethod = 'mysqladmin with this run\'s random root credential'
        } else {
          server.kill()
          shutdownMethod = 'own ChildProcess only; no empty-password shutdown request sent'
        }
      }
      let closed = await waitPort(false, 10000)
      if (!closed && server.exitCode === null && !serverExit) {
        server.kill()
        closed = await waitPort(false, 8000)
        shutdownMethod += '; own ChildProcess termination fallback'
      }
      const exitDeadline = Date.now() + 10000
      while (server.exitCode === null && !serverExit && Date.now() < exitDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const ownExited = server.exitCode !== null || !!serverExit
      record('shutdown-own-instance', ownExited && closed, 'Only own pid=' + server.pid + '; ' + shutdownMethod + '; all logs/datadir retained')
      record('port-released', !(await portBusy()), HOST + ':' + PORT)
    }
  }
  const body = { nature: 'real-synthetic-mysql-not-business-or-dm-acceptance', startedAt,
    finishedAt: F.nowIso().atLocal, version, host: HOST, port: PORT, outputId: o.outputId,
    aborted, steps, reportFile: output, dataRetained: true, credentialFilesWritten: false,
    bindingEvidence, serverExit, loginFileIsolation: { path: loginFile, exists: fs.existsSync(loginFile), method: 'MYSQL_TEST_LOGIN_FILE + --no-defaults' },
    sourceHash: F.sha256Hex(fs.readFileSync(__filename)), schemaHash: F.sha256Hex(fs.readFileSync(path.join(HERE, 'schema-mysql.sql'))) }
  body.status = completeResult(body) ? 'pass' : 'fail'
  body.hash = F.hashObject(body)
  F.writeJsonImmutable(output, body)
  return body
}

module.exports = { HERE, HOST, PORT, REQUIRED_CHECKS, startupBinding, batchText, completeResult, run }
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--mysql-bin' || args[2] !== '--output-id') {
    process.stderr.write('Usage: node run.cjs --mysql-bin <absolute directory> --output-id <new slug>\n')
    process.exitCode = 2
  } else run({ mysqlBin: args[1], outputId: args[3] }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exitCode = result.status === 'pass' ? 0 : 1
  }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 2 })
}
