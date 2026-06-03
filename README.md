# XYJ2000 — 西游记2000 MUD

西游题材中文 MUD 游戏，基于 MudOS v22pre11 驱动，使用 LPC 语言编写。

原始发布者 **vikee**（2002年，北京），基于 Annihilator 的 X 系统框架。

## 项目结构

```
xyj2000-mud/
├── mudlib.7z          # 游戏世界（adm/, cmds/, d/ 等，需解压）
├── config.cfg         # MudOS 运行时配置
├── driver/src/        # MudOS v22pre11 驱动源码
├── web/               # WebSocket ↔ Telnet 桥接（Node.js）
│   ├── server.js      # HTTP + WebSocket + Telnet 代理
│   ├── package.json
│   └── public/        # Web 终端客户端（xterm.js）
└── scripts/           # 部署脚本
```

## 快速部署

### 方式一：直接部署（Linux）

```bash
# 1. 解压游戏世界
7z x mudlib.7z -o/opt/xyj2000

# 2. 编译 MudOS 驱动（需要 gcc/make）
cd driver/src
./build.MudOS
cp driver /opt/xyj2000/

# 3. 安装 Web 桥接
cd web
npm install --omit=dev

# 4. 启动服务
cd /opt/xyj2000
./driver config.cfg &           # MUD 游戏服务（端口 6666）
node /path/to/web/server.js &   # Web 桥接（端口 17000）
```

### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t xyj2000-mud .

# 运行（端口映射：MUD 6666，Web 桥接 17000）
docker run -d --name xyj2000 \
  -p 6666:6666 -p 17000:17000 \
  xyj2000-mud
```

## 连接方式

| 方式 | 地址 | 说明 |
|------|------|------|
| 原生 Telnet | `telnet <host> 6666` | 直连游戏 |
| Web 浏览器 | `http://<host>:17000` | 通过 Web 桥接访问 |

## 注册账号

连接后按提示操作：
1. 编码选择：输入 `gb`
2. 是否学生：输入 `no`
3. 英文ID：新玩家输入 `new`，按指引注册

## 配置说明

编辑 `config.cfg` 可修改：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| port number | 6666 | 游戏端口 |
| mudlib directory | . | 游戏世界路径 |
| log directory | /log | 日志目录 |
| maximum users | 100 | 最大连接数 |
| time to clean up | 600 | 闲置清理间隔(秒) |

## 构建 MudOS 驱动

```bash
cd driver/src
./build.MudOS        # Linux
# 或参考 Install 文件手动编译
```

预编译 Windows 版 `MudOS.exe` 包含在 `mudlib.7z` 中。

## 致谢

- **Annihilator** — X 系统框架、基础 MUD 库
- **vikee** — xyj2000 版本维护与发布
- **MON, SNOWCAT, WEIQI, BULA** — 对 xyj2000 的贡献
- **MudOS 开发团队** — 驱动开发
