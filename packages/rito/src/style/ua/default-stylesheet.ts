/**
 * Internal user-agent stylesheet for HTML elements Rito renders specially.
 *
 * Keep browser-expressible tag defaults here instead of hard-coded partial
 * ComputedStyle maps so author CSS participates in the normal cascade.
 */
export const DEFAULT_UA_STYLESHEET = `
h1 { font-size: 2em; font-weight: bold; margin-top: 0.67em; margin-bottom: 0.67em; }
h2 { font-size: 1.5em; font-weight: bold; margin-top: 0.83em; margin-bottom: 0.83em; }
h3 { font-size: 1.17em; font-weight: bold; margin-top: 1em; margin-bottom: 1em; }
h4 { font-size: 1em; font-weight: bold; margin-top: 1.33em; margin-bottom: 1.33em; }
h5 { font-size: 0.83em; font-weight: bold; margin-top: 1.67em; margin-bottom: 1.67em; }
h6 { font-size: 0.67em; font-weight: bold; margin-top: 2.33em; margin-bottom: 2.33em; }

p { margin-top: 1em; margin-bottom: 1em; }
blockquote { margin-top: 1em; margin-bottom: 1em; margin-left: 40px; margin-right: 40px; }
pre { font-family: monospace; white-space: pre; margin-top: 1em; margin-bottom: 1em; }
code { font-family: monospace; }
em, i { font-style: italic; }
strong, b { font-weight: bold; }
center { text-align: center; }

ul { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: disc; }
ol { margin-top: 1em; margin-bottom: 1em; padding-left: 40px; list-style-type: decimal; }
li { margin-top: 0; margin-bottom: 0; }
dl { margin-top: 1em; margin-bottom: 1em; }
dt { font-weight: bold; }
dd { margin-left: 40px; }

hr { margin-top: 0.5em; margin-bottom: 0.5em; }
th { font-weight: bold; }
sup { vertical-align: super; font-size: smaller; }
sub { vertical-align: sub; font-size: smaller; }
`;
