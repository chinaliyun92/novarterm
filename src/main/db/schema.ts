export const SCHEMA_STATEMENTS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS server_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES server_groups(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'privateKey')),
    password TEXT,
    private_key_path TEXT,
    passphrase TEXT,
    default_directory TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    last_connected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS connection_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('connecting', 'connected', 'failed', 'disconnected')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    exit_code INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS recent_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, path)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK (session_type IN ('local', 'ssh')),
    server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    shell TEXT,
    cwd TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    layout TEXT,
    tab_order INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS terminal_triggers (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    send_text TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    auto_send INTEGER NOT NULL DEFAULT 0 CHECK (auto_send IN (0, 1)),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    source TEXT CHECK (source IN ('user', 'server_hidden')),
    source_server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_servers_group_id ON servers(group_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_servers_is_favorite ON servers(is_favorite);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_connection_records_server_started_at
    ON connection_records(server_id, started_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_recent_directories_server_last_accessed
    ON recent_directories(server_id, last_accessed_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_status_last_active
    ON sessions(status, last_active_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_terminal_triggers_source_server_id
    ON terminal_triggers(source, source_server_id);
  `,
];

export const DEFAULT_SETTINGS: Array<{ key: string; value: string }> = [
  { key: 'theme', value: 'dark' },
  { key: 'ui.language', value: 'en' },
  { key: 'ui.fontFamily', value: 'PingFang SC, Helvetica Neue, Arial, sans-serif' },
  { key: 'defaultShell', value: '/bin/zsh' },
  { key: 'terminal.defaultShell', value: '/bin/zsh' },
  { key: 'fontSize', value: '13' },
  { key: 'lineHeight', value: '1.4' },
  { key: 'cursorStyle', value: 'block' },
  { key: 'sshTimeoutMs', value: '10000' },
  { key: 'sshAutoReconnect', value: 'true' },
  { key: 'ssh.readyTimeoutMs', value: '15000' },
  { key: 'ssh.reconnectEnabled', value: 'true' },
  { key: 'ssh.reconnectMaxAttempts', value: '3' },
  { key: 'ssh.reconnectDelayMs', value: '1500' },
];
