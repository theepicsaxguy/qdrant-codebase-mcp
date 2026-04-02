import { describe, expect, it, vi } from 'vitest';
import { createStdioShutdownController } from '../../src/mcp/shutdown';

type SignalEvent = 'SIGINT' | 'SIGTERM';
type StdinEvent = 'close' | 'end';

class FakeEmitter<EventName extends string> {
  private readonly listeners = new Map<EventName, Set<() => void>>();

  once(event: EventName, listener: () => void): this {
    const wrapped = (): void => {
      this.off(event, wrapped);
      listener();
    };

    const eventListeners = this.listeners.get(event) ?? new Set<() => void>();
    eventListeners.add(wrapped);
    this.listeners.set(event, eventListeners);
    return this;
  }

  off(event: EventName, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: EventName): void {
    const eventListeners = [...(this.listeners.get(event) ?? [])];
    for (const listener of eventListeners) {
      listener();
    }
  }
}

class FakeProcess extends FakeEmitter<SignalEvent> {
  exitCode: number | undefined;
  readonly kill = vi.fn(() => true);
  readonly pid = 4242;
  readonly stdin = new FakeEmitter<StdinEvent>();
}

describe('createStdioShutdownController', () => {
  it('closes server and watchers on SIGINT, then re-signals the process', async () => {
    const processRef = new FakeProcess();
    const server = { close: vi.fn().mockResolvedValue(undefined) };
    const watcherManager = { stopAll: vi.fn().mockResolvedValue(undefined) };
    const controller = createStdioShutdownController({
      processRef,
      server,
      watcherManager,
    });

    controller.register();
    processRef.emit('SIGINT');

    await vi.waitFor(() => {
      expect(server.close).toHaveBeenCalledOnce();
      expect(watcherManager.stopAll).toHaveBeenCalledOnce();
      expect(processRef.exitCode).toBe(0);
      expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGINT');
    });
  });

  it('treats stdin close as a shutdown signal and falls back to SIGTERM', async () => {
    const processRef = new FakeProcess();
    const server = { close: vi.fn().mockResolvedValue(undefined) };
    const watcherManager = { stopAll: vi.fn().mockResolvedValue(undefined) };
    const controller = createStdioShutdownController({
      processRef,
      server,
      watcherManager,
    });

    controller.register();
    processRef.stdin.emit('close');

    await vi.waitFor(() => {
      expect(server.close).toHaveBeenCalledOnce();
      expect(watcherManager.stopAll).toHaveBeenCalledOnce();
      expect(processRef.exitCode).toBe(0);
      expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    });
  });

  it('runs shutdown only once when multiple stop signals arrive', async () => {
    const processRef = new FakeProcess();
    const server = { close: vi.fn().mockResolvedValue(undefined) };
    const watcherManager = { stopAll: vi.fn().mockResolvedValue(undefined) };
    const controller = createStdioShutdownController({
      processRef,
      server,
      watcherManager,
    });

    controller.register();
    processRef.emit('SIGTERM');
    processRef.stdin.emit('end');

    await vi.waitFor(() => {
      expect(server.close).toHaveBeenCalledOnce();
      expect(watcherManager.stopAll).toHaveBeenCalledOnce();
      expect(processRef.kill).toHaveBeenCalledOnce();
    });
  });

  it('sets a failing exit code when shutdown cleanup throws', async () => {
    const processRef = new FakeProcess();
    const server = { close: vi.fn().mockRejectedValue(new Error('close failed')) };
    const watcherManager = { stopAll: vi.fn().mockResolvedValue(undefined) };
    const controller = createStdioShutdownController({
      processRef,
      server,
      watcherManager,
    });

    controller.register();
    processRef.emit('SIGTERM');

    await vi.waitFor(() => {
      expect(processRef.exitCode).toBe(1);
      expect(processRef.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    });
  });
});
