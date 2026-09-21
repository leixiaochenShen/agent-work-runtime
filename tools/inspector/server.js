#!/usr/bin/env node
/**
 * AWR Inspector 鈥斺€?鏈湴妗ユ帴杩涚▼
 *
 * 鍋氱殑浜嬫儏鍙湁涓€浠讹細鎶婁竴娆?HTTP 璇锋眰缈昏瘧鎴愪竴鏉?`awr --json` 鍛戒护锛? * 鎶?AWR 鍘熸牱鍚愬嚭鐨?JSON 鍘熸牱杞彂缁欐祻瑙堝櫒銆傚畠涓嶈В閲娿€佷笉鏀瑰啓銆佷笉缂撳瓨銆? *
 * 缁戝畾鍥炵幆鍦板潃杩樹笉澶燂細娴忚鍣ㄩ噷鐨勪换鎰忛〉闈㈤兘鑳藉悜 127.0.0.1 鍙戣姹傘€? * 鎵€浠?/api/* 杩樻湁涓€灞傝姹傛潵婧愯竟鐣岋紝瑙?guardRequest()銆? *
 * 鐢ㄦ硶锛? *   node server.js --project /abs/path/to/project [--port 7381] [--demo] [--allow-reindex]
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 涓婇檺 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/** 鍙粰娴嬭瘯鐢ㄧ殑鏁板€艰鐩栵紱娌¤灏辩敤榛樿銆?*/
function envInt(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

const LIMITS = {
  stdoutBytes: 8 * 1024 * 1024,   // 鍗曟潯鍛戒护鐨?stdout 涓婇檺
  stderrBytes: 1 * 1024 * 1024,
  requestBytes: 64 * 1024,        // 璇锋眰浣撲笂闄?  concurrent: envInt('AWR_INSPECTOR_CONCURRENT', 4),          // 鍚屾椂鍦ㄨ窇鐨?awr 瀛愯繘绋嬫暟
  readTimeoutMs: envInt('AWR_INSPECTOR_READ_TIMEOUT_MS', 60000),   // 鍙鍛戒护鐨勮秴鏃?  writeTimeoutMs: envInt('AWR_INSPECTOR_WRITE_TIMEOUT_MS', 120000), // 鍐欏懡浠わ紙reindex锛夌殑瓒呮椂
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鍙傛暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function parseArgs(argv) {
  const out = {
    project: process.cwd(),
    port: 7381,
    demo: false,
    open: true,
    allowReindex: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') out.project = path.resolve(argv[++i] || '.');
    else if (a === '--port') out.port = Number(argv[++i]) || out.port;
    else if (a === '--demo') out.demo = true;
    else if (a === '--no-open') out.open = false;
    else if (a === '--allow-reindex') out.allowReindex = true;
    else if (a === '--help' || a === '-h') {
      console.log([
        '鐢ㄦ硶: node server.js [閫夐」]',
        '',
        '  --project <鐩綍>   瑕佹煡鐪嬬殑 AWR 椤圭洰锛岄粯璁ゅ綋鍓嶇洰褰?,
        '  --port <绔彛>      榛樿 7381',
        '  --demo             寮哄埗婕旂ず妯″紡锛屼笉鎵ц浠讳綍鐪熷疄鍛戒护',
        '  --allow-reindex    鍏佽浠庣晫闈㈣Е鍙?`source reindex`锛堥粯璁や笉鍏佽锛?,
        '  --no-open          涓嶈嚜鍔ㄦ墦寮€娴忚鍣?,
      ].join('\n'));
      process.exit(0);
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const PUBLIC_DIR = path.join(__dirname, 'public');

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ awr 璺緞瑙ｆ瀽 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 瑙ｆ瀽 .cmd 鏂囦欢锛屾彁鍙?Node.js 鍏ュ彛璺緞銆? * npm 鐨?.cmd 鍖呰鍣ㄦ槸 `"%_prog%" "<entry_point>" %*`锛? * 娴嬭瘯鐨?.cmd 鏄?`"node" "<entry_point>" %*`锛? * 鎴戜滑鎻愬彇 entry_point 骞跺睍寮€ %dp0% 涓?.cmd 鏂囦欢鎵€鍦ㄧ洰褰曘€? */
function parseCmdEntryPoint(cmdPath) {
  try {
    const content = fs.readFileSync(cmdPath, 'utf8');
    // 鍖归厤 "node_path" "entry_point" %*锛宯ode_path 鍙互鏄?%_prog%銆乶ode銆佹垨瀹屾暣璺緞
    const match = content.match(/"[^"]+"\s+"([^"]+)"\s+%\*/);
    if (match) {
      let entryPoint = match[1].replace(/%dp0%/g, path.dirname(cmdPath));
      if (fs.existsSync(entryPoint)) return entryPoint;
    }
  } catch {}
  return null;
}

/**
 * 閫氳繃 PATH 脳 PATHEXT 瑙ｆ瀽 awr 鐨勫畬鏁磋矾寰勶紝鍏ㄧ▼ shell: false銆? *
 * Windows 涓?PATHEXT 榛樿鏄?.COM;.EXE;.BAT;.CMD锛堝垎鍙峰垎闅旓級锛? * Node 鐨?spawn 鍦?shell: false 涓嬩笉浼氳嚜鍔ㄦ煡 PATHEXT锛岄渶瑕佹墜鍔ㄣ€? *
 * 杩斿洖 { cmd, entryPoint }锛? *   - cmd: PATHEXT 涓婃壘鍒扮殑鏂囦欢璺緞锛堢敤浜庢帰娴嬬増鏈級
 *   - entryPoint: 瀹為檯瑕?spawn 鐨?Node 鑴氭湰锛?cmd 浼氳瑙ｆ瀽鍑哄叆鍙ｏ級
 *   涓よ€呭潎涓?null 鏃惰繘 demo mode銆? */
function resolveAwr() {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.toUpperCase())
    : [''];
  const dirs = (process.env.PATH || '').split(sep);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, 'awr' + ext);
      try {
        const st = fs.statSync(candidate, { throwIfNoEntry: false });
        if (st && st.isFile()) {
          // .exe 鍙互鐩存帴 spawn锛?cmd/.bat 闇€瑕佽В鏋愬嚭 Node 鍏ュ彛
          if (ext === '.EXE' || ext === '') {
            return { cmd: candidate, entryPoint: candidate };
          }
          const entryPoint = parseCmdEntryPoint(candidate);
          if (entryPoint) return { cmd: candidate, entryPoint };
        }
      } catch {}
    }
  }
  return { cmd: null, entryPoint: null };
}

const { cmd: RESOLVED_AWR, entryPoint: RESOLVED_ENTRY_POINT } = resolveAwr();

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ awr 鎺㈡祴 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const runtime = {
  mode: ARGS.demo ? 'demo' : 'unknown', // 'live' | 'demo'
  awrVersion: null,
  project: ARGS.project,
  reason: ARGS.demo ? '鍚姩鏃跺甫浜?--demo 鍙傛暟' : null,
  allowReindex: ARGS.allowReindex,
  // `--json` 鏀惧叏灞€浣嶇疆銆傚彧鏈夊綋 AWR 鏄庣‘璇翠笉璁よ瘑 `--json` 鏃舵墠鏀规斁灏鹃儴锛?  // 鍒殑鍙傛暟鎶ラ敊涓嶈兘鍔ㄨ繖涓紑鍏筹紙閭ｄ細璁╀竴娆″潖璇锋眰姹℃煋鏁翠釜杩涚▼锛夈€?  jsonFlagPosition: 'global',
  running: 0,
};

function detectAwr() {
  return new Promise((resolve) => {
    if (ARGS.demo) return resolve();
    if (!RESOLVED_AWR) {
      runtime.mode = 'demo';
      runtime.reason = '娌℃湁鎵惧埌 awr 鍛戒护銆傝濂戒箣鍚庨噸鍚湰杩涚▼鍗冲彲鐪嬪埌鐪熷疄鏁版嵁銆?;
      return resolve();
    }
    execFile(process.execPath, [RESOLVED_ENTRY_POINT, '--version'], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        runtime.mode = 'demo';
        runtime.reason = '娌℃湁鎵惧埌 awr 鍛戒护銆傝濂戒箣鍚庨噸鍚湰杩涚▼鍗冲彲鐪嬪埌鐪熷疄鏁版嵁銆?;
        return resolve();
      }
      runtime.awrVersion = String(stdout).trim();
      runtime.mode = 'live';
      resolve();
    });
  });
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 璇锋眰鏉ユ簮杈圭晫 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${ARGS.port}`,
  `localhost:${ARGS.port}`,
  `[::1]:${ARGS.port}`,
]);
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${ARGS.port}`,
  `http://localhost:${ARGS.port}`,
  `http://[::1]:${ARGS.port}`,
]);

