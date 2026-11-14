export const en = {
  "ssh.prompt.description":
    "Pick the user to sign in as. Your policy's SSH rules decide which ones are allowed.",
  "ssh.prompt.title": "Connect to {hostname}",
  "ssh.prompt.username": "Username",
  "ssh.prompt.connect": "Connect",
  "ssh.prompt.troubleshooting": "troubleshooting",
  "ssh.prompt.help": "Can't connect? See {link}.",
  "ssh.offline.description":
    "It isn't connected to the tailnet right now. Start Tailscale on it, then try again.",
  "ssh.offline.title": "{hostname} is offline",
  "ssh.retry": "Try again",
  "ssh.compatibility.title": "Browser SSH is broken on Headscale {version}",
  "ssh.compatibility.description":
    "Headscale 0.29 beta releases through 0.29.1 reject Tailscale's browser/WASM {endpoint} WebSocket request with {status}. Upgrade Headscale to 0.29.2 or newer, or use Headscale 0.28.x.",
  "ssh.console.signInTitle": "Sign in to continue",
  "ssh.console.signIn": "Sign in",
  "ssh.console.signInDescription":
    "{hostname} needs you to sign in again before it opens the session. {link}",
  "ssh.console.joining": "Joining Tailnet…",
  "ssh.console.connecting": "Connecting to {hostname}…",
  "ssh.console.stopped": "Tailnet node stopped: {error}",
  "ssh.console.failed": "Failed to join Tailnet: {error}",
  "ssh.errors.wasm_missing.title": "Browser SSH isn't available",
  "ssh.errors.wasm_missing.message": "This build of Headplane doesn't include browser SSH.",
  "ssh.errors.agent_required.title": "Browser SSH needs the agent",
  "ssh.errors.agent_required.message": "Turn on the Headplane agent to use browser SSH.",
  "ssh.errors.oidc_required.title": "Browser SSH needs SSO",
  "ssh.errors.oidc_required.message":
    "Sign in with SSO to use browser SSH. API key sessions don't have a Headscale user.",
  "ssh.errors.node_not_found.title": "Machine not found",
  "ssh.errors.node_not_found.message":
    "There's no machine named {hostname}. It may have been renamed or removed.",
  "ssh.errors.user_not_linked.title": "Your account isn't linked",
  "ssh.errors.user_not_linked.message":
    "Browser SSH connects as your Headscale user. Ask an administrator to link your account to one.",
  "ssh.errors.docs": "Read the docs",
  "ssh.errors.home": "Go to Headplane",
  "ssh.terminal": "SSH terminal",
} as const;

export const zhCN = {
  "ssh.prompt.description": "请选择登录用户。策略中的 SSH 规则决定允许使用哪些用户。",
  "ssh.prompt.title": "连接到 {hostname}",
  "ssh.prompt.username": "用户名",
  "ssh.prompt.connect": "连接",
  "ssh.prompt.troubleshooting": "故障排查",
  "ssh.prompt.help": "无法连接？请参阅{link}。",
  "ssh.offline.description": "此设备当前未连接到 Tailnet。请在设备上启动 Tailscale，然后重试。",
  "ssh.offline.title": "{hostname} 已离线",
  "ssh.retry": "重试",
  "ssh.compatibility.title": "Headscale {version} 的浏览器 SSH 无法使用",
  "ssh.compatibility.description":
    "Headscale 0.29 测试版至 0.29.1 会以 {status} 拒绝 Tailscale 浏览器/WASM 的 {endpoint} WebSocket 请求。请升级到 Headscale 0.29.2 或更新版本，或使用 Headscale 0.28.x。",
  "ssh.console.signInTitle": "请登录以继续",
  "ssh.console.signIn": "登录",
  "ssh.console.signInDescription": "{hostname} 需要你重新登录才能打开会话。{link}",
  "ssh.console.joining": "正在加入 Tailnet…",
  "ssh.console.connecting": "正在连接到 {hostname}…",
  "ssh.console.stopped": "Tailnet 节点已停止：{error}",
  "ssh.console.failed": "加入 Tailnet 失败：{error}",
  "ssh.errors.wasm_missing.title": "此构建不支持浏览器 SSH",
  "ssh.errors.wasm_missing.message": "此 Headplane 构建未包含浏览器 SSH。",
  "ssh.errors.agent_required.title": "浏览器 SSH 需要代理",
  "ssh.errors.agent_required.message": "请启用 Headplane 代理以使用浏览器 SSH。",
  "ssh.errors.oidc_required.title": "浏览器 SSH 需要 SSO",
  "ssh.errors.oidc_required.message":
    "请使用 SSO 登录以使用浏览器 SSH。API 密钥会话没有对应的 Headscale 用户。",
  "ssh.errors.node_not_found.title": "找不到设备",
  "ssh.errors.node_not_found.message": "没有名为 {hostname} 的设备。该设备可能已重命名或移除。",
  "ssh.errors.user_not_linked.title": "你的账户尚未关联",
  "ssh.errors.user_not_linked.message":
    "浏览器 SSH 使用你的 Headscale 用户身份连接。请联系管理员将你的账户关联到 Headscale 用户。",
  "ssh.errors.docs": "阅读文档",
  "ssh.errors.home": "前往 Headplane",
  "ssh.terminal": "SSH 终端",
} satisfies Partial<Record<keyof typeof en, string>>;
