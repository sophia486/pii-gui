type ReadableStreamIteratorOptions = {
  preventCancel?: boolean;
};

type ReadableStreamAsyncIterator<T> = AsyncIterableIterator<T> & {
  next(): Promise<IteratorResult<T>>;
  return(): Promise<IteratorResult<T>>;
};

type ReadableStreamPrototype = ReadableStream<unknown> & {
  values?: (
    options?: ReadableStreamIteratorOptions,
  ) => ReadableStreamAsyncIterator<unknown>;
  [Symbol.asyncIterator]?: () => ReadableStreamAsyncIterator<unknown>;
};

export function installReadableStreamAsyncIterator() {
  const readableStream = globalThis.ReadableStream;
  if (!readableStream) return;

  const prototype = readableStream.prototype as ReadableStreamPrototype;

  if (typeof prototype.values !== "function") {
    Object.defineProperty(prototype, "values", {
      configurable: true,
      writable: true,
      value: function values(
        this: ReadableStream<unknown>,
        options: ReadableStreamIteratorOptions = {},
      ): ReadableStreamAsyncIterator<unknown> {
        const reader = this.getReader();
        let isFinished = false;

        return {
          async next() {
            if (isFinished) return { done: true, value: undefined };

            const result = await reader.read();
            if (result.done) {
              isFinished = true;
              reader.releaseLock();
              return { done: true, value: undefined };
            }

            return { done: false, value: result.value };
          },
          async return() {
            if (!isFinished) {
              isFinished = true;
              if (!options.preventCancel) {
                await reader.cancel();
              }
              reader.releaseLock();
            }

            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    });
  }

  if (typeof prototype[Symbol.asyncIterator] !== "function") {
    Object.defineProperty(prototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: function asyncIterator(this: ReadableStreamPrototype) {
        return this.values?.() as ReadableStreamAsyncIterator<unknown>;
      },
    });
  }
}

installReadableStreamAsyncIterator();
