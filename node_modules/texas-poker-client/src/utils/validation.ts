const KEYBOARD_CHARS_REGEX = /^[a-zA-Z0-9\u4e00-\u9fff\s\~\!\@\#\$\%\^\&\*\(\)\-\_\=\+\[\]\{\}\|\\\;\:\'\"\,\.\/\<\>\?]+$/

function getDisplayLength(str: string): number {
  let len = 0
  for (const ch of str) {
    len += ch.charCodeAt(0) > 127 ? 2 : 1
  }
  return len
}

export function validatePlayerName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: '昵称不能为空' }
  }
  const trimmed = name.trim()
  if (getDisplayLength(trimmed) > 12) {
    return { valid: false, error: '昵称长度不能超过6个汉字' }
  }
  if (!KEYBOARD_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: '昵称只能包含键盘可输入的字符' }
  }
  return { valid: true }
}

export function validateRoomName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: '房间名称不能为空' }
  }
  const trimmed = name.trim()
  if (getDisplayLength(trimmed) > 16) {
    return { valid: false, error: '房间名称长度不能超过8个汉字' }
  }
  if (!KEYBOARD_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: '房间名称只能包含键盘可输入的字符' }
  }
  return { valid: true }
}
