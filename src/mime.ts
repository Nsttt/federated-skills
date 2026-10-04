const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  csv: 'text/csv',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  sql: 'application/sql',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/yaml',
  'application/toml',
  'application/xml',
  'application/sql',
  'image/svg+xml',
]);

export const inferMimeType = (filePath: string): string => {
  const extension = filePath.split('.').at(-1)?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'text/plain';
};

export const isTextMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_APPLICATION_TYPES.has(mimeType);