/** 鐘舵€佸彉鏇磋姹傚繀椤诲甫杩欎釜澶淬€傜涓夋柟椤甸潰鍙戜笉鍑鸿嚜瀹氫箟澶达紝闄ら潪鍏堣繃 CORS 棰勬鈥斺€旀垜浠笉缁欓妫€鏀捐銆?*/
const GUARD_HEADER = 'x-awr-inspector';

/**
 * 鍒ゆ柇涓€涓?/api/* 璇锋眰鏄笉鏄湡鐨勬潵鑷湰鏈鸿繖涓〉闈€? * 杩斿洖 null 琛ㄧず鏀捐锛屽惁鍒欒繑鍥炶鍥炵粰璋冪敤鏂圭殑閿欒銆? */
function guardRequest(req) {
  // 1) Host锛氭尅 DNS rebinding銆傛敾鍑昏€呮妸鍩熷悕瑙ｆ瀽鍒?127.0.0.1锛孒ost 浠嶆槸浠栫殑鍩熷悕銆?  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return { code: 'ForbiddenHost', message: `涓嶆帴鍙楃殑 Host: ${host || '(绌?'}` };
  }

  // 2) Origin锛氬甫浜嗗氨蹇呴』鏄湰鏈鸿繖涓簮銆?null' 涔熶笉鏀捐锛堟矙绠?iframe銆乫ile:// 閮戒細鍙戝畠锛夈€?  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(String(origin))) {
    return { code: 'ForbiddenOrigin', message: `涓嶆帴鍙楃殑 Origin: ${origin}` };
  }

  // 3) Sec-Fetch-Site锛氭祻瑙堝櫒鑷繁鏍囩殑锛岄〉闈㈡敼涓嶄簡銆?  //    鍚屾簮璇锋眰鏄?same-origin锛涘湴鍧€鏍忕洿鎺ユ墦寮€鏄?none銆傚叾浣欎竴寰嬫嫆銆?  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return { code: 'ForbiddenSite', message: `涓嶆帴鍙楃殑 Sec-Fetch-Site: ${site}` };
  }

  // 4) 鐘舵€佸彉鏇磋姹傝甯﹁嚜瀹氫箟澶淬€傝〃鍗曡法绔?POST 鍙戜笉鍑哄畠銆?  if (req.method !== 'GET' && req.headers[GUARD_HEADER] !== '1') {
    return {
      code: 'MissingGuardHeader',
      message: `鐘舵€佸彉鏇磋姹傚繀椤诲甫 ${GUARD_HEADER}: 1 璇锋眰澶碻,
    };
  }

  return null;
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鎵ц awr 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// 鐧藉悕鍗曘€傞敭鏄墠绔兘璇锋眰鐨勫姩浣滃悕锛屽€兼槸杩欎釜鍔ㄤ綔鍏佽鐨勫浐瀹氬瓙鍛戒护銆?// 鍓嶇浼犱笉浜嗕换鎰忓懡浠わ紝鍙兘鍦ㄨ繖寮犺〃閲屾寫涓€涓紝鍐嶈ˉ涓婄粡杩囨牎楠岀殑鍙傛暟銆?const COMMANDS = {
  status: { argv: ['status'], write: false },
  ready: { argv: ['ready'], write: false },
  workShow: { argv: ['work', 'show'], write: false },
  search: { argv: ['search'], write: false },
  intakeInspect: { argv: ['intake', 'inspect'], write: false },
  contextCompile: { argv: ['context', 'compile'], write: false },
  sourceReindex: { argv: ['source', 'reindex'], write: true },
};

// 姣忎釜瀛楁涓€濂楁牎楠岋紝鎸夊畠瀹為檯鎵胯浇浠€涔堟潵瀹氾紝涓嶇敤涓€鏉＄矖鏀剧殑 ASCII 姝ｅ垯涓€鍒€鍒囥€?// 娉ㄥ叆椋庨櫓宸茬粡鐢便€屽弬鏁版暟缁?+ 涓嶈蛋 shell銆嶆秷鎺変簡锛岃繖閲岀鐨勬槸銆屽€煎悎涓嶅悎鐞嗐€嶃€?
/** AWR 鐨?key锛欵XAMPLE-001銆乬oal#demo銆乸lan#intake 杩欑被銆?*/
const KEY_RE = /^[A-Za-z0-9_.:#/-]{1,200}$/;

/** 鍒嗘敮鍚嶃€?*/
const BRANCH_RE = /^[A-Za-z0-9_./-]{1,200}$/;

function asKey(value) {
  const s = String(value == null ? '' : value);
  return KEY_RE.test(s) ? s : null;
}

function asBranch(value) {
  const s = String(value == null ? '' : value);
  return BRANCH_RE.test(s) ? s : null;
}

/**
 * 鑷敱鏂囨湰锛堟悳绱㈣瘝銆乮ntent锛夈€傚厑璁?Unicode鈥斺€斾腑鏂囨悳绱㈡槸姝ｅ綋闇€姹傘€? * 鍙尅鎺у埗瀛楃鍜?NUL锛屽苟闄愰暱銆? */
function asText(value, maxLength) {
  const s = String(value == null ? '' : value);
  if (!s || s.length > (maxLength || 500)) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // 鎺у埗瀛楃锛堝惈 NUL锛変竴寰嬩笉鏀讹紱鍒惰〃銆佹崲琛屻€佸洖杞︿篃涓嶈鍑虹幇鍦ㄨ繖绫诲崟琛屽弬鏁伴噷銆?    if (c < 0x20 || c === 0x7f) return null;
  }
  return s;
}

function buildArgv(commandKey, extra) {
  const spec = COMMANDS[commandKey];
  if (!spec) throw new Error(`涓嶅厑璁哥殑鍛戒护: ${commandKey}`);
  const base = ['--project', runtime.project];
  if (runtime.jsonFlagPosition === 'global') base.push('--json');
  const argv = base.concat(spec.argv, extra || []);
  if (runtime.jsonFlagPosition === 'trailing') argv.push('--json');
  return argv;
}

/**
 * 璺戜竴鏉?awr銆? *
 * stdout/stderr 鎸?Buffer 鏀堕泦锛岃窇瀹屽啀鏁翠綋瑙ｇ爜鈥斺€旀寜鍧楄В鐮佷細鎶婁竴涓瀛楄妭
 * UTF-8 瀛楃鍔堟垚涓ゅ崐锛屾嫾鍥炴潵灏辨槸 U+FFFD銆? *
 * 瓒呮椂鐨勫鐞嗗璇诲拰鍐欎笉涓€鏍凤細鍙鍛戒护鍙互鏉€锛沗source reindex` 鏄繖涓晫闈㈠敮涓€
 * 鐨勫啓鎿嶄綔锛屾潃鎺夊畠浼氱暀涓嬩竴涓€屼笉鐭ラ亾鎴愭病鎴愩€嶇殑鐘舵€侊紝鎵€浠ヤ笉鏉€锛屽彧鏄笉鍐嶇瓑瀹冦€? */
function execAwr(argv, opts) {
  const write = Boolean(opts && opts.write);
  const timeoutMs = write ? LIMITS.writeTimeoutMs : LIMITS.readTimeoutMs;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RESOLVED_ENTRY_POINT, ...argv], { stdio: 'pipe', windowsHide: true });

    // 妲戒綅璺熺潃瀛愯繘绋嬭蛋锛屼笉璺熺潃 HTTP 鍝嶅簲璧般€傝秴鏃舵椂鎴戜滑浼氬厛鍥炲搷搴旓紝
    // 浣嗗瓙杩涚▼杩樻椿鐫€鈥斺€旈偅涓Ы蹇呴』鐣欏埌瀹冪湡鐨勯€€鍑轰负姝紝鍚﹀垯涓婇檺褰㈠悓铏氳銆?    runtime.running += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      runtime.running -= 1;
    };

    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Object.assign({ truncated, write }, result));
    };

    const timer = setTimeout(() => {
      if (write) {
        // 涓嶆潃銆傛妸瀛愯繘绋嬫斁鎺夛紝璁╁畠鑷繁璺戝畬锛涚粨鏋滄槸鏈煡鐨勶紝濡傚疄璇淬€?        // 妲戒綅涓嶅湪杩欓噷閲婃斁鈥斺€旂瓑 close 浜嬩欢銆?        finish({ code: null, timedOut: true, outcomeUnknown: true, stdout: '', stderr: '' });
      } else {
        // 鍙鍛戒护锛氬厛绀煎悗鍏碉紝SIGTERM 缁?5 绉掞紝鍐?SIGKILL銆?        child.kill('SIGTERM');
        const hard = setTimeout(() => child.kill('SIGKILL'), 5000);
        hard.unref();
        finish({ code: null, timedOut: true, outcomeUnknown: false, stdout: '', stderr: '' });
      }
    }, timeoutMs);
    // 瓒呮椂瀹氭椂鍣ㄤ笉璇ユ嫋浣忚繘绋嬮€€鍑恒€?    timer.unref();

    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length;
      if (outBytes > LIMITS.stdoutBytes) {
        truncated = true;
        // 鍙鍛戒护鍙互鏉€銆傚啓鍛戒护涓嶈鈥斺€旀潃鎺変竴涓鍦ㄦ敼鐘舵€佺殑 reindex
        // 浼氱暀涓嬩笉鐭ラ亾鎴愭病鎴愮殑鐘舵€侊紝鑰岃緭鍑哄お澶у苟涓嶆槸缁堟瀹冪殑鐞嗙敱銆?        // 缁х画璇伙紝鍙槸鎶婅秴鍑虹殑閮ㄥ垎涓㈡帀銆?        if (!write) child.kill('SIGKILL');
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errBytes += chunk.length;
      if (errBytes > LIMITS.stderrBytes) {
        truncated = true;
        return;
      }
      err.push(chunk);
    });

    child.on('error', (e) => {
      release();
      finish({ code: -1, stdout: '', stderr: String(e.message) });
    });
    child.on('close', (code) => {
      release();
      finish({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

/**
 * 璺戜竴鏉″懡浠わ紝杩斿洖缁欏墠绔殑缁熶竴淇″皝銆? * 鏃犺鎴愯触閮藉甫涓?`command`锛氱晫闈笂閭ｆ潯銆屽彲浠ュ鍒跺幓缁堢璺戙€嶇殑鍛戒护灏辨槸瀹冦€? */
async function runCommand(commandKey, extra) {
  const spec = COMMANDS[commandKey];

  // 妲戒綅鐢?execAwr 鎸夊瓙杩涚▼鐢熷懡鍛ㄦ湡鍗犵敤涓庨噴鏀撅紝杩欓噷鍙仛鍑嗗叆鍒ゆ柇銆?  if (runtime.running >= LIMITS.concurrent) {
    return {
      ok: false,
      command: null,
      error: {
        code: 'BridgeBusy',
        message: '鍚屾椂鍦ㄨ窇鐨?awr 瀛愯繘绋嬪凡杈句笂闄愶紝绛夊叾涓竴涓粨鏉熷啀璇曘€?,
      },
    };
  }

  {
    let argv = buildArgv(commandKey, extra);
    let result = await execAwr(argv, spec);

    // --json 浣嶇疆鎺㈡祴锛氬彧鏈夊綋 AWR 鏄庣‘璇翠笉璁よ瘑 `--json` 鏃舵墠鎹綅缃噸璇曘€?    if (
      result.code !== 0 &&
      runtime.jsonFlagPosition === 'global' &&
      mentionsUnknownJsonFlag(result.stderr, result.stdout)
    ) {
      runtime.jsonFlagPosition = 'trailing';
      argv = buildArgv(commandKey, extra);
      result = await execAwr(argv, spec);
    }

    const command = 'awr ' + argv.map(quoteForDisplay).join(' ');

    if (result.timedOut) {
      return {
        ok: false,
        command,
        error: result.outcomeUnknown
          ? {
              code: 'OutcomeUnknown',
              message:
                '鍛戒护瓒呮椂浜嗭紝浣嗗畠娌℃湁琚粓姝紝鍙兘宸茬粡鐢熸晥锛屼篃鍙兘娌℃湁銆? +
                '鍏堢敤 awr 鏌ヤ竴涓嬪綋鍓嶇姸鎬佸啀鍐冲畾涓嬩竴姝ワ紝涓嶈鐩存帴閲嶈瘯銆?,
            }
          : {
              code: 'BridgeTimeout',
              message: '鍛戒护瓒呮椂锛屽凡缁堟銆傝繖鏄彧璇诲懡浠わ紝閲嶈瘯鏄畨鍏ㄧ殑銆?,
            },
      };
    }

    if (result.code === -1) {
      return { ok: false, command, error: { code: 'BridgeSpawnFailed', message: result.stderr } };
    }

    if (result.truncated) {
      // 鍐欏懡浠ゆ病琚粓姝紝鍙槸杈撳嚭娌℃敹鍏ㄢ€斺€斿畠鎴愭病鎴愭槸鏈煡鐨勶紝鍒彨浜虹洿鎺ラ噸璺戙€?      return spec.write
        ? {
            ok: false,
            command,
            error: {
              code: 'OutcomeUnknown',
              message:
                `杈撳嚭瓒呰繃浜?${LIMITS.stdoutBytes} 瀛楄妭涓婇檺锛屾病鏈夋敹鍏ㄣ€傚懡浠ゆ湰韬病鏈夎缁堟锛宍 +
                '鍙兘宸茬粡鐢熸晥銆傚厛鐢?awr 鏌ヤ竴涓嬪綋鍓嶇姸鎬佸啀鍐冲畾涓嬩竴姝ワ紝涓嶈鐩存帴閲嶈瘯銆?,
            },
          }
        : {
            ok: false,
            command,
            error: {
              code: 'OutputTooLarge',
              message: `awr 鐨勮緭鍑鸿秴杩囦簡 ${LIMITS.stdoutBytes} 瀛楄妭涓婇檺銆傝鍦ㄧ粓绔噷鐩存帴璺戣繖鏉″懡浠ゃ€俙,
            },
          };
    }

    const parsed = tryParseJson(result.stdout);

    if (result.code !== 0) {
      // AWR 鐨勯敊璇篃鏄?JSON锛屽甫 code 鍜?message锛屼絾瀹冨彲鑳借蛋 stdout 涔熷彲鑳借蛋 stderr銆?      const errJson =
        (parsed && (parsed.code || parsed.error) ? parsed : null) || tryParseJson(result.stderr);
      const domain = errJson && (errJson.error || errJson);
      return {
        ok: false,
        command,
        exitCode: result.code,
        error: domain && domain.code
          ? domain
          : { code: 'CommandFailed', message: (result.stderr || result.stdout || '').trim() },
        raw: errJson || null,
      };
    }

    if (!parsed) {
      return {
        ok: false,
        command,
        error: { code: 'NotJson', message: 'awr 杩斿洖鐨勪笉鏄?JSON銆傚師濮嬭緭鍑鸿 raw銆? },
        raw: result.stdout.slice(0, 20000),
      };
    }

    return { ok: true, command, data: parsed };
  }
}

/** 鍙銆屼笉璁よ瘑 --json銆嶈繖涓€绉嶆儏鍐碉紝鍒殑鍙傛暟鎶ラ敊涓嶇畻銆?*/
function mentionsUnknownJsonFlag(stderr, stdout) {
  const s = (String(stderr) + String(stdout)).toLowerCase();
  if (!s.includes('--json')) return false;
  return (
    s.includes('unexpected argument') || s.includes('unknown') || s.includes('unrecognized')
  );
}

function tryParseJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch (_) {
    // 鏈変簺鍛戒护浼氬厛鎵撳嵃鍑犺浜虹被鍙鐨勬枃鏈啀鎵撳嵃 JSON锛屽彇绗竴涓?{ 璧风殑閮ㄥ垎鍐嶈瘯銆?    const i = t.indexOf('{');
    if (i > 0) {
      try {
        return JSON.parse(t.slice(i));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function quoteForDisplay(arg) {
  return /[^A-Za-z0-9_@.:#/=-]/.test(arg) ? `'${String(arg).replace(/'/g, `'\\''`)}'` : arg;
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 璺敱 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const routes = {
  'GET /api/health': async () => ({
    ok: true,
    data: {
      mode: runtime.mode,
      awrVersion: runtime.awrVersion,
      project: runtime.project,
      reason: runtime.reason,
      allowReindex: runtime.allowReindex,
      bridgeVersion: '1.1.0',
    },
  }),

  'GET /api/status': async (url) => {
    const extra = [];
    const view = asKey(url.searchParams.get('view'));
    if (view === 'full' || view === 'summary') extra.push('--view', view);
    return runCommand('status', extra);
  },

  'GET /api/ready': async (url) => {
    const extra = [];
    const limit = Number(url.searchParams.get('limit'));
    if (Number.isInteger(limit) && limit >= 1 && limit <= 100) extra.push('--limit', String(limit));
    return runCommand('ready', extra);
  },

  'GET /api/work': async (url) => {
    const key = asKey(url.searchParams.get('key'));
    if (!key) return { ok: false, error: { code: 'BadRequest', message: '缂哄皯鍚堟硶鐨?key 鍙傛暟' } };
    return runCommand('workShow', [key]);
  },

  'GET /api/search': async (url) => {
    // AWR 0.4.0 鐨勭鍚嶆槸 `awr search [OPTIONS] [TEXT]`鈥斺€旀枃鏈槸浣嶇疆鍙傛暟锛屼笉鏄?--text銆?    const text = asText(url.searchParams.get('text'), 200);
    if (!text) {
      return { ok: false, error: { code: 'BadRequest', message: '缂哄皯鍚堟硶鐨?text 鍙傛暟' } };
    }
    const extra = [];
    const limit = Number(url.searchParams.get('limit'));
    if (Number.isInteger(limit) && limit >= 1 && limit <= 100) extra.push('--limit', String(limit));
    // `--` 涔嬪悗鏄綅缃弬鏁帮紝杩欐牱浠?`-` 寮€澶寸殑鎼滅储璇嶄篃涓嶄細琚綋鎴愰€夐」銆?    extra.push('--', text);
    return runCommand('search', extra);
  },

  'GET /api/sources': async () => runCommand('intakeInspect', []),

  'POST /api/context/compile': async (_url, body) => {
    const extra = [];
    const work = asKey(body.work);
    if (!work) return { ok: false, error: { code: 'BadRequest', message: '缂哄皯鍚堟硶鐨?work' } };
    extra.push('--work', work);

    const goal = asKey(body.goal);
    if (goal) extra.push('--goal', goal);

    const budget = Number(body.budget);
    if (Number.isInteger(budget) && budget >= 500 && budget <= 200000) {
      extra.push('--budget', String(budget));
    }

    const branch = asBranch(body.branch);
    if (branch) extra.push('--branch', branch);

    const intent = asText(body.intent, 500);
    if (intent) extra.push('--intent', intent);

    return runCommand('contextCompile', extra);
  },

  'POST /api/source/reindex': async () => {
    if (!runtime.allowReindex) {
      return {
        ok: false,
        error: {
          code: 'ReindexNotAllowed',
          message: '閲嶆柊绱㈠紩榛樿鏄叧鐨勩€傝寮€鍚紝鐢?--allow-reindex 閲嶅惎鏈繘绋嬨€?,
        },
      };
    }
    return runCommand('sourceReindex', []);
  },
};

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ HTTP 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 椤甸潰鍙鍔犺浇鑷繁鐨勪笢瑗裤€傛病鏈夊閮ㄥ瓧浣撱€佹病鏈夊唴鑱旇剼鏈€佹病鏈夊杩炪€?const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // 鐩綍绌胯秺闃叉姢锛氳В鏋愬悗鐨勮矾寰勫繀椤昏繕鍦?public 閲岄潰銆?  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      // 涓嶇紦瀛橈細鏀逛簡 public/ 閲岀殑鏂囦欢锛屽埛鏂伴〉闈㈠氨鑳界湅鍒帮紝涓嶇敤娓呯紦瀛樸€?      'cache-control': 'no-store',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(buf);
  });
}

/** 鎸?Buffer 鏀惰姹備綋锛岃秴闄愮洿鎺ユ嫆銆傚瓧绗︿覆鎷兼帴浼氬妶寮€澶氬瓧鑺傚瓧绗︺€?*/
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let killed = false;
    req.on('data', (chunk) => {
      if (killed) return;
      bytes += chunk.length;
      if (bytes > LIMITS.requestBytes) {
        killed = true;
        // 涓?destroy锛氳繛鎺ユ柇浜?413 灏卞彂涓嶅嚭鍘汇€備涪鎺夊墿涓嬬殑鏁版嵁鍗冲彲銆?        req.resume();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (killed) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({ body: raw ? JSON.parse(raw) : {} });
      } catch (_) {
        resolve({ body: {} });
      }
    });
    req.on('error', () => {
      if (!killed) resolve({ body: {} });
    });
  });
}

/**
 * 姣忎釜璇锋眰閮藉寘鍦ㄨ繖閲岄潰銆? *
 * `new URL()` 鍦ㄨ姹傝鐣稿舰鏃朵細鎶涳紙姣斿 `GET // HTTP/1.1`锛夛紝鑰岃繖涓洖璋冩槸 async鈥斺€? * 鎶涘嚭鍘诲氨鏄竴涓湭澶勭悊鐨?Promise 鎷掔粷锛岄粯璁ら厤缃笅鏁翠釜杩涚▼浼氶€€鍑恒€? * 涓€涓暩褰㈣姹備笉璇ユ妸鏁翠釜宸ュ叿甯﹁蛋銆? */
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    try {
      sendJson(res, 500, {
        ok: false,
        error: { code: 'BridgeError', message: String((err && err.message) || err) },
      });
    } catch (_) {
      // 鍝嶅簲宸茬粡鍙戝嚭鍘讳簡锛屽彧鑳芥斁寮冭繖涓€鏉★紱杩涚▼瑕佹椿鐫€銆?    }
  });
});

