import { jsonLd } from '@/lib/seo';

/**
 * The single place structured data (schema.org JSON-LD) is embedded in a page. `jsonLd()` escapes
 * `<`, `>`, `&` and the U+2028/U+2029 line separators, so the content can never close the script
 * tag or be read as HTML, and the data is static page metadata — never user input.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
    <script
      type="application/ld+json"
      // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}
