// Nest 12's compile() lazily loads the adapter even for a DI-only testing module.
import '@nestjs/platform-express';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { readCookie } from '../src/common/testing/in-memory-doubles';

/**
 * Guards the toolchain: Nest DI depends on `design:paramtypes`, emitted by oxc (Vite in tests,
 * rolldown in the build) from tsconfig's `emitDecoratorMetadata`. If a tooling upgrade stops
 * emitting it, this fails before anything subtler does.
 */
describe('decorator metadata', () => {
  @Injectable()
  class Dep {
    readonly name = 'dep';
  }

  @Injectable()
  class Consumer {
    constructor(
      readonly dep: Dep,
      @Inject('TOKEN') readonly token: string,
    ) {}
  }

  it('emits design:paramtypes for constructor injection', () => {
    expect(Reflect.getMetadata('design:paramtypes', Consumer)).toEqual([Dep, String]);
  });

  it('lets Nest wire classes by type', async () => {
    @Module({ providers: [Dep, Consumer, { provide: 'TOKEN', useValue: 'x' }] })
    class M {}
    const ref = await Test.createTestingModule({ imports: [M] }).compile();
    try {
      expect(ref.get(Consumer).dep.name).toBe('dep');
      expect(ref.get(Consumer).token).toBe('x');
    } finally {
      await ref.close();
    }
  });
});

describe('readCookie (test double helper)', () => {
  it('reads one cookie from a header', () => {
    expect(readCookie('a=1; sid=abc; b=2', 'sid')).toBe('abc');
    expect(readCookie('xsid=abc', 'sid')).toBeUndefined();
    expect(readCookie(undefined, 'sid')).toBeUndefined();
  });
});
