import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { EndpointDef } from '@remix/types/api';
import { ENDPOINT_METADATA } from './endpoint';

/**
 * `PATH_METADATA` from `@nestjs/common/constants`. Not imported: that deep path has no `exports`
 * entry, so it doesn't resolve from an ESM bundle. Covered by the verifier's unit test.
 */
const PATH_METADATA = 'path';

/**
 * Boot-time check of `@Endpoint` usage: a controller path prefix would silently move the route
 * away from its registry path, and two handlers for one endpoint would shadow each other. Both
 * fail the boot (and therefore every e2e test) instead of surfacing as a 404 in production.
 */
@Injectable()
export class EndpointVerifier implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const seen = new Map<string, string>();
    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || typeof instance !== 'object' || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const method of this.scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[method];
        if (typeof handler !== 'function') continue;
        const def = this.reflector.get<EndpointDef | undefined>(ENDPOINT_METADATA, handler);
        if (!def) continue;

        const where = `${metatype.name}.${method}`;
        const prefix: unknown = Reflect.getMetadata(PATH_METADATA, metatype);
        if (prefix !== undefined && prefix !== '/' && prefix !== '') {
          throw new Error(`${where}: controllers using @Endpoint must not set a path prefix`);
        }
        const route = `${def.method} ${def.path}`;
        const existing = seen.get(route);
        if (existing) throw new Error(`${route} is bound twice: ${existing} and ${where}`);
        seen.set(route, where);
      }
    }
  }
}
