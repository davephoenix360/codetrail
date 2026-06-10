// Type declarations for CSS imports (used by Expo's web target).
// Without these, `tsc --noEmit` complains about *.css and *.module.css imports.

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {
  const content: string;
  export default content;
}
