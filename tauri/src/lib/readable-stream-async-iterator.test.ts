import { describe, expect, it } from "vitest";

import { installReadableStreamAsyncIterator } from "./readable-stream-async-iterator";

describe("readable stream async iterator compatibility", () => {
  it("installs values and async iterator helpers when WebView does not provide them", async () => {
    const prototype = globalThis.ReadableStream?.prototype;
    if (!prototype) return;
    const streamPrototype = prototype as ReadableStream<unknown> & {
      values?: unknown;
      [Symbol.asyncIterator]?: unknown;
    };

    const valuesDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "values",
    );
    const asyncIteratorDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      Symbol.asyncIterator,
    );

    if (
      (valuesDescriptor && !valuesDescriptor.configurable) ||
      (asyncIteratorDescriptor && !asyncIteratorDescriptor.configurable)
    ) {
      return;
    }

    try {
      Object.defineProperty(prototype, "values", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      Object.defineProperty(prototype, Symbol.asyncIterator, {
        configurable: true,
        writable: true,
        value: undefined,
      });

      installReadableStreamAsyncIterator();

      expect(typeof streamPrototype.values).toBe("function");
      expect(typeof streamPrototype[Symbol.asyncIterator]).toBe("function");

      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue("first");
          controller.enqueue("second");
          controller.close();
        },
      });
      const chunks: string[] = [];

      for await (const chunk of stream as unknown as AsyncIterable<string>) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["first", "second"]);
    } finally {
      restoreProperty(prototype, "values", valuesDescriptor);
      restoreProperty(prototype, Symbol.asyncIterator, asyncIteratorDescriptor);
      installReadableStreamAsyncIterator();
    }
  });
});

function restoreProperty(
  prototype: ReadableStream<unknown> & {
    values?: unknown;
    [Symbol.asyncIterator]?: unknown;
  },
  key: "values" | typeof Symbol.asyncIterator,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(prototype, key, descriptor);
    return;
  }

  if (key === "values") {
    delete prototype.values;
    return;
  }

  delete prototype[Symbol.asyncIterator];
}
