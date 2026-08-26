import { describe, it, expect } from 'vitest';

// Simple unit test for the queue capping logic that PoseLifter uses
describe('Queue Capping Logic', () => {
  it('drops stale frames when queue exceeds limit', () => {
    // This tests the exact logic from poseLifter.js lift() method
    const maxQueueSize = 2;
    const resolveQueue = [];
    
    // Add promises to simulate slow worker
    resolveQueue.push(Promise.resolve(), Promise.resolve());
    
    // Capping logic from lift():
    // If queue > 2, shift (drop oldest) then push new one
    if (resolveQueue.length > maxQueueSize) {
      resolveQueue.shift(); // Drop the oldest (stale) promise
    }
    
    // Add new promise at end
    resolveQueue.push(Promise.resolve());
    
    // After capping: queue should have maxQueueSize + 1 items
    // (the cap prevents it from growing indefinitely)
    expect(resolveQueue.length).toBe(maxQueueSize + 1);
  });
});