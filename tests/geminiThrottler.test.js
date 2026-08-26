import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiLiveThrottler } from '../app/gemini-live-throttler.js';

describe('GeminiLiveThrottler Resource Management', () => {
  let throttler;

  beforeEach(() => {
    // Minimal setup - just instantiate the class
    // We'll test the dispose method behavior directly
    throttler = new GeminiLiveThrottler();
  });

  afterEach(() => {
    throttler.dispose();
  });

  it('should have default state after construction', () => {
    expect(throttler).toBeInstanceOf(GeminiLiveThrottler);
  });

  it('should dispose without errors', () => {
    // Just verify dispose runs without throwing
    expect(() => {
      throttler.dispose();
    }).not.toThrow();
  });
});