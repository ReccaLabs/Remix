// `@remix/types/api` (bundled from source) names the fetch type `HeadersInit`, which only the DOM
// lib declares globally. Alias it to Node's own fetch types instead of pulling DOM globals
// (window, document…) into a server codebase.
type HeadersInit = ConstructorParameters<typeof Headers>[0];
