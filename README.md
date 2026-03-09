# NovarTerm

[English](README.md) | [简体中文](README.zh-CN.md)

AI-first terminal workspace for developers and DevOps teams.

NovarTerm is an AI-native desktop terminal that keeps AI help in the same place where you run commands, inspect logs, transfer files, and manage remote sessions.

![](docs/screenshots/06.png)

## Roadmap and Status

High-level capability status for NovarTerm:

| # | Capability | Status | Notes |
|---|---|---|---|
| 1 | AI command bar (chat / explain / run / insert) | ✅ | Streaming responses, model routing, context control, and language policy are all active in core flow. |
| 2 | Structured AI debugging | ✅ | Error pattern detection triggers `Debug with Novar` with structured context cards for faster diagnosis. |
| 3 | Multi-tab and multi-pane workspace | ✅ | Tab/pane operations and layout restore after restart. |
| 4 | Remote SSH workflow | ✅ | Saved server quick-connect and manual `ssh` both supported. |
| 5 | Unified local/remote file pane | ⚠️ | Core browse/upload/download is ready; deeper workflows still evolving. |
| 6 | Predictable drag-and-drop rules | ✅ | Path insertion to shell vs confirmed upload to remote pane. |
| 7 | Centralized transfer center | ✅ | Unified progress and history tracking for transfers. |
| 8 | Trigger automation and i18n | ⚠️ | Core capability is ready; advanced rules and coverage are expanding. |
| 9 | Native platform polish and deep OS integration | ⚠️ | Preferences and platform-specific experiences are still improving. |
| 10 | Full cross-platform validation (Windows/Linux) | ⚠️ | macOS is verified first; broader validation is in progress. |
| N | Advanced features to be expanded later | ❌ | Reserved for future roadmap items. |

Status legend: `✅ Available` · `⚠️ In progress / partial` · `❌ Planned`

## Detailed Feature Breakdown

### 1) AI Command Bar (Core Flow)

- Supports streaming responses (SSE) for `Send` and `Explain`.
- Supports follow-up conversations with explicit actions: `Explain`, `Run`, and `Insert`.
- Uses model routing: built-in models go through internal proxy; user custom models use direct endpoint config.
- Applies context control: requests include only the most recent 2 messages for predictable token usage.
- Supports response-language policy: automatic language detection by default, with manual override in Settings.
- Request construction is explicit by action type: `Send` sends current prompt + recent context window; `Explain` sends selected command/output context + recent context window; `Run` keeps AI explanation and terminal execution in one place; `Insert` writes generated content into terminal input without forced execution.
- Stream lifecycle is observable in UI (start, incremental tokens, completion, failure), so users can distinguish partial output from completed output.
- Failure handling is recoverable: network/model errors keep conversation state understandable and allow retry without losing terminal context.

### 2) Debug with Novar

- Shows `Debug with Novar` entry when terminal output matches known error patterns.
- Sends structured debug context instead of plain text only, including `User Prompt`, `Terminal Output`, and `Executed Command`.
- Keeps debugging in the same terminal thread, avoiding context-switch to external tools.
- Uses context cards to reduce ambiguity between "what was asked", "what actually ran", and "what failed in output".

### 3) Terminal Workspace (Tabs + Panes)

- Multi-tab workflow: create, close, switch, and reorder tabs.
- Multi-pane workflow: horizontal split, vertical split, and close current pane.
- Split panes inherit session semantics (local/remote context and working path hints).
- Workspace recovery: tab/pane layout can be restored after app restart.

### 4) Remote Session Workflow

- Supports saved server profiles (add, edit, delete).
- Supports quick-connect from terminal context menu.
- Supports manual `ssh ...` login path when direct command control is preferred.
- Surfaces connection failures with actionable feedback for retry/switch.

### 5) Unified File Pane (Local + Remote)

- One file pane can switch data source between local and saved remote servers.
- Local pane supports browse, enter directory, go parent, create, rename, and delete.
- Remote pane supports browse, enter directory, go parent, create, rename, delete, upload, and download.
- Remote upload supports both files and directories, preserving relative structure for directory uploads.
- Name conflict policy: same-name file upload overwrites; same-name directory conflict is explicitly prompted.

### 6) Drag-and-Drop and Transfer Rules

- Dragging into shell inserts file/directory path only; it does not trigger upload.
- Dragging into remote file pane prompts for confirmation and then uploads.
- Dragging into local file pane does not trigger upload.
- Transfer Center in tab bar provides unified progress + history view for uploads/downloads.

### 7) Trigger Automation

- Supports trigger rules based on terminal-output keyword matching.
- Each trigger has independent enable/disable state.
- `Enabled`: controls whether matched trigger writes configured text into terminal input.
- `Auto Send`: controls whether written trigger text is submitted automatically (Enter).
- Default behavior is safe (auto-send off) to reduce accidental execution.

### 8) i18n and Usability Baseline

- Core user flows are available in English and Chinese.
- i18n coverage includes terminal, file pane, AI interaction, settings, error toasts, and confirmation dialogs.
- Settings include practical shortcut guidance (including `Command + K` for AI command bar toggle).

### Current Constraints (Important)

- File upload capability is available only when file pane source is remote.
- Shell drag-and-drop is strictly path insertion, not transport behavior.
- Platform validation is currently macOS-first; Windows/Linux verification is still in progress.

## Screenshots

![](docs/screenshots/01.png)

![](docs/screenshots/02.png)

![](docs/screenshots/03.png)

![](docs/screenshots/04.png)

![](docs/screenshots/05.png)
