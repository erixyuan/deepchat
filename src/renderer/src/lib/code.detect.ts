/**
 * @module detect
 * (Language detector)
 */

/**
 * Supported language identifiers
 */
export type CodeLanguage =
  | 'bash'
  | 'html'
  | 'http'
  | 'js'
  | 'ts'
  | 'py'
  | 'sql'
  | 'pl'
  | 'lua'
  | 'make'
  | 'uri'
  | 'css'
  | 'diff'
  | 'md'
  | 'docker'
  | 'xml'
  | 'c'
  | 'rs'
  | 'go'
  | 'java'
  | 'asm'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'mermaid'
  | 'plain'

/**
 * Language detection feature with pattern and score
 */
type LanguageFeature = [RegExp, number]

/**
 * Language definition with identifier and detection features
 */
type LanguageDefinition = [CodeLanguage, ...LanguageFeature[]]

/**
 * Language detection definitions
 */
const languages: LanguageDefinition[] = [
  ['bash', [/#!(\/usr)?\/bin\/bash/g, 500], [/\b(if|elif|then|fi|echo)\b|\$/g, 10]],
  ['html', [/<\/?[a-z-]+[^\n>]*>/g, 10], [/^\s+<!DOCTYPE\s+html/g, 500]],
  ['http', [/^(GET|HEAD|POST|PUT|DELETE|PATCH|HTTP)\b/g, 500]],
  [
    'js',
    [
      /\b(console|await|async|function|export|import|this|class|for|let|const|map|join|require)\b/g,
      10
    ]
  ],
  [
    'ts',
    [
      /\b(console|await|async|function|export|import|this|class|for|let|const|map|join|require|implements|interface|namespace)\b/g,
      10
    ]
  ],
  ['py', [/\b(def|print|class|and|or|lambda)\b/g, 10]],
  ['sql', [/\b(SELECT|INSERT|FROM)\b/g, 50]],
  ['pl', [/#!(\/usr)?\/bin\/perl/g, 500], [/\b(use|print)\b|\$/g, 10]],
  ['lua', [/#!(\/usr)?\/bin\/lua/g, 500]],
  ['make', [/\b(ifneq|endif|if|elif|then|fi|echo|.PHONY|^[a-z]+ ?:$)\b|\$/gm, 10]],
  ['uri', [/https?:|mailto:|tel:|ftp:/g, 30]],
  ['css', [/^(@import|@page|@media|(\.|#)[a-z]+)/gm, 20]],
  ['diff', [/^[+><-]/gm, 10], [/^@@ ?[-+,0-9 ]+ ?@@/gm, 25]],
  ['md', [/^(>|\t\*|\t\d+.|#{1,6} |-\s+|\*\s+)/gm, 25], [/\[.*\](.*)/g, 10]],
  ['docker', [/^(FROM|ENTRYPOINT|RUN)/gm, 500]],
  ['xml', [/<\/?[a-z-]+[^\n>]*>/g, 10], [/^<\?xml/g, 500]],
  ['c', [/#include\b|\bprintf\s+\(/g, 100]],
  ['rs', [/^\s+(use|fn|mut|match)\b/gm, 100]],
  ['go', [/\b(func|fmt|package)\b/g, 100]],
  ['java', [/^import\s+java/gm, 500]],
  ['asm', [/^(section|global main|extern|\t(call|mov|ret))/gm, 100]],
  ['css', [/^(@import|@page|@media|(\.|#)[a-z]+)/gm, 20]],
  ['json', [/\b(true|false|null|\{})\b|"[^"]+":/g, 10]],
  ['yaml', [/^(\s+)?[a-z][a-z0-9]*:/gim, 10]],
  ['toml', [/^\s*\[.*\]\s*$/gm, 100], [/^\s*[a-zA-Z0-9_-]+ *= */gm, 20]],
  [
    'mermaid',
    [
      /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)/gm,
      500
    ],
    [/\b(-->|--o|--x|=>|\[\]|[{}])\b/g, 10]
  ]
]

/**
 * Try to find the language the given code belongs to
 *
 * @param {string} code The code to analyze
 * @returns {CodeLanguage} The detected language of the code
 */
export const detectLanguage = (code: string): CodeLanguage => {
  return (
    languages
      .map(
        ([lang, ...features]) =>
          [
            lang,
            features.reduce(
              (acc: number, [match, score]: LanguageFeature) =>
                acc + [...code.matchAll(match)].length * score,
              0
            )
          ] as [CodeLanguage, number]
      )
      .filter(([, score]) => score > 20)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'plain'
  )
}
