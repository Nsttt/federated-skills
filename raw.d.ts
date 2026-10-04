// Types for `import skill from './SKILL.md?raw'` in skills provider builds.
// Add `"types": ["@module-federation/skills-mcp/raw"]` to your tsconfig.
declare module '*?raw' {
  const content: string;
  export default content;
}