async function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch (_) {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'BadRequestTarget', message: '鏃犳硶瑙ｆ瀽鐨勮姹傜洰鏍囥€? },
    });
  }

  if (url.pathname.startsWith('/api/')) {
    const denial = guardRequest(req);
    if (denial) return sendJson(res, 403, { ok: false, error: denial });

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      return sendJson(res, 404, {
        ok: false,
        error: { code: 'NoRoute', message: `${req.method} ${url.pathname}` },
      });
    }

    // 婕旂ず妯″紡涓嬮櫎浜?/api/health 涓€寰嬩笉鎵ц鍛戒护锛屽墠绔嚜宸辩敤鍐呯疆鏍锋湰鏁版嵁銆?    if (runtime.mode === 'demo' && url.pathname !== '/api/health') {
      return sendJson(res, 200, {
        ok: false,
        error: { code: 'DemoMode', message: runtime.reason || '褰撳墠鏄紨绀烘ā寮忥紝娌℃湁杩炴帴鐪熷疄椤圭洰銆? },
      });
    }

    try {
      let body = null;
      if (req.method === 'POST') {
        const read = await readBody(req);
        if (read.tooLarge) {
          return sendJson(res, 413, {
            ok: false,
            error: { code: 'BodyTooLarge', message: `璇锋眰浣撹秴杩?${LIMITS.requestBytes} 瀛楄妭銆俙 },
          });
        }
        body = read.body;
      }
      return sendJson(res, 200, await handler(url, body));
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        error: { code: 'BridgeError', message: String(err.message) },
      });
    }
  }

  serveStatic(req, res, url.pathname);
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鍚姩 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function start() {
  return detectAwr().then(
    () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(ARGS.port, '127.0.0.1', () => resolve(server));
      })
  );
}

if (require.main === module) {
  start().then(
    () => {
      const addr = `http://127.0.0.1:${ARGS.port}`;
      console.log('');
      console.log('  AWR Inspector 宸插惎鍔?);
      console.log('  鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€');
      console.log(`  鍦板潃    ${addr}`);
      console.log(`  椤圭洰    ${runtime.project}`);
      if (runtime.mode === 'live') {
        console.log(`  妯″紡    鐪熷疄鏁版嵁锛?{runtime.awrVersion || 'awr'}锛塦);
      } else {
        console.log('  妯″紡    婕旂ず妯″紡');
        console.log(`  鍘熷洜    ${runtime.reason}`);
      }
      console.log(`  閲嶆柊绱㈠紩 ${runtime.allowReindex ? '宸插紑鍚? : '宸插叧闂紙--allow-reindex 寮€鍚級'}`);
      console.log('  鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€');
      console.log('  鎸?Ctrl+C 鍋滄');
      console.log('');
      if (ARGS.open) {
        const opener =
          process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        spawn(opener, [addr], { stdio: 'ignore', detached: true }).on('error', () => {});
      }
    },
    (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`绔彛 ${ARGS.port} 宸茶鍗犵敤銆傛崲涓€涓細node server.js --port ${ARGS.port + 1}`);
      } else {
        console.error(err && err.message);
      }
      process.exit(1);
    }
  );
}

module.exports = { server, start, runtime, LIMITS, GUARD_HEADER, ARGS };
