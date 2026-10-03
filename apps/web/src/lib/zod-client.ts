import { z } from 'zod';

/**
 * Zod 4 probes `new Function('')` to decide whether to JIT-compile object parsers. The app's CSP
 * has no 'unsafe-eval' (rightly), so the probe raised a "script-src blocked eval" violation in
 * every browser session that validated a form. Jitless parsing skips the probe; the speed
 * difference is irrelevant for forms. Loaded once for the whole client by instrumentation-client.ts.
 */
z.config({ jitless: true });
