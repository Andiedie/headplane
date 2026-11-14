export const en = {
  "auth.link.description":
    "Headplane couldn't match your sign-in to a Headscale user. Pick the one that's yours.",
  "auth.link.title": "Link your account",
  "auth.link.user": "Headscale user",
  "auth.link.selectUser": "Select a user",
  "auth.link.unavailable": "That user can't be linked anymore. Pick another.",
  "auth.link.submit": "Link account",
  "auth.link.skip": "Skip for now",
  "auth.link.hint":
    "You'll add machines and create auth keys as this user. You can change it later from the Users page.",
  "auth.logout.description": "You can close this window.",
  "auth.logout.title": "You're signed out",
  "auth.logout.signIn": "Sign in again",
  "auth.login.httpWarning": "Sign-in won't work over HTTP",
  "auth.login.secureCookie":
    "Headplane is set to use secure cookies, but this page was loaded over an insecure connection. {docs}",
  "auth.docs": "Docs",
  "auth.login.title": "Sign in to Headplane",
  "auth.login.sso": "Continue with SSO",
  "auth.login.or": "or",
  "auth.login.apiKey": "API key",
  "auth.login.createKey": "Create one by running {command} on your Headscale server.",
  "auth.login.submit": "Sign in with API key",
  "auth.errors.required": "Enter an API key.",
  "auth.errors.invalid": "That API key is invalid or has expired.",
  "auth.errors.missing": "That API key doesn't exist on this server.",
  "auth.errors.noExpiration": "That API key has no expiration. Create a new one.",
  "auth.errors.expired": "That API key has expired.",
  "auth.errors.checkFailed": "Couldn't check the API key. See the server logs.",
  "auth.oidc.failed": "Single sign-on failed",
  "auth.oidc.noQuery":
    "The SSO provider did not correctly redirect back to Headplane with the required parameters. Please ensure your SSO provider is configured correctly.",
  "auth.oidc.invalidSession":
    "Unable to complete SSO login due to missing or invalid session data. Ensure that your Headplane cookie configuration is correct and that your browser is accepting cookies.",
  "auth.oidc.noSubject":
    "The SSO provider did not return a valid user identifier. Please ensure your SSO provider is correctly configured to provide the {claim} claim.",
  "auth.oidc.authFailed":
    "Authentication with the SSO provider failed. Please try again later. Headplane logs may provide more information.",
  "auth.oidc.unknown":
    "An unknown error occurred during OIDC authentication. Please try again later.",
  "auth.oidc.unavailable": "Single sign-on is unavailable",
  "auth.oidc.unreachable":
    "Headplane can't reach your identity provider right now. You can still sign in with an API key.",
  "auth.oidc.misconfigured": "Single sign-on is misconfigured",
  "auth.oidc.troubleshooting": "Troubleshooting",
  "auth.oidc.invalidKey":
    "The provided API key for OIDC authentication is invalid. Ensure that {config} is a valid API key.",
  "auth.oidc.missingEndpoints":
    "The OIDC provider is missing required endpoints. Ensure the discovery URL is correct or provide manual endpoint overrides in your configuration.",
  "auth.oidc.discoveryFailed":
    "Unable to reach the OIDC provider for discovery. SSO will retry on the next login attempt.",
  "auth.oidc.unknownConfig":
    "An unknown OIDC configuration error occurred. Please check the Headplane logs for more information.",
} as const;

export const zhCN = {
  "auth.link.description": "Headplane 无法将你的登录身份与 Headscale 用户匹配。请选择你的用户。",
  "auth.link.title": "关联你的账户",
  "auth.link.user": "Headscale 用户",
  "auth.link.selectUser": "选择用户",
  "auth.link.unavailable": "该用户已无法关联。请选择其他用户。",
  "auth.link.submit": "关联账户",
  "auth.link.skip": "暂时跳过",
  "auth.link.hint": "你将以此用户身份添加设备和创建认证密钥。之后可在“用户”页面更改关联。",
  "auth.logout.description": "你可以关闭此窗口。",
  "auth.logout.title": "你已退出登录",
  "auth.logout.signIn": "重新登录",
  "auth.login.httpWarning": "无法通过 HTTP 登录",
  "auth.login.secureCookie":
    "Headplane 已配置为使用安全 Cookie，但此页面通过不安全的连接加载。{docs}",
  "auth.docs": "文档",
  "auth.login.title": "登录 Headplane",
  "auth.login.sso": "使用 SSO 继续",
  "auth.login.or": "或",
  "auth.login.apiKey": "API 密钥",
  "auth.login.createKey": "在 Headscale 服务器上运行 {command} 来创建密钥。",
  "auth.login.submit": "使用 API 密钥登录",
  "auth.errors.required": "请输入 API 密钥。",
  "auth.errors.invalid": "该 API 密钥无效或已过期。",
  "auth.errors.missing": "此服务器上不存在该 API 密钥。",
  "auth.errors.noExpiration": "该 API 密钥没有过期时间。请创建新密钥。",
  "auth.errors.expired": "该 API 密钥已过期。",
  "auth.errors.checkFailed": "无法验证 API 密钥。请查看服务器日志。",
  "auth.oidc.failed": "单点登录失败",
  "auth.oidc.noQuery":
    "SSO 提供方未携带所需参数正确跳转回 Headplane。请确认 SSO 提供方的配置正确。",
  "auth.oidc.invalidSession":
    "会话数据缺失或无效，无法完成 SSO 登录。请确认 Headplane 的 Cookie 配置正确，并且浏览器允许 Cookie。",
  "auth.oidc.noSubject":
    "SSO 提供方未返回有效的用户标识。请确认 SSO 提供方已正确配置，以提供 {claim} 声明。",
  "auth.oidc.authFailed": "SSO 提供方认证失败。请稍后重试。Headplane 日志中可能有更多信息。",
  "auth.oidc.unknown": "OIDC 认证过程中发生未知错误。请稍后重试。",
  "auth.oidc.unavailable": "单点登录暂不可用",
  "auth.oidc.unreachable": "Headplane 暂时无法连接身份提供方。你仍可使用 API 密钥登录。",
  "auth.oidc.misconfigured": "单点登录配置有误",
  "auth.oidc.troubleshooting": "故障排查",
  "auth.oidc.invalidKey": "用于 OIDC 认证的 API 密钥无效。请确认 {config} 是有效的 API 密钥。",
  "auth.oidc.missingEndpoints":
    "OIDC 提供方缺少必需的端点。请确认发现 URL 正确，或在配置中手动指定端点。",
  "auth.oidc.discoveryFailed": "无法连接 OIDC 提供方进行发现。下次登录时将重试 SSO。",
  "auth.oidc.unknownConfig": "发生未知的 OIDC 配置错误。请查看 Headplane 日志以获取更多信息。",
} satisfies Partial<Record<keyof typeof en, string>>;

// Exact application-owned action messages; unknown upstream errors pass through.
export const authErrorKeys: Readonly<Record<string, keyof typeof en>> = {
  "Enter an API key.": "auth.errors.required",
  "That API key is invalid or has expired.": "auth.errors.invalid",
  "That API key doesn't exist on this server.": "auth.errors.missing",
  "That API key has no expiration. Create a new one.": "auth.errors.noExpiration",
  "That API key has expired.": "auth.errors.expired",
  "Couldn't check the API key. See the server logs.": "auth.errors.checkFailed",
};
