export const REMOTE_SAFE_TOOLS = [
  // Read-only tools
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  // MCP Chrome tools (for browsing)
  'mcp__Chrome__navigate_page',
  'mcp__Chrome__take_screenshot',
  'mcp__Chrome__take_snapshot',
  'mcp__Chrome__click',
  'mcp__Chrome__fill',
  'mcp__Chrome__hover',
  'mcp__Chrome__list_pages',
  'mcp__Chrome__select_page',
  'mcp__Chrome__new_page',
  'mcp__Chrome__close_page',
  'mcp__Chrome__wait_for',
  'mcp__Chrome__press_key',
  'mcp__Chrome__evaluate_script',
  'mcp__Chrome__get_network_request',
  'mcp__Chrome__list_network_requests',
  'mcp__Chrome__list_console_messages',
  // Task tools
  'Task',
] as const;
