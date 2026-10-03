/** Typed service token. The phantom `__type` field carries `T` for inference only. */
export interface ServiceToken<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: (value: T) => T;
}

export function createToken<T>(name: string): ServiceToken<T> {
  return { key: Symbol(name), name };
}

export class MissingServiceError extends Error {
  override name = 'MissingServiceError';
}

/**
 * Explicit, typed dependency container. Created once by the composition root and passed down;
 * there are no hidden global singletons.
 */
export class ServiceContainer {
  private readonly services = new Map<symbol, unknown>();
  private readonly parent: ServiceContainer | null;

  constructor(parent: ServiceContainer | null = null) {
    this.parent = parent;
  }

  provide<T>(token: ServiceToken<T>, value: T): this {
    this.services.set(token.key, value);
    return this;
  }

  get<T>(token: ServiceToken<T>): T {
    const value = this.tryGet(token);
    if (value === undefined) throw new MissingServiceError(`Service "${token.name}" not provided`);
    return value;
  }

  tryGet<T>(token: ServiceToken<T>): T | undefined {
    if (this.services.has(token.key)) return this.services.get(token.key) as T;
    return this.parent?.tryGet(token);
  }

  has(token: ServiceToken<unknown>): boolean {
    return this.services.has(token.key) || (this.parent?.has(token) ?? false);
  }

  /** Child scope for per-room services that should not leak into the app scope. */
  createScope(): ServiceContainer {
    return new ServiceContainer(this);
  }
}
