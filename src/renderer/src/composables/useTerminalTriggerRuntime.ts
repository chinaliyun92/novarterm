const triggerLastLineBySession = new Map<string, string>()
const triggerOutputTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const triggerAutoInputTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()
const triggerArmedBySession = new Set<string>()

let terminalTriggerRuntimeStore:
  | {
      triggerLastLineBySession: typeof triggerLastLineBySession
      triggerOutputTimerBySession: typeof triggerOutputTimerBySession
      triggerAutoInputTimerBySession: typeof triggerAutoInputTimerBySession
      triggerArmedBySession: typeof triggerArmedBySession
    }
  | null = null

export function useTerminalTriggerRuntime() {
  if (!terminalTriggerRuntimeStore) {
    terminalTriggerRuntimeStore = {
      triggerLastLineBySession,
      triggerOutputTimerBySession,
      triggerAutoInputTimerBySession,
      triggerArmedBySession,
    }
  }

  return terminalTriggerRuntimeStore
}
