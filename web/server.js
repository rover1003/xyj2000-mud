/**
 * XYJ2000 Web MUD 桥接服务
 * 
 * 功能：
 * 1. HTTP 服务 — 提供静态文件 (Web 客户端页面)
 * 2. WebSocket 服务 — 浏览器 ↔ 桥接器 双向通信
 * 3. Telnet 客户端 — 桥接器 ↔ FluffOS/MudOS 双向通信
 * 4. GBK ↔ UTF-8 编码转换
 * 
 * 启动：node server.js
 * 配置：通过环境变量 HOST/PORT/MUD_HOST/MUD_PORT
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const iconv = require('iconv-lite');

// ============================================================
// 配置
// ============================================================
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '17000');
const MUD_HOST = process.env.MUD_HOST || '127.0.0.1';
const MUD_PORT = parseInt(process.env.MUD_PORT || '6666');

// ============================================================
// MIME 类型映射（用于 HTTP 静态文件服务）
// ============================================================
const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ============================================================
// HTTP 服务 — 提供静态文件
// ============================================================
const PUBLIC_DIR = path.join(__dirname, 'public');

const httpServer = http.createServer((req, res) => {
  // 安全：拒绝目录遍历
  // 注意：Windows 上 path.normalize('/') 返回 '\\'，所以要统一成 '/'
  let safePath = path.normalize(req.url).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
  // 根路径 '/index.html' 或直接 '' 都返回 index.html
  let filePath = path.join(PUBLIC_DIR, (safePath === '/' || safePath === '') ? '/index.html' : safePath);

  // 确保文件在 PUBLIC_DIR 内
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_MAP[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============================================================
// WebSocket 服务
// ============================================================
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress;
  console.log(`[WS] 新连接: ${clientAddr}`);
  console.log(`[WS] URL: ${req.url}, Headers: ${JSON.stringify(req.headers)}`);

  // 每个 WebSocket 连接对应一个 Telnet 连接
  let telnetClient = null;
  let telnetBuffer = Buffer.alloc(0);
  let closed = false;

  // Telnet 协议常量
  const IAC  = 255;  // \xff
  const DONT = 254;  // \xfe
  const DO   = 253;  // \xfd
  const WONT = 252;  // \xfc
  const WILL = 251;  // \xfb
  const SB   = 250;  // \xfa - 子协商开始
  const SE   = 240;  // \xf0 - 子协商结束
  const GA   = 249;  // \xf9 - Go Ahead

  // Telnet 协商处理
  // 返回 { response, text, mccpStart: bool }
  function processTelnetData(data) {
    let responseBuffer = Buffer.alloc(0);
    let textParts = [];
    let mccpStart = false;
    let i = 0;

    while (i < data.length) {
      if (data[i] === IAC) {
        if (i + 1 >= data.length) break;

        const cmd = data[i + 1];

        // IAC IAC = 转义的 0xFF 字节
        if (cmd === IAC) {
          textParts.push(Buffer.from([IAC]));
          i += 2;
          continue;
        }

        // IAC SB = 子协商开始
        if (cmd === SB) {
          if (i + 2 >= data.length) break;
          const subOption = data[i + 2];
          let j = i + 3;
          while (j < data.length - 1) {
            if (data[j] === IAC && data[j + 1] === SE) {
              j += 2;
              break;
            }
            j++;
          }
          console.log(`[Telnet] 子协商: 选项 ${subOption}, 跳过 ${j - i} 字节`);
          // MCCP 子协商（选项 86）= 服务器开始压缩
          if (subOption === 86) {
            mccpStart = true;
            console.log('[Telnet] MCCP 压缩子协商收到，压缩即将开始');
          }
          i = j;
          continue;
        }

        // IAC GA = Go Ahead，忽略
        if (cmd === GA) {
          i += 2;
          continue;
        }

        // WILL / WONT / DO / DONT
        if (i + 2 >= data.length) break;
        const option = data[i + 2];
        console.log(`[Telnet] 协商: IAC ${cmd} ${option}`);

        let response = null;
        if (cmd === WILL) {
          // 选项 86 (MCCP2) 我们支持压缩
          // 其他选项我们拒绝（WONT），避免收到不支持的数据
          if (option === 86) {
            response = Buffer.from([IAC, DO, option]);
          } else {
            response = Buffer.from([IAC, DONT, option]);
          }
        } else if (cmd === DO) {
          // 服务器 DO -> 我们只接受简单选项
          if (option === 1 || option === 0) {
            // ECHO 或 BINARY - 接受
            response = Buffer.from([IAC, WILL, option]);
          } else {
            response = Buffer.from([IAC, WONT, option]);
          }
        } else if (cmd === WONT) {
          response = Buffer.from([IAC, DONT, option]);
        } else if (cmd === DONT) {
          response = Buffer.from([IAC, WONT, option]);
        }

        if (response) {
          responseBuffer = Buffer.concat([responseBuffer, response]);
        }
        i += 3;
      } else {
        // 收集文本数据
        let textEnd = i;
        while (textEnd < data.length && data[textEnd] !== IAC) {
          textEnd++;
        }
        if (textEnd > i) {
          textParts.push(data.slice(i, textEnd));
        }
        i = textEnd;
      }
    }

    return { response: responseBuffer, text: textParts.length > 0 ? Buffer.concat(textParts) : null, mccpStart };
  }

  // ---- Telnet 连接到 MudOS ----
  function connectTelnet() {
    console.log(`[Telnet] 开始连接到 ${MUD_HOST}:${MUD_PORT}`);
    telnetClient = new net.Socket();

    telnetClient.connect(MUD_PORT, MUD_HOST, () => {
      console.log(`[Telnet] 已连接到 ${MUD_HOST}:${MUD_PORT}`);
      // 通知浏览器端连接就绪
      ws.send(JSON.stringify({ type: 'sys', msg: '已连接到 MUD 服务器...\n' }));
    });

    telnetClient.on('error', (err) => {
      console.error(`[Telnet] 连接失败: ${err.message}`);
      if (!closed) {
        ws.send(JSON.stringify({ type: 'sys', msg: `连接失败: ${err.message}\n` }));
        closed = true;
        ws.close();
      }
    });

    // 收到 Telnet 数据 → 处理协商 → 解压 → 转码 → 发到 WebSocket
    let compressEnabled = false;
    let inflate = null;
    telnetClient.on('data', (data) => {
      if (closed) return;

      // 如果压缩已启用，原始数据需要先解压再处理
      if (compressEnabled && inflate) {
        console.log('[Telnet] 收到压缩数据, 长度:', data.length);
        try {
          inflate.write(data);
        } catch (e) {
          console.error('[Telnet] 解压写入错误:', e.message);
        }
        return;
      }

      // 未压缩：正常处理
      console.log('[Telnet] 收到原始数据, 长度:', data.length);
      const result = processTelnetData(data);

      // 发送协商响应
      if (result.response.length > 0) {
        telnetClient.write(result.response);
      }

      // 检测 MCCP 子协商 → 启用压缩
      if (result.mccpStart) {
        compressEnabled = true;
        inflate = zlib.createInflate();
        inflate.on('data', (chunk) => {
          const decompressed = processTelnetData(chunk);
          if (decompressed.text) {
            const decoded = iconv.decode(decompressed.text, 'gbk');
            console.log('[Telnet] 解压后:', decoded.substring(0, 200).replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
            ws.send(JSON.stringify({ type: 'data', text: decoded }));
          }
        });
        inflate.on('error', (err) => {
          console.error('[Telnet] 解压错误:', err.message);
        });
        console.log('[Telnet] MCCP 压缩已启用 (raw deflate)');
      }

      // 文本数据 — MUD 使用 GBK 编码
      if (result.text) {
        const decoded = iconv.decode(result.text, 'gbk');
        console.log('[Telnet] GBK:', decoded.substring(0, 200).replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
        ws.send(JSON.stringify({ type: 'data', text: decoded }));
      }
    });

    telnetClient.on('close', () => {
      console.log('[Telnet] 连接关闭');
      if (!closed) {
        ws.send(JSON.stringify({ type: 'sys', msg: '与 MUD 服务器的连接已断开。\n' }));
        closed = true;
        ws.close();
      }
    });

    telnetClient.on('error', (err) => {
      console.error('[Telnet] 错误:', err.message);
      if (!closed) {
        ws.send(JSON.stringify({ type: 'sys', msg: `连接错误: ${err.message}\n` }));
        closed = true;
        ws.close();
      }
    });
  }

  // ---- 从浏览器收到消息 → 转码 → 发到 Telnet ----
  ws.on('message', (raw) => {
    if (closed) return;

    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'cmd':
          // 用户输入的命令：UTF-8 → GBK → Telnet
          if (telnetClient && !telnetClient.destroyed) {
            const gbkData = iconv.encode(msg.text + '\n', 'gbk');
            telnetClient.write(gbkData);
          }
          break;

        case 'connect':
          // 连接到 MUD 服务器
          connectTelnet();
          break;

        case 'disconnect':
          // 断开连接
          if (telnetClient && !telnetClient.destroyed) {
            telnetClient.destroy();
          }
          break;

        default:
          console.log('[WS] 未知消息类型:', msg.type);
      }
    } catch (e) {
      console.error('[WS] 消息解析错误:', e.message);
    }
  });

  // ---- WebSocket 关闭 ----
  ws.on('close', () => {
    console.log(`[WS] 连接断开: ${clientAddr}`);
    closed = true;
    if (telnetClient && !telnetClient.destroyed) {
      telnetClient.destroy();
      telnetClient = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] 错误:', err.message);
    closed = true;
    if (telnetClient && !telnetClient.destroyed) {
      telnetClient.destroy();
      telnetClient = null;
    }
  });
});

// ============================================================
// 启动
// ============================================================
httpServer.listen(PORT, HOST, () => {
  console.log('============================================================');
  console.log('  XYJ2000 Web MUD 桥接服务');
  console.log('============================================================');
  console.log(`  网页客户端 : http://${HOST}:${PORT}`);
  console.log(`  WebSocket  : ws://${HOST}:${PORT}`);
  console.log(`  MUD 服务器  : ${MUD_HOST}:${MUD_PORT}`);
  console.log(`  编码       : GBK ↔ UTF-8 (iconv-lite)`);
  console.log('============================================================');
  console.log('  按 Ctrl+C 停止服务');
  console.log('============================================================');
});
